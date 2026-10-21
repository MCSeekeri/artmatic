/**
 * path-ops.ts — SVG 路径 ↔ 多边形，以及图形的布尔运算（纯函数）。
 *
 * ## 为什么要经过「多边形」这道手
 *
 * 图形的布尔运算（并 / 差 / 交 / 异或）在**多边形**上有成熟且正确的算法，
 * 而在**带圆弧与贝塞尔的路径**上没有便宜的解法。所以流程是：
 *
 *   路径 d ──parse+flatten──▶ MultiPolygon ──polygon-clipping──▶ MultiPolygon ──serialize──▶ 新的 d
 *
 * 代价是结果变成折线（圆弧被离散成折线）。对一个排版工具的插图来说这是
 * 正确的取舍：**布尔运算的结果本来就是多边形**，用户不会期望它保留弧的精确方程。
 *
 * ## 归一化
 *
 * 结果元素是 `shape: 'svg'`，路径按 **0..100** authored（见 shapes.ts 的
 * `scaleFrom100`）。所以算完要按结果外接框归一化一次 —— 这样元素被拉伸时
 * 路径跟着拉伸，与其它 svg 图形行为一致。
 */

import * as clippingNs from 'polygon-clipping';
import { shapeGeometry } from './shapes';
import type { ShapeElement } from './document';

/** polygon-clipping 的几何类型：[x, y]。 */
export type Pt = [number, number];
/** 一个多边形：外环 + 若干洞。 */
export type Ring = Pt[];
export type Poly = Ring[];
export type MultiPoly = Poly[];

export type BoolOp = 'union' | 'difference' | 'intersection' | 'xor';

/** 曲线 / 圆弧的离散精度（每段最多/最少采样点数）。 */
const MIN_SAMPLES = 8;
const MAX_SAMPLES = 96;
/** 每多少「用户单位」取一个采样点。值越小越精细，路径也越长。 */
const SAMPLE_STEP = 2;

/* ------------------------------------------------------------ 解析 */

/** 命令 → 参数个数。 */
export const ARITY: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

interface Cursor {
  x: number;
  y: number;
  /** 上一段三次 / 二次贝塞尔的控制点，供 S / T 的反射用。 */
  cx: number;
  cy: number;
  qx: number;
  qy: number;
  cmd: string;
}

function samplesFor(len: number): number {
  return Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Math.ceil(len / SAMPLE_STEP)));
}

/** 一般命令的参数：数字之间可以省略分隔符（`1-2`、`.5.5`）。 */
function numberArgs(s: string): number[] {
  return (s.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
}

/**
 * `A` / `a` 的参数串扫描。
 *
 * 弧的两个 flag（large-arc / sweep）在 SVG 语法里是**单个字符**，可以与相邻
 * 数字直接粘连：`a7 7 0 011.412 7.872` 是 rot=0、large=0、sweep=1、x=1.412。
 * 通用数字正则会把 `011.412` 读成一个数（11.412），于是这一组少一个参数 ——
 * **整条弧被丢掉、当前点不推进**，后续的相对命令全体错位。lucide 有大量图标
 * 是 `0 0018.5` 这种写法，全部会偏移几十个单位。
 *
 * 所以这里按「数值 / 数值 / 数值 / flag / flag / 数值 / 数值」的节奏逐字符扫。
 */
function arcArgs(s: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i]!)) i++;
    if (i >= s.length) break;
    const slot = out.length % 7;
    if (slot === 3 || slot === 4) {
      out.push(s[i] === '1' ? 1 : 0);
      i++;
      continue;
    }
    const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(s.slice(i));
    if (!m) {
      i++;
      continue;
    }
    out.push(Number(m[0]));
    i += m[0].length;
  }
  return out;
}

