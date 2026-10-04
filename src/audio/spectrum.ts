/**
 * spectrum.ts — 音频 → 逐帧频谱（**离线预计算**）。
 *
 * 为什么是离线的：openmosh 用实时 `AnalyserNode.getByteFrequencyData` 取频谱，
 * 而它自己在 `auto-range.ts` 的注释里就承认这带来预览与导出不一致的坑
 * （「The preview took this from the AnalyserNode, which the offline export has
 * no equivalent for」）。Artmatic 本来就是「先解码、再离线算」的架构
 * （ADR-002 自研 FFT 也是为这个），所以这里一次算完整首曲子的频谱、之后按 t 查表：
 * 确定、可 seek、预览与导出走同一份数据。
 *
 * **形状照 FFT 的线性频率 bin 交出去，不预先分组。** 分组交给消费方 ——
 * `audio-bars` 会把下标**平方**再采样，好把大部分宽度让给低频段（低频在一个线性
 * FFT 里只占很小一截；线性采样会让第一个 bar 之外的所有 bar 大部分时间都是死的）。
 *
 * 数值口径对齐 `AnalyserNode` 的默认窗口（-100 dB → 0，-30 dB → 255），
 * 因为下游的滚动归一化就是按「普通音乐的 bin 落在 0.4–0.85」这条经验设计的。
 */

import { Fft, hannWindow } from './fft';
import { frameRms } from './features';

/** 分析帧率。20 ms 一帧够用；内存约 `bins × 50` 字节/秒（1025 bins ≈ 200 KB/s）。 */
export const SPECTRUM_FPS = 50;
/** 与 tempo 的 N_FFT 一致：44.1 kHz 下 bin 宽 ≈ 21.5 Hz。 */
export const SPECTRUM_FFT = 2048;
/** 单边谱的 bin 数。**唯一的真源** —— 消费方与纹理宽度都从这里取。 */
export const SPECTRUM_BINS = (SPECTRUM_FFT >> 1) + 1;
/** 对齐 AnalyserNode 的默认 dB 窗口。 */
const MIN_DB = -100;
const MAX_DB = -30;
/** 每算这么多帧让出一次主线程（硬约束 1.4：主线程只做 rAF 与 uniform 写入）。 */
const CHUNK = 64;

export interface SpectrumTrack {
  /** 每帧的时间步长（秒）。 */
  readonly hopSec: number;
  readonly bins: number;
  readonly frames: number;
  /**
   * 取**素材时间** `t` 秒处那一帧的 bin（0..255），写进 `out`（长度必须 ≥ `bins`）。
   * 超出范围时全写 0。用传入的缓冲而不是返回新数组 —— 每帧都调，不能分配。
   *
   * 注意是**素材时间**（解码后 buffer 里的秒数），不是工程时间；
   * 工程时间到素材时间的换算由调用方按 `AudioClip.start` / `srcIn` 做。
   */
  at(t: number, out: Uint8Array): void;
}

/** 只依赖 `getChannelData` / `length` / `numberOfChannels` / `sampleRate`，方便单测喂假对象。 */
interface MonoSource {
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

/** 一趟走查的形状：多少帧、多少 bin、每帧多长。 */
export interface SpectrumPlan {
  frames: number;
  bins: number;
  hopSec: number;
  sampleRate: number;
}

/**
 * 帧数 / hop / bin 的**唯一真源**。
 *
 * 暴露出来是因为旁路钩子（音频特征累加器）必须**在走查开始前**按同样的帧数
 * 预分配，否则它会少喂帧、曲线尾部静默变成 0。让调用方自己抄一遍这套算术
 * 迟早会漂。
 */
export function planSpectrum(sampleRate: number, length: number): SpectrumPlan {
  const hop = Math.max(1, Math.round(sampleRate / SPECTRUM_FPS));
  return {
    frames: length >= SPECTRUM_FFT ? 1 + Math.floor((length - SPECTRUM_FFT) / hop) : 0,
    bins: SPECTRUM_BINS,
    hopSec: hop / sampleRate,
    sampleRate,
  };
}

function monoOf(buffer: MonoSource): Float32Array {
  const n = buffer.length;
  const out = new Float32Array(n);
  const channels = Math.max(1, buffer.numberOfChannels);
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i += 1) out[i]! += data[i]!;
  }
  const k = 1 / channels;
  for (let i = 0; i < n; i += 1) out[i]! *= k;
  return out;
}

/** 幅度 → 0..255（对齐 AnalyserNode 的 dB 窗口）。 */
function toByte(mag: number, scale: number): number {
  if (mag <= 0) return 0;
  const db = 20 * Math.log10(mag * scale);
  if (db <= MIN_DB) return 0;
  if (db >= MAX_DB) return 255;
  return Math.round(((db - MIN_DB) / (MAX_DB - MIN_DB)) * 255);
}

/**
 * 算出一整条频谱轨。
 *
 * `onProgress` 每处理一段调用一次（用来驱动进度条），分段让出主线程。
 *
 * `onFrame` 是**同一趟走查**里的旁路钩子：每算完一帧就拿到 `(线性幅度谱, 帧 rms)`。
 * 音频特征轨（`audio/features.ts`）挂在这里 —— 二者要的是同一个 FFT、同一个窗、
 * 同一个 hop，再走一趟就是把这件机械劳动抄两遍。`mag` 是**复用缓冲**，
 * 钩子必须当场取走要用的东西。
 */
export async function computeSpectrum(
  buffer: MonoSource,
  onProgress?: (done: number, total: number) => void,
  onFrame?: (mag: Float32Array, rms: number) => void,
): Promise<SpectrumTrack> {
  const sampleRate = buffer.sampleRate;
  const plan = planSpectrum(sampleRate, buffer.length);
  const hop = Math.max(1, Math.round(sampleRate / SPECTRUM_FPS));
  const hopSec = plan.hopSec;
  const n = SPECTRUM_FFT;
  const bins = plan.bins;
  const frames = plan.frames;

  const data = new Uint8Array(frames * bins);
  if (frames > 0) {
    const mono = monoOf(buffer);
    const fft = new Fft(n);
    const win = hannWindow(n);
    const frame = new Float32Array(n);
    const mag = new Float32Array(bins);
    // 满量程正弦在这个缩放下的幅度约为 1（Hann 的相干增益 0.5，单边谱再乘 2）。
    const scale = 2 / (n * 0.5);

    for (let start = 0; start < frames; start += CHUNK) {
      const stop = Math.min(frames, start + CHUNK);
      for (let f = start; f < stop; f += 1) {
        const off = f * hop;
        for (let i = 0; i < n; i += 1) frame[i] = (mono[off + i] ?? 0) * win[i]!;
        fft.magnitude(frame, mag);
        const base = f * bins;
        for (let k = 0; k < bins; k += 1) data[base + k] = toByte(mag[k]!, scale);
        // rms 取**加窗之前**的原始样本：加了窗的帧在两端被压掉，算出来的响度偏低。
        onFrame?.(mag, frameRms(mono, off, n));
      }
      onProgress?.(stop, frames);
      if (stop < frames) await Promise.resolve();
    }
  }

  return {
    hopSec,
    bins,
    frames,
    at(t: number, out: Uint8Array): void {
      const f = Math.round(t / hopSec);
      if (f < 0 || f >= frames) {
        out.fill(0, 0, bins);
        return;
      }
      const base = f * bins;
      for (let k = 0; k < bins; k += 1) out[k] = data[base + k]!;
    },
  };
}
