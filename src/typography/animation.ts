/**
 * animation.ts — CSS 动画模型（纯数据 + 纯函数，**不碰 DOM**）。
 *
 * 时间全部相对**片段起点**。唯一时钟是 t（AGENTS §1.1），这里绝不出现
 * Date.now() / performance.now()。
 *
 * 求值与渲染的分工：
 *  - 本文件只负责「localSec → WAAPI currentTime（ms）」这一层纯换算；
 *  - 真正把动画 seek 到那个时刻的是 bake-animation.ts（有 DOM）。
 * 这样预览与导出走的是同一条求值路径，差别只在有没有把结果固化进内联样式。
 *
 * 一个元素可以挂**多个动画条目**：渲染时每个条目嵌一层 `<div class="typo-anim">`
 * （render-dom.ts）。自定义条目还可以在**同一层里**再写多条逗号分隔的动画
 * （同时 / 先后跑），见 CustomAnimation。
 */

import type { TypographyDocument } from './document';
import { tr } from '../i18n/index.svelte';
import type { MessageKey } from '../i18n/locales';

/** 动画名统一加前缀，避免与用户手写 CSS 或页面其它动画撞名。 */
export const ANIM_NAME_PREFIX = 'artmatic-a-';
/** 动画挂载在元素的**内层包装**上（外层的 transform 被旋转占用），见 render-dom.ts。 */
export const ANIM_ID_ATTR = 'data-anim-id';

export type Easing =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  /** cubic-bezier(x1, y1, x2, y2) */
  | [number, number, number, number];

export type AnimPreset =
  | 'fade-in'
  | 'fade-out'
  | 'fade-in-out'
  | 'slide-in-left'
  | 'slide-in-right'
  | 'slide-in-up'
  | 'slide-in-down'
  | 'zoom-in'
  | 'zoom-out'
  | 'pop'
  | 'spin'
  | 'pulse'
  | 'shake'
  | 'blur-in';

export interface AnimTiming {
  /** 秒，相对片段起点。 */
  delay: number;
  /** 单次时长，秒。 */
  duration: number;
  /** 有限次数；Infinity → CSS 的 'infinite'。 */
  iterations: number;
  easing: Easing;
  direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  fill: 'none' | 'forwards' | 'backwards' | 'both';
}

export interface PresetAnimation extends AnimTiming {
  id: string;
  kind: 'preset';
  preset: AnimPreset;
  /** 预设参数（slide 距离 px / zoom 起止缩放 / blur 半径 px）。 */
  params?: Record<string, number>;
}

export interface CustomAnimation extends AnimTiming {
  id: string;
  kind: 'custom';
  /**
   * 关键帧定义。两种形态，向后兼容：
   *
   *  - **单条（旧）**：只写一个 keyframes 的**体**，例如
   *    `from{opacity:0}to{opacity:1}`。它被自动命名成 `artmatic-a-<id>`，
   *    动画简写由 timing 字段生成 —— 旧工程渲染结果逐字不变。
   *  - **多条（新）**：一个或多个 `@keyframes <名字>{…}` 块。名字由用户起，
   *    输出时会加**元素级命名空间**（`artmatic-a-<id>-<名字>`），
   *    所以两个元素各写一个 `@keyframes pulse` 不会互相覆盖。
   *
   * 为什么不让用户写整段 CSS（他确实要「允许手写代码」，这是能力与安全的
   * 最小妥协）：滚动任意 CSS 字符串会带来三个真问题 ——
   *   ① `@import url(http://…)` 会外发网络请求，破坏「离线 + 确定性」；
   *   ② `position:fixed` 能让元素逃出快照区域，光栅化结果不可预测；
   *   ③ 顶层选择器会污染同页的其它元素（预览页里还有时间轴和面板）。
   * 允许 `@keyframes` 块之后，它仍然只能影响被绑定的那个元素（选择器恒为
   * `[data-anim-id]`），注入点唯一（一份 <style>，随快照进入隔离文档）。
   */
  css: string;
  /**
   * 多条形态下的一条**逗号分隔** `animation` 简写，每条引用本条目里定义的
   * keyframes 名字（或既有预设名，如 `fade-in`）。名字同样会被命名空间化。
   *
   * 缺省 → 退回由 timing 字段生成的**单条**简写（引用 `artmatic-a-<id>`），
   * 与旧单 body 形态渲染结果逐字一致。
   */
  animation?: string;
}