/**
 * 把路径切成 token（含科学计数法与 `1-2` / `.5.5` 这类省略分隔符的写法）。
 *
 * **导出给 `path-nodes.ts` 用**：那边需要同一套词法。抄第二份的话，
 * 「`1-2` 要切成两个数」这类规则迟早有一份会漏掉，表现是「有些路径一编辑就乱」。
 */
export function tokenize(d: string): { cmd: string; args: number[] }[] {
  const out: { cmd: string; args: number[] }[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const upper = m[1]!.toUpperCase();
    out.push({ cmd: m[1]!, args: upper === 'A' ? arcArgs(m[2]!) : numberArgs(m[2]!) });
  }
  return out;
}

/**
 * 路径 → MultiPolygon。
 *
 * 只做**扁平化**（弧与贝塞尔按弦长分段），不做曲线拟合 —— 布尔运算只需要多边形。
 * 每个闭合子路径成为一个 Poly；子路径的**绕向**原样保留（nonzero 填充要靠它区分洞）。
 */
export function pathToMultiPolygon(d: string): MultiPoly {
  const multi: MultiPoly = [];
  let ring: Ring = [];
  const cur: Cursor = { x: 0, y: 0, cx: 0, cy: 0, qx: 0, qy: 0, cmd: 'M' };

  const push = (p: Pt): void => {
    ring.push([round4(p[0]), round4(p[1])]);
  };
  const flush = (): void => {
    // 至少三个点才构成面；顺带去掉与首点重复的尾点（Z 之后再显式回到起点很常见）。
    if (ring.length >= 3) {
      const first = ring[0]!;
      const last = ring[ring.length - 1]!;
      if (first[0] === last[0] && first[1] === last[1]) ring.pop();
    }
    if (ring.length >= 3) multi.push([ring]);
    ring = [];
  };

  for (const { cmd, args } of tokenize(d)) {
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const arity = ARITY[upper] ?? 2;
    // 一个命令可以跟多组参数（`L 1 2 3 4` = 两条线）。
    const groups = arity === 0 ? 1 : Math.max(1, Math.floor(args.length / arity));

    for (let g = 0; g < groups; g++) {
      const a = args.slice(g * arity, g * arity + arity);
      if (arity > 0 && a.length < arity) break;
      const ax = (i: number): number => (rel ? cur.x : 0) + a[i]!;
      const ay = (i: number): number => (rel ? cur.y : 0) + a[i]!;

      switch (upper) {
        case 'M': {
          flush();
          cur.x = ax(0);
          cur.y = ay(1);
          cur.cx = cur.x;
          cur.cy = cur.y;
          cur.qx = cur.x;
          cur.qy = cur.y;
          push([cur.x, cur.y]);
          // 后续参数按 L 处理（SVG 规范）。
          cur.cmd = 'L';
          continue;
        }
        case 'L': {
          cur.x = ax(0);
          cur.y = ay(1);
          push([cur.x, cur.y]);
          break;
        }
        case 'H': {
          cur.x = rel ? cur.x + a[0]! : a[0]!;
          push([cur.x, cur.y]);
          break;
        }
        case 'V': {
          cur.y = rel ? cur.y + a[0]! : a[0]!;
          push([cur.x, cur.y]);
          break;
        }
        case 'C': {
          const x1 = ax(0);
          const y1 = ay(1);
          const x2 = ax(2);
          const y2 = ay(3);
          const x = ax(4);
          const y = ay(5);
          sampleCubic(cur, x1, y1, x2, y2, x, y, push);
          cur.cx = x2;
          cur.cy = y2;
          break;
        }
        case 'S': {
          // 反射上一段三次贝塞尔的控制点；上一段不是 C/S 时反射点就是当前点。
          const reflected =
            cur.cmd === 'C' || cur.cmd === 'S'
              ? [2 * cur.x - cur.cx, 2 * cur.y - cur.cy]
              : [cur.x, cur.y];
          const x2 = ax(0);
          const y2 = ay(1);
          const x = ax(2);
          const y = ay(3);
          sampleCubic(cur, reflected[0]!, reflected[1]!, x2, y2, x, y, push);
          cur.cx = x2;
          cur.cy = y2;
          break;
        }
        case 'Q': {
          const qx = ax(0);
          const qy = ay(1);
          const x = ax(2);
          const y = ay(3);
          sampleQuad(cur, qx, qy, x, y, push);
          cur.qx = qx;
          cur.qy = qy;
          break;
        }
        case 'T': {
          const reflected =
            cur.cmd === 'Q' || cur.cmd === 'T'
              ? [2 * cur.x - cur.qx, 2 * cur.y - cur.qy]
              : [cur.x, cur.y];
          const x = ax(0);
          const y = ay(1);
          sampleQuad(cur, reflected[0]!, reflected[1]!, x, y, push);
          cur.qx = reflected[0]!;
          cur.qy = reflected[1]!;
          break;
        }
        case 'A': {
          const x = ax(5);
          const y = ay(6);
          sampleArc(cur, a[0]!, a[1]!, a[2]!, a[3]! === 1, a[4]! === 1, x, y, push);
          break;
        }
        case 'Z': {
          flush();
          // Z 之后当前点回到子路径起点 —— 起点是刚被 flush 掉的那个 ring 的第一点。
          break;
        }
        default:
          break;
      }
      cur.cmd = upper;
    }
  }
  flush();
  return multi;
}

