import { describe, expect, it } from 'vitest';
import { cellAt, gridLayout, linePoints, paintCells } from '../../src/ui/pattern/pattern-paint';

describe('网格布局（画布坐标 ↔ 格坐标）', () => {
  it('正方形格 + 居中：边长取整，避免半像素歧义', () => {
    const lay = gridLayout(8, 8, 100, 100);
    expect(lay.cell).toBe(12); // floor(100/8) = 12
    expect(lay.ox).toBe(2); // (100 - 96) / 2
    expect(lay.oy).toBe(2);
  });

  it('宽扁网格按高度受限', () => {
    const lay = gridLayout(64, 2, 448, 44);
    expect(lay.cell).toBe(7); // min(448/64=7, 44/2=22) → 7
    expect(lay.oy).toBeGreaterThan(0);
  });

  it('cellAt 落在网格外返回 null（拖出画布不会写到远处）', () => {
    const lay = gridLayout(4, 4, 40, 40); // cell=10, ox=oy=0
    expect(cellAt(0, 0, lay, 4, 4)).toEqual({ x: 0, y: 0 });
    expect(cellAt(39, 39, lay, 4, 4)).toEqual({ x: 3, y: 3 });
    expect(cellAt(-1, 5, lay, 4, 4)).toBeNull();
    expect(cellAt(5, 40, lay, 4, 4)).toBeNull();
  });

  it('cellAt 与 gridLayout 自洽：每格中心都映射回自己', () => {
    const lay = gridLayout(5, 3, 100, 80);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 5; x++) {
        const px = lay.ox + x * lay.cell + lay.cell / 2;
        const py = lay.oy + y * lay.cell + lay.cell / 2;
        expect(cellAt(px, py, lay, 5, 3)).toEqual({ x, y });
      }
    }
  });
});

describe('Bresenham 补线（快速拖动不漏格）', () => {
  it('水平 / 垂直 / 对角线都连续且端点正确', () => {
    expect(linePoints(0, 0, 3, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(linePoints(0, 0, 0, 2).map((p) => p.y)).toEqual([0, 1, 2]);
    expect(linePoints(0, 0, 2, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it('反向也走得通（从左下往右上）', () => {
    const pts = linePoints(3, 0, 0, 0);
    expect(pts[0]).toEqual({ x: 3, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 0, y: 0 });
    expect(pts).toHaveLength(4);
  });

  it('起点等于终点时只返回一个点', () => {
    expect(linePoints(2, 2, 2, 2)).toEqual([{ x: 2, y: 2 }]);
  });

  it('长斜线的每步都只走一格（连贯，无跳跃）', () => {
    const pts = linePoints(0, 0, 20, 9);
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.abs(pts[i]!.x - pts[i - 1]!.x);
      const dy = Math.abs(pts[i]!.y - pts[i - 1]!.y);
      expect(Math.max(dx, dy)).toBe(1);
    }
  });
});

describe('涂格', () => {
  it('brush=1 置活、brush=0 擦除，越界格忽略', () => {
    const data = new Uint8Array(4 * 4);
    paintCells(data, 4, 4, [{ x: 1, y: 1 }, { x: 2, y: 2 }], 1);
    expect(data[1 * 4 + 1]).toBe(1);
    expect(data[2 * 4 + 2]).toBe(1);
    paintCells(data, 4, 4, [{ x: 1, y: 1 }], 0);
    expect(data[1 * 4 + 1]).toBe(0);
    // 越界不抛、不写到别的格子
    paintCells(data, 4, 4, [{ x: -1, y: 0 }, { x: 9, y: 9 }], 1);
    expect(data.filter((v) => v !== 0).length).toBe(1);
  });

  it('沿一条线涂会得到一个连通段（这正是补线的目的）', () => {
    const data = new Uint8Array(16 * 16);
    const pts = linePoints(1, 1, 14, 9);
    paintCells(data, 16, 16, pts, 1);
    expect(data.filter((v) => v !== 0).length).toBe(pts.length);
  });
});
