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

/**
 * 时间 → 小节 / 拍（都**从 1 起**，与标尺上的读数、用户嘴里的「第 4 小节」一致）。
 *
 * 负拍（offset 落在 0 秒之后，即音乐还没开始）落到第 0 小节 —— 这是 DAW 的惯例：
 * 「第 0 小节第 4 拍」明确表示「在第一小节之前」，比钳成第 1 小节诚实。
 */
export function barBeatAt(t: number, g: BeatGrid): { bar: number; beat: number } {
  const b = beatAtTime(t, g);
  if (!Number.isFinite(b)) return { bar: 1, beat: 1 };
  const per = Math.max(1, g.beatsPerBar);
  const barIndex = Math.floor(b / per);
  return { bar: barIndex + 1, beat: Math.floor(b - barIndex * per) + 1 };
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

/**
 * **关键帧**的吸附单位（按住 Shift 拖关键帧时对齐到哪种刻度）。
 *
 * 与 `SNAP_MODES` 分表，因为两者回答的不是同一个问题：那张表是**时间轴网格**
 * 的口径，网格线画的就是它（小节 / 拍 / 半拍）；关键帧面板的网格是「秒刻度 +
 * 拍线」，它需要的是「对齐到秒 / 0.1 秒 / 帧」这类与拍无关的刻度。硬塞进
 * `SNAP_MODES` 会让时间轴的下拉多出两档而网格并不会跟着变 —— 正是那张表
 * 注释里记着的 splitter 双表事故的形态。
 */
export const KEY_SNAP_UNITS = {
  beat: { labelKey: 'typo.kfSnapBeat', hintKey: 'typo.kfSnapToBeat' },
  sec: { labelKey: 'typo.kfSnapSec', hintKey: 'typo.kfSnapToSec' },
  tenth: { labelKey: 'typo.kfSnapTenth', hintKey: 'typo.kfSnapToTenth' },
  frame: { labelKey: 'typo.kfSnapFrame', hintKey: 'typo.kfSnapToFrame' },
} as const satisfies Record<string, { labelKey: MessageKey; hintKey: MessageKey }>;

export type KeySnapUnit = keyof typeof KEY_SNAP_UNITS;

/**
 * 把（绝对）时间吸到关键帧面板选定的刻度。
 *
 * 一律在**绝对秒**上做：拍网格带 offset、帧号是 `t = frame / fps`（硬约束 1.1），
 * 拿片段内的相对秒去吸会得到「同一个位置在不同片段里对齐到不同刻度」。
 */
export function snapKeyTime(t: number, unit: KeySnapUnit, g: BeatGrid, fps = 30): number {
  switch (unit) {
    case 'sec':
      return Math.round(t);
    case 'tenth':
      return Math.round(t * 10) / 10;
    case 'frame': {
      const rate = Math.max(1, fps);
      return Math.round(t * rate) / rate;
    }
    default:
      return timeAtBeat(Math.round(beatAtTime(t, g)), g);
  }
}

/** 帧号 ↔ 秒：唯一时钟是 t = frame / fps（硬约束 1.1）。 */
export function timeAtFrame(frame: number, fps: number): number {
  return frame / fps;
}

export function frameAtTime(t: number, fps: number): number {
  return Math.floor(t * fps + 1e-6);
}