export type ElementAnimation = PresetAnimation | CustomAnimation;

/* ------------------------------------------------------------ 预设表 */

export interface AnimPresetDef {
  id: AnimPreset;
  /** 存文案键（见 effects/types.ts 的注释）。 */
  labelKey: MessageKey;
  duration: number;
  easing: Easing;
  params?: Record<string, number>;
}

export const ANIM_PRESETS: AnimPresetDef[] = [
  { id: 'fade-in', labelKey: 'anim.fadeIn', duration: 0.6, easing: 'ease-out' },
  { id: 'fade-out', labelKey: 'anim.fadeOut', duration: 0.6, easing: 'ease-in' },
  { id: 'fade-in-out', labelKey: 'anim.fadeInOut', duration: 1.2, easing: 'ease-in-out' },
  { id: 'slide-in-left', labelKey: 'anim.slideInLeft', duration: 0.6, easing: 'ease-out', params: { dist: 80 } },
  { id: 'slide-in-right', labelKey: 'anim.slideInRight', duration: 0.6, easing: 'ease-out', params: { dist: 80 } },
  // 注意 id 与文案的对应关系是原样保留的：id 描述**运动方向**，文案描述**来向**，
  // 所以 slide-in-up 配「下方滑入」。改文案时别顺手把它「修正」成上方。
  { id: 'slide-in-up', labelKey: 'anim.slideInUp', duration: 0.6, easing: 'ease-out', params: { dist: 80 } },
  { id: 'slide-in-down', labelKey: 'anim.slideInDown', duration: 0.6, easing: 'ease-out', params: { dist: 80 } },
  { id: 'zoom-in', labelKey: 'anim.zoomIn', duration: 0.6, easing: 'ease-out', params: { z0: 0.8 } },
  { id: 'zoom-out', labelKey: 'anim.zoomOut', duration: 0.6, easing: 'ease-out', params: { z1: 1.25 } },
  { id: 'pop', labelKey: 'anim.pop', duration: 0.45, easing: 'ease-in-out', params: { z1: 1.15 } },
  { id: 'spin', labelKey: 'anim.spin', duration: 1, easing: 'linear' },
  { id: 'pulse', labelKey: 'anim.pulse', duration: 1, easing: 'ease-in-out' },
  { id: 'shake', labelKey: 'anim.shake', duration: 0.5, easing: 'linear' },
  { id: 'blur-in', labelKey: 'anim.blurIn', duration: 0.7, easing: 'ease-out', params: { blur: 12 } },
];

const PRESET_IDS = new Set<string>(ANIM_PRESETS.map((d) => d.id));

/** 某个名字是不是内置预设（多动画简写里可以直接引用预设名）。 */
export function isPresetId(name: string): name is AnimPreset {
  return PRESET_IDS.has(name);
}

/**
 * 预设的展示名。找不到就回落到 id 本身 —— 与 `tr()` 的处理同构：
 * 宁可显示一个看得懂的标识符，也不要显示空白。
 */
export function presetLabel(p: AnimPreset): string {
  const def = ANIM_PRESETS.find((d) => d.id === p);
  return def ? tr(def.labelKey) : p;
}

export function defaultTiming(): AnimTiming {
  return {
    delay: 0,
    duration: 0.6,
    iterations: 1,
    easing: 'ease-out',
    direction: 'normal',
    fill: 'both',
  };
}

export function animationName(anim: ElementAnimation): string {
  return `${ANIM_NAME_PREFIX}${anim.id}`;
}

