import { describe, expect, it } from 'vitest';
import { EXPORT_CHANNELS, EXPORT_SAMPLE_RATE, mixdown, toAudioBuffer } from '../../src/exporters/mixdown';
import { newId, type AudioClip, type Project, type SoundTrack } from '../../src/core/schema';
import { DEMO_BPM } from '../../src/audio/demo-audio';

/**
 * 混流是「导出的声音」与「预览的声音」唯一的语义共用点，
 * 所以这里钉的是**可听出来的性质**：响度、位置、包络、静音轨。
 *
 * AudioBuffer 在 vitest（node 环境）里不存在，所以这里用一个只实现
 * `getChannelData` / `numberOfChannels` / `length` 的最小替身。
 * mixdown 只用到这三个成员，不依赖真实 Web Audio。
 */
function fakeBuffer(channels: number[][], sampleRate = 48000) {
  const data = channels.map((c) => Float32Array.from(c));
  return {
    numberOfChannels: data.length,
    length: data[0]!.length,
    sampleRate,
    duration: data[0]!.length / sampleRate,
    getChannelData: (i: number) => data[i]!,
  } as unknown as AudioBuffer;
}

/** 生成 n 个采样点的常量信号。 */
function dc(value: number, frames: number, channels = 1) {
  const chans = [];
  for (let c = 0; c < channels; c++) chans.push(new Array(frames).fill(value));
  return fakeBuffer(chans);
}

function audioClip(start: number, end: number, extra: Partial<AudioClip> = {}): AudioClip {
  return {
    id: newId(),
    kind: 'audio',
    assetId: 'A1',
    srcIn: 0,
    start,
    end,
    label: 'a',
    fadeSec: 0,
    curves: {},
    ...extra,
  };
}

function projectWith(clips: AudioClip[], duration: number, trackOverrides: Partial<SoundTrack> = {}): Project {
  const track: SoundTrack = {
    id: newId(),
    kind: 'audio',
    name: 'audio',
    enabled: true,
    clips,
    bus: 'master',
    ...trackOverrides,
  };
  return {
    schemaVersion: 2,
    name: 't',
    seed: 1,
    fps: 30,
    resolution: { w: 320, h: 180 },
    duration,
    beatGrid: { bpm: DEMO_BPM, offset: 0, bars: 4, beatsPerBar: 4 },
    tracks: [track],
  } as unknown as Project;
}

