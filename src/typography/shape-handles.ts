/**
 * shape-handles.ts — **参数化图形的控制点**（纯函数）。
 *
 * 这里是「把这个图形的一个可调参数画成一个可以拖的把手」的全部逻辑。
 * 与顶点编辑（`path-nodes.ts`）是两条独立的路：
 *
 *  - 控制点改的是**参数**（圆角 / 谷半径 / 壁厚 / 张角），图形本身仍是参数化的，
 *    改尺寸时形状按公式重算 —— 这是「实时形状」的行为；
 *  - 顶点编辑改的是**路径数据**，改完形状就固定了。
 *
 * 两者共用一个 overlay 组件，但数据层不共用：把参数也拍平成路径的话，
 * 「拖完圆角之后把矩形拉宽，圆角跟着变形」这条实时形状的好处就没了。
 *
 * ## 坐标
 *
 * 一律是**元素局部像素坐标**（原点 = frame 左上角、未旋转）。与文档坐标的
 * 换算在调用方（`geometry.ts` 的 `localToDoc` / `docToLocal`）。
 *
 * ## 为什么把手带一个 `read` 闭包
 *
 * 「把手在哪」和「拖到某处对应什么参数值」必须是**同一个映射的正反两面**。
 * 拆成两个函数、各自算一遍几何的话，改了其中一个（比如星形内顶点的角度公式）
 * 另一个不会跟着变，症状是「拖这个把手，参数乱跳」。
 */

import type { MessageKey } from '../i18n/locales';
import type { ShapeElement } from './document';
import { shapeParamSupport, shapeVertexRing, type ShapeBox } from './shapes';

export interface Vec {
  x: number;
  y: number;
}

export type ShapeParamKey = 'radius' | 'waist' | 'inner' | 'angle';

export interface ShapeHandle {
  /** 等于 `param`：每类参数最多一个把手。 */
  id: ShapeParamKey;
  /** 局部像素坐标。 */
  x: number;
  y: number;
  param: ShapeParamKey;
  labelKey: MessageKey;
  /**
   * 指针位置 → 参数值。
   *
   * `origin` / `start` 是**按下时**的指针位置与参数值。用差值而不是绝对位置，
   * 是因为把手在参数为 0 时会被推离锚点一个固定距离（否则它和缩放把手重叠）——
   * 绝对映射会让「刚按下就跳到那个距离对应的值」。
   */
  read: (localPt: Vec, origin: Vec, start: number) => number;
}

/** 参数为 0 时把手离锚点的最小距离（局部坐标 = 文档 px）。 */
const MIN_OFFSET = 14;

