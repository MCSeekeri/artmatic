/**
 * tempo.ts — 从音频自动估计 BPM 与第 0 拍偏移（ADR-002）。
 *
 * 移植自 angel-echo 的 `tools/analyze_audio.py`（同作者，内部移植），
 * 只取这段需要的三个环节，砍掉与「一部片的结构分析」相关的部分
 * （分段、镜头锚点、频谱瀑布图）：
 *
 * ```
 * 单声道 → Hann STFT（正窗，100 Hz 特征帧率）
 *        → 谱通量 flux（逐帧「只算增益」的频谱差分和）
 *        → 自相关 + 抛物线插值  → BPM
 *        → 在一拍内扫描相位，取 flux 命中率最高者 → 第几拍是第 0 拍
 *        → 四拍里挑下拍（平均 flux 最大）        → offset 落到小节线上
 * ```
 *
 * ## 两条与 Python 原版一致的取舍
 *
 * 1. **谱通量而不是能量包络**。能量的鼓点与贝斯的持续音会糊在一起；
 *    谱通量只看「频谱变亮」的瞬间，对鼓点更敏感，代价是要做 STFT。
 * 2. **自相关而不是梳状滤波**。自相关在整段上平均，对局部切分变化更稳；
 *    抛物线插值把 lag 从整数精修到小数，于是 BPM 不会只有整数分之一的分辨率。
 *
 * ## 分块让出主线程
 *
 * 一首 4 分钟的歌 ≈ 2.4 万帧 STFT，主线程上连续跑会卡住 UI 几百毫秒到一秒。
 * 按 `computeWaveform` 的既有做法**分块 + setTimeout(0) 让出**：一次性工作
 * 分块做既守硬约束 1.4，又省掉一个 Worker 的生命周期管理。
 */

import { Fft, hannWindow } from './fft';

/** STFT 窗长。2048 @44.1k ≈ 46 ms —— 低频（30 Hz 级）也还分得开。 */
export const N_FFT = 2048;

/** 特征帧率：100 Hz（10 ms 一格），与 Python 版的 441/44100 一致。 */
export const FEATURE_FPS = 100;

/** 节拍搜索范围。低于 70 会把 4/4 的 120 听成 60（倍频歧义），高于 180 同理。 */
export const BPM_LO = 70;
export const BPM_HI = 180;

/** 每块处理多少特征帧。256 ≈ 2.6 s 音频，单块约 5–15 ms。 */
const CHUNK = 256;

export interface TempoEstimate {
  bpm: number;
  /**
   * 第 0 拍的秒数（可直接写进 `BeatGrid.offset`）。
   * 已经是**下拍**（小节第一拍）的时间，不是随便某一拍。
   */
  offset: number;
  beatsPerBar: number;
  /** 相位命中分（0 起，越大越可信）。给 UI 判断「值不值得采纳」。 */
  confidence: number;
  /** 参与估计的特征帧数（诊断用）。 */
  frames: number;
  /** 音频几乎全静音时为 true，此时 bpm/offset 没有意义。 */
  silent: boolean;
}

export interface FluxResult {
  /** 每帧的谱通量。 */
  flux: Float32Array;
  /** 特征帧率（Hz）。 */
  fps: number;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 单声道混合（原地读，不开新数组）。 */
export function toMono(buffer: AudioBuffer): Float32Array {
  const n = buffer.length;
  const out = new Float32Array(n);
  const ch0 = buffer.getChannelData(0);
  if (buffer.numberOfChannels === 1) {
    out.set(ch0);
    return out;
  }
  const channels = buffer.numberOfChannels;
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i += 1) out[i]! += data[i]!;
  }
  const k = 1 / channels;
  for (let i = 0; i < n; i += 1) out[i]! *= k;
  return out;
}

/**
 * 逐帧谱通量。
 *
 * 帧率固定 100 Hz（与采样率无关）：`hop = round(sampleRate / 100)`。
 * 这样不同采样率的素材估出来的 BPM 落在同一套参数上（搜索范围、最小间隔
 * 都是以帧为单位写的），不需要为 48 kHz 再调一遍。
 */
