/**
 * sources.ts — SourceClip → 纹理的解析器。
 *
 * solid → 1×1 色纹理（按颜色缓存）
 * image → 资产纹理（platform 导入后经 setImage 登记）
 * algo  → 委托给注入的 algo 运行时（B7 装配）；未装配或没烘好返回 null
 * text  → 委托给注入的排版运行时（M4 装配）；缓存未命中时返回 null，
 *         由它异步光栅化后经 onReady → store.touch() → 下一帧重绘。
 * video → MVP 不实现，返回 null（类型位置已在 schema 留好）
 */

import type { SourceClip } from '../core/schema';
import type { Kit } from './kit';
import type { SourceResolver, SourceTexture } from './compositor';

export type AlgoResolver = (clip: SourceClip, t: number, frame: number) => SourceTexture | null;

/**
 * 排版解析器。比 AlgoResolver 多两个参数：当前渲染尺寸。
 * 光栅化必须照着「这一层会被画多大」出图（预览 ≈960、导出 1920），
 * 而渲染尺寸是 renderer 的状态（kit.w / kit.h），不是片段自己的属性。
 */
export type TextResolver = (
  clip: SourceClip,
  t: number,
  renderW: number,
  renderH: number,
) => SourceTexture | null;

export function hexToRgba(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return [255, 0, 255, 255]; // 坏颜色画成品红，立刻可见
  const n = parseInt(m[1]!, 16);
  const a = m[2] ? parseInt(m[2], 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

export class SourceManager {
  private readonly solidCache = new Map<string, SourceTexture>();
  private readonly imageCache = new Map<string, SourceTexture>();
  private algoResolver: AlgoResolver | null = null;
  private textResolver: TextResolver | null = null;

  constructor(private readonly kit: Kit) {}

  setAlgoResolver(r: AlgoResolver | null): void {
    this.algoResolver = r;
  }

  setTextResolver(r: TextResolver | null): void {
    this.textResolver = r;
  }

  readonly resolve: SourceResolver = (clip, t, frame) => {
    switch (clip.source.type) {
      case 'solid':
        return this.solid(clip.source.color);
      case 'image':
        return this.imageCache.get(clip.source.assetId) ?? null;
      case 'algo':
        return this.algoResolver?.(clip, t, frame) ?? null;
      case 'text':
        // 多传 kit.w / kit.h：光栅化要照着「这一层会被画多大」出图，
        // 而渲染尺寸是 renderer 的状态（预览 ≈960、导出 1920）。
        return this.textResolver?.(clip, t, this.kit.w, this.kit.h) ?? null;
      default:
        return null; // video：M5
    }
  };

  private solid(color: string): SourceTexture {
    const hit = this.solidCache.get(color);
    if (hit) return hit;
    const gl = this.kit.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array(hexToRgba(color)),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const st: SourceTexture = { tex, w: 1, h: 1 };
    this.solidCache.set(color, st);
    return st;
  }

  /** platform 导入图片后登记。 */
  setImage(assetId: string, img: TexImageSource, w: number, h: number): void {
    const old = this.imageCache.get(assetId);
    if (old) this.kit.gl.deleteTexture(old.tex);
    const gl = this.kit.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.imageCache.set(assetId, { tex, w, h });
  }

  hasImage(assetId: string): boolean {
    return this.imageCache.has(assetId);
  }
}
