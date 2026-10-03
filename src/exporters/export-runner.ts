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
  /**
   * 每帧耗时（毫秒，含 `prepareFrame` 的异步预热）。
   *
   * 存在的理由：视频素材的解码成本**只能**从这里量到。预览缺帧时会拿最近的
   * 帧顶上（很快），所以「连着渲 N 帧再计时」量的是渲染成本而不是解码成本 ——
   * 实测会得到 3 万 fps 这种荒谬数字。导出循环每帧都 `await prepareFrame`，
   * 那才是真实成本。性能探针与 E2E 用它，产品路径不读。
   */
  onFrame?: (ms: number, index: number) => void;
  signal?: AbortSignal;
}

export async function runExport(
  renderer: Renderer,
  project: Project,
  opts: ExportOptions,
): Promise<Blob | string> {
  const { w, h } = project.resolution;
  const total = Math.max(1, Math.ceil(project.duration * project.fps));

  // 尺寸必须先切到导出分辨率，才能把正确尺寸的 canvas 交给 sink：
  // mediabunny 的 CanvasSource 在构造时读尺寸并缓存 VideoFrame 工厂，
  // 顺序反了会产出一个错尺寸的文件且控制台无提示（见 mp4-sink.ts）。
  renderer.setExportSize(w, h);
  renderer.onSeek();
  renderer.enterExportMode();
  try {
    await opts.sink.configure({ w, h }, project.fps, opts.codec ?? 'png', {
      canvas: renderer.kit.canvas,
    });
    // ADR-003 规则 ③：字体没就绪就开渲，首帧会用回落字体量度，
    // 导出与预览不一致，而且「看起来都正常」，极难定位。
    await renderer.prewarmFonts(project);
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new ExportCancelled();
      const t = timeOf(i, project.fps);
      // 本帧的文字层预热到导出分辨率。命中缓存时是一次 Map 查询，
      // 未命中才真的光栅化 —— 静态文档整个片段只会在这里付一次代价。
      const frameStart = opts.onFrame ? performance.now() : 0;
      await renderer.prepareFrame(project, t);
      renderer.renderFrame(project, t);
      await opts.sink.submit(i, renderer.kit.canvas);
      if (opts.onFrame) opts.onFrame(performance.now() - frameStart, i);
      opts.onProgress?.((i + 1) / total);
      if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
    }
  } catch (e) {
    // 取消或抛错都要把编码器放掉，否则硬件会话不会归还（见 Mp4Sink.cancel）。
    await opts.sink.cancel?.();
    throw e;
  } finally {
    renderer.clearExportSize();
    renderer.onSeek();
    renderer.exitExportMode();
  }
  return opts.sink.finalize();
}