export async function computeFlux(
  mono: Float32Array,
  sampleRate: number,
  onProgress?: (done: number, total: number) => void,
): Promise<FluxResult> {
  const hop = Math.max(1, Math.round(sampleRate / FEATURE_FPS));
  const fps = sampleRate / hop;
  const n = N_FFT;
  const frames = mono.length >= n ? 1 + Math.floor((mono.length - n) / hop) : 0;
  if (frames <= 0) return { flux: new Float32Array(0), fps };

  const fft = new Fft(n);
  const win = hannWindow(n);
  const frame = new Float32Array(n);
  const bins = (n >> 1) + 1;
  let mag = new Float32Array(bins);
  let prev = new Float32Array(bins);
  const flux = new Float32Array(frames);
  let havePrev = false;

  for (let start = 0; start < frames; start += CHUNK) {
    const stop = Math.min(frames, start + CHUNK);
    for (let f = start; f < stop; f += 1) {
      const off = f * hop;
      for (let i = 0; i < n; i += 1) frame[i] = mono[off + i]! * win[i]!;
      fft.magnitude(frame, mag);
      if (havePrev) {
        let sum = 0;
        for (let k = 0; k < bins; k += 1) {
          const d = mag[k]! - prev[k]!;
          if (d > 0) sum += d;
        }
        flux[f] = sum;
      }
      // 交换缓冲（不分配）：这一帧的谱成为下一帧的「前一份」
      const tmp = prev;
      prev = mag;
      mag = tmp;
      havePrev = true;
    }
    onProgress?.(stop, frames);
    if (stop < frames) await yieldToUi();
  }
  return { flux, fps };
}

/** 均值。 */
function mean(a: Float32Array, from = 0, to = a.length): number {
  let s = 0;
  for (let i = from; i < to; i += 1) s += a[i]!;
  return to > from ? s / (to - from) : 0;
}

/**
 * 自相关估周期（帧为单位），带抛物线插值。
 * 返回 lag（小数帧）；退化时返回 -1。
 */
export function estimateLag(flux: Float32Array, fps: number): number {
  const n = flux.length;
  const m = mean(flux);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i += 1) e[i] = flux[i]! - m;

  // 只需要 lag ∈ [lo, hi]，所以只算这一段的自相关（O(n·span)，比全量 FFT 版便宜）
  const lo = Math.max(1, Math.round((fps * 60) / BPM_HI));
  const hi = Math.min(n - 1, Math.round((fps * 60) / BPM_LO));
  if (hi <= lo) return -1;

  const ac = new Float32Array(hi + 1);
  for (let lag = 0; lag <= hi; lag += 1) {
    let s = 0;
    for (let i = 0; i + lag < n; i += 1) s += e[i]! * e[i + lag]!;
    ac[lag] = s;
  }
  // 零能量时 ac 全是 0：此时「最大值」是任意的，必须显式判定为估不出来，
  // 否则会返回搜索区间的第一个 lag（那是一个看起来很像模像样的假答案）。
  if (!(ac[0]! > 0)) return -1;
  const norm = ac[0]!;
  for (let lag = 0; lag <= hi; lag += 1) ac[lag] = ac[lag]! / norm;

  let best = -1;
  let bestVal = -Infinity;
  for (let lag = lo; lag <= hi; lag += 1) {
    if (ac[lag]! > bestVal) {
      bestVal = ac[lag]!;
      best = lag;
    }
  }
  if (best < 0 || !(bestVal > 0)) return -1;

  // 抛物线插值：把整数 lag 精修到小数，否则 BPM 只有 lag 的分辨率
  if (best > 0 && best < hi) {
    const y0 = ac[best - 1]!;
    const y1 = ac[best]!;
    const y2 = ac[best + 1]!;
    const den = y0 - 2 * y1 + y2;
    if (Math.abs(den) > 1e-12) return best + (0.5 * (y0 - y2)) / den;
  }
  return best;
}

/** 一拍内扫描相位，取「落在拍上的 flux 平均值 + 0.5×p90」最高的那个。 */
export function scanPhase(flux: Float32Array, fps: number, bpm: number): { offset: number; score: number } {
  const period = (60 / bpm) * fps;
  const n = flux.length;
  if (!(period > 0) || n < 8) return { offset: 0, score: 0 };

  let best = 0;
  let bestScore = -Infinity;
  for (let off = 0; off < period; off += 0.25) {
    const hits: number[] = [];
    for (let pos = off; pos < n - 1; pos += period) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const v = flux[i0]! * (1 - frac) + flux[Math.min(i0 + 1, n - 1)]! * frac;
      hits.push(v);
    }
    if (hits.length < 8) continue;
    hits.sort((a, b) => a - b);
    const avg = hits.reduce((s, v) => s + v, 0) / hits.length;
    const p90 = hits[Math.floor(hits.length * 0.9)] ?? 0;
    const score = avg + 0.5 * p90;
    if (score > bestScore) {
      bestScore = score;
      best = off;
    }
  }
  return { offset: best / fps, score: bestScore };
}

