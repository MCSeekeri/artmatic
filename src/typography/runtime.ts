/**
 * runtime.ts — 排版层的运行时：文档 → 位图 → GL 纹理 → 合成链。
 *
 * 与已有 BakeClient 完全同构的桥接（同步 resolver ↔ 异步光栅化）：
 *   缓存命中 → 同步返回纹理
 *   未命中   → 返回 null（这一层这帧缺席）+ 异步光栅化 → onReady() →
 *              store.touch() → 下一帧 rAF 重绘
 *
 * 唯一超出 BakeClient 的地方是导出：导出的紧循环没有「缺席一帧」的余地，
 * 所以 renderer.prepareFrame / prewarmFonts 暴露了可 await 的预热入口。
 *
 * 缓存键 = (docHash, 输出尺寸, 本地帧号)。静态文档的帧号是 null ——
 * 一张标题卡整个片段生命期只光栅化一次。
 */

import { drawSizeFor } from '../engine/placement.frag';
import type { SourceTexture } from '../engine/compositor';
import type { Kit } from '../engine/kit';
import type { TextResolver } from '../engine/sources';
import type { Project, SourceClip } from '../core/schema';
import { frameKeyFor, rasterKeyForDoc } from './cache-key';
import type { TypographyDocument } from './document';
import type { FontProvider } from './font-provider';
import type { TextBackendRegistry } from './rasterizer';

/** 4K 文本层 + 放大动画的保护上限。 */
export const MAX_RASTER_EDGE = 4096;
/** 预览常驻位图的内存上限（按 w*h*4 计费）。 */
export const MAX_RASTER_BYTES = 48 * 1024 * 1024;
export const MAX_RASTER_ENTRIES = 32;
/** 导出期只保留当前帧 ±1：导出是顺序的，留着历史纯属浪费显存。 */
export const EXPORT_ENTRIES = 2;

export type { TextResolver };

interface CacheEntry {
  tex: WebGLTexture;
  w: number;
  h: number;
  bytes: number;
  used: number;
}

export interface TypographyRuntimeOptions {
  /** 新的位图就绪时调用 —— 与 BakeClient 一样接到 store.touch()。 */
  onReady: () => void;
  /** 取当前工程 fps。用回调而不是字段，避免「忘了同步」这一类 bug。 */
  fps: () => number;
}

export class TypographyRuntime {
  /** 0.25 / 0.5 / 1 = 低画质预览档。默认 1（跟随渲染尺寸）。 */
  previewScale = 1;

  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Set<string>();
  private clock = 0;
  private exportMode = false;

  constructor(
    private readonly kit: Kit,
    private readonly backends: TextBackendRegistry,
    private readonly fonts: FontProvider,
    private readonly opts: TypographyRuntimeOptions,
  ) {}

  /* ------------------------------------------------------------ 同步解析 */

  readonly resolve: TextResolver = (clip, t, renderW, renderH) => {
    if (clip.source.type !== 'text') return null;
    const doc = clip.source.doc;
    const localSec = t - clip.start;
    const size = this.rasterSizeFor(clip, doc.size.w, doc.size.h, renderW, renderH);
    const key = this.keyFor(doc, localSec, size.w, size.h);

    const hit = this.entries.get(key);
    if (hit) {
      hit.used = ++this.clock;
      return { tex: hit.tex, w: hit.w, h: hit.h };
    }

    this.schedule(key, doc, size.w, size.h, localSec);
    return null; // 这一层这帧缺席；准备好后 onReady 会触发下一帧重绘
  };

  private keyFor(doc: TypographyDocument, localSec: number, w: number, h: number): string {
    const localFrame = Math.round(localSec * this.opts.fps());
    return rasterKeyForDoc(doc, w, h, frameKeyFor(doc, localFrame));
  }

  /**
   * 光栅化的目标像素尺寸。
   *
   * 关键点：**不需要任何 `if (isExport)` 分支**。`renderW/renderH` 就是
   * kit.w/kit.h —— 预览时它已经是适配后的小尺寸，导出时它就是输出分辨率
   * （renderer.setExportSize）。所以「0.25x 预览 / 1.00x 导出」是这条式子的
   * 自然结果，而不是一个要维护的开关。
   *
   * 尺寸按文档宽高比推导：纹理的宽高比与文档一致时，compositor 的
   * drawSizeFor 算出来的摆放尺寸与光栅分辨率无关 —— 也就是说调 previewScale
   * 只影响清晰度，不影响版式。
   */
  private rasterSizeFor(
    clip: SourceClip,
    docW: number,
    docH: number,
    renderW: number,
    renderH: number,
  ): { w: number; h: number } {
    const [dW, dH] = drawSizeFor(clip.fit, renderW, renderH, docW, docH, 1, 1);
    const kW = dW / docW;
    const kH = dH / docH;
    const s = this.previewScale;
    return {
      w: clampInt(docW * kW * s, MAX_RASTER_EDGE),
      h: clampInt(docH * kH * s, MAX_RASTER_EDGE),
    };
  }

  /* ------------------------------------------------------------ 异步烘焙 */

  private schedule(key: string, doc: TypographyDocument, w: number, h: number, localSec: number): void {
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    const backend = this.backends.pick();
    void backend
      .rasterize({ doc, width: w, height: h, localSec, resolveImage: this.resolveImage })
      .then((canvas) => {
        this.upload(key, canvas, w, h);
        this.inflight.delete(key);
        this.opts.onReady();
      })
      .catch((err) => {
        this.inflight.delete(key);
        console.error('[typo] 光栅化失败', err);
      });
  }

