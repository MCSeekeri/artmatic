/**
 * geometry.ts — 排版编辑器的几何纯函数（**不碰 DOM**）。
 *
 * 全部是纯函数：输入定值、输出新值，不读全局、不依赖时间。
 * 手势层（ui/typography/gestures.ts）只负责把指针位移喂进来、把结果写进 store。
 *
 * 一条刻意的简化：吸附与对齐都用元素的**未旋转外接框**（frame 的 x/y/w/h），
 * 忽略 frame.rot。旋转后的 AABB 会让「对齐到中线」的语义变得难以预测
 * （用户看到的是框，不是外接矩形），PPT / Keynote 同样按未旋转框对齐。
 */

import type { Size } from './document';

export interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 智能参考线的吸附阈值（屏幕 px）。 */
export const SNAP_PX = 6;

/** 缩放时的最小尺寸（文档 px）。框塌成 0 之后所有比例都是 NaN。 */
export const MIN_SIZE = 1;

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export type AlignAxis =
  | 'left'
  | 'center-h'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'
  | 'distribute-h'
  | 'distribute-v';

export interface Guide {
  axis: 'v' | 'h';
  pos: number;
  kind: 'edge' | 'center';
  /** 'canvas' 或元素 id。 */
  target: 'canvas' | string;
}

export interface SnapResult {
  /** 吸附后的位置（未吸附就是原位置 + 位移）。 */
  frames: Map<string, Rect>;
  guides: Guide[];
}

/* ------------------------------------------------------------ 基础 */

export function boundsOf(rects: Rect[]): Rect {
  if (rects.length === 0) return { id: '', x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  }
  return { id: '', x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectsIntersect(a: { x: number; y: number; w: number; h: number }, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** 元素 → 未旋转外接框。调用方保证顺序即 z 序。 */
export function toRects(
  elements: { id: string; frame: { x: number; y: number; w: number; h: number } }[],
): Rect[] {
  return elements.map((e) => ({ id: e.id, x: e.frame.x, y: e.frame.y, w: e.frame.w, h: e.frame.h }));
}

/**
 * 命中测试：返回点下最上层（z 序最靠后）的元素框。
 *
 * 用几何而不是 DOM 事件做命中，理由有两个：
 *  1. 文档元素在 CSS 里是 `pointer-events: none`（同一份样式要同时服务光栅化，
 *     那边不该有任何交互语义），靠 DOM 事件根本收不到；
 *  2. 拖拽、框选、吸附本来就要算几何，命中走同一条路才不会出现
 *     「点得中但拖不动」这类不一致。
 */
export function hitTest(rects: Rect[], x: number, y: number): Rect | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i]!;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
  }
  return null;
}

/* ------------------------------------------------------------ 吸附 */

interface AxisTarget {
  pos: number;
  kind: 'edge' | 'center';
  target: 'canvas' | string;
}

function axisTargetsV(others: Rect[], canvas: Size): AxisTarget[] {
  const out: AxisTarget[] = [
    { pos: 0, kind: 'edge', target: 'canvas' },
    { pos: canvas.w / 2, kind: 'center', target: 'canvas' },
    { pos: canvas.w, kind: 'edge', target: 'canvas' },
  ];
  for (const o of others) {
    out.push({ pos: o.x, kind: 'edge', target: o.id });
    out.push({ pos: o.x + o.w / 2, kind: 'center', target: o.id });
    out.push({ pos: o.x + o.w, kind: 'edge', target: o.id });
  }
  return out;
}

function axisTargetsH(others: Rect[], canvas: Size): AxisTarget[] {
  const out: AxisTarget[] = [
    { pos: 0, kind: 'edge', target: 'canvas' },
    { pos: canvas.h / 2, kind: 'center', target: 'canvas' },
    { pos: canvas.h, kind: 'edge', target: 'canvas' },
  ];
  for (const o of others) {
    out.push({ pos: o.y, kind: 'edge', target: o.id });
    out.push({ pos: o.y + o.h / 2, kind: 'center', target: o.id });
    out.push({ pos: o.y + o.h, kind: 'edge', target: o.id });
  }
  return out;
}

/**
 * 按某个轴求最佳吸附位移。
 * 被拖集合取 3 个锚点（左/中/右），对每个锚点找最近的候选线，全局取差值最小者。
 */
function snapAxis(
  anchors: number[],
  kinds: ('edge' | 'center')[],
  targets: AxisTarget[],
  threshold: number,
): { delta: number; hits: AxisTarget[] } {
  let best: { delta: number; abs: number; pos: number } | null = null;

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]!;
    for (const t of targets) {
      const d = t.pos - a;
      const abs = Math.abs(d);
      if (abs > threshold) continue;
      if (!best || abs < best.abs) best = { delta: d, abs, pos: t.pos };
    }
  }
  if (!best) return { delta: 0, hits: [] };

  // 同一位置上可能同时命中画布和多条元素线 —— 全部画出来，用户才知道对齐到谁。
  const hits = targets.filter((t) => Math.abs(t.pos - best!.pos) < 1e-6);
  return { delta: best.delta, hits };
}