/**
 * 四拍里挑下拍：让「平均值最大」的那一拍当小节第一拍。
 * 不做这一步的话，小节线整体偏移 1–3 拍 —— 拍吸附看不出，小节吸附全错。
 */
export function pickDownbeat(flux: Float32Array, fps: number, beatOffset: number, bpm: number): number {
  const period = 60 / bpm;
  const n = flux.length;
  let best = 0;
  let bestScore = -Infinity;
  for (let off = 0; off < 4; off += 1) {
    const hits: number[] = [];
    for (let t = beatOffset + off * period; t < n / fps - 0.05; t += period * 4) {
      const idx = Math.min(n - 1, Math.max(0, Math.round(t * fps)));
      hits.push(flux[idx]!);
    }
    if (hits.length < 4) continue;
    const avg = hits.reduce((s, v) => s + v, 0) / hits.length;
    if (avg > bestScore) {
      bestScore = avg;
      best = off;
    }
  }
  return best;
}

/** 把秒折算进 [0, beatDur)：offset 的等价写法里最小的那个。 */
export function normalizeOffset(offset: number, bpm: number): number {
  const beat = 60 / bpm;
  if (!(beat > 0)) return 0;
  let v = offset % beat;
  if (v < 0) v += beat;
  return v;
}

/**
 * 把相位吸附到附近真正的通量峰上。
 *
 * **这一步不是可选的。** STFT 的帧网格本身带一个系统偏差：2048 点的窗要
 * 等事件的瞬态进入窗内才开始贡献通量，于是「按网格扫出来的相位」比真实
 * 起始沿稳定地晚（或早）几十毫秒。angel-echo 的 Python 版同样有这个偏差，
 * 它的对策是 `snap_beats(beats, onsets, tol=0.075)` —— 把拍吸附到检出的
 * onset 上。这里做等价的事，但直接在通量上找峰，省掉一整轮 onset 检测。
 *
 * 找到峰之后用抛物线插值精修到亚帧精度（帧网格是 10 ms，直接取整会让
 * 拍点带着 ±10 ms 的量化误差，卡点编曲上听得出来）。
 */
export function snapOffsetToPeak(
  flux: Float32Array,
  fps: number,
  offset: number,
  searchSec = 0.06,
): number {
  const n = flux.length;
  if (n < 3) return offset;
  const span = Math.max(1, Math.round(searchSec * fps));
  const center = Math.round(offset * fps);
  let best = -1;
  let bestVal = -Infinity;
  for (let i = Math.max(1, center - span); i <= Math.min(n - 2, center + span); i += 1) {
    if (flux[i]! > bestVal) {
      bestVal = flux[i]!;
      best = i;
    }
  }
  if (best < 1) return offset;
  const y0 = flux[best - 1]!;
  const y1 = flux[best]!;
  const y2 = flux[best + 1]!;
  const den = y0 - 2 * y1 + y2;
  const refined = Math.abs(den) > 1e-12 ? best + (0.5 * (y0 - y2)) / den : best;
  return refined / fps;
}

/**
 * 用**短窗**在这一小段上重找起始沿（粗到细的第二级）。
 *
 * 为什么必须有这一步：长窗（2048 ≈ 46 ms）给的是**频率**分辨率，而它的
 * 通量峰比真实起始沿**早**约 1/3 个窗长（实测 30 ms）—— 事件的瞬态一进入
 * 窗的早段就开始抬高幅度谱，等窗中心走到起始沿时通量已经在回落了。
 * 30 ms 的偏差在 BPM 上看不出来，但拍吸附上听得出来（约 1/16 拍）。
 *
 * 短窗（256 ≈ 5.8 ms）的时间分辨率高得多，配 1 ms 的帧距与抛物线插值，
 * 偏差降到几毫秒。只在这一小段上算（±80 ms ≈ 160 帧），代价可忽略。
 *
 * 两级各取所长，是 onset 检测的标准做法；写死一个「减去 30 ms」的常数
 * 也能过测试，但那个常数只在 44.1 kHz + 这个窗长下成立。
 */