function round4(v: number): number {
  // 四位小数：布尔运算对重复点很敏感，保留太多噪声会让「看似重合」的边判成不重合。
  return Math.round(v * 10_000) / 10_000;
}

function sampleQuad(
  cur: Cursor,
  qx: number,
  qy: number,
  x: number,
  y: number,
  push: (p: Pt) => void,
): void {
  const approx = Math.hypot(qx - cur.x, qy - cur.y) + Math.hypot(x - qx, y - qy);
  const n = samplesFor(approx);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    push([mt * mt * cur.x + 2 * mt * t * qx + t * t * x, mt * mt * cur.y + 2 * mt * t * qy + t * t * y]);
  }
  cur.x = x;
  cur.y = y;
}

function sampleCubic(
  cur: Cursor,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x: number,
  y: number,
  push: (p: Pt) => void,
): void {
  const approx =
    Math.hypot(x1 - cur.x, y1 - cur.y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2);
  const n = samplesFor(approx);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const dd = t * t * t;
    push([a * cur.x + b * x1 + c * x2 + dd * x, a * cur.y + b * y1 + c * y2 + dd * y]);
  }
  cur.x = x;
  cur.y = y;
}

/**
 * 椭圆弧（SVG 规范 F.6.5 的端点参数化 → 中心参数化）。
 *
 * 三段特例必须先挡掉，否则会在下面算出 NaN：
 *  - 起终点重合 ⇒ 整段弧按规范应当**忽略**；
 *  - rx / ry 为 0 ⇒ 退化成直线；
 *  - 半径过小 ⇒ 按规范等比放大到刚好容下弦长。
 */
function sampleArc(
  cur: Cursor,
  rxIn: number,
  ryIn: number,
  rotDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x: number,
  y: number,
  push: (p: Pt) => void,
): void {
  const x1 = cur.x;
  const y1 = cur.y;
  if (x1 === x && y1 === y) return; // 规范：忽略

  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) {
    push([x, y]);
    cur.x = x;
    cur.y = y;
    return;
  }

  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);

  const dx2 = (x1 - x) / 2;
  const dy2 = (y1 - y) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const k = Math.sqrt(lambda);
    rx *= k;
    ry *= k;
  }

  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const approx = Math.abs(dTheta) * Math.max(rx, ry);
  const n = samplesFor(approx);
  for (let i = 1; i <= n; i++) {
    const t = theta1 + (dTheta * i) / n;
    const px = Math.cos(t) * rx;
    const py = Math.sin(t) * ry;
    push([cx + cosP * px - sinP * py, cy + sinP * px + cosP * py]);
  }
  cur.x = x;
  cur.y = y;
}