/* ------------------------------------------------------------ 求值（纯函数） */

/**
 * 本地时间 → WAAPI 的 currentTime（ms）。
 *
 * 只依赖 `delay`（多动画简写里每条各有自己的延迟，见 customSubAnimations）。
 *
 * 延迟之前钳到 0：`fill: backwards` 时显示首帧、`fill: none` 时显示基础样式，
 * 两种都是确定的，且与真实播放的首帧一致。
 */
export function animationCurrentTimeMs(anim: { delay: number }, localSec: number): number {
  return Math.max(0, (localSec - anim.delay) * 1000);
}

/** 此刻动画是否落在「有作用」的区间内（图层面板给动画打点 / 高亮用）。 */
export function isAnimationActiveAt(anim: ElementAnimation, localSec: number): boolean {
  const elapsed = localSec - anim.delay;
  if (elapsed < 0) return false;
  if (anim.iterations === Infinity) return true;
  return elapsed <= anim.duration * anim.iterations + 1e-9;
}

/** 预设 → @keyframes 的**体**（不含 `@keyframes ...{}` 外壳）。纯函数。 */
export function presetKeyframes(preset: AnimPreset, params: Record<string, number> = {}): string {
  const dist = params.dist ?? 80;
  const z0 = params.z0 ?? 0.8;
  const z1 = params.z1 ?? 1.25;
  const blur = params.blur ?? 12;

  switch (preset) {
    case 'fade-in':
      return 'from{opacity:0}to{opacity:1}';
    case 'fade-out':
      return 'from{opacity:1}to{opacity:0}';
    case 'fade-in-out':
      return '0%{opacity:0}50%{opacity:1}100%{opacity:0}';
    case 'slide-in-left':
      return `from{transform:translateX(${-dist}px);opacity:0}to{transform:translateX(0);opacity:1}`;
    case 'slide-in-right':
      return `from{transform:translateX(${dist}px);opacity:0}to{transform:translateX(0);opacity:1}`;
    case 'slide-in-up':
      return `from{transform:translateY(${dist}px);opacity:0}to{transform:translateY(0);opacity:1}`;
    case 'slide-in-down':
      return `from{transform:translateY(${-dist}px);opacity:0}to{transform:translateY(0);opacity:1}`;
    case 'zoom-in':
      return `from{transform:scale(${z0});opacity:0}to{transform:scale(1);opacity:1}`;
    case 'zoom-out':
      return `from{transform:scale(${z1});opacity:0}to{transform:scale(1);opacity:1}`;
    case 'pop':
      return `0%{transform:scale(1)}60%{transform:scale(${z1})}100%{transform:scale(1)}`;
    case 'spin':
      return 'from{transform:rotate(0)}to{transform:rotate(360deg)}';
    case 'pulse':
      return '0%{opacity:1}50%{opacity:0.35}100%{opacity:1}';
    case 'shake':
      return '0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}';
    case 'blur-in':
      return `from{filter:blur(${blur}px);opacity:0}to{filter:blur(0);opacity:1}`;
  }
}

/* ------------------------------------------------------------ 手写 CSS 的解析 */

/**
 * 清洗用户手写的自定义 CSS（单 body 或多 @keyframes 块均可）。
 *
 * 剥掉标签 / `@import` / `@charset` / `@namespace` / 注释，并校验花括号配平：
 * 任何时刻 depth 不得为负，结束时必须归零。否则一个 `}` 就能提前闭合我们的
 * `@keyframes` 块，往后写任意顶层 CSS。
 *
 * 注意 keyframes 体里**合法地**包含成对的 `{}`（`from{...}to{...}`），所以
 * 不能简单地把花括号剥掉。清洗后为空字符串 = 非法，调用方应当拒绝写入。
 */
