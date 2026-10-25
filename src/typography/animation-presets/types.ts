/**
 * animation-presets/types.ts — 预设模块的公共形状（纯类型 + 两个纯函数）。
 *
 * 为什么预设要拆成「一组一个模块」：预设表已经五十多条，全塞在 `animation.ts`
 * 同一个 switch 里的话，加一个「强调」动画也要动那个文件 —— 而这张表恰好是
 * 最常被同时改的地方。拆开之后每组一个文件，加预设只碰自己那一份。
 *
 * 这里**不 import `animation.ts` 的运行时**（只 import 类型）：`animation.ts` 会
 * import 三个预设模块，反向再 import 它的值就成环了。类型在编译后消失，没有
 * 运行期依赖。
 */

import type { MessageKey } from '../../i18n/locales';
import type { AnimPreset, Easing } from '../animation';

/** 一个预设的定义。与 `animation.ts` 的 `AnimPresetDef` 同形（那边是它的别名）。 */
export interface PresetDef {
  /** 预设 id。**类型钉死**：拼错会编译失败，不会变成一张没有画面的空卡。 */
  id: AnimPreset;
  /** 文案键（`anim.*`，见 i18n/locales/zh-CN/media.ts）。 */
  labelKey: MessageKey;
  /** 缺省时长（秒）。 */
  duration: number;
  /** 缺省缓动。 */
  easing: Easing;
  /** 缺省参数（距离 / 缩放 / 模糊半径…）。 */
  params?: Record<string, number>;
}

/**
 * 预设的 keyframes 体（不含 `@keyframes` 外壳，也不含 `animation` 简写）。
 *
 * 写法约束（每一条都是 `animation-migrate.ts` 的解析器要求的，违反了不会报错、
 * 只会**少画一段**）：
 *  - 选择器只能是 `from` / `to` / `<数字>%`（可逗号并列，如 `0%,100%`）；
 *  - 声明之间用 `;`，值里不能再出现 `;`；
 *  - `filter` 只写**纯 `blur(<n>px)`** 才会被拆成可编辑的 blur 轨道，别的滤镜
 *    （hue-rotate / brightness / drop-shadow…）整条存成原始字符串轨道 —— 能用，
 *    但编辑器里只能改整串；
 *  - `transform` 只用 `translateX/Y`、`translate`、`scaleX/Y`、`scale`、`rotate`
 *    才会拆成 x/y/sx/sy/rot 通道；出现 `skewX` / `perspective` / `rotateX` 之类
 *    就整条存成原始字符串轨道（**同一预设的每一帧都要写 transform**，否则那些
 *    没写的帧会从轨道里消失）；
 *  - 不要用 `%` 做位移（解析器会当成 px）、不要用 `steps()`（缓动模型表达不了）、
 *    不要用 `-webkit-` 前缀属性（属性名闸门会拒绝）。
 */
export type KeyframeBuilder = (params: Record<string, number>) => string;

/** 一组预设：定义表 + id → keyframes 体。 */
export interface PresetModule {
  defs: PresetDef[];
  keyframes: Record<string, KeyframeBuilder>;
}

/** 取一个数值参数（缺省 / 非法值一律回落）。 */
export function num(params: Record<string, number>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 百分比选择器。`from` / `to` 与 `0%` / `100%` 等价，短的更清楚。 */
export function pct(n: number): string {
  return `${Math.round(n)}%`;
}
