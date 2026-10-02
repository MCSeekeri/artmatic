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

export function snapTime(t: number, mode: SnapMode, g: BeatGrid): number {
  return timeAtBeat(snapBeat(beatAtTime(t, g), mode, g.beatsPerBar), g);
}

/** 帧号 ↔ 秒：唯一时钟是 t = frame / fps（硬约束 1.1）。 */
export function timeAtFrame(frame: number, fps: number): number {
  return frame / fps;
}

export function frameAtTime(t: number, fps: number): number {
  return Math.floor(t * fps + 1e-6);
}