export function sanitizeCustomCss(css: string): string {
  let s = css.replace(/<\/?[a-z][^>]*>/gi, '');
  // 注释先剥：否则 `/* } */` 会干扰花括号配平（也会让 @import 藏在注释里蒙混）。
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/@import\b[^;]*;?/gi, '');
  s = s.replace(/@charset\b[^;]*;?/gi, '');
  s = s.replace(/@namespace\b[^;]*;?/gi, '');

  let depth = 0;
  for (const ch of s) {
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return '';
    }
  }
  if (depth !== 0) return '';
  return s.trim();
}

export function isValidCustomCss(css: string): boolean {
  return sanitizeCustomCss(css) !== '';
}

/** 交给编辑器预填的**可编辑文本**：单 body 原样，多动画 = 块 + 简写。 */
export function keyframeBodyOf(anim: ElementAnimation): string {
  if (anim.kind === 'preset') return presetKeyframes(anim.preset, anim.params);
  if (anim.animation) return `${anim.css}\nanimation: ${anim.animation};`.trim();
  return sanitizeCustomCss(anim.css);
}

/**
 * 自定义 CSS 被拒绝的原因。**只给编码** —— 组件负责翻成可读文案
 * （面向用户文案一律走 `tr()`，见 AGENTS §5.3）。
 */
export type CustomCssError =
  | 'unbalanced' // 花括号未配平 / 空
  | 'badAtRule' // 出现 @keyframes 之外的顶层 @ 规则
  | 'badSelector' // 顶层出现了选择器（不允许）
  | 'badKeyframeName' // @keyframes 名字不合法
  | 'missingAnimation' // 有 @keyframes 块却没有 animation 简写
  | 'badAnimation' // animation 简写解析失败
  | 'unknownName'; // 简写引用了未定义的动画名

export type CustomCssParse =
  | { ok: true; css: string; animation?: string }
  | { ok: false; reason: CustomCssError };

/**
 * 失败原因 → 文案键。**唯一一份**：编辑器弹窗与 agent 报错都从这里取。
 *
 * 两处各写一份的形态是「用户看到『引用的动画名没定义』、模型只收到『入参非法』」——
 * 后者只能靠改字符串试错，而每次试错都是一整轮往返。
 */
export const CUSTOM_CSS_ERROR_KEYS: Record<CustomCssError, MessageKey> = {
  unbalanced: 'typo.customCssUnbalanced',
  badAtRule: 'typo.customCssErrAtRule',
  badSelector: 'typo.customCssErrSelector',
  badKeyframeName: 'typo.customCssErrBadName',
  missingAnimation: 'typo.customCssErrMissingAnimation',
  badAnimation: 'typo.customCssErrBadAnimation',
  unknownName: 'typo.customCssErrUnknownName',
};

const KEYFRAME_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
/** `@keyframes` 体内合法的选择器：`from` / `to` / 百分比（可逗号分隔多个）。 */
const KEYFRAME_SELECTOR_RE = /^(from|to|(?:\d+\.?\d*|\.\d+)%)$/i;

/**
 * 校验一段**关键帧体**（`from{…}to{…}`）的选择器是否合法。
 *
 * 为什么必须校验：浏览器遇到非法的关键帧选择器（比如手滑写了个 `div{color:red}`）
 * 会**整条丢弃** `@keyframes`，于是动画「保存成功、就是不跑」，而且没有任何报错。
 * 旧单 body 形态绕过了 `scanCssBlocks`，这里是它唯一的闸口。
 */
function validKeyframeBody(s: string): boolean {
  const n = s.length;
  let i = 0;
  let sawBlock = false;
  while (i < n) {
    while (i < n && /\s/.test(s[i]!)) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && s[i] !== '{' && s[i] !== '}') i++;
    if (i >= n || s[i] === '}') return false;
    const sel = s.slice(start, i).trim();
    if (!sel) return false;
    for (const part of sel.split(',')) {
      if (!KEYFRAME_SELECTOR_RE.test(part.trim())) return false;
    }
    let depth = 1;
    i += 1;
    while (i < n && depth > 0) {
      if (s[i] === '{') depth += 1;
      else if (s[i] === '}') depth -= 1;
      i += 1;
    }
    if (depth !== 0) return false;
    sawBlock = true;
  }
  return sawBlock;
}

