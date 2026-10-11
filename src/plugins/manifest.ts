/**
 * manifest.ts — 插件清单的**契约与校验**。
 *
 * 一个插件就是一个 ESM 文件，导出一个 `plugin` 对象：
 *
 * ```js
 * // my-plugin.js —— 放进 <工程目录>/plugins/
 * export const plugin = {
 *   format: 'artmatic-plugin',
 *   apiVersion: 1,
 *   id: 'my-plugin',              // [a-z0-9][a-z0-9._-]*，长度 ≤ 64
 *   name: '我的插件',
 *   author: '…', version: '1.0.0', license: 'MIT',
 *   effects: [
 *     {
 *       id: 'scanline',           // 对外 id = 'my-plugin/scanline'
 *       name: '扫描线',
 *       desc: '一条会走的亮线。',
 *       category: 'style',        // 六选一，缺省 'style'
 *       tags: ['overlay'],
 *       params: [
 *         { key: 'amount', labelKey: '强度', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
 *       ],
 *       shader: {
 *         fragment: `void main() { outColor = texture(u_texture, vUv); }`,  // 不含头
 *         setUniforms: (gl, locs, values) => { … },
 *       },
 *     },
 *   ],
 *   generators: [
 *     {
 *       id: 'waves', name: '波纹', params: [],
 *       fragment: `void main() { … }`,                                       // 不含头
 *       setUniforms: () => {},
 *     },
 *   ],
 * };
 * ```
 *
 * ## 三条设计约束
 *
 * 1. **这个文件是纯函数**，不碰 DOM / GL / 文件系统 —— 校验逻辑是插件系统里
 *    最多分支的一段，必须能脱离浏览器单测（与 `project/layout.ts` 同一条纪律）。
 * 2. **问题一律用 `code` 表达，不写整句中文**。理由有两条：注册表/校验层不该
 *    依赖 i18n 的运行期模块；`src/` 下不许出现面向用户的中文字面量（`i18n.test.ts`
 *    守卫）。句子由 UI 按 code 查表（`ui/plugin-manager/plugin-panel-model.ts`）。
 * 3. **校验只做「能不能安全地交给运行期」这一件事**，不做语义检查：着色器能不能
 *    编译由 `PluginHost` 用真 GL 编译回答（见 `plugins/host.ts`），参数的业务约束
 *    （默认值是否在选项里之类）由 `algo-params.test.ts` 那一族守卫内置数据 —— 
 *    插件数据没有构建期守卫，所以这里只保证「不会让 Inspector 抛异常」。
 */

import { EFFECT_CATEGORIES, EFFECT_TAGS, type EffectCategory, type EffectTag } from '../effects/catalog';
import type { EffectShaderDef } from '../effects/shader-def';
import type { ParamDef } from '../effects/types';
import type { AlgoSetUniforms } from '../algos/shader-lib';
import { normalizeLabel, type Label } from '../i18n/label';
import { isValidPluginSegment } from '../core/plugin-id';

/** 清单里的格式标记。写错一律拒收（避免把别的 JSON 当插件喂进来）。 */
export const PLUGIN_FORMAT = 'artmatic-plugin';

/**
 * 本宿主能理解的最高 API 版本。
 *
 * 插件写更高的版本 = 它用了宿主还没有的能力，**必须拒收**而不是「尽力而为」——
 * 半个插件挂上去的表现是「某些参数拨了没反应」，那比明确拒收难查十倍。
 */
export const PLUGIN_API_VERSION = 1;

/* ------------------------------------------------------------- 问题码 */

