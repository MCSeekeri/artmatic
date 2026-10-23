/**
 * script/model.ts — 文档级脚本的**数据模型与清洗**（纯函数，不碰 DOM）。
 *
 * 脚本是文档的可选字段（`TypographyDocument.scripts`），按 `groups` / `theme`
 * 的约定**不抬 SCHEMA_VERSION**：老工程没有这个键 = 没有脚本。
 *
 * 三条不能破的纪律：
 *  1. `sanitizeScripts` **永不抛**。工程必须打得开 —— 坏脚本整条丢弃，
 *     问题以**路径字符串**报回（`scripts[2].needs[0]`），句子由 UI/agent 翻。
 *  2. 代码**原样保留**（只钳长度）。trim 会让编译错误的行号与用户看到的
 *     对不上，而脚本编辑器唯一的定位手段就是行号。
 *  3. 这里不写任何面向用户的文案：`src/` 下不允许中文字面量（i18n 守卫），
 *     运行期诊断只存 **code + detail**，句子在 `typography.ts` 的文案表里。
 */

import type { TypographyDocument } from '../document';

/** 结构预处理声明。不是运行期探测 —— DOM 必须在脚本执行之前就建好。 */
export const SCRIPT_NEEDS = ['chars', 'canvas'] as const;
export type ScriptNeed = (typeof SCRIPT_NEEDS)[number];

export interface TypographyScript {
  id: string;
  /** 展示名。用户可改；缺省是 `Script N`（ASCII，数据层不产出文案）。 */
  name: string;
  /**
   * 函数体源码。`ctx` 在作用域内，**必须同步**执行。
   *
   * 编译方式见 `compile.ts`：
   *   `new Function('ctx', <遮蔽的全局>, '"use strict";' + code)`
   * 因此用户写的是语句，不是 `(ctx) => {…}` 表达式。
   */
  code: string;
  /** 单条启停。总开关在 UI 偏好里（默认关）。 */
  enabled: boolean;
  /**
   * 需要结构预处理的元素 id。缺省 / 空数组 = **全部可见元素**。
   *
   * 它不是「脚本只能操作这些元素」的限制 —— `ctx.el(id)` 任何时候都能拿到
   * 任何可见元素；它只决定 render-dom 要不要为目标元素多铺一层 DOM
   * （逐字 span / canvas 节点）。
   */
  targets?: string[];
  /** 需要 render-dom 预先建好的结构。 */
  needs?: ScriptNeed[];
}

/** 硬上限。写进能力清单（agent 唯一能看到「能写多大」的地方）。 */
export const SCRIPT_LIMITS = {
  /** 每条文档最多几条脚本。 */
  maxScripts: 8,
  /** 单条源码字符数。 */
  maxCodeChars: 20_000,
  /** 整份文档的源码总字符数。 */
  maxTotalCodeChars: 65_536,
  /** 单条脚本的目标元素上限。 */
  maxTargets: 200,
  /** 单脚本软警告（ms）；超过只进诊断，不中断。 */
  softMs: 4,
  /** 单脚本硬上限（ms）：下一次写入时抛错并中止该脚本。 */
  hardMs: 12,
  /** 每帧写入次数上限（样式 + 属性 + canvas 取用各算一次）。 */
  maxWrites: 5_000,
  /** 路径变形等长化后的节点数上限（防止 morph 把一条路径炸成几万个点）。 */
  maxMorphNodes: 512,
} as const;

export interface SanitizedScripts {
  scripts: TypographyScript[];
  /** 被丢弃 / 被截断的位置，如 `scripts[1].code`。 */
  dropped: string[];
  /** 清洗后的总源码字符数。 */
  totalChars: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asName(raw: unknown, index: number): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 120);
  return `Script ${index + 1}`;
}

function asNeeds(raw: unknown, at: string, dropped: string[]): ScriptNeed[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    dropped.push(at);
    return undefined;
  }
  const out: ScriptNeed[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item !== 'string' || !(SCRIPT_NEEDS as readonly string[]).includes(item)) {
      dropped.push(`${at}[${i}]`);
      continue;
    }
    if (!out.includes(item as ScriptNeed)) out.push(item as ScriptNeed);
  }
  return out.length ? out : undefined;
}

function asTargets(raw: unknown, at: string, dropped: string[]): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    dropped.push(at);
    return undefined;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item !== 'string' || !item.trim()) {
      dropped.push(`${at}[${i}]`);
      continue;
    }
    const id = item.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    if (out.length >= SCRIPT_LIMITS.maxTargets) {
      dropped.push(`${at}[${i}]`);
      continue;
    }
    out.push(id);
  }
  return out.length ? out : undefined;
}

