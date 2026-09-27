/**
 * export-runner.ts — 逐帧导出驱动。
 *
 * 硬约束 1.1：禁止 requestAnimationFrame 驱动导出。导出是
 * `for (let i = 0; i < totalFrames; i++)`，只受编码器背压约束
 * （每帧 await sink.submit）。每 10 帧 setTimeout(0) 让 UI 喘口气
 * （进度条重绘、取消按钮可点）——这不是时钟，只是协作式让渡。
 *
 * 渲染与预览同一条求值路径：renderFrame(project, t)，差别只在
 * renderer 的分辨率状态。
 */

import { timeOf } from '../engine/clock';
import type { Renderer } from '../engine/renderer';
import type { Project } from '../core/schema';
import type { FrameSink } from './frame-sink';

export class ExportCancelled extends Error {
  constructor() {
    super('导出已取消');
    this.name = 'ExportCancelled';
  }
}

export interface ExportOptions {
  sink: FrameSink;
  codec?: string;
  onProgress?: (frac: number) => void;
  signal?: AbortSignal;
}

export async function runExport(
  renderer: Renderer,
  project: Project,
  opts: ExportOptions,
): Promise<Blob | string> {
  const { w, h } = project.resolution;
  const total = Math.max(1, Math.ceil(project.duration * project.fps));
  await opts.sink.configure({ w, h }, project.fps, opts.codec ?? 'png');

  renderer.setExportSize(w, h);
  // 反馈历史（echo 类）从干净的起点顺序渲染，导出因此天然确定。
  renderer.onSeek();
  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new ExportCancelled();
      renderer.renderFrame(project, timeOf(i, project.fps));
      await opts.sink.submit(i, renderer.kit.canvas);
      opts.onProgress?.((i + 1) / total);
      if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    renderer.clearExportSize();
    renderer.onSeek();
  }
  return opts.sink.finalize();
}
