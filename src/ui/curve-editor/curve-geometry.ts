/**
 * curve-geometry.ts — 曲线编辑器的坐标映射与路径生成（纯函数，可单测）。
 *
 * 所有函数都在 **SVG viewBox 坐标** 里工作，不碰 DOM、不读 devicePixelRatio：
 * 组件用一个固定的 viewBox + CSS 缩放，指针坐标先按 boundingRect 归一化再乘回
 * viewBox —— 于是「窗口变大」「浏览器缩放」都不会让命中判定跑偏。
 *
 * 时间轴用**绝对时间**（秒，与 Project 同一口径）。关键帧自己的 `t` 是相对
 * 片段起点 / 锚定拍的，转换在组件里一次完成；这里只画、不算语义。
 */

import { evalKeyframes, type Key } from '../../core/curve';

export interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GraphDomain {
  t0: number;
  t1: number;
  v0: number;
  v1: number;
}

const MIN_TIME_SPAN = 0.05;
const MIN_VALUE_SPAN = 1e-4;

/**
 * 把「片段范围 + 参数范围」这个初值扩大到装得下全部关键帧。
 *
 * 只在关键帧真的越界时才扩：参数表给的 0..1（不透明度）是用户心里的量纲，
 * 无条件加 padding 会把轴画到 -0.06..1.06，看起来像哪里错了。
 */
export function fitDomain(
  keys: readonly { t: number; v: number }[],
  seed: GraphDomain,
): GraphDomain {
  let t0 = seed.t0;
  let t1 = seed.t1;
  let v0 = seed.v0;
  let v1 = seed.v1;
  for (const k of keys) {
    if (!Number.isFinite(k.t) || !Number.isFinite(k.v)) continue;
    if (k.t < t0) t0 = k.t;
    if (k.t > t1) t1 = k.t;
    if (k.v < v0) v0 = k.v;
    if (k.v > v1) v1 = k.v;
  }
  if (t1 - t0 < MIN_TIME_SPAN) {
    const mid = (t0 + t1) / 2;
    t0 = mid - MIN_TIME_SPAN / 2;
    t1 = mid + MIN_TIME_SPAN / 2;
  }
  if (v1 - v0 < MIN_VALUE_SPAN) {
    const mid = (v0 + v1) / 2;
    v0 = mid - MIN_VALUE_SPAN / 2;
    v1 = mid + MIN_VALUE_SPAN / 2;
  }
  // 关键帧（菱形半径 ~5px）压在画框边缘时会被裁掉一半，所以两端都留一点空。
  const tp = (t1 - t0) * 0.02;
  const vp = (v1 - v0) * 0.06;
  return { t0: t0 - tp, t1: t1 + tp, v0: v0 - vp, v1: v1 + vp };
}

export function xOfTime(t: number, d: GraphDomain, box: PlotBox): number {
  return box.left + ((t - d.t0) / (d.t1 - d.t0)) * box.width;
}

export function yOfValue(v: number, d: GraphDomain, box: PlotBox): number {
  return box.top + (1 - (v - d.v0) / (d.v1 - d.v0)) * box.height;
}

export function timeOfX(x: number, d: GraphDomain, box: PlotBox): number {
  return d.t0 + ((x - box.left) / box.width) * (d.t1 - d.t0);
}

export function valueOfY(y: number, d: GraphDomain, box: PlotBox): number {
  return d.v0 + (1 - (y - box.top) / box.height) * (d.v1 - d.v0);
}

/** 采样点数：段内足够多，肉眼分不出折线；固定值保证渲染确定性（同一数据同路径）。 */
export const CURVE_SAMPLES = 24;

/**
 * 一条曲线的 SVG path。
 *
 * `step` 段必须画成直角折线（先水平、再在下一个 key 处竖直跳变）—— 这是
 * 「插值改了有没有生效」唯一肉眼可见的证据。其余段按采样画。
 *
 * 第一个 key 之前与最后一个 key 之后是水平线：`evalKeyframes` 在两端做钳制，
 * 编辑器必须画得和它一致，否则用户会以为那两段也有动画。
 */
