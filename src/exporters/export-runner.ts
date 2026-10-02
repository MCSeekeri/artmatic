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
 *
 * `await renderer.prepareFrame(project, t)` 是本文件里唯一一处「新增的等待」，
 * 它来自排版层：文字位图是异步光栅化的，而导出没有「这一帧缺席」的余地。
 * 它与 `await sink.submit` 同类（渲染前准备 + 协作式背压），不是第二个时钟。
 * 见 AGENTS 的 ADR-009。
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
  renderer.enterExportMode();
  // ADR-003 规则 ③：字体没就绪就开渲，首帧会用回落字体量度，
  // 导出与预览不一致，而且「看起来都正常」，极难定位。
  await renderer.prewarmFonts(project);
  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new ExportCancelled();
      const t = timeOf(i, project.fps);
      // 本帧的文字层预热到导出分辨率。命中缓存时是一次 Map 查询，
      // 未命中才真的光栅化 —— 静态文档整个片段只会在这里付一次代价。
      await renderer.prepareFrame(project, t);
      renderer.renderFrame(project, t);
      await opts.sink.submit(i, renderer.kit.canvas);
      opts.onProgress?.((i + 1) / total);
      if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    renderer.clearExportSize();
    renderer.onSeek();
    renderer.exitExportMode();
  }
  return opts.sink.finalize();
}
