import { describe, expect, it } from 'vitest';
import {
  audioClipGainAt,
  audioEnvelopeAt,
  audioGainAt,
  sampleAudioEnvelope,
  type AudioGainSource,
} from '../../src/core/audio-envelope';
import type { AudioClip } from '../../src/core/schema';
import type { BeatGrid } from '../../src/core/time';

const GRID: BeatGrid = { bpm: 120, offset: 0, beatsPerBar: 4 };

function clip(extra: Partial<AudioClip> = {}): AudioClip {
  return {
    id: 'c1',
    kind: 'audio',
    assetId: 'a',
    srcIn: 0,
    start: 2,
    end: 4,
    label: 'a',
    fadeSec: 0,
    curves: {},
    ...extra,
  };
}

const env = (extra: Partial<AudioGainSource>): AudioGainSource => ({
  start: 0,
  end: 2,
  curves: {},
  ...extra,
});

describe('audioEnvelopeAt：fadeIn / fadeOut', () => {
  it('开点为 0、中段为 1、终点为 0', () => {
    const e = env({ fadeIn: 0.5, fadeOut: 0.5 });
    expect(audioEnvelopeAt(0, 2, e)).toBe(0);
    expect(audioEnvelopeAt(0.25, 2, e)).toBeCloseTo(0.5, 6);
    expect(audioEnvelopeAt(1, 2, e)).toBeCloseTo(1, 6);
    expect(audioEnvelopeAt(1.75, 2, e)).toBeCloseTo(0.5, 6);
    expect(audioEnvelopeAt(2, 2, e)).toBe(0);
  });

  it('只设淡入时尾部仍是满电平；只设淡出时头部仍是满电平', () => {
    expect(audioEnvelopeAt(1.9, 2, env({ fadeIn: 0.5 }))).toBeCloseTo(1, 6);
    expect(audioEnvelopeAt(0.1, 2, env({ fadeOut: 0.5 }))).toBeCloseTo(1, 6);
  });

  it('缺省 / 0 = 不淡', () => {
    expect(audioEnvelopeAt(0, 2, env({}))).toBe(1);
    expect(audioEnvelopeAt(2, 2, env({ fadeIn: 0, fadeOut: 0 }))).toBe(1);
  });

  it('fadeIn + fadeOut 超过片段长度时按比例收缩（整段都在淡，不留硬切）', () => {
    // 各 2s 但片段只有 2s → 各占 1s；中点在 1s 处恰好是 1。
    const e = env({ end: 2, fadeIn: 2, fadeOut: 2 });
    expect(audioEnvelopeAt(0, 2, e)).toBe(0);
    expect(audioEnvelopeAt(1, 2, e)).toBeCloseTo(1, 6);
    expect(audioEnvelopeAt(2, 2, e)).toBe(0);
  });

  it('与 fadeSec 复合而不是替代（两条斜坡相乘）', () => {
    // fadeSec 0.5 在 0.25s 是 0.5；fadeIn 0.5 在 0.25s 也是 0.5 → 0.25。
    const e = env({ fadeSec: 0.5, fadeIn: 0.5 });
    expect(audioEnvelopeAt(0.25, 2, e)).toBeCloseTo(0.25, 6);
  });

  it('fadeSec 被钳到片段一半，两段淡区不相交', () => {
    const e = env({ fadeSec: 5 });
    expect(audioEnvelopeAt(1, 2, e)).toBeCloseTo(1, 6);
  });

  it('片段长度 0 / 片外位置给出端点值而不是 NaN', () => {
    expect(audioEnvelopeAt(0, 0, env({ fadeIn: 1 }))).toBe(0);
    expect(audioEnvelopeAt(-1, 2, env({ fadeIn: 1 }))).toBe(0);
    expect(audioEnvelopeAt(99, 2, env({}))).toBe(1);
  });
});

describe('audioGainAt / audioClipGainAt', () => {
  it('没有 gain 曲线时约定为 1（不是 0）', () => {
    expect(audioGainAt(clip(), GRID, 2.5)).toBe(1);
  });

  it('gain 曲线按绝对时间求值，并乘上淡变', () => {
    const c = clip({
      fadeIn: 1,
      curves: { gain: { keys: [{ t: 0, v: 0.5, interp: 'linear' }] } },
    });
    // 片段从 2s 开始、淡入 1s：t=2.5 是淡入中点（0.5），再乘 gain 0.5。
    expect(audioClipGainAt(c, GRID, 2.5)).toBeCloseTo(0.25, 6);
    // 片外 = 0（调用方仍要先判是否落在片段内，这里只是不给出负位置）
    expect(audioClipGainAt(c, GRID, 1.9)).toBe(0);
    expect(audioClipGainAt(c, GRID, 4.1)).toBe(0);
  });
});

describe('sampleAudioEnvelope', () => {
  it('首尾都取到，长度固定 ≥ 2', () => {
    const c = clip({ fadeIn: 0.5, fadeOut: 0.5 });
    const curve = sampleAudioEnvelope(c, GRID, 0, 2, 32);
    expect(curve).toHaveLength(32);
    expect(curve[0]).toBeCloseTo(0, 5);
    expect(curve[31]).toBeCloseTo(0, 5);
  });

  it('count 小于 2 时退回 2（WebAudio 不接受单点曲线）', () => {
    expect(sampleAudioEnvelope(clip(), GRID, 0, 1, 1)).toHaveLength(2);
  });

  it('从片段中段开始时，采样覆盖的是剩余那一段（预览从中间起播）', () => {
    const c = clip({ fadeOut: 0.5 });
    const curve = sampleAudioEnvelope(c, GRID, 1.5, 2, 16);
    expect(curve[0]).toBeGreaterThan(0.9);
    expect(curve[15]).toBeCloseTo(0, 5);
  });
});
