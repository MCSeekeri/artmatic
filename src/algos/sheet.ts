/**
 * sheet.ts — 帧图集（tile atlas）。
 *
 * 移植自 angel-echo js/automata.js 的 sheetSpec/sheetPut（同作者内部移植）。
 * 有状态模拟不能边写边读纹理，所以整段序列模拟一次、堆进一张图集，
 * 着色器按连续帧号取 tile。每帧成本与采样静态图相同。
 */

export interface SheetSpec {
  frames: number;
  tile: number;
  cols: number;
  rows: number;
  w: number;
  h: number;
}

export function sheetSpec(frames: number, tile: number, maxSide = 4096): SheetSpec {
  const cols = Math.max(1, Math.min(frames, Math.floor(maxSide / tile)));
  const rows = Math.ceil(frames / cols);
  return { frames, tile, cols, rows, w: cols * tile, h: rows * tile };
}

export function sheetPut(
  out: Uint8Array,
  sheet: SheetSpec,
  index: number,
  tileData: Uint8Array,
  tw: number,
  th: number,
): void {
  const cx = (index % sheet.cols) * sheet.tile;
  const cy = Math.floor(index / sheet.cols) * sheet.tile;
  for (let y = 0; y < th; y++) {
    out.set(tileData.subarray(y * tw, y * tw + tw), (cy + y) * sheet.w + cx);
  }
}