export type PluginIssueCode =
  /** 导出的不是对象。 */
  | 'not-object'
  /** `format` 不是 'artmatic-plugin'。 */
  | 'bad-format'
  /** `apiVersion` 不是 1..PLUGIN_API_VERSION 的整数。 */
  | 'bad-api-version'
  /** `id` 不符合 `[a-z0-9][a-z0-9._-]*`（≤ 64）。 */
  | 'bad-id'
  /** `name` 不是非空字符串。 */
  | 'bad-name'
  /** `effects` / `generators` 不是数组。 */
  | 'bad-list'
  /** 两个列表都空 —— 挂上去什么也不会发生，多半是写错了字段名。 */
  | 'no-defs'
  /** 条目不是对象 / 缺 id / id 非法 / 缺 name。 */
  | 'bad-def'
  /** 同一个插件里 id 重复（后面的会被丢掉）。 */
  | 'duplicate-id'
  /** 参数表里有一项结构不合法（会让检查器渲染不出来）。 */
  | 'bad-param'
  /** 着色器定义不合法。 */
  | 'bad-shader'
  /** 分类 / 标签不认识（**只警告**，那一项被丢掉，条目照常挂载）。 */
  | 'unknown-meta'
  /** 文件读不出来（权限 / 坏文件）。 */
  | 'read-failed'
  /** 着色器编不过（真 GL 编译回答的，不在校验层猜）。 */
  | 'compile-failed'
  /** 着色器声明了某个 uniform 但从没读过它 —— 那个参数拨了不会有反应。 */
  | 'dropped-uniform';

export interface PluginIssue {
  code: PluginIssueCode;
  /** 出问题的位置，如 `effects[0].params[2]`。给 UI 定位用，不含文案。 */
  path?: string;
  /** 出问题的实际值（id / 类型名等），**非文案**。 */
  detail?: string;
}

/* ------------------------------------------------------------- 类型 */

export interface PluginEffectDef {
  id: string;
  name: Label;
  desc: Label | null;
  category: EffectCategory | null;
  tags: EffectTag[];
  params: ParamDef[];
  shader: EffectShaderDef;
}

export interface PluginGeneratorDef {
  id: string;
  name: Label;
  desc: Label | null;
  params: ParamDef[];
  fragment: string;
  setUniforms: AlgoSetUniforms;
}

export interface PluginManifest {
  format: typeof PLUGIN_FORMAT;
  apiVersion: number;
  id: string;
  name: string;
  author: string | null;
  version: string | null;
  license: string | null;
  effects: PluginEffectDef[];
  generators: PluginGeneratorDef[];
}

export type ValidateResult =
  | { ok: true; manifest: PluginManifest; warnings: PluginIssue[] }
  | { ok: false; issues: PluginIssue[] };

/* --------------------------------------------------------- 小工具 */

