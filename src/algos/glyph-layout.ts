/**
 * glyph-layout.ts — 字形图集的**纯**布局算术。
 *
 * 单独拆出来是为了它能在 vitest 里跑（`glyph-atlas.ts` 要 `document` 与
 * `WebGL2RenderingContext`，单测里两样都没有）。图集的行列数一旦算错，
 * 表现是「字符索引对不上字形」—— 画面看起来仍然「像 ASCII」，只是每个
 * 字符都是错的，肉眼极难发现。所以这段算术值得被测。
 */

/** 可打印 ASCII 的范围（含端点）：空格 … `~`。 */
export const ASCII_FIRST = 32;
export const ASCII_LAST = 126;

/** 16 列正好是一行能放下的格数（也是常见 ASCII 艺术实现的惯例）。 */
export const GLYPH_COLS = 16;
export const GLYPH_ROWS = 6;

export interface GlyphLayout {
  cols: number;
  rows: number;
  cell: number;
}

/** 图集需要多少格才能放下全部可打印 ASCII。 */
export function glyphSlots(): number {
  return ASCII_LAST - ASCII_FIRST + 1;
}

/** 给定格边长，返回布局。格子尺寸被钳到 `[8, 128]`（太小画不出字形、太大浪费显存）。 */
export function glyphLayout(cell = 32): GlyphLayout {
  const c = Math.max(8, Math.min(128, Math.round(cell)));
  const slots = glyphSlots();
  const cols = GLYPH_COLS;
  const rows = Math.max(GLYPH_ROWS, Math.ceil(slots / cols));
  return { cols, rows, cell: c };
}

/** 码点 → 图集里的格坐标（`-1` 表示不在图集内）。 */
export function glyphIndex(code: number, layout: GlyphLayout): { x: number; y: number } | null {
  const i = code - ASCII_FIRST;
  if (i < 0 || i >= layout.cols * layout.rows) return null;
  return { x: i % layout.cols, y: Math.floor(i / layout.cols) };
}

/** 格坐标 → UV 原点的**左下角**（GL 纹理原点，与 `vUv` 同向）。 */
export function glyphUvOrigin(ix: number, iy: number, layout: GlyphLayout): { u0: number; v0: number } {
  return { u0: ix / layout.cols, v0: iy / layout.rows };
}