/**
 * 拖动吸附。返回吸附后的位置与应当显示的参考线。
 *
 * threshold 为 0 表示不吸附（按住 Alt 关吸附时用），此时返回原位移。
 */
export function snapMove(
  moving: Rect[],
  dx: number,
  dy: number,
  others: Rect[],
  canvas: Size,
  threshold: number,
): SnapResult {
  const moved = moving.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
  if (threshold <= 0 || moved.length === 0) {
    return { frames: new Map(moved.map((r) => [r.id, r])), guides: [] };
  }

  const b = boundsOf(moved);
  const xRes = snapAxis(
    [b.x, b.x + b.w / 2, b.x + b.w],
    ['edge', 'center', 'edge'],
    axisTargetsV(others, canvas),
    threshold,
  );
  const yRes = snapAxis(
    [b.y, b.y + b.h / 2, b.y + b.h],
    ['edge', 'center', 'edge'],
    axisTargetsH(others, canvas),
    threshold,
  );

  const guides: Guide[] = [];
  for (const hit of xRes.hits) guides.push({ axis: 'v', pos: hit.pos, kind: hit.kind, target: hit.target });
  for (const hit of yRes.hits) guides.push({ axis: 'h', pos: hit.pos, kind: hit.kind, target: hit.target });

  const frames = new Map<string, Rect>();
  for (const r of moved) frames.set(r.id, { ...r, x: r.x + xRes.delta, y: r.y + yRes.delta });
  return { frames, guides };
}

/* ------------------------------------------------------------ 对齐 / 分布 */

/** 逐个元素相对 target 框对齐。返回新位置（只动相关的那一个轴）。 */
export function alignElements(
  rects: Rect[],
  target: Rect,
  axis: AlignAxis,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (axis === 'distribute-h' || axis === 'distribute-v') return out;

  for (const r of rects) {
    let x = r.x;
    let y = r.y;
    switch (axis) {
      case 'left':
        x = target.x;
        break;
      case 'center-h':
        x = target.x + (target.w - r.w) / 2;
        break;
      case 'right':
        x = target.x + target.w - r.w;
        break;
      case 'top':
        y = target.y;
        break;
      case 'middle':
        y = target.y + (target.h - r.h) / 2;
        break;
      case 'bottom':
        y = target.y + target.h - r.h;
        break;
    }
    out.set(r.id, { x, y });
  }
  return out;
}

/**
 * 等间距分布。**首尾不动**，把中间的元素在两者之间排匀（等间隙，不是等中心距）。
 * 少于 3 个元素时无意义，返回空 Map。
 */
export function distribute(rects: Rect[], axis: 'h' | 'v'): Map<string, number> {
  const out = new Map<string, number>();
  if (rects.length < 3) return out;

  const key = axis === 'h' ? 'x' : 'y';
  const size = axis === 'h' ? 'w' : 'h';
  const sorted = [...rects].sort((a, b) => a[key] - b[key]);

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = last[key] + last[size] - first[key];
  let used = 0;
  for (const r of sorted) used += r[size];
  const gap = (span - used) / (sorted.length - 1);

  let cursor = first[key] + first[size] + gap;
  for (let i = 1; i < sorted.length - 1; i++) {
    const r = sorted[i]!;
    out.set(r.id, cursor);
    cursor += r[size] + gap;
  }
  return out;
}

/* ------------------------------------------------------------ 缩放 / 旋转 */

export interface ScaleOptions {
  /** Shift：保持比例。 */
  keepRatio: boolean;
  /** Alt：以选区中心为锚。 */
  fromCenter: boolean;
}

/**
 * 拖动把手缩放整个选区。
 *
 * 实现方式是「先把选区外接框算出新框，再把每个元素按同一比例映射进去」——
 * 这样多选时元素之间的相对间距也会一同缩放，符合设计工具的直觉。
 *
 * 比例钳到正值：负数会让所有元素翻转，而 frame 结构里没有「翻转」这个语义。
 */
