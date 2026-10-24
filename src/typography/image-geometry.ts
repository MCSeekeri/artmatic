/**
 * image-geometry.ts — 图片元素的**裁剪 / 对齐画布 / 调整大小**（纯几何）。
 *
 * 与 `image-effects.ts` 一样是纯函数：界面（Ribbon 浮层）与 agent 写入共用
 * 同一份算式，所以「面板上裁成 16:9」与「模型写 crop」不可能给出两个结果。
 *
 * ## 两条必须记住的约定
 *
 * 1. **`ImageElement.crop` 是源图比例（0..1），不是像素**。裁剪窗要「看起来
 *    就是那个比例」，必须把源图的原始宽高比算进去 —— 直接按 `w/h` 取窗口的话，
 *    16:9 的图裁成 1:1 会变成一条竖条。
 * 2. **裁比例时顺带把 `fit` 设成 `cover`**。`contain` 下裁出来的窗口会留黑边，
 *    用户会觉得「裁剪没生效」；`cover` 下窗口正好铺满元素框（推导见
 *    `cropForAspect` 的注释）。
 */

import type { MessageKey } from '../i18n/locales';
import type { Size, TextureFrame } from './document';

export interface ImageCropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CROP_ASPECTS: { id: string; labelKey: MessageKey; ratio: number | null }[] = [
  { id: 'original', labelKey: 'rib.cropOriginal', ratio: null },
  { id: '1-1', labelKey: 'rib.cropSquare', ratio: 1 },
  { id: '4-3', labelKey: 'rib.crop4x3', ratio: 4 / 3 },
  { id: '3-4', labelKey: 'rib.crop3x4', ratio: 3 / 4 },
  { id: '16-9', labelKey: 'rib.crop16x9', ratio: 16 / 9 },
  { id: '9-16', labelKey: 'rib.crop9x16', ratio: 9 / 16 },
  { id: '3-2', labelKey: 'rib.crop3x2', ratio: 3 / 2 },
  { id: '2-3', labelKey: 'rib.crop2x3', ratio: 2 / 3 },
];

/**
 * 目标宽高比（源像素口径）→ 居中的裁剪窗。
 *
 * 推导：元素框 W×H、裁剪窗 cw×ch 时，内层图片被放大到 `100/cw %` × `100/ch %`，
 * 于是内层盒的宽高比是 `(W·ch)/(H·cw)`；源窗口的宽高比是 `(cw·nw)/(ch·nh)`。
 * 两者相等时 `cover` 恰好不裁也不留边 —— 解出 `cw/ch = r·nh/nw`。
 *
 * `ratio = null`（原始比例）返回 null：调用方据此**删掉 crop 字段**。
 */
export function cropForAspect(natural: Size, ratio: number | null): ImageCropRect | null {
  if (ratio === null) return null;
  const nw = natural?.w ?? 0;
  const nh = natural?.h ?? 0;
  if (!(nw > 0) || !(nh > 0) || !(ratio > 0)) return null;
  const k = (ratio * nh) / nw;
  let cw: number;
  let ch: number;
  if (k >= 1) {
    cw = 1;
    ch = 1 / k;
  } else {
    ch = 1;
    cw = k;
  }
  cw = Math.min(1, Math.max(0.02, cw));
  ch = Math.min(1, Math.max(0.02, ch));
  return { x: (1 - cw) / 2, y: (1 - ch) / 2, w: cw, h: ch };
}

/** 对齐画布的六种方式。 */
export type ImageAlignMode = 'center' | 'center-h' | 'center-v' | 'fit' | 'fill' | 'stretch';

/**
 * 按对齐方式算新的 frame（只给需要改的键）。
 *
 * `fit` / `fill` 保持元素自身的宽高比缩放（contain / cover 的手工版），
 * `stretch` 直接铺满（配合 `fit: 'fill'` 才是「拉伸」，所以调用方要一起写）。
 */
export function frameForAlign(
  frame: TextureFrame,
  canvas: Size,
  mode: ImageAlignMode,
): Partial<TextureFrame> {
  const w = Math.max(1, frame.w);
  const h = Math.max(1, frame.h);
  const cw = Math.max(1, canvas.w);
  const ch = Math.max(1, canvas.h);
  switch (mode) {
    case 'center':
      return { x: (cw - w) / 2, y: (ch - h) / 2 };
    case 'center-h':
      return { x: (cw - w) / 2 };
    case 'center-v':
      return { y: (ch - h) / 2 };
    case 'fit': {
      const k = Math.min(cw / w, ch / h);
      const nw = w * k;
      const nh = h * k;
      return { x: (cw - nw) / 2, y: (ch - nh) / 2, w: nw, h: nh };
    }
    case 'fill': {
      const k = Math.max(cw / w, ch / h);
      const nw = w * k;
      const nh = h * k;
      return { x: (cw - nw) / 2, y: (ch - nh) / 2, w: nw, h: nh };
    }
    case 'stretch':
      return { x: 0, y: 0, w: cw, h: ch };
    default:
      return {};
  }
}

/**
 * 改元素宽高、**保持中心不动**。
 *
 * 锚在左上角的话，缩小时图会往左上「跑」（用户报过「调大小之后位置也变了」）。
 * `lockAspect` 时按当前宽高比推另一边。
 */
export function resizeFrameCentered(
  frame: TextureFrame,
  next: { w?: number; h?: number },
  lockAspect: boolean,
): Partial<TextureFrame> {
  const w0 = Math.max(1, frame.w);
  const h0 = Math.max(1, frame.h);
  let w = Math.max(1, next.w ?? w0);
  let h = Math.max(1, next.h ?? h0);
  if (lockAspect) {
    const k = w0 / h0;
    if (next.w !== undefined) h = Math.max(1, w / k);
    else w = Math.max(1, h * k);
  }
  return {
    x: frame.x + (w0 - w) / 2,
    y: frame.y + (h0 - h) / 2,
    w,
    h,
  };
}
