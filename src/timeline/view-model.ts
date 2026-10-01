/**
 * view-model.ts — 时间轴坐标换算。
 *
 * 唯一的横向尺度是 pxPerBeat（缩放以拍为单位，跟着拍网格走——
 * 改了 BPM 布局不需要重新标定）。秒 ↔ 像素的换算都必须经过这里，
 * 不许在组件里另写一套。
 */

import { beatDur, type BeatGrid } from '../core/time';
import { DENSITY } from '../ui/tokens';

export function pxPerSec(pxPerBeat: number, grid: BeatGrid): number {
  return pxPerBeat / beatDur(grid);
}

export function xOfTime(t: number, pxPerBeat: number, grid: BeatGrid): number {
  return t * pxPerSec(pxPerBeat, grid);
}

export function timeAtX(x: number, pxPerBeat: number, grid: BeatGrid): number {
  return x / pxPerSec(pxPerBeat, grid);
}

/**
 * 行高与标尺高。数值来自 ui/tokens.ts 的 DENSITY——Canvas 数学要的是数字，
 * CSS 要的是 `--row-h: 28px`，两边必须同一个源，否则网格线和片段 DOM 会错位。
 */
export const RULER_HEIGHT = DENSITY.rulerH;
export const ROW_HEIGHT = DENSITY.rowH;
