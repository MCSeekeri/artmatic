/**
 * video-audio.ts — 视频容器里那条音轨 → `AudioBuffer`（v13）。
 *
 * 为什么在 `engine/` 而不是 `audio/`：它要读的是**视频素材的载体**
 * （`Blob` / `Uint8Array` / 桌面版按范围读的 path），而那套登记与
 * `engine/video-source.ts` 共用同一个 `VideoMedia`。放进 `audio/` 会让
 * 音频子树反向依赖引擎。
 *
 * ## 只解使用区间
 *
 * 一个 40 分钟的视频整条音轨是 ~460 MB float32。工程里通常只用了其中几秒，
 * 所以按 `audio-plan` 给出的 span 求并集、用 `AudioBufferSink.buffers(from, to)`
 * 只解那一段。缓存按 assetId 记「已解出的区间」，新区间被旧区间罩住就直接复用；
 * 需要更宽时重新解一个更大的并集（替换，不叠加）。
 *
 * ## 失败必须非阻塞
 *
 * 没有音轨 / 编码解不动 / 超出 `videoAudioMB` 预算 —— 一律返回 null 并**只记一次**
 * warn。预览静音、导出无音轨都比「导出失败」可接受；而每帧重试会把控制台刷爆。
 *
 * 纯副作用模块（mediabunny + WebAudio），不参与 `core/` 的单测。
 */

import { ALL_FORMATS, AudioBufferSink, Input, type Source } from 'mediabunny';
import { audioSpans } from '../core/audio-plan';
import { getLimits } from '../core/capacity';
import type { Project } from '../core/schema';
import { videoMediaFor, type VideoMedia } from './media-assets';
import { videoSourceOf } from './video-source';

/** 解码结果向两侧多留一点，避免下一帧的「正好多用 1 帧」触发整段重解。 */
const PAD_SEC = 0.25;

interface CachedAudio {
  /** 已解出的源区间（秒）。 */
  start: number;
  end: number;
  buffer: AudioBuffer | null;
  failed: boolean;
  promise: Promise<AudioBuffer | null> | null;
  used: number;
}

const cache = new Map<string, CachedAudio>();
let clock = 0;
const warned = new Set<string>();

/** 已解码音频的总字节数（用于 `videoAudioMB` 预算）。 */
function cachedBytes(): number {
  let n = 0;
  for (const e of cache.values()) {
    if (e.buffer) n += e.buffer.length * e.buffer.numberOfChannels * 4;
  }
  return n;
}

/** 放掉一个素材的解码结果（关工程时调；与 `player.forget` 同寿）。 */
export function forgetVideoAudio(assetId: string): void {
  cache.delete(assetId);
  warned.delete(assetId);
}

