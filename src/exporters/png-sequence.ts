/**
 * png-sequence.ts — PNG 序列导出（fflate 打 zip）。
 *
 * 每帧 await toBlob：这既是背压（硬约束 1.1 的紧循环唯一约束），
 * 也是确定性保障——preserveDrawingBuffer + 紧随 renderFrame 的
 * microtask 里读到的就是本帧。
 * zip 用 level 0：PNG 自己已压缩，zip 只负责打包。
 *
 * ## 两条落盘路（2026-10-12）
 *
 * | 路 | 何时走 | 内存 |
 * |---|---|---|
 * | 内存 | 体积估下来在 `limits.exportMemoryMB` 之内（短片段） | 所有帧的 PNG + zip 副本（峰值 3 份） |
 * | 流式 | 超预算，且宿主给了 `SaveStream`（FSA 保存对话框） | 只留当前一帧 |
 *
 * 内存那条曾是唯一的路，而它是**以崩收场**的：1080p 每帧 PNG ≈ 1–1.5 MB，
 * 300 帧就是 400 MB，峰值（帧 + zip + Blob 拷贝）还要 ×3 —— 标签页 OOM 会把
 * 没保存的编辑一起带走。流式那条走 fflate 的增量 zip（`ZipPassThrough`），
 * 边导边写，内存与时长无关。
 */

import { Zip, ZipPassThrough, zipSync } from 'fflate';
import { tr } from '../i18n/index.svelte';
import type { SaveStream } from '../platform/types';
import type { FrameSink } from './frame-sink';

export interface PngSequenceOptions {
  /** 流式落盘出口；null/缺省 = 先在内存里产完再交给调用方。 */
  stream?: SaveStream | null;
}

export class PngSequenceSink implements FrameSink {
  private files: Record<string, Uint8Array> = {};
  private readonly stream: SaveStream | null;
  /** 流式模式下的增量 zip 与写盘队列。 */
  private zip: Zip | null = null;
  private writes: Promise<void> = Promise.resolve();
  private failed: unknown = null;

  constructor(opts: PngSequenceOptions = {}) {
    this.stream = opts.stream ?? null;
  }

  async configure(_size: { w: number; h: number }, _fps: number, _codec: string): Promise<void> {
    this.files = {};
    this.zip = null;
    this.writes = Promise.resolve();
    this.failed = null;
    if (!this.stream) return;
    /*
     * 增量 zip：`Zip` 的回调是**同步**的（fflate 一产出字节就叫我们），而写盘是
     * 异步的 —— 所以这里只把块排进队列，真正的顺序由 `writes` 保证。
     * 队列在 `submit` 里每帧 await 一次（见那里），所以积压不会超过一帧的量。
     */
    this.zip = new Zip((err, chunk) => {
      if (err) {
        this.failed = err;
        return;
      }
      this.writeChunk(chunk);
    });
  }

  private writeChunk(chunk: Uint8Array): void {
    const stream = this.stream;
    if (!stream || chunk.length === 0) return;
    // 复制一份：fflate 会复用它内部的缓冲区。
    const copy = chunk.slice();
    this.writes = this.writes.then(() => stream.write(copy));
  }

  async submit(frameIndex: number, source: HTMLCanvasElement): Promise<void> {
    const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, 'image/png'));
    // 这条会经 ui/export.ts 的 catch 拼进 `err.export.failed` 进底栏 —— 是文案，不是诊断。
    if (!blob) throw new Error(tr('err.export.pngBlobNull'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const name = `frame_${String(frameIndex).padStart(5, '0')}.png`;

    if (this.zip) {
      const entry = new ZipPassThrough(name);
      this.zip.add(entry);
      entry.push(bytes, true);
      // 一帧一背压：写盘慢的时候这里就等一会儿，队列长度因此恒为常数。
      await this.writes;
      if (this.failed) throw this.failed;
      return;
    }
    this.files[name] = bytes;
  }

  async finalize(): Promise<Blob | string> {
    if (!this.stream || !this.zip) {
      const zipped = zipSync(this.files, { level: 0 });
      // zipSync 返回 Uint8Array；复制进新 ArrayBuffer 以满足 Blob 的类型要求。
      const buf = new ArrayBuffer(zipped.byteLength);
      new Uint8Array(buf).set(zipped);
      return new Blob([buf], { type: 'application/zip' });
    }
    this.zip.end();
    await this.writes;
    if (this.failed) throw this.failed;
    await this.stream.close();
    // 流式路没有 Blob 可交：返回**文件名**（`FrameSink.finalize` 的 `string` 分支）。
    return this.stream.name;
  }

  /** 取消：把没写完的目标丢掉（FSA 的 siloed 写入因此不会落盘）。 */
  async cancel(): Promise<void> {
    this.files = {};
    this.zip = null;
    await this.stream?.abort().catch(() => {});
  }
}