export function curvePath(
  keys: readonly Key[],
  d: GraphDomain,
  box: PlotBox,
  samples = CURVE_SAMPLES,
): string {
  if (keys.length === 0) return '';
  const x = (t: number) => xOfTime(t, d, box);
  const y = (v: number) => yOfValue(v, d, box);
  const valueAt = (t: number) => evalKeyframes(keys as Key[], t);

  /*
   * 只按**域内**的 key 切段，域外的 key 交给 `evalKeyframes` 与端点钳制。
   *
   * 这与旧实现等价（编辑器的域总是包住全部 key），但时间轴片段用的是
   * 「片段范围」而不是「全部 key 的范围」：一段被 trim 过的片段，关键帧
   * 常常在片段外面 —— 旧写法会先画到域外的 key 再连线，片段内的形状是错的。
   */
  const bounds: number[] = [];
  for (const k of keys) {
    if (k.t > d.t0 + 1e-9 && k.t < d.t1 - 1e-9) bounds.push(k.t);
  }
  bounds.push(d.t1);

  let out = `M ${x(d.t0).toFixed(2)} ${y(valueAt(d.t0)).toFixed(2)}`;
  let from = d.t0;
  for (const to of bounds) {
    if (to <= from + 1e-9) continue;
    if (from > d.t0 + 1e-9) {
      // 段起点。上一段是 step 时，这一句正好补出竖直跳变。
      out += ` L ${x(from).toFixed(2)} ${y(valueAt(from)).toFixed(2)}`;
    }
    const a = keyAtOrBefore(keys, from);
    if (a?.interp === 'step') {
      out += ` L ${x(to).toFixed(2)} ${y(valueAt(from)).toFixed(2)}`;
    } else {
      for (let s = 1; s <= samples; s += 1) {
        const t = from + ((to - from) * s) / samples;
        out += ` L ${x(t).toFixed(2)} ${y(valueAt(t)).toFixed(2)}`;
      }
    }
    from = to;
  }
  // 末端精确钳到最后一个 key 的值（`to` 可能正好落在 key 上）。
  out += ` L ${x(d.t1).toFixed(2)} ${y(valueAt(d.t1)).toFixed(2)}`;
  return out;
}

/** 最后一个 `t <= at` 的 key（二分；keys 已按 t 升序）。 */
function keyAtOrBefore(keys: readonly Key[], at: number): Key | null {
  let lo = 0;
  let hi = keys.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.t <= at + 1e-9) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 ? keys[found]! : null;
}

/**
 * 时间轴片段上的迷你曲线。
 *
 * `keys` 必须是**绝对时间**（调用方已经加上 beatAnchor / 片段起点），
 * `start` / `end` 是片段的绝对起止。x 轴只映射片段范围 —— 片段外的 key
 * 仍参与求值（曲线进入片段时的值必须正确），只是画在视口外被裁掉。
 *
 * 与编辑器共用 `curvePath`，所以 step 的直角、smooth / bezier 的形状在片段
 * 上和在编辑器里完全一致。值域会扩到包住所有 key，避免过冲被裁平。
 */
export function clipCurvePath(
  keys: Key[],
  start: number,
  end: number,
  min: number,
  max: number,
  box: PlotBox,
): string {
  if (keys.length === 0 || !(end > start)) return '';
  let v0 = Math.min(min, max);
  let v1 = Math.max(min, max);
  for (const k of keys) {
    if (k.v < v0) v0 = k.v;
    if (k.v > v1) v1 = k.v;
  }
  if (v1 - v0 < 1e-6) {
    v0 -= 1;
    v1 += 1;
  }
  return curvePath(keys, { t0: start, t1: end, v0, v1 }, box);
}

/** 把曲线路径闭合成「曲线下方全部填充」的区域。 */
export function curveAreaPath(path: string, box: PlotBox): string {
  if (!path) return '';
  const bottom = box.top + box.height;
  const right = box.left + box.width;
  return `${path} L ${right} ${bottom} L ${box.left} ${bottom} Z`;
}

/** 关键帧菱形（中心 x/y，半径 r）。 */
export function diamondPath(x: number, y: number, r = 4.5): string {
  return `M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 时间吸附到帧；`frame` 是秒（1/fps）。 */
export function snapToFrame(t: number, frame: number): number {
  if (!(frame > 1e-9)) return t;
  return Math.round(t / frame) * frame;
}
