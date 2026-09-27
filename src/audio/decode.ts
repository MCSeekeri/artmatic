/**
 * decode.ts — 音频解码与波形桶。
 *
 * min/max 桶归约是一次性的（导入时），不在逐帧路径上——所以用分块
 * setTimeout 让出主线程就够，不进 Worker（硬约束 1.4 管的是每帧预算，
 * 一次性工作分块做既守纪律又省一个 Worker 的生命周期管理）。
 */

export interface WaveformData {
  /** [min0, max0, min1, max1, ...]，单声道混合后的逐桶极值。 */
  buckets: Float32Array;
  bucketSec: number;
  length: number;
  duration: number;
}

export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(data);
}

/** 归约 AudioBuffer → min/max 桶。分块异步，导入一首 3 分钟的歌也不卡 UI。 */
export async function computeWaveform(buffer: AudioBuffer, bucketSec = 0.05): Promise<WaveformData> {
  const sr = buffer.sampleRate;
  const per = Math.max(1, Math.round(bucketSec * sr));
  const n = Math.ceil(buffer.length / per);
  const buckets = new Float32Array(n * 2);
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;

  const CHUNK = 64; // 每 tick 归约 64 桶（≈3.2s 音频 @50ms 桶）
  for (let start = 0; start < n; start += CHUNK) {
    const end = Math.min(n, start + CHUNK);
    for (let b = start; b < end; b++) {
      const s0 = b * per;
      const s1 = Math.min(buffer.length, s0 + per);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = s0; i < s1; i++) {
        const v = ch1 ? (ch0[i]! + ch1[i]!) * 0.5 : ch0[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      buckets[b * 2] = lo === Infinity ? 0 : lo;
      buckets[b * 2 + 1] = hi === -Infinity ? 0 : hi;
    }
    if (end < n) await new Promise((r) => setTimeout(r, 0));
  }
  return { buckets, bucketSec: per / sr, length: n, duration: buffer.duration };
}

/** [t0, t1] 秒的极值（画波形带用）。 */
export function waveformRange(
  w: WaveformData,
  t0: number,
  t1: number,
): { min: number; max: number } {
  const b0 = Math.max(0, Math.floor(t0 / w.bucketSec));
  const b1 = Math.min(w.length - 1, Math.ceil(t1 / w.bucketSec));
  let lo = Infinity;
  let hi = -Infinity;
  for (let b = b0; b <= b1; b++) {
    lo = Math.min(lo, w.buckets[b * 2]!);
    hi = Math.max(hi, w.buckets[b * 2 + 1]!);
  }
  return { min: lo === Infinity ? 0 : lo, max: hi === -Infinity ? 0 : hi };
}
