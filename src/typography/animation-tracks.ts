/**
 * animation-tracks.ts — 结构化关键帧动画（`kind: 'tracks'`）的模型与纯函数。
 *
 * **一条动画 = 一个属性**。这不是偷懒：一条 CSS `@keyframes` 只有一套时序，
 * 想让两个属性异步起落就必须拆成两条 `animation`（各带自己的 `delay`）。
 * 拆开之后逐段缓动也不再有歧义 —— 每个关键帧块里的 `animation-timing-function`
 * 归属唯一，正好对上 `core/curve.ts` 的**出向**语义（本帧 → 下一帧）。
 *
 * 时间存**绝对秒（相对片段起点）**：关键帧钉在片段时间轴上，改时长只移动最后一帧。
 * 发射时再归一化成 `@keyframes` 的百分比（见 `animation.ts::emitTracks`）。
 *
 * 本文件不碰 DOM、不读时钟（AGENTS §1.1）；时间换算只发生在发射处一次。
 */

import type { AnimTiming, Easing } from './animation';

/** 定长通道。其余字符串一律当任意 CSS 属性名（kebab-case）。 */
export type AnimChannel = 'x' | 'y' | 'sx' | 'sy' | 'rot' | 'opacity' | 'blur';

export type StepJump = 'jump-start' | 'jump-end' | 'jump-none' | 'jump-both' | 'start' | 'end';

/**
 * 阶梯缓动。**存对象而不是字符串**：面板要一个可编辑的 N 与跳变位置，
 * 而 `"steps(4,end)"` 这种原文既没法校验也没法在浮层里回填。
 */
export interface StepEase {
  steps: number;
  /** 缺省 `end`（CSS 的默认值）。 */
  jump?: StepJump;
}

/** 一条关键帧的出向缓动：关键字 / cubic-bezier 四元组 / 阶梯。 */
export type TrackEase = Easing | StepEase;

/** 关键帧的**形状**由缓动种类决定（面板的画法，不参与发射）。 */
export type EaseKind = 'none' | 'curve' | 'step';

export interface TrackKey {
  /** 绝对秒，相对**片段起点**。 */
  t: number;
  /** 数值通道为 number；任意属性为原始字符串（已过闸）。 */
  v: number | string;
  /** 出向缓动：本帧 → 下一帧。缺省 = 条目 `easing`。 */
  ease?: TrackEase | null;
}

/**
 * 缓动种类。`none` = 没单独设，跟随条目 `easing`（画菱形）；
 * `curve` = 关键字 / cubic-bezier（画圆形）；`step` = `steps()`（画方形）。
 */
export function easeKindOf(ease: TrackEase | null | undefined): EaseKind {
  if (!ease) return 'none';
  return typeof ease === 'object' && !Array.isArray(ease) ? 'step' : 'curve';
}

/** 一条结构化动画：一个属性 + 一串绝对秒关键帧。 */
export interface TracksAnimation extends AnimTiming {
  id: string;
  kind: 'tracks';
  /** 通道 id 或任意 CSS 属性名。 */
  prop: AnimChannel | (string & {});
  /** 按 `t` 升序（写入端负责，`applyTrackTiming` 会再排一次）。 */
  keys: TrackKey[];
}

/**
 * 每个通道的量纲与恒等值。
 *
 * `identity` 只有一个用途：**新建轨道时第一帧的初值**（以及面板上「复位」）。
 * 不参与发射 —— 一条动画只有一个属性，每个关键帧都写它，不存在「漏写的属性
 * 从基础样式插值」那条坑（AGENTS 里那条规则约束的是多属性同块）。
 */
export interface ChannelMeta {
  id: AnimChannel;
  /** 显示用单位后缀（`px` / `×` / `°` / 空）。符号不翻译。 */
  unit: string;
  identity: number;
  /** 面板滑杆/输入框的口径；`undefined` = 不限。 */
  min?: number;
  max?: number;
  step: number;
}