/** 顶层（括号 / 花括号内不算）是否出现 `@` 规则或 `animation:` 声明。 */
function looksStructured(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (ch === '@') return true;
      if ((ch === 'a' || ch === 'A') && /^animation\s*:/i.test(s.slice(i))) return true;
    }
  }
  return false;
}

interface CssScan {
  keyframes: { name: string; body: string }[];
  others: string[];
  error?: CustomCssError;
}

/**
 * 扫一遍（已清洗的）CSS：抽出所有 `@keyframes <名字>{<体>}` 块，其余顶层语段
 * 原样收进 `others`。非 keyframes 的顶层花括号 = 结构非法。
 */
function scanCssBlocks(s: string): CssScan {
  const keyframes: { name: string; body: string }[] = [];
  const others: string[] = [];
  const n = s.length;
  let i = 0;

  const fail = (error: CustomCssError): CssScan => ({ keyframes, others, error });

  while (i < n) {
    while (i < n && /\s/.test(s[i]!)) i++;
    if (i >= n) break;

    if (s[i] === '@') {
      const kw = /^@keyframes\b/i.exec(s.slice(i));
      if (!kw) return fail('badAtRule');
      i += kw[0].length;
      while (i < n && /\s/.test(s[i]!)) i++;
      const nameStart = i;
      while (i < n && /[A-Za-z0-9_-]/.test(s[i]!)) i++;
      const name = s.slice(nameStart, i);
      if (!KEYFRAME_NAME_RE.test(name)) return fail('badKeyframeName');
      while (i < n && /\s/.test(s[i]!)) i++;
      if (s[i] !== '{') return fail('unbalanced');
      const bodyStart = i + 1;
      let depth = 1;
      i += 1;
      while (i < n && depth > 0) {
        if (s[i] === '{') depth += 1;
        else if (s[i] === '}') depth -= 1;
        i += 1;
      }
      if (depth !== 0) return fail('unbalanced');
      const body = s.slice(bodyStart, i - 1).trim();
      // 体内选择器也要管：非法的关键帧选择器会让浏览器丢掉整条 @keyframes。
      if (!validKeyframeBody(body)) return fail('badSelector');
      keyframes.push({ name, body });
    } else {
      const start = i;
      let depth = 0;
      while (i < n) {
        const ch = s[i]!;
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
        else if (ch === '{') return fail('badSelector');
        else if (ch === '}') return fail('unbalanced');
        else if (ch === ';' && depth === 0) break;
        i += 1;
      }
      const stmt = s.slice(start, i).trim();
      if (stmt) others.push(stmt);
      i += 1;
    }
  }
  return { keyframes, others };
}

function parseMultiCss(s: string): CustomCssParse {
  const scan = scanCssBlocks(s);
  if (scan.error) return { ok: false, reason: scan.error };

  let animation: string | undefined;
  for (const stmt of scan.others) {
    const m = /^animation\s*:\s*([\s\S]+)$/i.exec(stmt);
    if (!m || animation !== undefined) return { ok: false, reason: 'badAnimation' };
    animation = m[1]!.trim();
  }

  if (animation === undefined) {
    // 只有块没有简写 = 不知道该怎么用；什么都没有 = 空。
    return {
      ok: false,
      reason: scan.keyframes.length > 0 ? 'missingAnimation' : 'unbalanced',
    };
  }

  const parsed = parseAnimationShorthand(animation);
  if (!parsed.ok) return { ok: false, reason: 'badAnimation' };

  const defined = new Set(scan.keyframes.map((b) => b.name));
  for (const p of parsed.parts) {
    if (!defined.has(p.name) && !isPresetId(p.name)) return { ok: false, reason: 'unknownName' };
  }

  return {
    ok: true,
    css: scan.keyframes.map((b) => `@keyframes ${b.name}{${b.body}}`).join(''),
    animation,
  };
}

