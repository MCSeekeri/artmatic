import { describe, expect, it } from 'vitest';
import { Fft, hannWindow } from '../../src/audio/fft';
import {
  computeFlux,
  estimateLag,
  estimateTempo,
  normalizeOffset,
  pickDownbeat,
  refineOnset,
  scanPhase,
  snapOffsetToPeak,
  toMono,
} from '../../src/audio/tempo';

/**
 * BPM / offset 估计。
 *
 * 用**合成信号**验：已知 BPM 的点击串（短促的 1 kHz 突发）过一遍完整链路
 * （STFT → 谱通量 → 自相关 → 相位扫描 → 下拍选择），断言还原出来的
 * BPM 与 offset。这比拿一首真歌去对「听起来对不对」可靠得多 ——
 * 真歌里没有 ground truth，而这里有一个精确的答案。
 */

const SR = 44100;

/** 造一个「点击串」：每隔 period 秒来一小段 1 kHz 的突发。 */
function clickTrain(opts: { bpm: number; seconds: number; offset?: number; noise?: number }): Float32Array {
  const n = Math.floor(opts.seconds * SR);
  const out = new Float32Array(n);
  const period = 60 / opts.bpm;
  const burst = Math.round(0.02 * SR); // 20 ms
  const first = opts.offset ?? 0;
  for (let k = 0; first + k * period < opts.seconds; k += 1) {
    const start = Math.round((first + k * period) * SR);
    for (let i = 0; i < burst && start + i < n; i += 1) {
      // 指数衰减包络：让起始沿足够陡（谱通量看的就是这个）
      const env = Math.exp(-i / (burst * 0.18));
      out[start + i]! += Math.sin((2 * Math.PI * 1000 * i) / SR) * env * 0.8;
    }
  }
  if (opts.noise) {
    for (let i = 0; i < n; i += 1) out[i]! += (Math.random() - 0.5) * opts.noise;
  }
  return out;
}

/** 冒充 AudioBuffer：`toMono` 只用到这三个成员。 */
function fakeBuffer(mono: Float32Array): AudioBuffer {
  return {
    length: mono.length,
    sampleRate: SR,
    numberOfChannels: 1,
    duration: mono.length / SR,
    getChannelData: () => mono,
  } as unknown as AudioBuffer;
}

describe('Fft', () => {
  it('长度不是 2 的幂就拒绝', () => {
    expect(() => new Fft(1000)).toThrow();
  });

  it('单频正弦的能量落在对应的 bin 上', () => {
    const n = 1024;
    const fft = new Fft(n);
    const bin = 64;
    const frame = new Float32Array(n);
    for (let i = 0; i < n; i += 1) frame[i] = Math.cos((2 * Math.PI * bin * i) / n);
    const out = new Float32Array((n >> 1) + 1);
    fft.magnitude(frame, out);
    let peak = 0;
    let peakBin = 0;
    for (let k = 1; k < out.length; k += 1) {
      if (out[k]! > peak) {
        peak = out[k]!;
        peakBin = k;
      }
    }
    expect(peakBin).toBe(bin);
    // 主瓣之外应当低两个数量级
    expect(out[bin + 20]!).toBeLessThan(peak * 0.02);
  });

  it('Hann 窗两端为 0，峰值在中点附近', () => {
    const w = hannWindow(8);
    expect(w[0]).toBeCloseTo(0, 6);
    expect(w[7]).toBeCloseTo(0, 6);
    // 对称 Hann（分母 n-1）在偶数长度下没有取到 1 的点：n=8 时中间两个样本
    // 是 0.5-0.5cos(2π·4/7) ≈ 0.95。断言「是最大值」而不是「等于 1」。
    const max = Math.max(...w);
    expect(w[4]).toBeCloseTo(max, 9);
    expect(max).toBeGreaterThan(0.9);
  });
});

describe('toMono', () => {
  it('单声道原样，多声道取平均', () => {
    const one = fakeBuffer(new Float32Array([1, 0, -1]));
    expect([...toMono(one)]).toEqual([1, 0, -1]);

    const stereo = {
      length: 3,
      sampleRate: SR,
      numberOfChannels: 2,
      getChannelData: (c: number) => (c === 0 ? new Float32Array([1, 1, 0]) : new Float32Array([0, 1, 1])),
    } as unknown as AudioBuffer;
    expect([...toMono(stereo)].map((v) => Math.round(v * 100) / 100)).toEqual([0.5, 1, 0.5]);
  });
});