export const CHANNEL_META: Record<AnimChannel, ChannelMeta> = {
  x: { id: 'x', unit: 'px', identity: 0, step: 1 },
  y: { id: 'y', unit: 'px', identity: 0, step: 1 },
  sx: { id: 'sx', unit: '×', identity: 1, min: 0, step: 0.01 },
  sy: { id: 'sy', unit: '×', identity: 1, min: 0, step: 0.01 },
  rot: { id: 'rot', unit: '°', identity: 0, step: 1 },
  opacity: { id: 'opacity', unit: '', identity: 1, min: 0, max: 1, step: 0.01 },
  blur: { id: 'blur', unit: 'px', identity: 0, min: 0, step: 0.1 },
};

export const ANIM_CHANNELS: AnimChannel[] = ['x', 'y', 'sx', 'sy', 'rot', 'opacity', 'blur'];

export function isChannel(prop: string): prop is AnimChannel {
  return Object.prototype.hasOwnProperty.call(CHANNEL_META, prop);
}

/** 新轨道的初值：定长通道取恒等值，任意属性取调用方给的字符串。 */
export function identityValue(prop: string): number | string {
  return isChannel(prop) ? CHANNEL_META[prop].identity : '';
}

/* ------------------------------------------------------------ 属性名 / 值的闸门 */

/**
 * 属性名：只允许 `--custom` 或普通标识符（kebab-case）。
 *
 * 挡的不是排版，是**逃逸**：属性名会被拼进 `[data-anim-id="…"]{…}` 规则里，
 * 一个带 `}` 的名字就能提前闭合规则、往那份唯一 `<style>` 里写任意顶层 CSS。
 */
const PROP_NAME_RE = /^(--)?[A-Za-z][A-Za-z0-9-]*$/;

/**
 * 这几条不能当动画属性：它们定义动画本身，写进关键帧块会被浏览器忽略
 * （忽略还算好的，`animation` 简写会连带覆盖条目自己的时序）。
 */
const RESERVED_PROPS = new Set([
  'animation',
  'animation-name',
  'animation-duration',
  'animation-delay',
  'animation-timing-function',
  'animation-iteration-count',
  'animation-direction',
  'animation-fill-mode',
  'animation-play-state',
]);

export function isValidPropName(prop: string): boolean {
  return PROP_NAME_RE.test(prop) && !RESERVED_PROPS.has(prop.toLowerCase());
}

/**
 * 值：拒绝 `; { } < >` 与 `url(` / 注释 / `!important`。
 *
 * 前四个是结构化逃逸（闭合声明、闭合规则、插标签），`url(` 会把网络请求带进
 * 唯一那份样式表（破坏离线确定性），`!important` 则会盖掉我们自己的时序声明。
 */