/**
 * 解析编辑器里的一段自定义 CSS。纯函数。
 *
 * 判别：顶层不含 `@` 规则、也没有 `animation:` 声明 → **旧单 body 形态**
 * （整个文本就是一个 keyframes 体）；否则走多动画形态（N 个 `@keyframes` 块 +
 * 一条 `animation` 简写）。旧工程因此继续原样可用。
 */
export function parseCustomCss(raw: string): CustomCssParse {
  const s = sanitizeCustomCss(raw);
  if (!s) return { ok: false, reason: 'unbalanced' };
  // 旧形态没有 `@`，靠「整段就是一个关键帧体」判别；选择器写错时宁可拒绝。
  if (!looksStructured(s)) return validKeyframeBody(s) ? { ok: true, css: s } : { ok: false, reason: 'badSelector' };
  return parseMultiCss(s);
}

/* ------------------------------------------------------ animation 简写的解析 */

export interface ParsedAnimPart {
  /** 引用的动画名（本条目定义的 keyframes 名，或预设 id）。 */
  name: string;
  /** 秒。 */
  duration: number;
  /** 秒。 */
  delay: number;
  /** Infinity → infinite。 */
  iterations: number;
}

export type ShorthandParse = { ok: true; parts: ParsedAnimPart[] } | { ok: false };