/**
 * 把任意输入洗成一份合法脚本表。**永不抛**。
 *
 * 截断策略：超过条数上限的条目整条丢弃；单条超过代码上限的**截断**并把
 * 该条目标成 `enabled:false` —— 半条代码跑起来比不跑更难查，但直接丢整条
 * 会让用户以为自己写丢了。禁用 + 诊断是唯一诚实的处置。
 */
export function sanitizeScripts(raw: unknown): SanitizedScripts {
  const dropped: string[] = [];
  if (raw === undefined || raw === null) return { scripts: [], dropped, totalChars: 0 };
  if (!Array.isArray(raw)) return { scripts: [], dropped: ['scripts'], totalChars: 0 };

  const scripts: TypographyScript[] = [];
  const seen = new Set<string>();
  let totalChars = 0;

  for (const [i, item] of raw.entries()) {
    const at = `scripts[${i}]`;
    if (scripts.length >= SCRIPT_LIMITS.maxScripts) {
      dropped.push(at);
      continue;
    }
    if (!isRecord(item)) {
      dropped.push(at);
      continue;
    }
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
    if (!id || seen.has(id)) {
      dropped.push(`${at}.id`);
      continue;
    }
    seen.add(id);

    let code = typeof item.code === 'string' ? item.code : '';
    if (!code.trim()) {
      dropped.push(`${at}.code`);
      continue;
    }
    let enabled = item.enabled !== false;
    if (code.length > SCRIPT_LIMITS.maxCodeChars) {
      code = code.slice(0, SCRIPT_LIMITS.maxCodeChars);
      enabled = false;
      dropped.push(`${at}.code`);
    }
    const remaining = SCRIPT_LIMITS.maxTotalCodeChars - totalChars;
    if (remaining <= 0) {
      dropped.push(at);
      continue;
    }
    if (code.length > remaining) {
      code = code.slice(0, remaining);
      enabled = false;
      dropped.push(`${at}.code`);
    }
    totalChars += code.length;

    const targets = asTargets(item.targets, `${at}.targets`, dropped);
    const needs = asNeeds(item.needs, `${at}.needs`, dropped);

    scripts.push({
      id,
      name: asName(item.name, i),
      code,
      enabled,
      ...(targets ? { targets } : {}),
      ...(needs ? { needs } : {}),
    });
  }

  return { scripts, dropped, totalChars };
}

/** 文档里有没有**会跑**的脚本（总开关不在这个判断里）。 */
export function hasRunnableScripts(doc: { scripts?: TypographyScript[] }): boolean {
  return (doc.scripts ?? []).some((s) => s.enabled && s.code.trim().length > 0);
}

export function scriptCount(doc: { scripts?: TypographyScript[] }): number {
  return (doc.scripts ?? []).length;
}

/** 结构签名片段：`needs` / `targets` 变了必须重建 DOM。 */
export function scriptSignature(doc: { scripts?: TypographyScript[] }): string {
  return (doc.scripts ?? [])
    .map(
      (s) =>
        `${s.id}:${s.enabled ? 1 : 0}:${(s.needs ?? []).join('+')}:${(s.targets ?? []).join(',')}`,
    )
    .join('|');
}

export interface ElementScriptNeeds {
  chars: boolean;
  canvas: boolean;
}

/**
 * 每个元素需要哪些结构预处理。
 *
 * 只统计**启用的**脚本：停用的脚本不该继续让整篇文本铺逐字 span
 * （那是实打实的 DOM 成本，而用户已经说了「这条不跑」）。
 */
export function scriptNeedsByElement(doc: TypographyDocument): Map<string, ElementScriptNeeds> {
  const out = new Map<string, ElementScriptNeeds>();
  const all = doc.elements.map((e) => e.id);
  const bump = (ids: readonly string[], need: ScriptNeed): void => {
    for (const id of ids) {
      const cur = out.get(id) ?? { chars: false, canvas: false };
      cur[need] = true;
      out.set(id, cur);
    }
  };
  for (const s of doc.scripts ?? []) {
    if (!s.enabled || !s.needs?.length) continue;
    const targets = s.targets?.length ? s.targets : all;
    for (const need of s.needs) bump(targets, need);
  }
  return out;
}

/** 简易 FNV-1a：只用于编译缓存 / 代码变化判定，不用于安全场合。 */
export function codeHash(code: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
