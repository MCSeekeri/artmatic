import { describe, expect, it } from 'vitest';
import { rulerLabelAt } from '../../src/timeline/grid-draw';
import { xOfBeat } from '../../src/timeline/view-model';
import { snapTime, timeAtBeat, type BeatGrid } from '../../src/core/time';

const GRID: BeatGrid = { bpm: 120, offset: 0, beatsPerBar: 4 };

describe('rulerLabelAt：标尺文案（时间轴双形态唯一可断言的产物）', () => {
  it('节奏模式：小节.拍，从 1 数起', () => {
    expect(rulerLabelAt(0, GRID, 30, 'beat')).toBe('1.1');
    expect(rulerLabelAt(1, GRID, 30, 'beat')).toBe('1.2');
    expect(rulerLabelAt(4, GRID, 30, 'beat')).toBe('2.1');
    expect(rulerLabelAt(9, GRID, 30, 'beat')).toBe('3.2');
  });

  it('标准模式：分:秒.帧（帧按工程帧率）', () => {
    // 120 BPM：一拍 0.5s；30fps 下 0.5s = 第 15 帧。
    expect(rulerLabelAt(0, GRID, 30, 'standard')).toBe('00:00.00');
    expect(rulerLabelAt(1, GRID, 30, 'standard')).toBe('00:00.15');
    expect(rulerLabelAt(8, GRID, 30, 'standard')).toBe('00:04.00');
    expect(rulerLabelAt(8, GRID, 25, 'standard')).toBe('00:04.00');
  });

  it('同一条拍线在两种模式下文案不同（切换形态确实改变读数）', () => {
    expect(rulerLabelAt(8, GRID, 30, 'beat')).not.toBe(rulerLabelAt(8, GRID, 30, 'standard'));
  });

  it('超过一分钟时分钟位不归零', () => {
    // 60s = 120 拍 @120BPM
    expect(rulerLabelAt(120, GRID, 30, 'standard')).toBe('01:00.00');
  });

  it('非整数帧率 / 非法 beatsPerBar 不产生 NaN', () => {
    const weird: BeatGrid = { bpm: 120, offset: 0, beatsPerBar: 0 };
    // beatsPerBar 被钳到 1：第 1 拍就是第 2 小节第 1 拍（不产生 NaN / Infinity）。
    expect(rulerLabelAt(1, weird, 29.97, 'beat')).toBe('2.1');
    expect(rulerLabelAt(1, weird, 29.97, 'standard')).toMatch(/^00:00\.\d{2}$/);
  });

  it('标准模式的时间码含 offset：第 4 拍在 offset+2s 处', () => {
    const g: BeatGrid = { bpm: 120, offset: 1.5, beatsPerBar: 4 };
    // 第 4 拍 = 1.5 + 4×0.5 = 3.5s → 00:03.15（30fps）
    expect(rulerLabelAt(4, g, 30, 'standard')).toBe('00:03.15');
  });
});

describe('xOfBeat：标尺 / 网格的拍线位置必须计入 offset', () => {
  const g: BeatGrid = { bpm: 120, offset: 1.5, beatsPerBar: 4 };

  it('第 0 拍画在 offset 对应的 x 上（不是 x=0）', () => {
    // 120BPM / 28px 每拍 → 56px/s；offset 1.5s → 84px。
    expect(xOfBeat(0, 28, g)).toBeCloseTo(84, 10);
  });

  it('相邻拍相距恒为 pxPerBeat（BPM 只改秒数，不改像素间距）', () => {
    expect(xOfBeat(1, 28, g) - xOfBeat(0, 28, g)).toBeCloseTo(28, 10);
    expect(xOfBeat(9, 28, g) - xOfBeat(8, 28, g)).toBeCloseTo(28, 10);
  });

  it('吸附到第 n 拍的秒数，落在第 n 拍的线上（这就是「播放头压不上刻度」的判据）', () => {
    const t = snapTime(3.2, 'beat', g);
    expect(t).toBeCloseTo(timeAtBeat(3, g), 10);
    // 84px（offset 1.5s）+ 3 × 28px/拍
    expect(xOfBeat(3, 28, g)).toBeCloseTo(84 + 3 * 28, 10);
  });
});