const BAD_VALUE_RE = /[;{}<>\r\n]|\/\*|url\s*\(|!important/i;

export function isValidPropValue(value: string): boolean {
  return value.trim() !== '' && !BAD_VALUE_RE.test(value);
}

/* ------------------------------------------------------------ 关键帧整理 */

const clampNum = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function round(v: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

function num(v: number | string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 排序 + 夹到 `t >= 0` + **同一时刻只留一个**（后者胜出：拖动时它才是用户
 * 正在指的那一个）。返回新数组，不改入参。
 */
export function normalizeKeys(keys: readonly TrackKey[]): TrackKey[] {
  const sorted = keys
    .filter((k) => Number.isFinite(k.t))
    .map((k) => ({ ...k, t: Math.max(0, k.t) }))
    .sort((a, b) => a.t - b.t);
  const out: TrackKey[] = [];
  for (const k of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.t - k.t) < 1e-6) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

/** 一条轨道的有效区间（秒，相对片段起点）。空轨道返回 `0/0`。 */
export function trackSpan(keys: readonly TrackKey[]): { delay: number; duration: number } {
  if (keys.length === 0) return { delay: 0, duration: 0 };
  const delay = keys[0]!.t;
  return { delay, duration: Math.max(0, keys[keys.length - 1]!.t - delay) };
}

/**
 * 把派生时序回填进对象：`delay = 第一帧`、`duration = 最后一帧 − 第一帧`。
 *
 * 为什么还留着这两个字段（而不是删掉只读 keys）：`isAnimationActiveAt()`、
 * `customSubAnimations()` 与光栅化的缓存键都在读它们，删掉就是一次跨四五个
 * 文件的连锁改动。**真源是 keys**，这两个字段只是在每次写入后同步一次，读的人
 * 不必知道新模型。（`seekAnimations()` 不读它们 —— CSS 的 `animation-delay`
 * 已经承担了延迟，见 `animation.ts::animationCurrentTimeMs`。）
 */
export function applyTrackTiming<T extends TracksAnimation>(anim: T): T {
  anim.keys = normalizeKeys(anim.keys);
  if (anim.keys.length === 0) {
    anim.delay = Math.max(0, anim.delay);
    anim.duration = Math.max(1e-3, anim.duration);
    return anim;
  }
  const span = trackSpan(anim.keys);
  anim.delay = span.delay;
  anim.duration = Math.max(1e-3, span.duration);
  return anim;
}

/* ------------------------------------------------------------ 声明生成 */

/**
 * 一个关键帧的声明文本（不含 `{}`）。非法属性名 / 值返回 null。
 *
 * 数值通道在这里做**唯一的**单位与夹取处理：`opacity` 夹 0..1、`blur` 非负。
 * 面板上再夹一次是为了拖动手感，不是正确性来源。
 */
export function channelDeclaration(prop: string, v: number | string): string | null {
  switch (prop) {
    case 'x':
      return `transform:translateX(${round(num(v), 3)}px)`;
    case 'y':
      return `transform:translateY(${round(num(v), 3)}px)`;
    case 'sx':
      return `transform:scaleX(${round(num(v), 4)})`;
    case 'sy':
      return `transform:scaleY(${round(num(v), 4)})`;
    case 'rot':
      return `transform:rotate(${round(num(v), 3)}deg)`;
    case 'opacity':
      return `opacity:${round(clampNum(num(v), 0, 1), 4)}`;
    case 'blur':
      return `filter:blur(${round(Math.max(0, num(v)), 3)}px)`;
    default: {
      if (!isValidPropName(prop)) return null;
      const text = String(v).trim();
      if (!isValidPropValue(text)) return null;
      return `${prop}:${text}`;
    }
  }
}

/**
 * 轨道在 `t` 时刻的值。面板行头读数、以及「在播放头加一个关键帧」的初值都读它。
 *
 * 数值通道线性插值；**任意属性取前一帧**（与 CSS 的离散语义一致 ——
 * 猜一个 `letter-spacing` 的中间值只会让用户以为轨道坏了）。
 */
export function sampleKeys(keys: readonly TrackKey[], t: number): number | string {
  const ks = normalizeKeys(keys);
  if (ks.length === 0) return 0;
  if (t <= ks[0]!.t) return ks[0]!.v;
  const last = ks[ks.length - 1]!;
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < ks.length - 1 && ks[i + 1]!.t <= t) i += 1;
  const a = ks[i]!;
  const b = ks[i + 1]!;
  const span = b.t - a.t;
  if (span <= 1e-9) return b.v;
  if (typeof a.v === 'number' && typeof b.v === 'number') {
    return a.v + (b.v - a.v) * ((t - a.t) / span);
  }
  return a.v;
}

/** 某个通道在当前值下的显示读数（面板行头 / agent 读回共用一套取整）。 */
export function displayValue(prop: string, v: number | string): string {
  if (!isChannel(prop)) return String(v);
  const meta = CHANNEL_META[prop];
  return `${round(num(v), 3)}${meta.unit}`;
}

export { num as toNumber };
