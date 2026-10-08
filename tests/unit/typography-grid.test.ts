import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TYPO_GRID,
  GRID_LIMITS,
  clampSize,
  gridLines,
  gridSpacing,
  normalizeTypoGrid,
  quantizeEdge,
  quantizeToGrid,
} from '../../src/typography/grid';
import { resizeFramesRotated, snapMove } from '../../src/typography/geometry';

const DOC = { w: 1920, h: 1080 };

describe('默认值', () => {
  it('默认**不**吸附网格 —— 量化式吸附默认打开会让所有拖动变成一格格跳', () => {
    // 这条是实测代价换来的：snap 默认 true 时，三条既有的自由拖动 E2E 直接变红，
    // 用户观感是「元素只能一格格跳」，而那时网格还根本没显示出来。
    expect(DEFAULT_TYPO_GRID.snap).toBe(false);
    expect(DEFAULT_TYPO_GRID.enabled).toBe(false);
    // 画幅线框是**常驻**的（用户要一眼看到画面范围），网格不是。
    expect(DEFAULT_TYPO_GRID.frame).toBe(true);
  });

  it('显示网格与吸附网格互不代管（可以看着网格但不吸附）', () => {
    const shown = normalizeTypoGrid({ ...DEFAULT_TYPO_GRID, enabled: true });
    expect(shown.snap).toBe(false);
  });
});

describe('normalizeTypoGrid', () => {
  it('空输入回落到默认值', () => {
    expect(normalizeTypoGrid(undefined)).toEqual(DEFAULT_TYPO_GRID);
    expect(normalizeTypoGrid(null)).toEqual(DEFAULT_TYPO_GRID);
    expect(normalizeTypoGrid({})).toEqual(DEFAULT_TYPO_GRID);
  });

  it('非法 mode 回落而不是原样带进去', () => {
    expect(normalizeTypoGrid({ mode: 'em' as never }).mode).toBe(DEFAULT_TYPO_GRID.mode);
  });

  it('尺寸按当前 mode 的上下限钳制', () => {
    expect(normalizeTypoGrid({ mode: 'px', size: 0.2 }).size).toBe(GRID_LIMITS.minPx);
    expect(normalizeTypoGrid({ mode: 'percent', size: 0.2 }).size).toBe(GRID_LIMITS.minPct);
    expect(normalizeTypoGrid({ mode: 'px', size: 99999 }).size).toBe(GRID_LIMITS.maxPx);
    expect(normalizeTypoGrid({ mode: 'percent', size: 99999 }).size).toBe(GRID_LIMITS.maxPct);
  });

  it('NaN / 负数不会渗进去', () => {
    expect(normalizeTypoGrid({ size: Number.NaN }).size).toBe(DEFAULT_TYPO_GRID.size);
    expect(normalizeTypoGrid({ size: -10 }).size).toBe(DEFAULT_TYPO_GRID.size);
  });
});

describe('gridSpacing', () => {
  it('px 模式下两轴相同', () => {
    expect(gridSpacing({ ...DEFAULT_TYPO_GRID, mode: 'px', size: 60 }, DOC)).toEqual({ x: 60, y: 60 });
  });

  it('百分比模式按画幅各轴换算 —— 不是正方形格子', () => {
    const s = gridSpacing({ ...DEFAULT_TYPO_GRID, mode: 'percent', size: 10 }, DOC);
    expect(s.x).toBeCloseTo(192, 6);
    expect(s.y).toBeCloseTo(108, 6);
    // 这条是机制判据：如果实现里偷懒用短边或宽度算两轴，x === y，断言就红。
    expect(s.x).not.toBe(s.y);
  });
});

describe('gridLines', () => {
  it('不含 0 与终点（那是画幅线框的职责）', () => {
    expect(gridLines(100, 300)).toEqual([100, 200]);
  });

  it('间距小于 1px 时返回空而不是死循环', () => {
    expect(gridLines(0, 1920)).toEqual([]);
    expect(gridLines(0.5, 1920)).toEqual([]);
  });
});