export function scaleFrames(
  orig: Rect[],
  handle: HandleId,
  dx: number,
  dy: number,
  opts: ScaleOptions,
): Map<string, Rect> {
  const b0 = boundsOf(orig);
  const passthrough = () => new Map(orig.map((r) => [r.id, { ...r }]));
  if (orig.length === 0 || b0.w <= 0 || b0.h <= 0) return passthrough();

  const west = handle === 'nw' || handle === 'w' || handle === 'sw';
  const east = handle === 'ne' || handle === 'e' || handle === 'se';
  const north = handle === 'nw' || handle === 'n' || handle === 'ne';
  const south = handle === 'sw' || handle === 's' || handle === 'se';

  let x0 = b0.x;
  let y0 = b0.y;
  let x1 = b0.x + b0.w;
  let y1 = b0.y + b0.h;

  if (west) {
    x0 += dx;
    if (opts.fromCenter) x1 -= dx;
  }
  if (east) {
    x1 += dx;
    if (opts.fromCenter) x0 -= dx;
  }
  if (north) {
    y0 += dy;
    if (opts.fromCenter) y1 -= dy;
  }
  if (south) {
    y1 += dy;
    if (opts.fromCenter) y0 -= dy;
  }

  // 先防塌陷（框跑到另一边去了），再算比例。
  if (x1 - x0 < MIN_SIZE) {
    if (west) x0 = x1 - MIN_SIZE;
    else x1 = x0 + MIN_SIZE;
  }
  if (y1 - y0 < MIN_SIZE) {
    if (north) y0 = y1 - MIN_SIZE;
    else y1 = y0 + MIN_SIZE;
  }

  let kx = (x1 - x0) / b0.w;
  let ky = (y1 - y0) / b0.h;

  if (opts.keepRatio) {
    // 角把手用「变化更大」的那个轴做主导；边把手只有唯一可用的轴。
    const onlyX = (west || east) && !(north || south);
    const onlyY = (north || south) && !(west || east);
    const k = onlyX ? kx : onlyY ? ky : Math.abs(kx) > Math.abs(ky) ? kx : ky;
    kx = k;
    ky = k;
  }

  kx = Math.max(kx, MIN_SIZE / b0.w);
  ky = Math.max(ky, MIN_SIZE / b0.h);

  const newW = b0.w * kx;
  const newH = b0.h * ky;

  // 由锚点重算左上角：Alt 锚中心，否则锚在不动的那个边。
  const outX = opts.fromCenter ? b0.x + b0.w / 2 - newW / 2 : west ? x1 - newW : x0;
  const outY = opts.fromCenter ? b0.y + b0.h / 2 - newH / 2 : north ? y1 - newH : y0;

  const out = new Map<string, Rect>();
  for (const r of orig) {
    out.set(r.id, {
      ...r,
      x: outX + (r.x - b0.x) * kx,
      y: outY + (r.y - b0.y) * ky,
      w: r.w * kx,
      h: r.h * ky,
    });
  }
  return out;
}

/**
 * 绕 center 旋转各元素的**中心**，返回新的左上角。
 *
 * 调用方还要把同一个 deltaRad 加到每个元素的 frame.rot 上 —— 只改位置会得到
 * 「框绕着转但内容不转」的错误结果。两者合起来才是刚体旋转。
 */
export function rotateFrames(
  orig: Rect[],
  center: { x: number; y: number },
  deltaRad: number,
): Map<string, { x: number; y: number }> {
  const cos = Math.cos(deltaRad);
  const sin = Math.sin(deltaRad);
  const out = new Map<string, { x: number; y: number }>();
  for (const r of orig) {
    const cx = r.x + r.w / 2 - center.x;
    const cy = r.y + r.h / 2 - center.y;
    const nx = cx * cos - cy * sin + center.x;
    const ny = cx * sin + cy * cos + center.y;
    out.set(r.id, { x: nx - r.w / 2, y: ny - r.h / 2 });
  }
  return out;
}

/** 把向量按弧度旋转。 */
export function rotateVec(v: { x: number; y: number }, rad: number): { x: number; y: number } {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/**
 * 在**元素自身的坐标系**里缩放。
 *
 * 为什么需要单独一个函数：`scaleFrames` 是轴对齐的 —— 它把位移当作世界坐标轴
 * 上的 dx/dy。元素一旦转了角度，把手在屏幕上指向的方向就不再是世界 x/y 轴，
 * 直接喂世界位移会得到「拖右边结果它往斜上方长」这种结果。
 *
 * 做法：
 *  1. 把各框平移到以选区中心为原点（平移不改变缩放比例，锚点逻辑依然成立）；
 *  2. 把世界位移**反向旋转**进本地坐标系，交给 `scaleFrames`；
 *  3. 得到的本地框，其中心按 rot **正向旋转**回世界，就是新的世界中心。
 *
 * rot === 0 时退化成与直接用 `scaleFrames` 完全一致的结果（有单测钉着）。
 */
export function resizeFramesRotated(
  orig: Rect[],
  handle: HandleId,
  dx: number,
  dy: number,
  rot: number,
  opts: ScaleOptions,
): Map<string, Rect> {
  const b0 = boundsOf(orig);
  const center = { x: b0.x + b0.w / 2, y: b0.y + b0.h / 2 };
  const local = orig.map((r) => ({ ...r, x: r.x - center.x, y: r.y - center.y }));

  const d = rotateVec({ x: dx, y: dy }, -rot);
  const scaled = scaleFrames(local, handle, d.x, d.y, opts);

  const out = new Map<string, Rect>();
  for (const [id, r] of scaled) {
    // 本地框的中心（相对旧中心），转回世界后加上原中心。
    const c = rotateVec({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, rot);
    out.set(id, { id, w: r.w, h: r.h, x: center.x + c.x - r.w / 2, y: center.y + c.y - r.h / 2 });
  }
  return out;
}

/** 旋转把手吸附：Shift 时吸到 15° 的整数倍。 */
export function snapAngle(rad: number, enabled: boolean): number {
  if (!enabled) return rad;
  const step = (Math.PI / 180) * 15;
  return Math.round(rad / step) * step;
}