export function refineOnset(
  mono: Float32Array,
  sampleRate: number,
  guess: number,
  searchSec = 0.08,
): number {
  const n = 256;
  const hop = Math.max(1, Math.round(sampleRate / 1000)); // 1 ms 帧距
  const from = Math.max(0, Math.floor((guess - searchSec) * sampleRate));
  const to = Math.min(mono.length - n, Math.ceil((guess + searchSec) * sampleRate));
  if (to - from <= n) return guess;

  const count = Math.floor((to - from) / hop) + 1;
  const fft = new Fft(n);
  const win = hannWindow(n);
  const frame = new Float32Array(n);
  const bins = (n >> 1) + 1;
  let mag = new Float32Array(bins);
  let prev = new Float32Array(bins);
  const flux = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const off = from + i * hop;
    for (let k = 0; k < n; k += 1) frame[k] = mono[off + k]! * win[k]!;
    fft.magnitude(frame, mag);
    if (i > 0) {
      let sum = 0;
      for (let k = 0; k < bins; k += 1) {
        const d = mag[k]! - prev[k]!;
        if (d > 0) sum += d;
      }
      flux[i] = sum;
    }
    const tmp = prev;
    prev = mag;
    mag = tmp;
  }

  // i=0 的 flux 是「与全零比」，恒为一个大值，必须从 1 开始找峰
  let best = -1;
  let bestVal = -Infinity;
  for (let i = 1; i < count - 1; i += 1) {
    if (flux[i]! > bestVal) {
      bestVal = flux[i]!;
      best = i;
    }
  }
  if (best < 1) return guess;
  const y0 = flux[best - 1]!;
  const y1 = flux[best]!;
  const y2 = flux[best + 1]!;
  const den = y0 - 2 * y1 + y2;
  const refined = Math.abs(den) > 1e-12 ? best + (0.5 * (y0 - y2)) / den : best;
  return (from + refined * hop) / sampleRate;
}

export interface EstimateOpts {
  onProgress?: (done: number, total: number) => void;
}

/** 从一段已解码音频估 BPM / offset。静音或太短时返回 null。 */
export async function estimateTempo(
  buffer: AudioBuffer,
  opts: EstimateOpts = {},
): Promise<TempoEstimate | null> {
  const mono = toMono(buffer);
  const { flux, fps } = await computeFlux(mono, buffer.sampleRate, opts.onProgress);
  if (flux.length < fps * 2) return null; // 不足 2 秒，估不出周期

  // 静音门限：整段几乎没有能量时，自相关只是在拟合数值噪声，
  // 出来的 BPM 看着像模像样但毫无意义 —— 宁可给出「估不出来」。
  let peak = 0;
  for (let i = 0; i < mono.length; i += 64) peak = Math.max(peak, Math.abs(mono[i]!));
  if (peak < 1e-4) {
    return { bpm: 0, offset: 0, beatsPerBar: 4, confidence: 0, frames: flux.length, silent: true };
  }

  const lag = estimateLag(flux, fps);
  if (lag <= 0) {
    return { bpm: 0, offset: 0, beatsPerBar: 4, confidence: 0, frames: flux.length, silent: true };
  }
  const bpm = (60 * fps) / lag;
  const coarse = scanPhase(flux, fps, bpm);
  /*
   * 两级定位：
   *   1. 长窗通量上吸附到峰（把相位从网格抬到峰上，仍有 ~30 ms 提前量）
   *   2. 短窗在这一小段上重找起始沿（提前量降到几毫秒）
   * 之后才挑下拍 —— 否则下拍是在带偏差的网格上挑的。
   */
  const snapped = snapOffsetToPeak(flux, fps, coarse.offset);
  const offset = refineOnset(mono, buffer.sampleRate, snapped);
  const downbeat = pickDownbeat(flux, fps, offset, bpm);

  return {
    bpm,
    offset: normalizeOffset(offset + downbeat * (60 / bpm), bpm),
    beatsPerBar: 4,
    confidence: coarse.score,
    frames: flux.length,
    silent: false,
  };
}
