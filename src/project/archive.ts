/**
 * archive.ts — 工程包（`.artmatic`）的 ZIP64 读写（store-only）。
 *
 * ## 为什么自研
 *
 * 包里装的是视频 / 图片，本来就压不动；store-only 让写入变成「流式拷贝 +
 * 算 CRC」，内存峰值与包大小无关。`fflate` 的同步 API 要整份进堆，2 GB 的
 * 工程包会直接把标签页打死 —— 这正是 W1 一路在消灭的那类动作。
 *
 * ZIP64 是硬需求：一个 4 GB 的视频素材就超过 ZIP32 的偏移上限。这里的
 * 写/读都按 ZIP64 处理（小文件仍然产出普通 ZIP，读两种都认）。
 *
 * ## 写入用 data descriptor
 *
 * 本地头先写「大小未知」（bit 3），边写边算 CRC，写完再补 descriptor。
 * 这样**不需要先把素材读一遍**（那等于把 2 GB 的读取翻倍），也不需要
 * 临时文件。中央目录里记的是真实大小，解包方以中央目录为准。
 *
 * ## 安全
 *
 * 解包**只接受相对 POSIX 路径**：拒绝绝对路径、盘符、反斜杠、`..`、空段、
 * 重复条目。包可能来自别人，路径处理不能靠调用方自觉。
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_DESCRIPTOR = 0x08074b50;

export const ZIP_STORE = 0;
export const ARCHIVE_EXT = '.artmatic';

/**
 * 超过它就启用 ZIP64。生产是 0xFFFFFFFF；测试传 1 就能在几 KB 的包上
 * 走一遍 ZIP64 分支（5 GB 的夹具不现实）。
 */
export const ZIP64_LIMIT = 0xffffffff;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(chunks: Iterable<Uint8Array>, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function u16(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
}
function u32(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}
function u64(v: number): Uint8Array {
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 0; i < 8; i++) {
    out[i] = x & 0xff;
    x = Math.floor(x / 256);
  }
  return out;
}
function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function readU16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function readU32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}
function readU64(b: Uint8Array, o: number): number {
  let v = 0;
  for (let i = 7; i >= 0; i--) v = v * 256 + b[o + i]!;
  return v;
}

/* ------------------------------------------------------------ 路径安全 */

/**
 * 校验并规范化包内路径。非法返回 null（调用方必须拒绝整包，而不是跳过）。
 */
export function safeArchivePath(name: string): string | null {
  if (!name || name.length > 512) return null;
  if (name.includes('\\') || name.includes('\0')) return null;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null;
  const segs = name.split('/');
  if (segs.some((s) => !s || s === '.' || s === '..')) return null;
  return segs.join('/');
}

/* ------------------------------------------------------------ 写入 */

export interface ZipEntryInput {
  /** 包内路径（POSIX）。 */
  name: string;
  /** 未压缩大小（用来决定是否 ZIP64）。 */
  size: number;
  /** 分块读。实现方保证总字节数 === size（写的时候会核对）。 */
  open: () => AsyncIterable<Uint8Array>;
}

interface WrittenEntry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  zip64: boolean;
}

export type ZipChunkSink = (chunk: Uint8Array) => Promise<void> | void;

/**
 * 流式 ZIP 写入。`sink` 可以是 FSA 的 WritableStream、Node 的 fs 流，或测试里的数组。
 */
export class ZipWriter {
  private offset = 0;
  private entries: WrittenEntry[] = [];

  constructor(
    private sink: ZipChunkSink,
    private limit = ZIP64_LIMIT,
  ) {}

  private async put(chunk: Uint8Array): Promise<void> {
    if (chunk.length) await this.sink(chunk);
    this.offset += chunk.length;
  }

