/**
 * png-sequence.ts — PNG 序列导出（fflate 打 zip）。
 *
 * 每帧 await toBlob：这既是背压（硬约束 1.1 的紧循环唯一约束），
 * 也是确定性保障——preserveDrawingBuffer + 紧随 renderFrame 的
 * microtask 里读到的就是本帧。
 * zip 用 level 0：PNG 自己已压缩，zip 只负责打包。
 */

import { zipSync } from 'fflate';
import { tr } from '../i18n/index.svelte';
import type { FrameSink } from './frame-sink';

export class PngSequenceSink implements FrameSink {
  private files: Record<string, Uint8Array> = {};

  async configure(_size: { w: number; h: number }, _fps: number, _codec: string): Promise<void> {
    this.files = {};
  }

  async submit(frameIndex: number, source: HTMLCanvasElement): Promise<void> {
    const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, 'image/png'));
    // 这条会经 ui/export.ts 的 catch 拼进 `err.export.failed` 进底栏 —— 是文案，不是诊断。
    if (!blob) throw new Error(tr('err.export.pngBlobNull'));
    this.files[`frame_${String(frameIndex).padStart(5, '0')}.png`] = new Uint8Array(
      await blob.arrayBuffer(),
    );
  }

  async finalize(): Promise<Blob> {
    const zipped = zipSync(this.files, { level: 0 });
    // zipSync 返回 Uint8Array；复制进新 ArrayBuffer 以满足 Blob 的类型要求。
    const buf = new ArrayBuffer(zipped.byteLength);
    new Uint8Array(buf).set(zipped);
    return new Blob([buf], { type: 'application/zip' });
  }
}