describe('quantizeToGrid', () => {
  it('吸到最近的格点（上下两个方向都行）', () => {
    expect(quantizeToGrid({ x: 103, y: 298 }, { x: 100, y: 100 })).toEqual({ x: 100, y: 300 });
  });

  it('落在中点上时向上吸，结果仍然确定（不会来回抖）', () => {
    expect(quantizeToGrid({ x: 50, y: 50 }, { x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
  });

  it('**对位置取整而不是对位移取整**：一个偏离格点的元素一动就归位', () => {
    // 起点 37（离最近的 40 差 3）。只移动 1px：
    //  - 对位移取整 → 位移 0 → 还停在 37（永远吸不上，用户看到「开了吸附没反应」）
    //  - 对位置取整 → 1040+37+1 = 1078 → 吸到 1080 ✔
    const start = { x: 1037, y: 0 };
    const moved = { x: start.x + 1, y: 0 };
    expect(quantizeToGrid(moved, { x: 40, y: 40 }).x).toBe(1040);
  });

  it('间距非法（≤1）时原样返回，不做除零', () => {
    expect(quantizeToGrid({ x: 37, y: 41 }, { x: 0, y: 1 })).toEqual({ x: 37, y: 41 });
  });

  it('负坐标也能量化（元素可以拖到画幅外）', () => {
    expect(quantizeToGrid({ x: -37, y: -1 }, { x: 20, y: 20 })).toEqual({ x: -40, y: 0 });
  });
});

describe('quantizeEdge', () => {
  it('边量到格点；间距非法时原样返回', () => {
    expect(quantizeEdge(118, 40)).toBe(120);
    expect(quantizeEdge(118, 0)).toBe(118);
  });
});

describe('snapMove 的网格模式', () => {
  const canvas = { w: 1920, h: 1080 };
  const grid = { x: 50, y: 50 };

  it('开启网格 = 位置量化到格点', () => {
    const moving = [{ id: 'a', x: 97, y: 203, w: 40, h: 40 }];
    const r = snapMove(moving, 0, 0, [], canvas, 6, grid);
    expect(r.frames.get('a')!.x).toBe(100);
    expect(r.frames.get('a')!.y).toBe(200);
    expect(r.guides.map((g) => g.target)).toEqual(['grid', 'grid']);
  });

  it('网格模式下**不再**吃元素/画布参考线（这是「乱飞」的根治）', () => {
    // 另一个元素的左边在 100，被拖的框左边在 97 —— 智能参考线会把它拉到 100。
    // 网格间距 50 时量化结果是 100，两者恰好一致，所以换一个能区分开的布局：
    // 被拖的框在 97，网格间距 40 → 量化到 80；而元素参考线会拉到 100。
    const moving = [{ id: 'a', x: 97, y: 400, w: 40, h: 40 }];
    const others = [{ id: 'b', x: 100, y: 900, w: 40, h: 40 }];
    const r = snapMove(moving, 0, 0, others, canvas, 6, { x: 40, y: 40 });
    expect(r.frames.get('a')!.x).toBe(80);
    expect(r.guides.every((g) => g.target === 'grid')).toBe(true);
  });

  it('元素宽也只有一个吸附点：不会被「三个锚点各自找最近的格线」拽来拽去', () => {
    // 宽 1400 的框，位移 1px 的量级不应当让结果跳一格。
    const wide = [{ id: 'a', x: 100, y: 100, w: 1400, h: 200 }];
    const a = snapMove(wide, 3, 0, [], canvas, 6, grid).frames.get('a')!.x;
    const b = snapMove(wide, 4, 0, [], canvas, 6, grid).frames.get('a')!.x;
    const c = snapMove(wide, -3, 0, [], canvas, 6, grid).frames.get('a')!.x;
    // 起点 100 本身就是格点，±3px 的抖动必须仍然停在 100（不会跳去 150 或 50）。
    expect([a, b, c]).toEqual([100, 100, 100]);
  });

  it('不传网格 = 老行为（智能参考线）', () => {
    const moving = [{ id: 'a', x: 97, y: 400, w: 40, h: 40 }];
    const others = [{ id: 'b', x: 100, y: 900, w: 40, h: 40 }];
    const r = snapMove(moving, 0, 0, others, canvas, 6, null);
    expect(r.frames.get('a')!.x).toBe(100);
    expect(r.guides.some((g) => g.target === 'b')).toBe(true);
  });

  it('threshold 为 0（按住 Alt）时网格也放行 —— 这是用户的显式「我要自由移动」', () => {
    const moving = [{ id: 'a', x: 97, y: 203, w: 40, h: 40 }];
    const r = snapMove(moving, 0, 0, [], canvas, 0, grid);
    expect(r.frames.get('a')!.x).toBe(97);
    expect(r.guides).toEqual([]);
  });
});

describe('缩放的网格吸附', () => {
  const orig = [{ id: 'a', x: 100, y: 100, w: 200, h: 100 }];

  it('拖右边把手时右边量到格点，左边不动', () => {
    const r = resizeFramesRotated(orig, 'e', 43, 0, 0, {
      keepRatio: false,
      fromCenter: false,
      grid: { x: 50, y: 50 },
    });
    const f = r.get('a')!;
    expect(f.x).toBe(100);
    // 100 + 200 + 43 = 343 → 最近的格点是 350
    expect(f.x + f.w).toBe(350);
  });

  it('拖左边把手时左边量到格点，右边不动', () => {
    const r = resizeFramesRotated(orig, 'w', -43, 0, 0, {
      keepRatio: false,
      fromCenter: false,
      grid: { x: 50, y: 50 },
    });
    const f = r.get('a')!;
    // 100 - 43 = 57 → 50
    expect(f.x).toBe(50);
    expect(f.x + f.w).toBe(300);
  });

  it('上下把手同理', () => {
    const r = resizeFramesRotated(orig, 's', 0, 37, 0, {
      keepRatio: false,
      fromCenter: false,
      grid: { x: 50, y: 50 },
    });
    const f = r.get('a')!;
    expect(f.y).toBe(100);
    expect(f.y + f.h).toBe(250);
  });

  it('Alt 以中心为锚时，对面那条边跟着镜像，仍然都落在格点上', () => {
    const r = resizeFramesRotated(orig, 'e', 43, 0, 0, {
      keepRatio: false,
      fromCenter: true,
      grid: { x: 50, y: 50 },
    });
    const f = r.get('a')!;
    expect(f.x + f.w).toBe(350);
    // 中心 200 不动 ⇒ 左边 = 400 - 350 = 50
    expect(f.x).toBe(50);
  });

  it('不给网格时缩放结果与旧行为逐位相同', () => {
    const a = resizeFramesRotated(orig, 'e', 43, 0, 0, { keepRatio: false, fromCenter: false });
    const b = resizeFramesRotated(orig, 'e', 43, 0, 0, {
      keepRatio: false,
      fromCenter: false,
      grid: null,
    });
    expect(a.get('a')).toEqual(b.get('a'));
  });

  it('吸附把框压塌时仍受 MIN_SIZE 保护（不会出现 0 宽）', () => {
    const thin = [{ id: 'a', x: 100, y: 100, w: 4, h: 4 }];
    const r = resizeFramesRotated(thin, 'e', -7, 0, 0, {
      keepRatio: false,
      fromCenter: false,
      grid: { x: 50, y: 50 },
    });
    const f = r.get('a')!;
    expect(f.w).toBeGreaterThanOrEqual(1);
  });
});
