/**
 * pattern-paint.ts — 手绘位图编辑器的**纯**几何算术。
 *
 * 拆出来的理由和 `glyph-layout.ts` 一样：这段算术错了不会报错 ——
 * 表现是「画的地方和亮起来的格子差半格」或者「快速拖动时漏格」，
 * 都是肉眼要盯一会儿才发现的。放在纯函数里就能直接单测。
 */

export interface GridLayout {
  /** 每格边长（CSS px，整数）。 */
  cell: number;
  /** 网格左上角在画布内的偏移（CSS px），用于居中。 */
  ox: number;
  oy: number;
}

export interface Cell {
  x: number;
  y: number;
}

/**
 * 给定画布尺寸与网格尺寸，算出「正方形格 + 居中」的布局。
 *
 * 格边长取整是刻意的：非整数格会让格线落在半像素上、抗锯齿后边界发灰，
 * 而用户点到的像素与最近的格中心之间就会有歧义（相邻两格各占一半）。
 */
export function gridLayout(bmW: number, bmH: number, cssW: number, cssH: number): GridLayout {
  const w = Math.max(1, Math.floor(bmW));
  const h = Math.max(1, Math.floor(bmH));
  const cell = Math.max(1, Math.floor(Math.min(cssW / w, cssH / h)));
  const ox = Math.floor((cssW - cell * w) / 2);
  const oy = Math.floor((cssH - cell * h) / 2);
  return { cell, ox, oy };
}

/** 画布坐标 → 格坐标；落在网格外返回 `null`。 */
export function cellAt(
  px: number,
  py: number,
  layout: GridLayout,
  bmW: number,
  bmH: number,
): Cell | null {
  const x = Math.floor((px - layout.ox) / layout.cell);
  const y = Math.floor((py - layout.oy) / layout.cell);
  if (x < 0 || y < 0 || x >= bmW || y >= bmH) return null;
  return { x, y };
}

/**
 * Bresenham 直线上的整数格。
 *
 * 必须补线：`pointermove` 的采样率低于快速拖动的速度，只处理「当前落在哪一格」
 * 会画出断续的点阵（用户看到的是虚线，而不是他拖过的那条线）。
 */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Cell[] {
  const pts: Cell[] = [];
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  // 上限保护：坐标非法（NaN / 巨大）时不要无限循环。
  const guard = dx - dy + 2;
  for (let i = 0; i < guard; i++) {
    pts.push({ x, y });
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}

/** 把一串格涂成 `brush`（0/1）；越界的格忽略。 */
export function paintCells(
  data: Uint8Array,
  w: number,
  h: number,
  pts: readonly Cell[],
  brush: number,
): void {
  const v = brush ? 1 : 0;
  for (const p of pts) {
    if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) continue;
    data[p.y * w + p.x] = v;
  }
}