  /** 图片素材的 URL 解析。M4 由编辑器注册；未注册时该元素这帧缺席。 */
  resolveImage: (assetId: string) => string | null = () => null;

  /* ------------------------------------------------------------ 导出预热 */

  /**
   * 把命中 t 的所有排版层预烘到当前渲染尺寸。
   *
   * 这是本模块对既有结构唯一的侵入（导出循环里多一次 await）。
   * 它与 `await sink.submit` 同类：是渲染前准备 + 协作式背压，
   * 不是第二个时钟 —— 硬约束 1.1 禁止的是「用 rAF 驱动导出」。
   */
  async prewarmFrame(project: Project, t: number): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const track of project.tracks) {
      if (track.kind !== 'visual' || !track.enabled) continue;
      for (const clip of track.clips) {
        if (clip.kind !== 'source' || clip.source.type !== 'text') continue;
        if (t < clip.start || t >= clip.end) continue;
        const doc = clip.source.doc;
        const size = this.rasterSizeFor(clip, doc.size.w, doc.size.h, this.kit.w, this.kit.h);
        const localSec = t - clip.start;
        const key = this.keyFor(doc, localSec, size.w, size.h);
        if (this.entries.has(key)) continue;
        jobs.push(this.bakeNow(key, doc, size.w, size.h, localSec));
      }
    }
    await Promise.all(jobs);
  }

  private async bakeNow(
    key: string,
    doc: TypographyDocument,
    w: number,
    h: number,
    localSec: number,
  ): Promise<void> {
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      const canvas = await this.backends
        .pick()
        .rasterize({ doc, width: w, height: h, localSec, resolveImage: this.resolveImage });
      this.upload(key, canvas, w, h);
    } catch (err) {
      console.error('[typo] 预热失败', err);
    } finally {
      this.inflight.delete(key);
    }
  }

  /** ADR-003 规则 ③：导出前必须等字体就绪。 */
  async prewarmFonts(project: Project): Promise<void> {
    for (const track of project.tracks) {
      if (track.kind !== 'visual') continue;
      for (const clip of track.clips) {
        if (clip.kind === 'source' && clip.source.type === 'text') {
          await this.fonts.ensure(clip.source.doc);
        }
      }
    }
  }

  /** 强制光栅化一张（「烘焙为 PNG 素材」用），不经过缓存。 */
  async rasterizeOnce(
    doc: TypographyDocument,
    width: number,
    height: number,
    localSec: number,
  ): Promise<HTMLCanvasElement> {
    return this.backends
      .pick()
      .rasterize({ doc, width, height, localSec, resolveImage: this.resolveImage });
  }

  enterExportMode(): void {
    this.exportMode = true;
    this.evict(EXPORT_ENTRIES, 0);
  }

  exitExportMode(): void {
    this.exportMode = false;
    this.evict(MAX_RASTER_ENTRIES, MAX_RASTER_BYTES);
  }

  dispose(): void {
    for (const e of this.entries.values()) this.kit.gl.deleteTexture(e.tex);
    this.entries.clear();
    this.inflight.clear();
    this.backends.dispose();
  }

  /** 测试钩子。 */
  stats(): { entries: number; bytes: number } {
    let bytes = 0;
    for (const e of this.entries.values()) bytes += e.bytes;
    return { entries: this.entries.size, bytes };
  }

  /* ------------------------------------------------------------ 纹理上传 */

  private upload(key: string, canvas: HTMLCanvasElement, w: number, h: number): void {
    const gl = this.kit.gl;
    const old = this.entries.get(key);
    if (old) gl.deleteTexture(old.tex);

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // **必须翻转**：纹理坐标 v=0 对应层的底部（VERT_QUAD 里 vUv = aPos*0.5+0.5），
    // 而 texImage2D 默认把图像的第一行放到 v=0。不翻的话文字和图形全上下颠倒。
    // 注意这把整个 GL 上传状态改了，用完立刻还原，免得影响别处的上传路径。
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    // 线性过滤：光栅化尺寸是照着显示尺寸算的，通常是 1:1 或略微缩小，
    // 用 NEAREST 会在 previewScale < 1 时把笔画打碎。
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const bytes = w * h * 4;
    const entry: CacheEntry = { tex, w: canvas.width, h: canvas.height, bytes, used: ++this.clock };
    this.entries.set(key, entry);

    this.evict(
      this.exportMode ? EXPORT_ENTRIES : MAX_RASTER_ENTRIES,
      this.exportMode ? 0 : MAX_RASTER_BYTES,
    );
  }

  /** 淘汰超出预算的条目（按最近使用时间）。maxBytes 为 0 表示只限条目数。 */
  private evict(maxEntries: number, maxBytes: number): void {
    while (this.entries.size > maxEntries || (maxBytes > 0 && this.totalBytes() > maxBytes)) {
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [k, e] of this.entries) {
        if (e.used < oldest) {
          oldest = e.used;
          oldestKey = k;
        }
      }
      if (!oldestKey) return;
      const victim = this.entries.get(oldestKey)!;
      this.kit.gl.deleteTexture(victim.tex);
      this.entries.delete(oldestKey);
    }
  }

  private totalBytes(): number {
    let sum = 0;
    for (const e of this.entries.values()) sum += e.bytes;
    return sum;
  }
}

function clampInt(v: number, max: number): number {
  const n = Math.round(v);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, max);
}
