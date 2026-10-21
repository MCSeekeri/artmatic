/**
 * canvas-size.ts — 排版画布的「画幅」计算：比例预设、比例锁、上屏占位。
 *
 * 排版片段的画布尺寸一直等于工程分辨率（建片段时抄一份），于是它**必然**占满
 * 全屏。让画布可以比工程画面小、换比例之后，需要三件纯计算：
 *
 *  1. 比例预设给出一组具体像素（按比例装进工程画面，取整）；
 *  2. 比例锁：改一边，另一边跟着变；
 *  3. 上屏占位：这块画布最终在画面上占多大 —— 由 `fit` 决定，与画布像素**不必**
 *     相等（contain 会把 800×200 的画布放大到铺满宽度）。
 *
 * 第 3 条是界面读数的唯一来源：不给读数的话，「改了画布尺寸画面却没变小」
 * 会被当成 bug —— 而它其实是 contain 的正常行为。
 *
 * 画布本身的缩放（元素跟着按比例重排）不在这里，走 `document.ts::resizeDocument`。
 */

import { drawSizeFor } from '../engine/placement.frag';
import type { SourceClip } from '../core/schema';
import type { Size } from './document';

/** 画布比例预设。`ratio` 为 null = 跟随工程分辨率。 */
export interface CanvasRatio {
  /** 显示文本也是它（`project` 那条另给文案键）。 */
  id: 'project' | '16:9' | '9:16' | '1:1' | '4:5';
  ratio: number | null;
}

export const CANVAS_RATIOS: readonly CanvasRatio[] = [
  { id: 'project', ratio: null },
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
  { id: '1:1', ratio: 1 },
  { id: '4:5', ratio: 4 / 5 },
];

/** 画布边长下限（`createTypographyDocument` 也是这个口径）。 */
export const MIN_CANVAS_EDGE = 2;

function clampEdge(v: number): number {
  const n = Math.round(Number.isFinite(v) ? v : MIN_CANVAS_EDGE);
  return Math.max(MIN_CANVAS_EDGE, n);
}

/** 比例 → 具体像素：**按比例装进工程画面**（不超出、也不放大）。 */
export function sizeForRatio(ratio: number, frame: Size): Size {
  if (!(ratio > 0) || !(frame.w > 0) || !(frame.h > 0)) {
    return { w: clampEdge(frame.w), h: clampEdge(frame.h) };
  }
  const byWidth = { w: frame.w, h: Math.round(frame.w / ratio) };
  const fit = byWidth.h <= frame.h ? byWidth : { w: Math.round(frame.h * ratio), h: frame.h };
  return { w: clampEdge(fit.w), h: clampEdge(fit.h) };
}

/**
 * 比例锁：改一条边，另一边按 `size` 的当前比例重算。
 *
 * 用**当前画布**的比例而不是工程比例 —— 用户把画幅调成 9:16 之后，锁住的应该
 * 是 9:16，否则「改高度」会把它拽回工程比例。
 */
export function withLockedAspect(size: Size, edge: 'w' | 'h', v: number): Size {
  const n = clampEdge(v);
  if (!(size.w > 0) || !(size.h > 0)) return { w: n, h: n };
  return edge === 'w'
    ? { w: n, h: clampEdge((n * size.h) / size.w) }
    : { w: clampEdge((n * size.w) / size.h), h: n };
}

/** 画布在工程画面上的占位（像素 + 占画面的百分比）。 */
export interface Footprint {
  w: number;
  h: number;
  /** 占画面宽 / 高的百分比（整数）。 */
  pctW: number;
  pctH: number;
}

/**
 * 这块画布在画面上占多大。
 *
 * 与 `typography/runtime.ts::rasterSizeFor` 用的是**同一个** `drawSizeFor` ——
 * 读数和真实摆放各算一套的话，读数会与画面差一截，而且只在大画布上显形。
 * `sx/sy` 传片段的 `transform`，`fit` 传片段的 `fit`。
 */
export function footprintOf(
  canvas: Size,
  frame: Size,
  fit: SourceClip['fit'],
  sx = 1,
  sy = 1,
): Footprint {
  const [w, h] = drawSizeFor(fit, frame.w, frame.h, canvas.w, canvas.h, sx, sy);
  return {
    w: Math.round(w),
    h: Math.round(h),
    pctW: frame.w > 0 ? Math.round((w / frame.w) * 100) : 0,
    pctH: frame.h > 0 ? Math.round((h / frame.h) * 100) : 0,
  };
}