const PARAM_TYPES = new Set(['range', 'select', 'checkbox', 'color', 'bitmask', 'pattern']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * 非空字符串。**空白串算空** —— 一个 `name: '   '` 的插件在列表里是一行空白，
 * 而「为什么这一行没有名字」没人查得出来。原样返回（不做 trim），
 * 免得把 `id` / 选项值这类**要精确匹配**的字段改掉。
 */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

/** 读一个可选文本字段：缺省 → null；给了但不是非空字符串 → null（不报错）。 */
function optionalText(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

/* ----------------------------------------------------- 参数表校验 */

/**
 * 校验一项 `ParamDef`。返回 `null` 表示合法。
 *
 * 判据只有一条：**`Inspector.svelte` 的渲染分支会不会在它身上抛**。
 * 那里是 `{#if}` 链，未知类型会被静默跳过（不渲染），所以「未知类型」不算
 * 致命 —— 但缺 `options` 的 select 会直接 `undefined.map` 崩掉整块面板。
 */
function checkParam(raw: unknown, path: string): PluginIssue | null {
  if (!isObject(raw)) return { code: 'bad-param', path, detail: 'not-object' };
  const key = str(raw.key);
  if (!key) return { code: 'bad-param', path, detail: 'key' };
  if (!normalizeLabel(raw.labelKey)) return { code: 'bad-param', path, detail: 'labelKey' };
  if (raw.visibleWhen !== undefined && typeof raw.visibleWhen !== 'function') {
    return { code: 'bad-param', path, detail: 'visibleWhen' };
  }
  const type = str(raw.type);
  if (!type) return { code: 'bad-param', path, detail: 'type' };
  if (!PARAM_TYPES.has(type)) return { code: 'bad-param', path, detail: `type:${type}` };

  switch (type) {
    case 'range': {
      if (num(raw.min) === null) return { code: 'bad-param', path, detail: 'min' };
      if (num(raw.max) === null) return { code: 'bad-param', path, detail: 'max' };
      if (num(raw.step) === null) return { code: 'bad-param', path, detail: 'step' };
      if (num(raw.defaultValue) === null) return { code: 'bad-param', path, detail: 'defaultValue' };
      if (raw.curve !== undefined && num(raw.curve) === null) {
        return { code: 'bad-param', path, detail: 'curve' };
      }
      return null;
    }
    case 'select': {
      if (str(raw.defaultValue) === null) return { code: 'bad-param', path, detail: 'defaultValue' };
      if (!Array.isArray(raw.options) || raw.options.length === 0) {
        return { code: 'bad-param', path, detail: 'options' };
      }
      for (const [i, o] of raw.options.entries()) {
        if (!isObject(o) || str(o.value) === null || !normalizeLabel(o.labelKey)) {
          return { code: 'bad-param', path: `${path}.options[${i}]`, detail: 'option' };
        }
      }
      return null;
    }
    case 'checkbox': {
      if (num(raw.defaultValue) === null) return { code: 'bad-param', path, detail: 'defaultValue' };
      return null;
    }
    case 'color': {
      if (str(raw.defaultValue) === null) return { code: 'bad-param', path, detail: 'defaultValue' };
      return null;
    }
    case 'bitmask': {
      if (num(raw.bits) === null || (num(raw.bits) as number) <= 0) {
        return { code: 'bad-param', path, detail: 'bits' };
      }
      if (num(raw.defaultValue) === null) return { code: 'bad-param', path, detail: 'defaultValue' };
      if (!Array.isArray(raw.groups) || raw.groups.length === 0) {
        return { code: 'bad-param', path, detail: 'groups' };
      }
      for (const [i, g] of raw.groups.entries()) {
        if (!isObject(g) || num(g.bits) === null || !normalizeLabel(g.labelKey)) {
          return { code: 'bad-param', path: `${path}.groups[${i}]`, detail: 'group' };
        }
        if (g.style !== 'eca' && g.style !== 'count') {
          return { code: 'bad-param', path: `${path}.groups[${i}]`, detail: 'style' };
        }
      }
      if (raw.presets !== undefined) {
        if (!Array.isArray(raw.presets)) return { code: 'bad-param', path, detail: 'presets' };
        for (const [i, o] of raw.presets.entries()) {
          if (!isObject(o) || num(o.value) === null || !normalizeLabel(o.labelKey)) {
            return { code: 'bad-param', path: `${path}.presets[${i}]`, detail: 'preset' };
          }
        }
      }
      return null;
    }
    case 'pattern': {
      if (typeof raw.defaultValue !== 'string') return { code: 'bad-param', path, detail: 'defaultValue' };
      if (raw.editorSize !== undefined && num(raw.editorSize) === null) {
        return { code: 'bad-param', path, detail: 'editorSize' };
      }
      if (raw.mode !== undefined && raw.mode !== '2d' && raw.mode !== '1d') {
        return { code: 'bad-param', path, detail: 'mode' };
      }
      return null;
    }
    default:
      return null;
  }
}

/** 整张参数表：逐项校验 + 键唯一（重复键会让两个控件改同一个值）。 */
function checkParams(raw: unknown, path: string): PluginIssue[] {
  if (!Array.isArray(raw)) return [{ code: 'bad-param', path, detail: 'not-array' }];
  const out: PluginIssue[] = [];
  const seen = new Set<string>();
  for (const [i, p] of raw.entries()) {
    const issue = checkParam(p, `${path}[${i}]`);
    if (issue) {
      out.push(issue);
      continue;
    }
    const key = (p as { key: string }).key;
    if (seen.has(key)) out.push({ code: 'bad-param', path: `${path}[${i}]`, detail: `dup-key:${key}` });
    seen.add(key);
  }
  return out;
}

/** 一个 pre-pass。 */
function checkPrePass(raw: unknown, path: string): PluginIssue | null {
  if (!isObject(raw)) return { code: 'bad-shader', path, detail: 'not-object' };
  if (typeof raw.fragment !== 'string' || raw.fragment.trim().length === 0) {
    return { code: 'bad-shader', path, detail: 'fragment' };
  }
  for (const k of ['linearFilter', 'feedback', 'delayedInput']) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') {
      return { code: 'bad-shader', path, detail: k };
    }
  }
  return null;
}