const EASING_KEYWORDS = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
]);
const DIRECTION_KEYWORDS = new Set(['normal', 'reverse', 'alternate', 'alternate-reverse']);
const FILL_KEYWORDS = new Set(['none', 'forwards', 'backwards', 'both']);
const TIME_RE = /^[+-]?(\d+\.?\d*|\.\d+)(ms|s)$/i;
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const EASING_FN_RE = /^(cubic-bezier|steps|linear)\(/i;

/** 顶层按分隔符切（括号 / 花括号内不切）。 */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/** 顶层按空白切（`cubic-bezier(0.2, 0, 0.2, 1)` 里的空格不切）。 */
function splitWhitespace(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function toSeconds(tk: string): number {
  const n = Number.parseFloat(tk);
  return /ms$/i.test(tk) ? n / 1000 : n;
}

/** 一条动画（逗号分隔中的一段）→ 名字 + 时序。无法识别返回 null。 */
function parsePart(part: string): ParsedAnimPart | null {
  const tokens = splitWhitespace(part);
  let name = '';
  let duration = 0;
  let delay = 0;
  let iterations = 1;
  let timeSeen = 0;

  for (const tk of tokens) {
    if (TIME_RE.test(tk)) {
      if (timeSeen === 0) duration = toSeconds(tk);
      else if (timeSeen === 1) delay = toSeconds(tk);
      else return null; // 超过两个时间 —— 非法
      timeSeen++;
    } else if (tk.toLowerCase() === 'infinite') {
      iterations = Infinity;
    } else if (NUMBER_RE.test(tk)) {
      iterations = Number(tk);
    } else if (EASING_KEYWORDS.has(tk.toLowerCase()) || EASING_FN_RE.test(tk)) {
      // 缓动，忽略
    } else if (DIRECTION_KEYWORDS.has(tk.toLowerCase()) || FILL_KEYWORDS.has(tk.toLowerCase())) {
      // 方向 / 填充，忽略
    } else if (IDENT_RE.test(tk)) {
      if (name) return null; // 两个候选名 —— 非法
      name = tk;
    } else {
      return null;
    }
  }
  if (!name) return null;
  return { name, duration, delay, iterations };
}

/** 解析一条**逗号分隔**的 `animation` 简写值。纯函数。 */
export function parseAnimationShorthand(s: string): ShorthandParse {
  const raw = splitTopLevel(s, ',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (raw.length === 0) return { ok: false };
  const parts: ParsedAnimPart[] = [];
  for (const p of raw) {
    const parsed = parsePart(p);
    if (!parsed) return { ok: false };
    parts.push(parsed);
  }
  return { ok: true, parts };
}

/**
 * 某条目在时间轴上实际会跑的**子动画**列表。
 *
 *  - 预设 / 旧单 body 自定义 → 一条，延迟取 timing 字段（与旧行为逐字一致）。
 *  - 多动画自定义 → 逐条取自简写，各有自己的时长与延迟。
 *
 * 烘焙 seek 与动画窗格都读它，保证「预览看到几条」与「时间轴画几条」一致。
 */
export function customSubAnimations(anim: ElementAnimation): ParsedAnimPart[] {
  const fallback: ParsedAnimPart = {
    name: animationName(anim),
    delay: anim.delay,
    duration: anim.duration,
    iterations: anim.iterations,
  };
  if (anim.kind !== 'custom' || !anim.animation) return [fallback];
  const parsed = parseAnimationShorthand(anim.animation);
  return parsed.ok ? parsed.parts : [fallback];
}

/* ------------------------------------------------------------ 样式表生成 */

function easingCss(e: Easing): string {
  if (typeof e === 'string') return e;
  return `cubic-bezier(${e.map((n) => round(n, 4)).join(',')})`;
}

function iterationsCss(n: number): string {
  return n === Infinity ? 'infinite' : String(round(n, 4));
}

function round(n: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

/** 动画 → CSS `animation` 简写值（单条；多动画走 CustomAnimation.animation）。 */
export function animationShorthand(anim: ElementAnimation): string {
  return [
    animationName(anim),
    `${round(anim.duration, 4)}s`,
    easingCss(anim.easing),
    `${round(anim.delay, 4)}s`,
    iterationsCss(anim.iterations),
    anim.direction,
    anim.fill,
  ].join(' ');
}

interface EmittedCustom {
  keyframes: { name: string; body: string }[];
  animation: string;
}

/**
 * 把自定义条目展开成「要发出的 @keyframes 块 + 最终简写」。
 *
 * **命名空间化**：每条 keyframes 名都前缀 `artmatic-a-<id>-`，引用预设则用
 * `artmatic-a-<id>-p-<预设>`。id 全局唯一，所以两个元素各写一个 `@keyframes pulse`
 * 不会互相覆盖。简写里的名字同步重写成这些命名空间名。
 *
 * 旧形态（`animation` 缺省）沿用 `artmatic-a-<id>` 单名 + timing 生成的简写，
 * 与扩展前逐字一致。
 */
function emitCustom(c: CustomAnimation): EmittedCustom | null {
  if (!c.animation) {
    const body = sanitizeCustomCss(c.css);
    if (!body) return null;
    return { keyframes: [{ name: animationName(c), body }], animation: animationShorthand(c) };
  }

  const scan = scanCssBlocks(c.css);
  if (scan.error) return null;
  const parsed = parseAnimationShorthand(c.animation);
  if (!parsed.ok) return null;

  const names = new Map<string, string>();
  const keyframes: { name: string; body: string }[] = [];
  for (const b of scan.keyframes) {
    const ns = `${ANIM_NAME_PREFIX}${c.id}-${b.name}`;
    names.set(b.name, ns);
    keyframes.push({ name: ns, body: b.body });
  }
  for (const p of parsed.parts) {
    if (names.has(p.name)) continue;
    if (!isPresetId(p.name)) return null; // 引用了本条目未定义的名字
    const ns = `${ANIM_NAME_PREFIX}${c.id}-p-${p.name}`;
    names.set(p.name, ns);
    keyframes.push({ name: ns, body: presetKeyframes(p.name) });
  }

  return { keyframes, animation: rewriteNames(c.animation, names) };
}

/** 把简写里每段的动画名替换成命名空间名（其余 token 原样保留）。 */
function rewriteNames(shorthand: string, names: Map<string, string>): string {
  return splitTopLevel(shorthand, ',')
    .map((raw) => {
      const part = parsePart(raw);
      const tokens = splitWhitespace(raw);
      if (!part) return tokens.join(' ');
      const idx = tokens.indexOf(part.name);
      const ns = names.get(part.name);
      if (ns && idx >= 0) tokens[idx] = ns;
      return tokens.join(' ');
    })
    .filter((s) => s !== '')
    .join(', ');
}

/**
 * 生成整篇文档所需的 `<style>` 内容：@keyframes 块 + 每个动画的绑定规则。
 *
 * 绑定走**一份样式表**而不是逐个元素写内联 style：注入点唯一，
 * 快照序列化时只需要带上这一个节点，也让「手写 CSS 无法逃逸」这条成立。
 *
 * 选择器用 `[data-anim-id=...]`（挂在元素的**内层包装**上），
 * 因为外层的 transform 被旋转占用，而动画预设大量使用 transform。
 */
export function animationStyleSheet(doc: TypographyDocument): string {
  const frames: string[] = [];
  const rules: string[] = [];
  const seen = new Set<string>();

  const pushFrame = (name: string, body: string): void => {
    if (!body || seen.has(name)) return;
    seen.add(name);
    frames.push(`@keyframes ${name}{${body}}`);
  };

  for (const el of doc.elements) {
    for (const anim of el.animations) {
      if (anim.kind === 'custom') {
        const emitted = emitCustom(anim);
        if (!emitted) continue;
        for (const k of emitted.keyframes) pushFrame(k.name, k.body);
        rules.push(`[${ANIM_ID_ATTR}="${cssAttrEscape(anim.id)}"]{animation:${emitted.animation}}`);
      } else {
        const body = presetKeyframes(anim.preset, anim.params);
        if (!body) continue;
        pushFrame(animationName(anim), body);
        rules.push(`[${ANIM_ID_ATTR}="${cssAttrEscape(anim.id)}"]{animation:${animationShorthand(anim)}}`);
      }
    }
  }
  return frames.concat(rules).join('\n');
}

/** 属性选择器里的字符串转义。id 是我们自己生成的，但仍然不信任。 */
function cssAttrEscape(s: string): string {
  return s.replace(/["\\]/g, (m) => `\\${m}`);
}

/**
 * 文档是否含时间变化的内容 —— 决定光栅化缓存键要不要带帧号。
 *
 * 脚本只在**总开关打开**时才算「会随时间变化」：
 *  - 关掉时脚本一条都不执行，画面与没有脚本的文档逐像素相同 ⇒ 按静态缓存
 *    （不然一张标题卡会每帧重烘一遍，白烧 200ms/帧）；
 *  - 打开时每帧都可能不同 ⇒ 帧号进键。
 *
 * 两种模式在缓存键里各有盐（见 `cache-key.ts::rasterKey`），所以切换开关
 * 不会命中对方烘出来的图。
 */
export function docIsAnimated(doc: TypographyDocument, scriptsActive = false): boolean {
  if (doc.elements.some((e) => e.animations.length > 0)) return true;
  return scriptsActive && (doc.scripts ?? []).some((s) => s.enabled && s.code.trim().length > 0);
}

/* ------------------------------------------------------------ 构造 */

export function createPresetAnimation(
  preset: AnimPreset,
  id: string,
  over: Partial<AnimTiming> = {},
): PresetAnimation {
  const def = ANIM_PRESETS.find((d) => d.id === preset);
  return {
    ...defaultTiming(),
    duration: def?.duration ?? 0.6,
    easing: def?.easing ?? 'ease-out',
    ...over,
    id,
    kind: 'preset',
    preset,
    params: def?.params,
  };
}

export function createCustomAnimation(
  id: string,
  css: string,
  over: Partial<AnimTiming> & { animation?: string } = {},
): CustomAnimation {
  const { animation, ...timing } = over;
  const anim: CustomAnimation = { ...defaultTiming(), ...timing, id, kind: 'custom', css };
  if (animation) anim.animation = animation;
  return anim;
}
