/**
 * sources.ts — SourceClip → 纹理的解析器。
 *
 * solid → 1×1 色纹理（按颜色缓存）
 * image → 已解码的 ImageBitmap（`engine/media-assets.ts`），首次用到时上传成纹理
 * algo  → 委托给注入的 algo 运行时（B7 装配）；未装配或没烘好返回 null
 * text  → 委托给注入的排版运行时（M4 装配）；缓存未命中时返回 null，
 *         由它异步光栅化后经 onReady → store.touch() → 下一帧重绘
 * video → 委托给注入的视频运行时（M6 装配）；帧没解码好返回 null，同上
 *
 * ## 为什么 image / video 都走「注入 resolver」而不是直连
 *
 * 两条路都是**异步就绪**的（图片要 `createImageBitmap`，视频要解到目标帧），
 * 而 `resolve` 必须是同步的 —— 它跑在每帧的合成路径上。所以约定与 algo 烘焙
 * 完全一致：**这一帧缺席，就返回 null**，由注入方在就绪后通知重绘。
 *
 * 图片这一层过去是缺的：`setImage` 在 M4 就写好了却**零调用方**，于是
 * 排版「转为图片」产出的片段画面上是空白。现在改成「注册解码结果 + 懒上传」，
 * 顺带解决了「注册时渲染器还没建好」的时序问题 —— 登记项活在模块里，
 * 纹理等第一次真正用到时才建。
 */

import type { SourceClip } from '../core/schema';
import type { Kit } from './kit';
import type { SourceResolver, SourceTexture } from './compositor';
import { imageSourceFor, type ImageEntry } from './media-assets';

export type AlgoResolver = (clip: SourceClip, t: number, frame: number) => SourceTexture | null;

/**
 * 视频解析器。与 AlgoResolver 同形（同步、未就绪给 null），
 * 差别是它背后有解码队列 —— 实现见 `engine/video-source.ts`。
 */
export type VideoResolver = (clip: SourceClip, t: number, frame: number) => SourceTexture | null;

/** 图片解析器：assetId → 已解码的图源。未解码好就返回 null。 */
export type ImageResolver = (assetId: string) => ImageEntry | null;

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
  /**
   * 图片纹理缓存。`rev` 是**登记项对象本身**：同一个 assetId 换了内容
   * （登记处新建了 entry）身份就变，缓存自然失效 —— 不需要任何显式的
   * invalidate 调用，那种调用迟早有人忘记加。
   */
  private readonly imageCache = new Map<string, { st: SourceTexture; rev: object }>();
  private algoResolver: AlgoResolver | null = null;
  private textResolver: TextResolver | null = null;
  private videoResolver: VideoResolver | null = null;
  private imageResolver: ImageResolver | null = imageSourceFor;

  constructor(private readonly kit: Kit) {}

  setAlgoResolver(r: AlgoResolver | null): void {
    this.algoResolver = r;
  }

  setTextResolver(r: TextResolver | null): void {
    this.textResolver = r;
  }

  setVideoResolver(r: VideoResolver | null): void {
    this.videoResolver = r;
  }

  /** 默认实现直接读 `media-assets` 的登记表；注入只是为了测试可替换。 */
  setImageResolver(r: ImageResolver | null): void {
    this.imageResolver = r;
  }

  readonly resolve: SourceResolver = (clip, t, frame) => {
    switch (clip.source.type) {
      case 'solid':
        return this.solid(clip.source.color);
      case 'image': {
        const entry = this.imageResolver?.(clip.source.assetId);
        return entry ? this.imageTexture(clip.source.assetId, entry) : null;
      }
      case 'algo':
        return this.algoResolver?.(clip, t, frame) ?? null;
      case 'video':
        return this.videoResolver?.(clip, t, frame) ?? null;
      case 'text':
        // 多传 kit.w / kit.h：光栅化要照着「这一层会被画多大」出图，
        // 而渲染尺寸是 renderer 的状态（预览 ≈960、导出 1920）。
        return this.textResolver?.(clip, t, this.kit.w, this.kit.h) ?? null;
      default:
        return null;
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

  /**
   * 图片纹理：按 assetId 缓存，用**登记项对象身份**当版本号。
   *
   * 同一个 assetId 换了内容（登记处新建了 entry）身份就变，缓存自然失效 ——
   * 不需要任何显式的 invalidate 调用，那种调用迟早有人忘记加。
   */
  private imageTexture(assetId: string, entry: ImageEntry): SourceTexture {
    const hit = this.imageCache.get(assetId);
    if (hit && hit.rev === entry) return hit.st;
    if (hit) this.kit.gl.deleteTexture(hit.st.tex);

    const st = this.uploadImage(entry.source, entry.w, entry.h);
    this.imageCache.set(assetId, { st, rev: entry });
    return st;
  }

  /**
   * 把一个 **canvas 源**上传成纹理。
   *
   * ## `UNPACK_FLIP_Y_WEBGL = true` —— 这是实测结论，而且是两轮实测
   *
   * 第一轮：按「DOM 行序自上而下、纹理 v=0 是第一行，所以要翻」的推断写 true，
   * E2E 抓到画面整体上下颠倒。第二轮：改成 false，**结果逐像素完全一样** ——
   * 于是真相清楚了：第一轮的颠倒不是这个标志造成的，而是
   * **Chromium 上传 `ImageBitmap` 时忽略这个标志**。
   *
   * 对策是把上传源统一成 canvas（见 `media-assets.registerImageBytes`）：
   * canvas 源正常受标志控制，所以这里翻一次就够，图片与视频同时正确。
   *
   * 与**排版那条路无关**：排版的纹理在自己的运行时里上传（ADR-003 规则②
   * 也需要 FLIP_Y），两条路各管各的，不要互相照搬。
   * 这一切由 `tests/e2e/m6.spec.ts` 的「上红下蓝」断言钉死。
   */
  uploadImage(source: TexImageSource, w: number, h: number): SourceTexture {
    const gl = this.kit.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, w, h };
  }

  /** 素材被替换/移除时丢掉对应的纹理（登记处没有失效通知时才需要显式调）。 */
  invalidateImage(assetId: string): void {
    const hit = this.imageCache.get(assetId);
    if (!hit) return;
    this.kit.gl.deleteTexture(hit.st.tex);
    this.imageCache.delete(assetId);
  }
}
