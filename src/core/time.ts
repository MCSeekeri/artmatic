/**
 * time.ts — 拍网格与时间换算。
 *
 * ADR-002：offset（第 0 拍秒数）是独立参数，不是从 0 开始。
 *   timeAtBeat(b) = offset + b * beatDur
 *   beatAtTime(t) = (t - offset) / beatDur
 *
 * 吸附单位全仓库只有这里一张 SNAP_MODES 表。angel-echo-splitter 的教训：
 * AE.SNAP.*.unit（从未被读取）与 store.snapUnit（0.05 vs 0.01 不一致）两套并存，
 * 网格间距和吸附步长于是可能走岔。这里网格绘制与拖拽吸附调同一个 stepBeats，
 * 单测把「snap 步长 = 网格步长」钉死。
 */

import type { MessageKey } from '../i18n/locales';

export interface BeatGrid {
  bpm: number;
  /** 第 0 拍的秒数（可以为负：音乐在 0 秒前就开始了）。 */
  offset: number;
  beatsPerBar: number;
}

export function beatDur(g: BeatGrid): number {
  return 60 / g.bpm;
}

export function barDur(g: BeatGrid): number {
  return beatDur(g) * g.beatsPerBar;
}

export function timeAtBeat(b: number, g: BeatGrid): number {
  return g.offset + b * beatDur(g);
}

export function beatAtTime(t: number, g: BeatGrid): number {
  return (t - g.offset) / beatDur(g);
}

export const SNAP_MODES = {
  bar: { labelKey: 'tl.snapBar', stepBeats: (bpb: number) => bpb },
  beat: { labelKey: 'tl.snapBeat', stepBeats: () => 1 },
  half: { labelKey: 'tl.snapHalf', stepBeats: () => 0.5 },
  free: { labelKey: 'tl.snapFree', stepBeats: () => 0.01 },
  /**
   * 帧吸附：步长是 **1/fps 秒**，与拍网格无关 —— 标准模式唯一的吸附档位。
   *
   * 它在这张表里是**异类**（`stepBeats` 对它没有意义，取 1 只是保持表同形），
   * 所以 `snapTime` / `snapToleranceSec` 先按 `mode === 'frame'` 分支，
   * 绝不会拿它去算拍。**别把「帧」塞进拍步长表再乘 beatDur** —— 120BPM 下
   * 0.01 拍的「细格」与 1/30 秒只差 0.0003s，看起来像能用，直到改了 BPM。
   */
  frame: { labelKey: 'tl.snapFrame', stepBeats: () => 1 },
} as const satisfies Record<string, { labelKey: MessageKey; stepBeats: (bpb: number) => number }>;

export type SnapMode = keyof typeof SNAP_MODES;

/** 吸附步长（拍）——网格绘制与拖拽吸附的唯一来源。 */
export function snapStepBeats(mode: SnapMode, beatsPerBar: number): number {
  return SNAP_MODES[mode].stepBeats(beatsPerBar);
}

export function snapBeat(b: number, mode: SnapMode, beatsPerBar: number): number {
  const s = snapStepBeats(mode, beatsPerBar);
  return Math.round(b / s) * s;
}

/**
 * 把时间吸到最近的吸附点。
 *
 * `fps` 只有「帧」档用得上（工程帧率，见硬约束 1.1）：时间码上的第 N 帧
 * 就是 `N / fps` 秒，与 `timeAtFrame` 同一个定义域。
 */
export function snapTime(t: number, mode: SnapMode, g: BeatGrid, fps = 30): number {
  if (mode === 'frame') {
    const rate = Math.max(1, fps);
    return Math.round(t * rate) / rate;
  }
  return timeAtBeat(snapBeat(beatAtTime(t, g), mode, g.beatsPerBar), g);
}

/**
 * 吸附的容差（秒）= 半个步长。段落边界要用它判断「比网格线更近」。
 * 与 `snapTime` 必须同源，否则会出现「吸附到了段落，但网格却显示在别处」。
 */
export function snapToleranceSec(mode: SnapMode, g: BeatGrid, fps = 30): number {
  if (mode === 'frame') return 0.5 / Math.max(1, fps);
  return (snapStepBeats(mode, g.beatsPerBar) * beatDur(g)) / 2;
}

/** 帧号 ↔ 秒：唯一时钟是 t = frame / fps（硬约束 1.1）。 */
export function timeAtFrame(frame: number, fps: number): number {
  return frame / fps;
}

export function frameAtTime(t: number, fps: number): number {
  return Math.floor(t * fps + 1e-6);
}
