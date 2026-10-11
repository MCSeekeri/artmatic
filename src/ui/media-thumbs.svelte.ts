/**
 * media-thumbs.svelte.ts — 视频素材的缩略图缓存（**惰性、串行、只试一次**）。
 *
 * 图片素材不需要它：导入时 `registerImageBytes` 已经解出一张 canvas，
 * `typography/image-assets.ts` 那份 objectURL 直接就能当 `<img src>`。
 * 视频只有 `Blob`/`File` 句柄 —— 那里**不解码**（`engine/media-assets.ts` 的硬要求：
 * 不摊开字节），所以媒体池要缩略图只能自己解一帧，而那是几百毫秒级的活。
 * 于是三条纪律：
 *
 *  · **惰性**：只在媒体池真的列出这一条时才解（`ensureVideoThumb` 由面板的
 *    `$effect` 调用）。导入时不预热 —— 十个视频就是十次解码，而用户可能根本
 *    不打开媒体池。
 *  · **串行**：一次解一个。并发解码会互相抢解码器（`VideoSampleSink` 内部只有
 *    一个），而且这只是列表缩略图，慢一点没关系。
 *  · **失败不再试**：容器/编解码不支持是粘性错误，重试只会在每次拉开抽屉时
 *    再卡一遍。失败的条目记在 `failed` 里，面板继续显示类型图标。
 *
 * 为什么是 `.svelte.ts`：面板要**在缩略图就绪时重渲那一行**，而缩略图是异步
 * 落地的。`revision` 是 `$state`，`videoThumb()` 每次读它 —— 于是任何读到这里的
 * 模板都会在就绪的那一刻自动更新，不需要维护订阅。
 */

import { videoMediaFor } from '../engine/media-assets';
import { videoThumbnail } from '../engine/video-source';
import { appState } from './app-state.svelte';

/** assetId → objectURL。 */
const thumbs = new Map<string, string>();
const pending = new Set<string>();
const failed = new Set<string>();

let revision = $state(0);

/**
 * 缩略图的 objectURL；还没就绪（或失败了）时返回 null。
 *
 * 读一次 `revision`：调用点一般在模板里，这一读就是「缩略图就绪后重渲」的依赖。
 */
export function videoThumb(assetId: string): string | null {
  void revision;
  return thumbs.get(assetId) ?? null;
}

/** 排一个解码任务并串起来（队列头失败不影响后面）。 */
let tail: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = tail.then(fn, fn);
  tail = p.catch(() => undefined);
  return p;
}

/** 幂等：解过一次（成功或失败）就什么都不做。 */
export function ensureVideoThumb(assetId: string): void {
  if (thumbs.has(assetId) || pending.has(assetId) || failed.has(assetId)) return;
  const media = videoMediaFor(assetId);
  if (!media) return;

  /*
   * 取哪一帧：往里走一点而不是第 0 帧 —— 很多素材开头是黑场或淡入，
   * 第 0 帧做缩略图等于给用户一排黑方块。时长未知就退回 0.1s。
   */
  const duration = appState.store.project.assets[assetId]?.durationSec ?? 0;
  const at = Math.min(1, Math.max(0.05, duration * 0.1));

  pending.add(assetId);
  void enqueue(() => videoThumbnail(media, at)).then((blob) => {
    pending.delete(assetId);
    if (!blob) {
      failed.add(assetId);
      return;
    }
    thumbs.set(assetId, URL.createObjectURL(blob));
    revision += 1;
  });
}

/** 工程关掉 / 素材换掉时丢掉缓存（objectURL 一并 revoke，别一直占着内存）。 */
export function forgetVideoThumb(assetId: string): void {
  const url = thumbs.get(assetId);
  if (url) URL.revokeObjectURL(url);
  thumbs.delete(assetId);
  failed.delete(assetId);
  revision += 1;
}

/** 测试用：清空（避免用例之间互相污染）。 */
export function clearVideoThumbs(): void {
  for (const url of thumbs.values()) URL.revokeObjectURL(url);
  thumbs.clear();
  pending.clear();
  failed.clear();
  revision += 1;
}
