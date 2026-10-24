/**
 * pattern-image.ts — 把一张图片采样成 `pattern` 位图（SVG / PNG 等带透明通道的图）。
 *
 * ## 语义
 *
 * 判据只有一条：**不透明度**。像素 alpha 过半就算「活」，颜色、亮度、通道
 * 一概不看 —— 这让「一个透明底的 logo」直接变成种子图案，而不是让用户去猜
 * 该用亮度还是对比度。
 *
 * 阈值取 128 而不是 255：导入时按**网格分辨率**重绘，SVG 的细线在缩放后
 * 每个格子拿到的是**覆盖率**（抗锯齿），要求 alpha 恰好 255 会把 1px 的描边
 * 整条丢掉。128 = 「这一格被盖住一半以上」。
 *
 * ## 与网格的关系
 *
 * 默认按**模拟网格的尺寸**采样（调用方给 `w` / `h`），于是 `stampCentered`
 * 盖回去是一次恒等映射 —— 图片就是初始状态本身，而不是缩在中间的一小块。
 * 超过 `MAX_PATTERN_DIM` 时按比例缩到上限内（宁可整体小一圈，也不横向压扁）。
 *
 * ## 为什么解码走 `<img>` 而不是 `createImageBitmap`
 *
 * `createImageBitmap` 在 Chromium 里**不接受 SVG blob**。图片素材的解码
 * （`engine/media-assets.ts`）也是同一个坑 —— 这里不复用它是因为图案导入
 * 需要拿到**原始像素**，而那边交出来的是一张按原尺寸画好的 canvas，
 * 再缩放一次会多一次重采样。
 */

import { MAX_PATTERN_DIM, emptyBitmap, type Bitmap } from './pattern-codec';

/** alpha ≥ 它的格子算活（见文件头）。 */
export const ALPHA_LIVE = 128;

export interface ContainRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * contain 适配：把 `srcW × srcH` 等比放进 `dstW × dstH` 并居中。
 *
 * 纯函数（单测钉住）。**不拉伸**：拉伸会让一个正方形 logo 在 16:9 网格里
 * 变宽，而用户看到的是「导入之后变形了」，却找不到任何参数能改回来。
 */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): ContainRect {
  const sw = srcW > 0 ? srcW : 1;
  const sh = srcH > 0 ? srcH : 1;
  const k = Math.min(dstW / sw, dstH / sh);
  const w = Math.max(1, Math.min(dstW, Math.round(sw * k)));
  const h = Math.max(1, Math.min(dstH, Math.round(sh * k)));
  return { x: Math.floor((dstW - w) / 2), y: Math.floor((dstH - h) / 2), w, h };
}

/**
 * alpha 通道 → 位图（纯函数，单测直接打）。
 *
 * `alpha` 是行主序的 RGBA 里每隔 4 个取一个的那种数组；长度不足时缺的格补 0
 * （与 `decodePattern` 同一条「永不抛」的纪律，坏数据只该降级）。
 */
export function bitmapFromAlpha(
  alpha: ArrayLike<number>,
  w: number,
  h: number,
  threshold = ALPHA_LIVE,
): Bitmap {
  const bm = emptyBitmap(w, h);
  for (let i = 0; i < bm.data.length; i++) {
    bm.data[i] = (alpha[i] ?? 0) >= threshold ? 1 : 0;
  }
  return bm;
}

/** 目标位图尺寸：等比缩进 `MAX_PATTERN_DIM`，且至少 1 格。 */
export function patternSizeFor(w: number, h: number): { w: number; h: number } {
  const ww = Math.max(1, Math.round(w));
  const hh = Math.max(1, Math.round(h));
  const k = Math.min(1, MAX_PATTERN_DIM / Math.max(ww, hh));
  return { w: Math.max(1, Math.round(ww * k)), h: Math.max(1, Math.round(hh * k)) };
}

/**
 * 把任意图源采样成位图。
 *
 * 先按 contain 适配画进一张 `dstW × dstH` 的 canvas，再逐像素读 alpha。
 * 画的时候保持 `imageSmoothingEnabled` 默认（开）：缩小时得到的是覆盖率，
 * 这正是「细线不整条消失」的来源。
 */
export function bitmapFromImageSource(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Bitmap | null {
  const size = patternSizeFor(dstW, dstH);
  const canvas = createCanvas(size.w, size.h);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) return null;
  const rect = containRect(srcW, srcH, size.w, size.h);
  ctx.clearRect(0, 0, size.w, size.h);
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h);
  const img = ctx.getImageData(0, 0, size.w, size.h);
  return bitmapFromAlpha(stridedAlpha(img.data, size.w * size.h), size.w, size.h);
}

/** 从 RGBA 数据里抽出 alpha 通道（避免每格做一次 `i*4+3` 的乘法）。 */
export function stridedAlpha(rgba: ArrayLike<number>, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) out[i] = rgba[i * 4 + 3] ?? 0;
  return out;
}

/**
 * Blob → 位图。SVG 与 PNG 走同一条路（`<img>` 能解两者）。
 *
 * 返回 `null` = 解不开（坏文件 / 不支持的格式）。调用方负责提示。
 */
export async function bitmapFromImageBlob(
  blob: Blob,
  dstW: number,
  dstH: number,
): Promise<Bitmap | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // 没有固有尺寸的 SVG：拿目标尺寸当比例（画进整格），总比 1:1 塞一个角好。
    const sw = img.naturalWidth || dstW;
    const sh = img.naturalHeight || dstH;
    return bitmapFromImageSource(img, sw, sh, dstW, dstH);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function createCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
