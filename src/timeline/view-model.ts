/**
 * view-model.ts — 时间轴坐标换算。
 *
 * 唯一的横向尺度是 pxPerBeat（缩放以拍为单位，跟着拍网格走——
 * 改了 BPM 布局不需要重新标定）。秒 ↔ 像素的换算都必须经过这里，
 * 不许在组件里另写一套。
 */

import { beatDur, type BeatGrid } from '../core/time';

export function pxPerSec(pxPerBeat: number, grid: BeatGrid): number {
  return pxPerBeat / beatDur(grid);
}

export function xOfTime(t: number, pxPerBeat: number, grid: BeatGrid): number {
  return t * pxPerSec(pxPerBeat, grid);
}

export function timeAtX(x: number, pxPerBeat: number, grid: BeatGrid): number {
  return x / pxPerSec(pxPerBeat, grid);
}

export const RULER_HEIGHT = 26;
export const ROW_HEIGHT = 40;