  async add(input: ZipEntryInput): Promise<void> {
    const name = enc.encode(input.name);
    const zip64 = input.size >= this.limit;
    const offset = this.offset;
    const extra = zip64 ? concat([u16(0x0001), u16(16), u64(0), u64(0)]) : new Uint8Array(0);
    const header = concat([
      u32(SIG_LOCAL),
      u16(zip64 ? 45 : 20),
      u16(0x0808), // bit 3（data descriptor）+ UTF-8
      u16(ZIP_STORE),
      u16(0),
      u16(0),
      u32(0), // crc 未知
      u32(zip64 ? 0xffffffff : 0),
      u32(zip64 ? 0xffffffff : 0),
      u16(name.length),
      u16(extra.length),
      name,
      extra,
    ]);
    await this.put(header);

    let crc = 0xffffffff;
    let written = 0;
    for await (const chunk of input.open()) {
      for (let i = 0; i < chunk.length; i++) crc = CRC_TABLE[(crc ^ chunk[i]!) & 0xff]! ^ (crc >>> 8);
      written += chunk.length;
      await this.put(chunk);
    }
    const finalCrc = (crc ^ 0xffffffff) >>> 0;
    if (written !== input.size) {
      throw new Error(`package entry ${input.name}: expected ${input.size} bytes, got ${written}`);
    }

    const desc = zip64
      ? concat([u32(SIG_DESCRIPTOR), u32(finalCrc), u64(written), u64(written)])
      : concat([u32(SIG_DESCRIPTOR), u32(finalCrc), u32(written), u32(written)]);
    await this.put(desc);

    this.entries.push({ name, crc: finalCrc, size: written, offset, zip64 });
  }

  async close(): Promise<void> {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const extra = e.zip64
        ? concat([u16(0x0001), u16(24), u64(e.size), u64(e.size), u64(e.offset)])
        : new Uint8Array(0);
      await this.put(
        concat([
          u32(SIG_CENTRAL),
          u16(45),
          u16(e.zip64 ? 45 : 20),
          u16(0x0808),
          u16(ZIP_STORE),
          u16(0),
          u16(0),
          u32(e.crc),
          u32(e.zip64 ? 0xffffffff : e.size),
          u32(e.zip64 ? 0xffffffff : e.size),
          u16(e.name.length),
          u16(extra.length),
          u16(0),
          u16(0),
          u16(0),
          u32(0),
          u32(e.zip64 ? 0xffffffff : e.offset),
          e.name,
          extra,
        ]),
      );
    }
    const cdSize = this.offset - cdStart;
    const need64 =
      this.entries.some((e) => e.zip64) ||
      this.entries.length >= 0xffff ||
      cdStart >= this.limit ||
      cdSize >= this.limit;

    if (need64) {
      const eocd64Offset = this.offset;
      await this.put(
        concat([
          u32(SIG_EOCD64),
          u64(44),
          u16(45),
          u16(45),
          u32(0),
          u32(0),
          u64(this.entries.length),
          u64(this.entries.length),
          u64(cdSize),
          u64(cdStart),
        ]),
      );
      await this.put(
        concat([
          u32(SIG_EOCD64_LOC),
          u32(0),
          u64(eocd64Offset),
          u32(1),
        ]),
      );
    }

    await this.put(
      concat([
        u32(SIG_EOCD),
        u16(0),
        u16(0),
        u16(Math.min(this.entries.length, 0xffff)),
        u16(Math.min(this.entries.length, 0xffff)),
        u32(Math.min(cdSize, 0xffffffff)),
        u32(need64 ? 0xffffffff : cdStart),
        u16(0),
      ]),
    );
  }
}

/* ------------------------------------------------------------ 读取 */

export interface ZipEntry {
  name: string;
  size: number;
  compressedSize: number;
  offset: number;
  method: number;
  /** 写完/读回时用来核对解包完整性。 */
  crc: number;
}

