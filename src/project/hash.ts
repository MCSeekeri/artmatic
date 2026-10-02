/**
 * hash.ts — 素材内容哈希（sha256）。
 *
 * 用途只有一个：判断「磁盘上那份素材还是不是工程引用的那份」。
 * 素材用引用而非拷贝，就必须有个东西能在重开工程时回答
 * 「这个文件被换过没有」。文件大小不行（换个同尺寸的图完全不报错），
 * 修改时间更不行（复制/同步都会改）。
 *
 * **走 `crypto.subtle`，不自己实现 sha256。** 手搓密码学比没有更糟 ——
 * 你会以为它安全。代价是它只在安全上下文存在，见下。
 */

/**
 * 超过这个大小就不算哈希（记 null）。
 *
 * `crypto.subtle.digest` 无法流式，必须整个 buffer 一次吃进去；而它内部
 * 还要再拷一份进 WASM 堆。GB 级视频素材叠上浏览器已经持有的 ArrayBuffer，
 * 峰值轻松破 5 GB。素材哈希是**可选的增强**，不是工程可打开的前提，
 * 所以宁可降级成「大小 + 修改时间」的弱指纹，也不要为了它把进程搞爆。
 */
export const MAX_HASH_BYTES = 256 * 1024 * 1024;

const HEX = '0123456789abcdef';

function toHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < b.length; i++) {
    const v = b[i]!;
    out += HEX[v >> 4]! + HEX[v & 15]!;
  }
  return out;
}

/** 当前环境能不能算哈希。false 时上层应显示「弱指纹」而不是报错。 */
export function hashSupported(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}

/**
 * 计算 sha256，返回小写十六进制（64 字符）。
 *
 * ⚠️ **需要安全上下文。** `crypto.subtle` 在 `http://` 非 localhost 的页面里
 * 是 `undefined` —— 那是 Chromium 的规矩，不是 bug。本项目只会跑在三种上下文：
 * `http://localhost:5173`（dev）、`http://localhost` 起的 preview（E2E）、
 * Electron（`file://` 与自定义协议都算 trustworthy origin）。三者都是安全上下文，
 * 所以这里不做纯 JS 回退：回退一个非密码学哈希会悄悄改变「文件被改过」的判据，
 * 那比直接报错危险。
 *
 * 调用方要容错就先用 `hashSupported()` 判，别 catch 这个错误。
 */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) throw new Error('crypto.subtle 不可用（需要安全上下文）');
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // TS 5.7 起 TypedArray / ArrayBufferView 带上了 ArrayBufferLike 泛型参数，
  // 而 `BufferSource` 只收 ArrayBuffer 那一支（SharedArrayBuffer 被排除在外）。
  // 运行时不存在这个问题：传进去的就是一个普通 Uint8Array。
  const view = bytes as unknown as ArrayBufferView<ArrayBuffer>;
  return toHex(await subtle.digest('SHA-256', view));
}

/**
 * 能算就算，不能算就返回 null（超阈值或不支持）。
 * 台账里 `hash === null` 是合法的，表示「只有弱指纹」。
 */
export async function hashIfReasonable(data: ArrayBuffer | Uint8Array): Promise<string | null> {
  const size = data instanceof Uint8Array ? data.byteLength : data.byteLength;
  if (size > MAX_HASH_BYTES) return null;
  if (!hashSupported()) return null;
  return sha256Hex(data);
}

/** 人看的短哈希（前 8 位）。用于 UI 与日志，不要拿它做比较。 */
export function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 8) : '—';
}