describe('computeFlux + estimateLag：还原已知 BPM', () => {
  for (const bpm of [90, 120, 140]) {
    it(`${bpm} BPM 的点击串能估出 ${bpm}（±1）`, async () => {
      const mono = clickTrain({ bpm, seconds: 12 });
      const { flux, fps } = await computeFlux(mono, SR);
      expect(flux.length).toBeGreaterThan(fps * 10);

      const lag = estimateLag(flux, fps);
      expect(lag).toBeGreaterThan(0);
      const got = (60 * fps) / lag;
      expect(Math.abs(got - bpm)).toBeLessThan(1);
    });
  }

  it('静音估不出周期（返回 -1 而不是编一个值）', async () => {
    const silent = new Float32Array(SR * 5);
    const { flux, fps } = await computeFlux(silent, SR);
    expect(estimateLag(flux, fps)).toBe(-1);
  });

  it('BPM 落在搜索范围内（倍频歧义被 70..180 挡住）', async () => {
    const mono = clickTrain({ bpm: 120, seconds: 10 });
    const { flux, fps } = await computeFlux(mono, SR);
    const bpm = (60 * fps) / estimateLag(flux, fps);
    expect(bpm).toBeGreaterThanOrEqual(70);
    expect(bpm).toBeLessThanOrEqual(180);
  });
});

describe('scanPhase / pickDownbeat', () => {
  it('相位扫描落在点击位置上', async () => {
    const mono = clickTrain({ bpm: 120, seconds: 12, offset: 0.13 });
    const { flux, fps } = await computeFlux(mono, SR);
    const bpm = (60 * fps) / estimateLag(flux, fps);
    /*
     * 三级精度，逐级收紧（这也是实现里的真实链路）：
     *   coarse  网格扫描 —— 带 STFT 帧偏差（几十毫秒）
     *   snapped 长窗通量峰 —— 仍在真实起始沿**之前**
     *   refined 短窗重定位 —— 几毫秒
     */
    const coarse = scanPhase(flux, fps, bpm).offset;
    const snapped = snapOffsetToPeak(flux, fps, coarse);
    const refined = refineOnset(mono, SR, snapped);
    const delta = (v: number) =>
      Math.min(Math.abs(v - 0.13), Math.abs(v - 0.13 + 0.5), Math.abs(v - 0.13 - 0.5));
    expect(delta(coarse)).toBeGreaterThan(0.02);      // 粗定位确实偏（否则这条测试没意义）
    expect(delta(refined)).toBeLessThan(0.008);       // 短窗精修之后应当很准
    expect(delta(refined)).toBeLessThan(delta(snapped));
  });

  it('下拍在 0..3 之间，且同样的输入给同样的答案', async () => {
    const mono = clickTrain({ bpm: 120, seconds: 12 });
    const { flux, fps } = await computeFlux(mono, SR);
    const bpm = (60 * fps) / estimateLag(flux, fps);
    const { offset } = scanPhase(flux, fps, bpm);
    const a = pickDownbeat(flux, fps, offset, bpm);
    const b = pickDownbeat(flux, fps, offset, bpm);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(4);
  });

  it('normalizeOffset 把秒折进 [0, 一拍)', () => {
    expect(normalizeOffset(0.75, 120)).toBeCloseTo(0.25, 9);
    expect(normalizeOffset(-0.1, 120)).toBeCloseTo(0.4, 9);
    expect(normalizeOffset(0.1, 120)).toBeCloseTo(0.1, 9);
  });
});

describe('estimateTempo：整条链路', () => {
  it('120 BPM / offset 0.25 能还原', async () => {
    const mono = clickTrain({ bpm: 120, seconds: 14, offset: 0.25 });
    const r = await estimateTempo(fakeBuffer(mono));
    expect(r).not.toBeNull();
    expect(r!.silent).toBe(false);
    expect(Math.abs(r!.bpm - 120)).toBeLessThan(1);
    expect(r!.beatsPerBar).toBe(4);
    // offset 允许落在同一拍的任意等价位置（下拍可能把它整体挪了几拍）
    const beat = 60 / r!.bpm;
    const rem = ((r!.offset % beat) + beat) % beat;
    const target = 0.25 % beat;
    const delta = Math.min(Math.abs(rem - target), beat - Math.abs(rem - target));
    expect(delta).toBeLessThan(0.01);
  });

  it('时长不足 2 秒 → null（不编一个值出来）', async () => {
    const mono = clickTrain({ bpm: 120, seconds: 1.2 });
    expect(await estimateTempo(fakeBuffer(mono))).toBeNull();
  });

  it('静音 → silent=true 且 confidence=0（调用方据此拒绝采纳）', async () => {
    const r = await estimateTempo(fakeBuffer(new Float32Array(SR * 6)));
    expect(r).not.toBeNull();
    expect(r!.silent).toBe(true);
    expect(r!.confidence).toBe(0);
  });

  it('少量噪声不影响还原', async () => {
    const mono = clickTrain({ bpm: 100, seconds: 14, offset: 0.08, noise: 0.02 });
    const r = await estimateTempo(fakeBuffer(mono));
    expect(r).not.toBeNull();
    expect(Math.abs(r!.bpm - 100)).toBeLessThan(2);
  });
});
