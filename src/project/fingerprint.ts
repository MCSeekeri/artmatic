/**
 * fingerprint.ts — 素材内容身份（W1 素材生命周期的地基）。
 *
 * ## 为什么不是全量 sha256
 *
 * `crypto.subtle.digest` 不能流式（见 `hash.ts`）。给 2 GB 视频算全量哈希的
 * 唯一办法是先整份读进堆 —— 那正是 W1.1 消灭掉的动作。但「这条素材还是不是
 * 原来那份」又必须有个判据（去重、linked/bundled 冲突、打包校验都要它）。
 *
 * 折中：**大小 + 首尾各 64 KiB**。读 128 KiB，能抓住
 * 「换了文件 / 重新编码 / 截断」的绝大多数情况，漏掉的只有「只改了中段且
 * 首尾与大小完全不变」这一种（现实中几乎只出现在刻意构造的文件上）。
 *
 * ## 格式
 *
 * ```
 * fp1:<size>:<sha256(size \n head \n tail) 前 32 位十六进制>
 * ```
 *
 * 前缀 `fp1:` 是版本位：将来换算法时旧值可以被识别成「弱指纹」而不是
 * 被当成同一种东西比较。`fp0:<size>` 只在 `crypto.subtle` 不可用时出现
 * （非安全上下文）—— 它**不允许**被用于去重，只用于展示。
 *
 * ## 缓存
 *
 * 键是来源对象（`Blob` / `Uint8Array` / 句柄包装）。`Blob` 不可变，
 * 句柄包装在同一会话里稳定，所以缓存不需要失效逻辑 —— 与 `asset-store.ts`
 * 的哈希缓存同一条纪律：**没有显式 invalidate，就不会有人忘记调它**。
 */

import { hashSupported, sha256Hex } from './hash';
import type { FsFileHandle } from './fs';

/** 首尾各取多少字节。64 KiB = 磁盘一个簇的常见上限，也是顺读的一次量级。 */
export const FP_CHUNK = 64 * 1024;

export interface AssetContent {
  size: number;
  /** 见文件头。空串不在正常路径上出现。 */
  fp: string;
}

const cache = new WeakMap<object, AssetContent>();

function weakContent(size: number): AssetContent {
  return { size, fp: `fp0:${size}` };
}

/** 只有 `fp1:` 能用于「是不是同一份内容」的判定。 */
export function isStrongFp(fp: string | null | undefined): boolean {
  return !!fp && fp.startsWith('fp1:');
}

function concat(size: number, head: Uint8Array, tail: Uint8Array): Uint8Array {
  const sizeText = new TextEncoder().encode(`${size}\n`);
  const out = new Uint8Array(sizeText.byteLength + head.byteLength + tail.byteLength);
  out.set(sizeText, 0);
  out.set(head, sizeText.byteLength);
  out.set(tail, sizeText.byteLength + head.byteLength);
  return out;
}

async function fpOf(size: number, head: Uint8Array, tail: Uint8Array): Promise<string> {
  if (!hashSupported()) return `fp0:${size}`;
  const h = await sha256Hex(concat(size, head, tail));
  return `fp1:${size}:${h.slice(0, 32)}`;
}

/**
 * 从一块内存字节算指纹。
 *
 * 小文件（≤ 64 KiB）只取一次；64–128 KiB 时首尾会重叠 —— 重叠不影响判据，
 * 但**必须与 `contentOfBlob` 的切法逐字节一致**，否则同一份内容会得到两个
 * 指纹（linked 与 bundled 会被判成冲突）。
 */
export async function contentOfBytes(bytes: Uint8Array): Promise<AssetContent> {
  const hit = cache.get(bytes);
  if (hit) return hit;

  const size = bytes.byteLength;
  const headLen = Math.min(FP_CHUNK, size);
  const tailLen = size > FP_CHUNK ? Math.min(FP_CHUNK, size) : 0;
  const head = bytes.subarray(0, headLen);
  const tail = tailLen ? bytes.subarray(size - tailLen) : new Uint8Array(0);
  const content = { size, fp: await fpOf(size, head, tail) };
  cache.set(bytes, content);
  return content;
}

/** 从 `Blob` / `File` 算指纹。只读首尾两块，不整份读。 */
export async function contentOfBlob(blob: Blob): Promise<AssetContent> {
  const hit = cache.get(blob);
  if (hit) return hit;

  const size = blob.size;
  if (!hashSupported()) {
    const weak = weakContent(size);
    cache.set(blob, weak);
    return weak;
  }
  const headLen = Math.min(FP_CHUNK, size);
  const tailLen = size > FP_CHUNK ? Math.min(FP_CHUNK, size) : 0;
  const head = new Uint8Array(await blob.slice(0, headLen).arrayBuffer());
  const tail = tailLen
    ? new Uint8Array(await blob.slice(size - tailLen, size).arrayBuffer())
    : new Uint8Array(0);
  const content = { size, fp: await fpOf(size, head, tail) };
  cache.set(blob, content);
  return content;
}

/**
 * 从**绝对路径**算指纹（桌面版 linked）。
 *
 * 只读首尾两块，与 `contentOfBlob` 的切法逐字节一致；不缓存 —— 外部文件
 * 可以在两次调用之间被改掉，缓存会让「源已变化」永远检测不到。
 */
export async function contentOfPath(
  size: number,
  read: (start: number, end: number) => Promise<Uint8Array>,
): Promise<AssetContent> {
  if (!hashSupported()) return weakContent(size);
  const headLen = Math.min(FP_CHUNK, size);
  const tailLen = size > FP_CHUNK ? Math.min(FP_CHUNK, size) : 0;
  const head = headLen ? await read(0, headLen) : new Uint8Array(0);
  const tail = tailLen ? await read(size - tailLen, size) : new Uint8Array(0);
  return { size, fp: await fpOf(size, head, tail) };
}

/** 从工程目录里的文件句柄算指纹（打开工程时给视频补身份用）。 */
export async function contentOfHandle(handle: FsFileHandle): Promise<AssetContent> {
  const hit = cache.get(handle);
  if (hit) return hit;
  const file = await handle.get();
  // 原生实现 `readBlob()` 直接给 `File`（零拷贝）；memory 根给 Blob。
  // 两者都没有时才读全（只可能是旧的/极小的实现）。
  const blob = file.readBlob
    ? await file.readBlob()
    : new Blob([(await file.readBytes()) as unknown as BlobPart]);
  const content = await contentOfBlob(blob);
  cache.set(handle, content);
  return content;
}

/** 只给测试与诊断用：绕开缓存重算。 */
export async function contentOfBlobUncached(blob: Blob): Promise<AssetContent> {
  const size = blob.size;
  if (!hashSupported()) return weakContent(size);
  const headLen = Math.min(FP_CHUNK, size);
  const tailLen = size > FP_CHUNK ? Math.min(FP_CHUNK, size) : 0;
  const head = new Uint8Array(await blob.slice(0, headLen).arrayBuffer());
  const tail = tailLen
    ? new Uint8Array(await blob.slice(size - tailLen, size).arrayBuffer())
    : new Uint8Array(0);
  return { size, fp: await fpOf(size, head, tail) };
}
