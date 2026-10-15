/**
 * offline-media.ts — 「脱机媒体」占位符的共享数据（纯常量，无 DOM / GL）。
 *
 * 片段引用了**不存在的媒体**（图片 / 视频素材不在仓里）时，画面不该是无声的
 * 空白 —— 那是「坏了但看不出为什么」的最差形态。PR / 达芬奇的惯例是一块
 * 暗红色占位：一眼能看出「这里应该有东西，而现在没有」。
 *
 * 三个渲染出口共用这一份数据：
 *   - `engine/offline-placeholder.ts`：Canvas2D 画成纹理（视频 / 图片片段）
 *   - `typography/render-dom.ts`：DOM 节点（排版文档里的图片元素）
 *   - 两者的几何不同（一个按画布像素、一个按 CSS 容器单位），但**颜色与字形
 *     必须一致** —— 各画各的会出现「时间轴上是暗红、排版里是玫红」。
 *
 * 字形来自 Lucide 的 `file-x-corner`（ISC，见 CREDITS.md）：`ui/icons.ts`
 * 用的是同一个图标的 Svelte 组件，这里存的是它的路径数据（Canvas2D 的
 * `Path2D` 与 DOM 的 `<path d>` 都直接吃 SVG path 语法）。
 */

/** 占位符底色：暗红（「有问题」的信号色，但不到刺眼的程度）。 */
export const OFFLINE_BG = '#3b1216';

/** 图标与文字的颜色：暗红底上的浅色。 */
export const OFFLINE_INK = '#e8b4b8';

/** `file-x-corner` 的路径数据（Lucide ISC）。viewBox 0 0 24 24，描边样式。 */
export const OFFLINE_ICON_PATHS: readonly string[] = [
  'M11 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5',
  'M14 2v5a1 1 0 0 0 1 1h5',
  'm15 17 5 5',
  'm20 17-5 5',
];