function warnOnce(key: string, detail: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[video-audio] ${key}: ${detail}`);
}

/**
 * 把 `[start, end)` 的音轨解成一个 `AudioBuffer`。
 *
 * 时间戳是**源内时间**（秒），与 `AudioClip.srcIn` 同一口径。
 */
async function decodeRange(
  media: VideoMedia,
  start: number,
  end: number,
): Promise<AudioBuffer | null> {
  let input: Input<Source> | null = null;
  try {
    input = new Input({ formats: ALL_FORMATS, source: videoSourceOf(media) });
    if (!(await input.canRead())) return null;
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;

    const sink = new AudioBufferSink(track);
    const chunks: { buffer: AudioBuffer; timestamp: number }[] = [];
    for await (const wrapped of sink.buffers(Math.max(0, start), Math.max(0, end))) {
      chunks.push({ buffer: wrapped.buffer, timestamp: wrapped.timestamp });
      // 迭代器消费完，input 才能安全 dispose；下面的 finally 会兜住异常路径。
    }
    if (!chunks.length) return null;

    const rate = chunks[0]!.buffer.sampleRate;
    const channels = Math.max(1, chunks[0]!.buffer.numberOfChannels);
    const total = Math.max(1, Math.ceil((end - start) * rate));
    const ctx = new OfflineAudioContext(1, 1, Math.max(8000, rate));
    const out = ctx.createBuffer(channels, total, rate);
    for (let c = 0; c < channels; c++) {
      const dst = out.getChannelData(c);
      for (const chunk of chunks) {
        const src = chunk.buffer.getChannelData(Math.min(c, chunk.buffer.numberOfChannels - 1));
        const offset = Math.round((chunk.timestamp - start) * rate);
        for (let i = 0; i < src.length; i++) {
          const j = offset + i;
          if (j >= 0 && j < total) dst[j] = src[i]!;
        }
      }
    }
    return out;
  } catch (e) {
    warnOnce('decode', e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    input?.dispose();
  }
}

/**
 * 保证 `assetId` 的 `[start, end)` 区间已解码。
 *
 * 并发的同一素材请求共用一个 promise —— `AudioBufferSink` 内部只有一个解码器，
 * 两路并进会互相踩（与 `video-source.ts` 的 `chain` 同一个理由）。
 */
export async function ensureVideoAudio(
  assetId: string,
  media: VideoMedia,
  start: number,
  end: number,
): Promise<AudioBuffer | null> {
  const lo = Math.max(0, start - PAD_SEC);
  const hi = Math.max(lo + 0.05, end + PAD_SEC);

  let entry = cache.get(assetId);
  if (entry && !entry.failed && entry.buffer && entry.start <= lo + 1e-6 && entry.end >= hi - 1e-6) {
    entry.used = ++clock;
    return entry.buffer;
  }
  if (entry?.promise) return entry.promise;

  const mergedStart = entry && !entry.failed ? Math.min(entry.start, lo) : lo;
  const mergedEnd = entry && !entry.failed ? Math.max(entry.end, hi) : hi;

  const budget = getLimits().videoAudioMB * 1024 * 1024;
  // 粗估：48 kHz 立体声 float32 ≈ 384 KB/s；预算不够就不解（降级为静音）。
  if (cachedBytes() + (mergedEnd - mergedStart) * 384_000 > budget) {
    warnOnce(assetId, 'video audio over budget (raise videoAudioMB); this asset stays silent');
    if (!entry) {
      entry = { start: mergedStart, end: mergedEnd, buffer: null, failed: true, promise: null, used: ++clock };
      cache.set(assetId, entry);
    } else {
      entry.failed = true;
    }
    return null;
  }

  if (!entry) {
    entry = { start: mergedStart, end: mergedEnd, buffer: null, failed: false, promise: null, used: ++clock };
    cache.set(assetId, entry);
  }
  entry.start = mergedStart;
  entry.end = mergedEnd;
  entry.used = ++clock;
  const target = entry;

  target.promise = decodeRange(media, mergedStart, mergedEnd).then((buffer) => {
    target.promise = null;
    if (!buffer) {
      target.failed = true;
      target.buffer = null;
      return null;
    }
    target.buffer = buffer;
    return buffer;
  });
  return target.promise;
}

/** 一个素材需要解码的源区间（并集）。没有 span 返回 null。 */
export function sourceRangeFor(project: Project, assetId: string): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const span of audioSpans(project)) {
    if (span.assetId !== assetId) continue;
    /*
     * 区间来自 `audio-plan` 的 `srcRange`（`core/speed.ts::sourceRangeOf` 算的
     * 积分极值）。变速时它可能**比首尾两点更宽**：负速会让媒体时间往回走，
     * 只算 `srcIn + dur × speed` 会漏掉折返那一段，表现为倒放段没声音。
     */
    const t0 = Math.max(0, span.srcRange?.from ?? span.srcIn);
    const t1 = span.srcRange?.to ?? t0 + Math.max(0, span.end - span.start) * (span.speed || 1);
    start = Math.min(start, t0);
    end = Math.max(end, t1);
  }
  return start === Infinity ? null : { start, end };
}

/**
 * 预热工程里所有视频素材的音轨，把结果交给 `register`（通常是
 * `AudioPlayer.register`）。
 *
 * 播放前与导出前各调一次：缓存命中时几乎没有开销；失败不抛，只记一次 warn。
 */
export async function prepareProjectVideoAudio(
  project: Project,
  register: (assetId: string, buffer: AudioBuffer) => void,
): Promise<void> {
  const ids = new Set<string>();
  for (const span of audioSpans(project)) ids.add(span.assetId);

  const jobs: Promise<void>[] = [];
  for (const assetId of ids) {
    const asset = project.assets[assetId];
    // 独立音频素材走 `decodeAudio` 那条，不在这里重复解；
    // 只有视频素材需要从容器里抽音轨。
    if (!asset || asset.kind !== 'video' || asset.hasAudio === false) continue;
    const media = videoMediaFor(assetId);
    if (!media) continue;
    const range = sourceRangeFor(project, assetId);
    if (!range) continue;
    jobs.push(
      ensureVideoAudio(assetId, media, range.start, range.end).then((buffer) => {
        if (buffer) register(assetId, buffer);
      }),
    );
  }
  await Promise.all(jobs);
}