/** 圆角把手：**第一个顶点**沿「指向质心」方向偏移。 */
function radiusHandle(
  ring: Vec[],
  radius: number,
  shortSide: number,
): { at: Vec; vertex: Vec; dir: Vec } | null {
  if (ring.length < 3) return null;
  const vertex = ring[0]!;
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length;
  cy /= ring.length;
  const len = Math.hypot(cx - vertex.x, cy - vertex.y);
  if (len < 1e-6) return null;
  const dir = { x: (cx - vertex.x) / len, y: (cy - vertex.y) / len };
  // 小图形上不能推得太远（14px 在一个 30px 的三角形里就跑到对面去了）。
  const off = Math.max(radius, Math.min(MIN_OFFSET, shortSide * 0.25));
  return { at: { x: vertex.x + dir.x * off, y: vertex.y + dir.y * off }, vertex, dir };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function shapeBoxOf(el: ShapeElement): ShapeBox {
  return {
    w: el.frame.w,
    h: el.frame.h,
    radius: el.radius,
    sides: el.sides,
    waist: el.waist,
    inner: el.inner,
    angle: el.angle,
    path: el.path,
  };
}

/**
 * 某个参数的**当前生效值**（缺省值与 `shapes.ts` 里各图形的缺省口径一致）。
 *
 * 拖动开始时要拿它当差值的零点。写成两份（这里有、手势里有）的话，星形缺省
 * 谷半径从 0.4 改成别的值时，只有一份会跟着变 —— 症状是「按下还没动，
 * 参数先跳一下」。
 */
export function shapeParamValue(el: ShapeElement, param: ShapeParamKey): number {
  const w = Math.max(1, el.frame.w);
  const h = Math.max(1, el.frame.h);
  const short = Math.min(w, h);
  switch (param) {
    case 'radius':
      return Math.max(0, el.radius ?? 0);
    case 'waist':
      return clamp(el.waist ?? 0.4, 0.05, 0.98);
    case 'inner':
      if (el.shape === 'ring') return el.inner ?? (Math.min(w, h) / 2) * 0.18;
      return clamp(el.inner ?? short * 0.1, 1, short / 2 - 1);
    case 'angle':
      return clamp(el.angle ?? 270, 1, 360);
  }
}

/** 按参数键写进元素。参数名与 `ShapeElement` 的字段一一对应，所以只此一处。 */
export function applyShapeParam(el: ShapeElement, param: ShapeParamKey, value: number): void {
  if (param === 'radius') el.radius = value;
  else el[param] = value;
}

/**
 * 当前图形的全部控制点。空数组 = 这个图形没有可拖的参数（椭圆 / 直线 / 自定义路径）。
 */
export function shapeHandles(el: ShapeElement): ShapeHandle[] {
  // 自定义路径没有参数可言（它的形状就是那串数据），控制点由顶点编辑负责。
  if (el.shape === 'svg') return [];

  const box = shapeBoxOf(el);
  const w = Math.max(1, el.frame.w);
  const h = Math.max(1, el.frame.h);
  const cx = w / 2;
  const cy = h / 2;
  const support = shapeParamSupport(el.shape);
  const out: ShapeHandle[] = [];

  if (support.radius) {
    const rh = radiusHandle(shapeVertexRing(el.shape, box), shapeParamValue(el, 'radius'), Math.min(w, h));
    if (rh) {
      out.push({
        id: 'radius',
        x: rh.at.x,
        y: rh.at.y,
        param: 'radius',
        labelKey: 'rib.radius',
        read: (pt, origin, start) => {
          // 沿对角线的**投影**：横向乱拖不会把圆角带跑。
          const proj = (p: Vec): number =>
            (p.x - rh.vertex.x) * rh.dir.x + (p.y - rh.vertex.y) * rh.dir.y;
          return clamp(start + (proj(pt) - proj(origin)), 0, Math.min(w, h) / 2);
        },
      });
    }
  }

  if (support.waist) {
    const sides = Math.max(3, Math.round(el.sides ?? 5));
    const waist = shapeParamValue(el, 'waist');
    // 内顶点（`starPoints` 的下标 1）所在的角度。
    const a = Math.PI / sides - Math.PI / 2;
    out.push({
      id: 'waist',
      x: cx + Math.cos(a) * cx * waist,
      y: cy + Math.sin(a) * cy * waist,
      param: 'waist',
      labelKey: 'rib.starWaist',
      // 按**归一化半径**取值，于是把星形拉成扁的之后，把手仍然贴在谷点上。
      read: (pt) => clamp(Math.hypot((pt.x - cx) / cx, (pt.y - cy) / cy), 0.05, 0.98),
    });
  }

  if (support.inner) {
    if (el.shape === 'ring') {
      const rx = Math.max(1, cx);
      const ry = Math.max(1, cy);
      const thick = shapeParamValue(el, 'inner');
      const k = Math.max(0.02, 1 - thick / Math.min(rx, ry));
      out.push({
        id: 'inner',
        x: rx + rx * k,
        y: ry,
        param: 'inner',
        labelKey: 'rib.borderWidth',
        read: (pt) => {
          const d = clamp(Math.hypot((pt.x - cx) / cx, (pt.y - cy) / cy), 0.02, 0.999);
          return (1 - d) * Math.min(rx, ry);
        },
      });
    } else if (el.shape === 'frame') {
      const t = shapeParamValue(el, 'inner');
      out.push({
        id: 'inner',
        x: w - t,
        y: h - t,
        param: 'inner',
        labelKey: 'rib.borderWidth',
        read: (pt) => clamp(Math.min(w - pt.x, h - pt.y), 1, Math.min(w, h) / 2 - 1),
      });
    }
  }

  if (support.angle) {
    const a = shapeParamValue(el, 'angle');
    const th = -Math.PI / 2 + (a * Math.PI) / 180;
    out.push({
      id: 'angle',
      x: cx + cx * Math.cos(th),
      y: cy + cy * Math.sin(th),
      param: 'angle',
      labelKey: 'rib.pieAngle',
      read: (pt, _origin, start) => {
        const t = Math.atan2((pt.y - cy) / cy, (pt.x - cx) / cx);
        const deg = ((t + Math.PI / 2) * 180) / Math.PI;
        /*
         * 角度是循环的（0° 与 360° 是同一个方向），这里要同时满足两件事：
         *
         *  ① **不整圈翻过去**：把手划过 0°/360° 那一瞬间参数不能从 2 跳到 358。
         *     做法是与 `start` 对齐到最近的等价角（差值归到 ±180 之内）。
         *  ② **拉满时给的是 360 而不是 1**：正上方既是 0° 也是 360°，而张角
         *     钳在 [1, 360] —— 不特判的话「拖到顶」会得到一条 1° 的缝，
         *     而用户想要的是整圆。判据用 `start`：从大角度那一侧滑过来的，
         *     落到正上方就是「拉满」。
         */
        let d = deg - start;
        d -= Math.round(d / 360) * 360;
        let v = start + d;
        if (v < 1 && start > 180) v = 360;
        return clamp(v, 1, 360);
      },
    });
  }

  return out;
}