async function readSlice(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** 列出包内条目（读 EOCD / ZIP64 EOCD + 中央目录；不读数据）。 */
export async function listZip(blob: Blob): Promise<ZipEntry[]> {
  const tailLen = Math.min(blob.size, 66_000);
  const tail = await readSlice(blob, blob.size - tailLen, blob.size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (readU32(tail, i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip: EOCD not found');

  let count = readU16(tail, eocd + 10);
  let cdSize = readU32(tail, eocd + 12);
  let cdOffset = readU32(tail, eocd + 16);

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // ZIP64 locator 紧挨在 EOCD 前 20 字节。
    const locAt = eocd - 20;
    if (locAt >= 0 && readU32(tail, locAt) === SIG_EOCD64_LOC) {
      const z64Offset = readU64(tail, locAt + 8);
      const z64 = await readSlice(blob, z64Offset, z64Offset + 56);
      if (readU32(z64, 0) !== SIG_EOCD64) throw new Error('bad ZIP64 EOCD');
      count = readU64(z64, 32);
      cdSize = readU64(z64, 40);
      cdOffset = readU64(z64, 48);
    }
  }

  const cd = await readSlice(blob, cdOffset, cdOffset + cdSize);
  const out: ZipEntry[] = [];
  let o = 0;
  for (let n = 0; n < count; n++) {
    if (readU32(cd, o) !== SIG_CENTRAL) throw new Error('bad central directory');
    const flags = readU16(cd, o + 8);
    const method = readU16(cd, o + 10);
    const crc = readU32(cd, o + 16);
    let size = readU32(cd, o + 24);
    let csize = readU32(cd, o + 20);
    const nameLen = readU16(cd, o + 28);
    const extraLen = readU16(cd, o + 30);
    const commentLen = readU16(cd, o + 32);
    let offset = readU32(cd, o + 42);
    const name = dec.decode(cd.subarray(o + 46, o + 46 + nameLen));

    let eo = o + 46 + nameLen;
    const endExtra = eo + extraLen;
    while (eo + 4 <= endExtra) {
      const id = readU16(cd, eo);
      const len = readU16(cd, eo + 2);
      if (id === 0x0001) {
        let p = eo + 4;
        if (size === 0xffffffff && p + 8 <= eo + 4 + len) {
          size = readU64(cd, p);
          p += 8;
        }
        if (csize === 0xffffffff && p + 8 <= eo + 4 + len) {
          csize = readU64(cd, p);
          p += 8;
        }
        if (offset === 0xffffffff && p + 8 <= eo + 4 + len) offset = readU64(cd, p);
      }
      eo += 4 + len;
    }

    if (flags & 0x1) throw new Error('encrypted zip entries are not supported');
    out.push({ name, size, compressedSize: csize, offset, method, crc });
    o = endExtra + commentLen;
  }

  const seen = new Set<string>();
  for (const e of out) {
    const safe = safeArchivePath(e.name);
    if (!safe) throw new Error(`unsafe archive path: ${e.name}`);
    if (seen.has(safe)) throw new Error(`duplicate archive entry: ${safe}`);
    seen.add(safe);
  }
  return out;
}

/** 读一个条目的数据（store-only）。返回分块流。 */
export async function* readZipEntry(blob: Blob, entry: ZipEntry): AsyncGenerator<Uint8Array> {
  if (entry.method !== ZIP_STORE) {
    throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);
  }
  const local = await readSlice(blob, entry.offset, entry.offset + 30);
  if (readU32(local, 0) !== SIG_LOCAL) throw new Error(`bad local header for ${entry.name}`);
  const nameLen = readU16(local, 26);
  const extraLen = readU16(local, 28);
  const start = entry.offset + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > blob.size) throw new Error(`truncated archive entry: ${entry.name}`);
  const reader = blob.slice(start, end).stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value?.byteLength) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** 一个 Blob 的字节流（`File.stream()`；Node 的 Blob 也有）。 */
export async function* blobChunks(blob: Blob): AsyncGenerator<Uint8Array> {
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value?.byteLength) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