/* ------------------------------------------------------------ 序列化 */

export interface MultiPolyBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boundsOfMulti(mp: MultiPoly): MultiPolyBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of mp) {
    for (const ring of poly) {
      for (const p of ring) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** MultiPolygon → SVG path 的 `d`。坐标经 `map` 变换后按 4 位小数输出。 */
export function multiToPath(mp: MultiPoly, map: (p: Pt) => Pt = (p) => p): string {
  const parts: string[] = [];
  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length < 3) continue;
      const pts = ring.map(map);
      parts.push(
        `M${fmt(pts[0]!)}` + pts.slice(1).map((p) => ` L${fmt(p)}`).join('') + ' Z',
      );
    }
  }
  return parts.join(' ');
}

function fmt(p: Pt): string {
  return `${round2(p[0])},${round2(p[1])}`;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/* ------------------------------------------------------------ 布尔运算
 *
 * ⚠️ **`polygon-clipping@0.15.7` 的类型声明与 ESM 产物不一致**：
 * `.d.ts` 声明的是具名导出（`union` / `difference` / `intersection` / `xor`），
 * 而 `dist/polygon-clipping.esm.js` 只有 `export { index as default }`。
 *
 * 后果非常阴：`import { union } from 'polygon-clipping'` 在 vitest 里能过
 * （它走 CJS 的 `main`，interop 出一套具名导出），**但打进浏览器就是
 * `(void 0) is not a function`** —— 单元测试全绿、按钮点了没反应。
 * 所以这里统一从 default 取，两条解析路径都覆盖；缺 default 时回落到命名空间对象。
 */
interface ClippingModule {
  union(...geoms: MultiPoly[]): MultiPoly;
  difference(...geoms: MultiPoly[]): MultiPoly;
  intersection(...geoms: MultiPoly[]): MultiPoly;
  xor(...geoms: MultiPoly[]): MultiPoly;
}

const clip = ((clippingNs as unknown as { default?: ClippingModule }).default ??
  (clippingNs as unknown as ClippingModule)) as ClippingModule;

export function booleanOp(op: BoolOp, polys: MultiPoly[]): MultiPoly {
  if (polys.length === 0) return [];
  const [first, ...rest] = polys as [MultiPoly, ...MultiPoly[]];
  if (!rest.length) return first;
  switch (op) {
    case 'union':
      return clip.union(first, ...rest);
    case 'difference':
      return clip.difference(first, ...rest);
    case 'intersection':
      return clip.intersection(first, ...rest);
    case 'xor':
      return clip.xor(first, ...rest);
    default:
      return first;
  }
}

/** 拆分得到的一个面：区域本身 + 覆盖它的输入里**最靠上**的那一个（样式来源）。 */
export interface DividedRegion {
  mp: MultiPoly;
  top: number;
}

/**
 * 拆分（分割 / divide）：把输入图形按彼此的边界切成**互不重叠的面**，
 * 每个面作为一个独立的多边形。
 *
 * 与 `xor` 的区别是本质的：`xor` 只保留「恰好被奇数个图形覆盖」的区域，
 * 两个图形相减的结果是**一个带洞的多边形**（洞就是重叠部分）—— 重叠区域
 * 仍然是一片空白、不是对象。拆分要的是「每个面都成为对象」：A−B、A∩B、
 * B−A 三块各自独立。所以不能直接调 `clip.xor`。
 *
 * ## 增量法而不是枚举子集
 *
 * 朴素做法是枚举所有覆盖组合（2^N 个），N 稍大就爆炸。这里按 z 序一个个
 * 加进来：每个已有面被新图形切成「相交」与「不相交」两份（cover 集分别
 * 追加 / 保持不变），新图形里没被任何已有面覆盖的部分单独成一块。
 * 整个过程只在**真正存在的面**上做布尔运算，区域数就是图形边界的实际
 * 排列数（N 个矩形最多 O(N²)），不会出现 2^N 个空集。
 *
 * **cover 里最后加入的下标就是最靠上的来源**：输入按 z 序（底 → 顶）传入，
 * 每个面的样式取「最后一笔盖在它上面的那个图形」，与所见一致。
 */
export function dividePolygons(polys: readonly MultiPoly[]): DividedRegion[] {
  let regions: { mp: MultiPoly; cover: number[] }[] = [];

  polys.forEach((shape, index) => {
    if (!shape.length) return;
    const next: { mp: MultiPoly; cover: number[] }[] = [];
    for (const region of regions) {
      const inside = clip.intersection(region.mp, shape);
      if (inside.length) next.push({ mp: inside, cover: [...region.cover, index] });
      const outside = clip.difference(region.mp, shape);
      if (outside.length) next.push({ mp: outside, cover: region.cover });
    }
    // 新图形的「净增面积」：减掉所有已有面之后剩下的部分。
    let fresh = shape;
    for (const region of regions) {
      fresh = clip.difference(fresh, region.mp);
      if (!fresh.length) break;
    }
    if (fresh.length) next.push({ mp: fresh, cover: [index] });
    regions = next;
  });

  return regions.map((r) => ({ mp: r.mp, top: r.cover[r.cover.length - 1]! }));
}

/**
 * 一个图形元素 → **文档坐标**下的 MultiPolygon。
 *
 * 旋转（`frame.rot`）**不参与**：布尔运算在未旋转的框里做。旋转后再做布尔
 * 需要先把两边都烘焙成旋转后的多边形，那会让结果的「框」不再是轴对齐的，
 * 而本项目的 frame 只支持轴对齐 + 一个角度。取舍：结果不带旋转，
 * 想要旋转的图形请先解组再单独转。
 */
export function shapeToMultiPolygon(el: ShapeElement): MultiPoly {
  const geo = shapeGeometry(el.shape, {
    w: el.frame.w,
    h: el.frame.h,
    radius: el.radius,
    sides: el.sides,
    waist: el.waist,
    inner: el.inner,
    angle: el.angle,
    path: el.path,
    pathUnit: el.pathUnit,
    evenOdd: el.evenOdd,
  });
  const local = pathToMultiPolygon(geo.d);
  // authored 0..100 的图形要先乘回元素尺寸，再平移到文档坐标。
  const kx = geo.scaleFrom100 ? el.frame.w / 100 : 1;
  const ky = geo.scaleFrom100 ? el.frame.h / 100 : 1;
  const ox = el.frame.x;
  const oy = el.frame.y;
  return local.map((poly) =>
    poly.map((ring) => ring.map((p): Pt => [ox + p[0] * kx, oy + p[1] * ky])),
  );
}

/** 元素在**文档坐标**下的覆盖多边形（缩放成 0..100 authored 之前）。 */
export function multiToShape(mp: MultiPoly): { path: string; frame: MultiPolyBounds } | null {
  const b = boundsOfMulti(mp);
  if (!b || b.w <= 0 || b.h <= 0) return null;
  const kx = 100 / b.w;
  const ky = 100 / b.h;
  const path = multiToPath(mp, (p) => [(p[0] - b.x) * kx, (p[1] - b.y) * ky]);
  if (!path) return null;
  return { path, frame: b };
}

/* ------------------------------------------------------------ 测试辅助 */

/** 有向面积（外环逆时针为正）。用来断言「结果确实有这么大」。 */
export function signedArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** 总面积（洞被扣掉 —— 洞的绕向与外环相反）。 */
export function totalArea(mp: MultiPoly): number {
  let s = 0;
  for (const poly of mp) for (const ring of poly) s += signedArea(ring);
  return Math.abs(s);
}
