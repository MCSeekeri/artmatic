/**
 * grid.ts — 画布网格与画幅线框的设置与几何（**纯数据 + 纯函数**）。
 *
 * 两件互不相同的事，放一个模块是因为它们共享同一条吸附通道：
 *  - **画幅线框**：文档边界的参考框。它回答「画面范围多大、元素出画没有」。
 *    吸附目标就是画布的四条边与两条中线 —— 这条早就在 `geometry.ts` 的
 *    `axisTargetsV/H` 里了，本模块只负责「显不显示」。
 *  - **网格**：等距的辅助线。它是**可参数化**的吸附目标（`snapToGrid`），
 *    与「元素对元素」的智能参考线是两条独立的路径。
 *
 * 单位一律是**文档坐标 px**。百分比模式在 `gridSpacing` 里换算一次，
 * 下游（绘制、吸附）只认 px —— 于是「换模式」不会渗进任何几何代码。
 */

import type { Size } from './document';

export type GridMode = 'px' | 'percent';

export interface TypoGridPrefs {
  /** 网格线显示开关。 */
  enabled: boolean;
  /**
   * 吸附到网格。**与显示解耦**：PPT 里可以对齐网格但不显示它，
   * 也可以显示网格却不吸附（拿来当视觉参考）。两者绑死会让人没法只用一半。
   */
  snap: boolean;
  mode: GridMode;
  /** px 模式 = 每格多少像素；percent 模式 = 每格占画幅的百分之多少。 */
  size: number;
  /** 竖线 / 横线可**分别**关闭：排版时经常只需要一个方向的参考。 */
  showX: boolean;
  showY: boolean;
  /** 画幅线框常驻。 */
  frame: boolean;
}

export const GRID_LIMITS = {
  minPx: 4,
  maxPx: 2000,
  minPct: 0.5,
  maxPct: 50,
} as const;

export const DEFAULT_TYPO_GRID: TypoGridPrefs = {
  enabled: false,
  /*
   * ⚠️ **默认必须是 false。**
   *
   * 「吸附网格」是与显示解耦的独立开关，而它的语义是**位置量化**（位置只能落在
   * 格点上、不再与元素/画布参考线竞争）。默认打开的话，每一个用户在还不知道
   * 网格是什么的情况下，拖动就已经被量化到 60px 的格点上了 —— 观感是
   * 「元素只能一格格跳」。实测代价：三条既有的自由拖动 E2E 直接变红。
   *
   * 单独显示网格（enabled）也不该顺手把它打开：两者本来就是两件事
   * （可以看着网格但不吸附）。
   */
  snap: false,
  mode: 'px',
  size: 60,
  showX: true,
  showY: true,
  frame: true,
};

const MODES: GridMode[] = ['px', 'percent'];

/**
 * 归一化来自 localStorage 的值。
 *
 * 单独一个函数而不是内联在 `loadUiPrefs` 里：网格这一坨有 6 个字段，
 * 展开写会让那个函数变成一屏 if —— 而且加字段时最容易漏的就是这里，
 * 漏了的表现是「设置面板里改了，刷新就回去了」。
 */
export function normalizeTypoGrid(v: unknown, baseline: TypoGridPrefs = DEFAULT_TYPO_GRID): TypoGridPrefs {
  const o = (v ?? {}) as Partial<TypoGridPrefs>;
  const mode = MODES.includes(o.mode as GridMode) ? (o.mode as GridMode) : baseline.mode;
  const raw = Number(o.size);
  const size = Number.isFinite(raw) && raw > 0 ? clampSize(raw, mode) : baseline.size;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : baseline.enabled,
    snap: typeof o.snap === 'boolean' ? o.snap : baseline.snap,
    mode,
    size,
    showX: typeof o.showX === 'boolean' ? o.showX : baseline.showX,
    showY: typeof o.showY === 'boolean' ? o.showY : baseline.showY,
    frame: typeof o.frame === 'boolean' ? o.frame : baseline.frame,
  };
}

export function clampSize(size: number, mode: GridMode): number {
  const lim = mode === 'percent'
    ? { lo: GRID_LIMITS.minPct, hi: GRID_LIMITS.maxPct }
    : { lo: GRID_LIMITS.minPx, hi: GRID_LIMITS.maxPx };
  if (!Number.isFinite(size)) return lim.lo;
  return Math.min(lim.hi, Math.max(lim.lo, size));
}

/**
 * 一格在文档坐标里的宽度与高度。
 *
 * 百分比模式下两个轴的**像素间距不同**（画幅不是正方形），这是刻意的：
 * 「每 10% 画幅一格」本来就该得到 10×N 个格子，而不是正方形格子。
 */
export function gridSpacing(g: TypoGridPrefs, size: Size): { x: number; y: number } {
  if (g.mode === 'percent') {
    const k = clampSize(g.size, 'percent') / 100;
    return { x: Math.max(1, size.w * k), y: Math.max(1, size.h * k) };
  }
  const s = clampSize(g.size, 'px');
  return { x: s, y: s };
}

/** 一个轴上所有网格线的位置（不含 0 与终点 —— 那是画幅线框的职责）。 */
export function gridLines(spacing: number, extent: number): number[] {
  if (!(spacing > 1)) return [];
  // 上限 4000 条：size 被钳到最小 4px，1920 宽也就 480 条，这里是防呆。
  const n = Math.min(4000, Math.ceil(extent / spacing) - 1);
  const out: number[] = [];
  for (let i = 1; i <= n; i++) {
    const p = i * spacing;
    // 严格小于：正好落在 extent 上的那条就是画幅边界，不该画第二根线。
    if (p < extent) out.push(p);
  }
  return out;
}

/**
 * 把一个点量化到最近的格点。
 *
 * 这是网格吸附**唯一**的数学：对**目标位置**取整，不是对位移取整。
 * 对位移取整的话，一个本来就偏离格点的元素永远吸不上去 —— 用户看到的是
 * 「开了吸附却没反应」，而且偏移量会被永久保留。
 *
 * 早期版本给每个元素算了 3 个锚点（起/中/末）再取「最近的那条格线」，
 * 实测是「元素乱飞」：宽元素的三个锚点各自离不同的格线最近，哪个胜出完全
 * 取决于毫米级的位移。**一个元素只有一个吸附点**才是可预期的。
 */
export function quantizeToGrid(
  p: { x: number; y: number },
  spacing: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: normZero(spacing.x > 1 ? Math.round(p.x / spacing.x) * spacing.x : p.x),
    y: normZero(spacing.y > 1 ? Math.round(p.y / spacing.y) * spacing.y : p.y),
  };
}

/**
 * 去掉 `-0`。
 *
 * `Math.round(-0.05)` 是 `-0`，而 `-0` 与 `0` 在 `Object.is` 下不相等 ——
 * 于是「元素刚好停在原点」和「停在原点」会被测成两个不同的值。
 * 数值上无害，但这种「看起来一样但不相等」的东西迟早会在某个断言或
 * 缓存键比较里咬人，在源头抹掉最省事。
 */
function normZero(v: number): number {
  return v === 0 ? 0 : v;
}

/** 把一条边的位置量化到格点。缩放吸附用。 */
export function quantizeEdge(v: number, spacing: number): number {
  return spacing > 1 ? normZero(Math.round(v / spacing) * spacing) : v;
}