/**
 * 特效的着色器定义。
 *
 * 只查**结构**：`fragment` 是不是非空字符串、`setUniforms` 是不是函数、
 * pre-pass 数组的形状。GLSL 的语法/链接错误由真 GL 编译来回答
 * （`PluginHost` 在挂载时编译一遍），不在这里猜。
 */
function checkShader(raw: unknown, path: string): PluginIssue[] {
  if (!isObject(raw)) return [{ code: 'bad-shader', path, detail: 'not-object' }];
  const out: PluginIssue[] = [];
  if (typeof raw.fragment !== 'string' || raw.fragment.trim().length === 0) {
    out.push({ code: 'bad-shader', path, detail: 'fragment' });
  }
  if (typeof raw.setUniforms !== 'function') {
    out.push({ code: 'bad-shader', path, detail: 'setUniforms' });
  }
  if (raw.prePasses !== undefined) {
    if (!Array.isArray(raw.prePasses)) {
      out.push({ code: 'bad-shader', path, detail: 'prePasses' });
    } else {
      for (const [i, pp] of raw.prePasses.entries()) {
        const issue = checkPrePass(pp, `${path}.prePasses[${i}]`);
        if (issue) out.push(issue);
      }
    }
  }
  for (const k of ['feedback', 'hdrFeedback', 'linearFilter', 'opaqueOutput']) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') {
      out.push({ code: 'bad-shader', path, detail: k });
    }
  }
  return out;
}

/* ------------------------------------------------------- 主入口 */

/**
 * 校验一个插件的导出物。
 *
 * **拒收（`ok: false`）与警告（`warnings`）的分界**：会不会让「挂上去之后
 * 界面/渲染出问题」。结构问题一律拒收整条插件（因为它多半是写错了字段名，
 * 半挂上去最难查）；分类/标签不认识只警告并丢掉那一项（条目本身是好的）。
 */
