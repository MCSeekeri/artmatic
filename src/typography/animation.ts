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
   * **只允许 @keyframes 的体**，例如 `from{opacity:0} to{opacity:1}`。
   *
   * 为什么不让用户写整段 CSS（他确实要「允许手写代码」，这是能力与安全的
   * 最小妥协）：滚动任意 CSS 字符串会带来三个真问题 ——
   *   ① `@import url(http://…)` 会外发网络请求，破坏「离线 + 确定性」；
   *   ② `position:fixed` 能让元素逃出快照区域，光栅化结果不可预测；
   *   ③ 顶层选择器会污染同页的其它元素（预览页里还有时间轴和面板）。
   * 限制成 keyframes 体之后，它只能影响被绑定的那个元素，而且注入点唯一
   * （一份 <style>，随快照进入隔离文档）。
   */
  css: string;
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
 * 延迟之前钳到 0：`fill: backwards` 时显示首帧、`fill: none` 时显示基础样式，
 * 两种都是确定的，且与真实播放的首帧一致。
 */
export function animationCurrentTimeMs(anim: ElementAnimation, localSec: number): number {
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

/**
 * 清洗用户手写的 keyframes 体。
 *
 * body 里**合法地**包含成对的 `{}`（`from{...}to{...}`），所以不能简单地把
 * 花括号剥掉；要校验配平：任何时刻 depth 不得为负，结束时必须归零。
 * 否则一个 `}` 就能提前闭合我们的 `@keyframes` 块，往后写任意顶层 CSS。
 * 清洗后为空字符串 = 这行代码非法，调用方应当拒绝写入。
 */
export function sanitizeKeyframeBody(css: string): string {
  let s = css.replace(/<\/?[a-z][^>]*>/gi, '');
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

export function isValidKeyframeBody(css: string): boolean {
  return sanitizeKeyframeBody(css) !== '';
}

/** 取某个动画的 keyframes 体；custom 会先过清洗。返回 '' 表示应当跳过。 */
export function keyframeBodyOf(anim: ElementAnimation): string {
  if (anim.kind === 'preset') return presetKeyframes(anim.preset, anim.params);
  return sanitizeKeyframeBody(anim.css);
}

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

/** 动画 → CSS `animation` 简写值。 */
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

  for (const el of doc.elements) {
    for (const anim of el.animations) {
      const name = animationName(anim);
      if (!seen.has(name)) {
        const body = keyframeBodyOf(anim);
        if (!body) continue;
        seen.add(name);
        frames.push(`@keyframes ${name}{${body}}`);
      }
      rules.push(`[${ANIM_ID_ATTR}="${cssAttrEscape(anim.id)}"]{animation:${animationShorthand(anim)}}`);
    }
  }
  return frames.concat(rules).join('\n');
}

/** 属性选择器里的字符串转义。id 是我们自己生成的，但仍然不信任。 */
function cssAttrEscape(s: string): string {
  return s.replace(/["\\]/g, (m) => `\\${m}`);
}

/** 文档是否含时间变化的内容 —— 决定光栅化缓存键要不要带帧号。 */
export function docIsAnimated(doc: TypographyDocument): boolean {
  return doc.elements.some((e) => e.animations.length > 0);
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
  over: Partial<AnimTiming> = {},
): CustomAnimation {
  return { ...defaultTiming(), ...over, id, kind: 'custom', css };
}