describe('mixdown', () => {
  it('没有音频片段时返回 null（而不是一条静音轨）', () => {
    expect(mixdown(projectWith([], 2), () => dc(1, 100))).toBeNull();
  });

  it('轨道 enabled=false 时同样返回 null', () => {
    const p = projectWith([audioClip(0, 1)], 1, { enabled: false });
    expect(mixdown(p, () => dc(1, 100))).toBeNull();
  });

  it('输出采样率与声道数符合约定', () => {
    const m = mixdown(projectWith([audioClip(0, 1)], 1), () => dc(0.5, 48000, 2));
    expect(m).not.toBeNull();
    expect(m!.sampleRate).toBe(EXPORT_SAMPLE_RATE);
    expect(m!.channels).toHaveLength(EXPORT_CHANNELS);
  });

  it('常量信号 0.5 混出来还是 0.5（增益为 1 时不改变电平）', () => {
    const m = mixdown(projectWith([audioClip(0, 1)], 1), () => dc(0.5, 48000))!;
    expect(m.channels[0]![1000]).toBeCloseTo(0.5, 5);
    expect(m.peak).toBeCloseTo(0.5, 5);
  });

  it('片段在时间轴上的位置正确：start=0.5s 的信号不出现在 0.2s 处', () => {
    // 片段从 0.5s 开始，前 0.5s 必须是 0
    const m = mixdown(projectWith([audioClip(0.5, 1.5)], 2), () => dc(0.8, 48000))!;
    expect(m.channels[0]![Math.floor(0.2 * EXPORT_SAMPLE_RATE)]).toBe(0);
    // 0.5s 之后才有信号
    expect(m.channels[0]![Math.floor(0.7 * EXPORT_SAMPLE_RATE)]).toBeCloseTo(0.8, 5);
  });

  it('srcIn 偏移生效：跳过源素材开头', () => {
    // 源是 [0.1, 0.9] 的一秒，srcIn=0.5s 时片段开头应读到 0.6
    const src = fakeBuffer([[...new Array(24000).fill(0.1), ...new Array(24000).fill(0.9)]]);
    const clip = audioClip(0, 0.5, { srcIn: 0.5 });
    const m = mixdown(projectWith([clip], 1), () => src)!;
    expect(m.channels[0]![100]).toBeCloseTo(0.9, 5);
  });

  it('两个片段在各自位置叠加，不互相污染', () => {
    const a = dc(0.2, 48000);
    const b = dc(0.4, 48000);
    const p = projectWith([audioClip(0, 0.5, { assetId: 'A' }), audioClip(0.5, 1, { assetId: 'B' })], 1);
    const m = mixdown(p, (id) => (id === 'A' ? a : b))!;
    expect(m.channels[0]![Math.floor(0.25 * EXPORT_SAMPLE_RATE)]).toBeCloseTo(0.2, 5);
    expect(m.channels[0]![Math.floor(0.75 * EXPORT_SAMPLE_RATE)]).toBeCloseTo(0.4, 5);
  });

  it('重叠片段是相加而不是取后者', () => {
    const p = projectWith([audioClip(0, 1, { assetId: 'A' }), audioClip(0, 1, { assetId: 'B' })], 1);
    const m = mixdown(p, (id) => dc(id === 'A' ? 0.2 : 0.4, 48000))!;
    expect(m.channels[0]![1000]).toBeCloseTo(0.6, 5);
  });

  it('素材缺失时跳过该片段，不中断整条混流', () => {
    const p = projectWith(
      [audioClip(0, 0.5, { assetId: 'MISSING' }), audioClip(0.5, 1, { assetId: 'OK' })],
      1,
    );
    const m = mixdown(p, (id) => (id === 'OK' ? dc(0.7, 48000) : null))!;
    expect(m.channels[0]![Math.floor(0.25 * EXPORT_SAMPLE_RATE)]).toBe(0);
    expect(m.channels[0]![Math.floor(0.75 * EXPORT_SAMPLE_RATE)]).toBeCloseTo(0.7, 5);
  });

  it('fadeSec 在片段开头淡入：起点为 0', () => {
    const clip = audioClip(0, 1, { fadeSec: 0.5 });
    const m = mixdown(projectWith([clip], 1), () => dc(1, 48000))!;
    const at = (s: number) => m.channels[0]![Math.floor(s * EXPORT_SAMPLE_RATE)];
    expect(at(0)).toBeCloseTo(0, 5);
    // 淡入中点（0.25s，正好一半）应为 0.5
    expect(at(0.25)).toBeCloseTo(0.5, 4);
    // 0.5s 处淡入结束、淡出刚开始 → 满电平
    expect(at(0.5)).toBeCloseTo(1, 5);
  });

  it('fadeSec 在片段结尾淡出：终点为 0', () => {
    const clip = audioClip(0, 1, { fadeSec: 0.5 });
    const m = mixdown(projectWith([clip], 1), () => dc(1, 48000))!;
    // 最后 0.25s（从 0.75 到 1.0）线性降到 0
    const at = (s: number) => m.channels[0]![Math.floor(s * EXPORT_SAMPLE_RATE)];
    expect(at(0.9)).toBeCloseTo(0.2, 3);
    expect(at(0.99)).toBeLessThan(0.05);
  });

  it('fadeSec 大于片段长度一半时压到半长，不会让中间塌到 0', () => {
    // fade = 1s 但片段只有 0.4s → 实际 fade 0.2s，中点应仍是满电平
    const clip = audioClip(0, 0.4, { fadeSec: 1 });
    const m = mixdown(projectWith([clip], 0.4), () => dc(1, 48000))!;
    const at = (s: number) => m.channels[0]![Math.floor(s * EXPORT_SAMPLE_RATE)];
    expect(at(0.2)).toBeCloseTo(1, 3);
  });

  it('fadeSec <= 0 时不淡入淡出', () => {
    const m = mixdown(projectWith([audioClip(0, 1, { fadeSec: 0 })], 1), () => dc(1, 48000))!;
    expect(m.channels[0]![0]).toBeCloseTo(1, 5);
  });

  it('单声道素材复制到双声道（不越界、不静音）', () => {
    const m = mixdown(projectWith([audioClip(0, 1)], 1), () => dc(0.5, 48000))!;
    for (let c = 0; c < EXPORT_CHANNELS; c++) {
      expect(m.channels[c]![1000]).toBeCloseTo(0.5, 5);
    }
  });

  it('超出工程时长的部分被裁掉', () => {
    // 片段到 1.5s，工程只有 1s
    const m = mixdown(projectWith([audioClip(0, 1.5)], 1), () => dc(1, 48000))!;
    expect(m.channels[0]!.length).toBe(Math.ceil(1 * EXPORT_SAMPLE_RATE));
    expect(m.duration).toBe(1);
  });

  it('gain 曲线生效：keys 只有一档时按该值缩放', () => {
    const clip = audioClip(0, 1, {
      curves: { gain: { keys: [{ t: 0, v: 0.25, interp: 'linear' }] } },
    });
    const m = mixdown(projectWith([clip], 1), () => dc(1, 48000))!;
    expect(m.channels[0]![1000]).toBeCloseTo(0.25, 5);
  });

  it('全静音的工程 peak 为 0（UI 靠它提示「只有画面」）', () => {
    const m = mixdown(projectWith([audioClip(0, 1)], 1), () => dc(0, 48000))!;
    expect(m.peak).toBe(0);
  });
});

describe('toAudioBuffer', () => {
  /** createBuffer 的最小替身（node 环境没有 AudioBuffer）。 */
  function ctxStub() {
    return {
      createBuffer: (ch: number, len: number, sr: number) => {
        const data = Array.from({ length: ch }, () => new Float32Array(len));
        return {
          numberOfChannels: ch,
          length: len,
          sampleRate: sr,
          getChannelData: (i: number) => data[i]!,
          copyToChannel: (src: Float32Array, i: number) => {
            data[i]!.set(src);
          },
        };
      },
    } as unknown as BaseAudioContext;
  }

  it('把混流结果搬进 AudioBuffer，长度与声道数一致', () => {
    const m = mixdown(projectWith([audioClip(0, 1)], 1), () => dc(0.5, 48000))!;
    const buf = toAudioBuffer(m, ctxStub());
    expect(buf.numberOfChannels).toBe(EXPORT_CHANNELS);
    expect(buf.length).toBe(m.channels[0]!.length);
    expect(buf.sampleRate).toBe(EXPORT_SAMPLE_RATE);
    expect(buf.getChannelData(0)[1000]).toBeCloseTo(0.5, 5);
  });
});
