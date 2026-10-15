/**
 * offline-placeholder.ts — 「脱机媒体」占位图的 Canvas2D 绘制（视频 / 图片片段）。
 *
 * 只被 `engine/sources.ts` 用：合成路径上某个 image / video 源解析不到素材时，
 * 返回这张图上传成的纹理，而不是 `null`（那一层被静默跳过 = 无声空白）。
 *
 * 判据「真的不存在」与「还没加载好」必须分开 —— 后者是每一帧都在发生的
 * 正常状态（异步解码），给它也画占位符的话，正常加载过程会满屏闪暗红。
 * 判据由注入的探针给出（见 `SourceManager.setAssetOfflineProbe`）。
 *
 * 颜色与字形与排版侧的 DOM 占位符共用 `core/offline-media.ts` 的常量。
 * 朝向：canvas 行序自上而下，上传时 `SourceManager.uploadImage` 的
 * `UNPACK_FLIP_Y_WEBGL = true` 会翻一次 —— 与所有图片素材同一条路。
 */

import { OFFLINE_BG, OFFLINE_ICON_PATHS, OFFLINE_INK } from '../core/offline-media';

/** 占位图的画布尺寸（16:9）。放置时按片段的 fit 缩放，不决定画面比例。 */
export const OFFLINE_PLACEHOLDER_SIZE = { w: 640, h: 360 } as const;

/**
 * 在 `ctx` 上画一张占位图（底色铺满整个 `w × h`）。
 *
 * 上下文类型放宽到 `OffscreenCanvasRenderingContext2D`：占位图优先建在
 * `OffscreenCanvas` 上（不进 DOM），而两者的绘制 API 在本函数用到的范围内
 * 完全一致（`Path2D` 两边都有）。
 *
 * @param label 占位文字（「脱机媒体」，由宿主从 i18n 注入）。空串 = 只画图标。
 */
export function drawOfflinePlaceholder(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  label: string,
): void {
  ctx.save();
  ctx.fillStyle = OFFLINE_BG;
  ctx.fillRect(0, 0, w, h);

  // 图标：居中偏上，边长取短边的 28%（Lucide 的 24×24 viewBox 等比缩放）。
  const icon = Math.min(w, h) * 0.28;
  ctx.translate((w - icon) / 2, h / 2 - icon * 0.62);
  ctx.scale(icon / 24, icon / 24);
  ctx.strokeStyle = OFFLINE_INK;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const d of OFFLINE_ICON_PATHS) ctx.stroke(new Path2D(d));
  ctx.restore();

  if (!label) return;
  ctx.save();
  ctx.fillStyle = OFFLINE_INK;
  ctx.font = `${Math.round(Math.min(w, h) * 0.085)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2 + icon * 0.52);
  ctx.restore();
}