export function validateManifest(raw: unknown): ValidateResult {
  const issues: PluginIssue[] = [];
  const warnings: PluginIssue[] = [];

  if (!isObject(raw)) return { ok: false, issues: [{ code: 'not-object' }] };

  if (raw.format !== PLUGIN_FORMAT) {
    return { ok: false, issues: [{ code: 'bad-format', detail: String(raw.format ?? '') }] };
  }

  const apiVersion = num(raw.apiVersion);
  if (apiVersion === null || !Number.isInteger(apiVersion) || apiVersion < 1 || apiVersion > PLUGIN_API_VERSION) {
    return { ok: false, issues: [{ code: 'bad-api-version', detail: String(raw.apiVersion ?? '') }] };
  }

  const id = str(raw.id);
  if (!id || !isValidPluginSegment(id)) {
    return { ok: false, issues: [{ code: 'bad-id', detail: String(raw.id ?? '') }] };
  }

  const name = str(raw.name);
  if (!name) issues.push({ code: 'bad-name' });

  const effectsList = raw.effects ?? [];
  const generatorsList = raw.generators ?? [];
  const effectsIsArray = Array.isArray(effectsList);
  const generatorsIsArray = Array.isArray(generatorsList);
  if (!effectsIsArray) issues.push({ code: 'bad-list', path: 'effects' });
  if (!generatorsIsArray) issues.push({ code: 'bad-list', path: 'generators' });
  if (!effectsIsArray || !generatorsIsArray || issues.length > 0) return { ok: false, issues };
  const rawEffects = effectsList as unknown[];
  const rawGenerators = generatorsList as unknown[];

  const effects: PluginEffectDef[] = [];
  const generators: PluginGeneratorDef[] = [];
  const seen = new Set<string>();

  for (const [i, rawDef] of rawEffects.entries()) {
    const at = `effects[${i}]`;
    if (!isObject(rawDef)) {
      issues.push({ code: 'bad-def', path: at, detail: 'not-object' });
      continue;
    }
    const localId = str(rawDef.id);
    if (!localId || !isValidPluginSegment(localId)) {
      issues.push({ code: 'bad-def', path: at, detail: `id:${String(rawDef.id ?? '')}` });
      continue;
    }
    const label = normalizeLabel(rawDef.name);
    if (!label) {
      issues.push({ code: 'bad-def', path: at, detail: 'name' });
      continue;
    }
    if (seen.has(localId)) {
      issues.push({ code: 'duplicate-id', path: at, detail: localId });
      continue;
    }
    const paramIssues = checkParams(rawDef.params ?? [], `${at}.params`);
    const shaderIssues = checkShader(rawDef.shader, `${at}.shader`);
    if (paramIssues.length > 0 || shaderIssues.length > 0) {
      issues.push(...paramIssues, ...shaderIssues);
      continue;
    }

    let category: EffectCategory | null = null;
    if (rawDef.category !== undefined) {
      const c = str(rawDef.category);
      if (c && (EFFECT_CATEGORIES as string[]).includes(c)) category = c as EffectCategory;
      else warnings.push({ code: 'unknown-meta', path: at, detail: `category:${String(rawDef.category)}` });
    }

    const tags: EffectTag[] = [];
    if (rawDef.tags !== undefined) {
      if (!Array.isArray(rawDef.tags)) {
        warnings.push({ code: 'unknown-meta', path: at, detail: 'tags:not-array' });
      } else {
        for (const t of rawDef.tags) {
          if (typeof t === 'string' && (EFFECT_TAGS as string[]).includes(t)) tags.push(t as EffectTag);
          else warnings.push({ code: 'unknown-meta', path: at, detail: `tag:${String(t)}` });
        }
      }
    }

    seen.add(localId);
    effects.push({
      id: localId,
      name: label,
      desc: normalizeLabel(rawDef.desc),
      category,
      tags,
      params: (rawDef.params ?? []) as ParamDef[],
      shader: rawDef.shader as unknown as EffectShaderDef,
    });
  }

  for (const [i, rawDef] of rawGenerators.entries()) {
    const at = `generators[${i}]`;
    if (!isObject(rawDef)) {
      issues.push({ code: 'bad-def', path: at, detail: 'not-object' });
      continue;
    }
    const localId = str(rawDef.id);
    if (!localId || !isValidPluginSegment(localId)) {
      issues.push({ code: 'bad-def', path: at, detail: `id:${String(rawDef.id ?? '')}` });
      continue;
    }
    const label = normalizeLabel(rawDef.name);
    if (!label) {
      issues.push({ code: 'bad-def', path: at, detail: 'name' });
      continue;
    }
    if (seen.has(localId)) {
      issues.push({ code: 'duplicate-id', path: at, detail: localId });
      continue;
    }
    const paramIssues = checkParams(rawDef.params ?? [], `${at}.params`);
    if (paramIssues.length > 0) {
      issues.push(...paramIssues);
      continue;
    }
    if (typeof rawDef.fragment !== 'string' || rawDef.fragment.trim().length === 0) {
      issues.push({ code: 'bad-shader', path: at, detail: 'fragment' });
      continue;
    }
    if (typeof rawDef.setUniforms !== 'function') {
      issues.push({ code: 'bad-shader', path: at, detail: 'setUniforms' });
      continue;
    }

    seen.add(localId);
    generators.push({
      id: localId,
      name: label,
      desc: normalizeLabel(rawDef.desc),
      params: (rawDef.params ?? []) as ParamDef[],
      fragment: rawDef.fragment,
      setUniforms: rawDef.setUniforms as AlgoSetUniforms,
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  if (effects.length === 0 && generators.length === 0) {
    return { ok: false, issues: [{ code: 'no-defs' }] };
  }

  return {
    ok: true,
    warnings,
    manifest: {
      format: PLUGIN_FORMAT,
      apiVersion,
      id,
      name: name as string,
      author: optionalText(raw.author),
      version: optionalText(raw.version),
      license: optionalText(raw.license),
      effects,
      generators,
    },
  };
}

/**
 * 从模块的导出物里取清单。
 *
 * 同时接受 `export const plugin = …` 与 `export default …`：前者是文档里写的
 * 形式（自带名字，读代码时一眼看得出这是什么），后者是写起来最省事的形式。
 * 两个都没有时返回 `null`，由调用方翻译成一条可读的失败原因。
 */
export function manifestFromModule(mod: unknown): unknown {
  if (!isObject(mod)) return null;
  if ('plugin' in mod) return mod.plugin;
  if ('default' in mod) return mod.default;
  return null;
}
