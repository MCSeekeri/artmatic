/**
 * shapes.ts — 内联 SVG 图形库（纯数据 + 纯函数）。
 *
 * **路径直接生成在元素的像素盒里**（viewBox = `0 0 w h`），不是先画在
 * 100×100 再拉伸。理由：
 *
 *  - 描边宽度可以直接用文档 px。用 `viewBox="0 0 100 100"` + `preserveAspectRatio="none"`
 *    拉伸时，非等比缩放会让边框**一边粗一边细**（水平边按 sy 缩放、垂直边按 sx），
 *    看起来就像「被 transform: scale 拉歪了」。
 *  - `non-scaling-stroke` 不能解决这个问题：它把线宽钉死在**设备像素**上，
 *    于是 0.25x 预览与 1.00x 导出渲染出来的相对粗细不同，直接破坏「预览 = 导出」。
 *
 * 代价是改一个尺寸就要重算路径字符串 —— 反正 `syncElement` 本来每帧就在写
 * 内联样式，多写一个 `d` 属性不构成负担。
 *
 * **圆角是顶点级操作**（`roundPolygonPath`），不是矩形专属：所有多边形类图形
 * （三角形 / 星形 / 正多边形 / 梯形 / 平行四边形 / 箭头）共用同一套倒角，
 * 于是「矩形能改圆角、别的不能」这种不一致从根上消失。
 */

import type { ShapeElement, ShapeKind } from './document';
import type { MessageKey } from '../i18n/locales';

export interface ShapeGeometry {
  /** 与元素盒一致，所以缩放是 1:1。 */
  viewBox: string;
  /** path 的 d。line 这类需要描边的图形也走 path，只是 fill 通常为 none。 */
  d: string;
  /**
   * 需要额外包一层 `<g transform="scale(sx,sy)">` 的图形（目前只有自定义 svg：
   * 它的路径数据按 0..100 authored，与像素盒不同坐标系）。
   */
  scaleFrom100?: boolean;
  /** 带洞的图形（圆环 / 方框）要 `fill-rule="evenodd"`。 */
  evenOdd?: boolean;
}

function n(v: number): string {
  // 两位小数：路径字符串要稳定，否则同一图形会因为浮点尾数不同而产出不同的
  // DOM 字符串，破坏光栅化缓存的稳定性。
  return String(Math.round(v * 100) / 100);
}

interface Pt {
  x: number;
  y: number;
}

/**
 * 通用圆角：把多边形每个顶点换成一段圆弧。
 *
 * 数学：内角 θ 处，切点到顶点的距离是 `r / tan(θ/2)`。
 * 当它超过相邻边的一半时（半径给得太大），把切点钳到边中点，同时把实际半径
 * 按 `t · tan(θ/2)` 缩回去 —— 直接用原半径会画出一段**不经过切点**的弧，
 * 图形边缘会「鼓出来」一截。
 *
 * 扫掠方向由两条边的叉积决定，所以顺时针与逆时针的顶点序都画得对。
 */
export function roundPolygonPath(pts: Pt[], radius: number): string {
  const count = pts.length;
  if (count < 3) return '';
  if (!(radius > 0)) return `M${pts.map((p) => `${n(p.x)},${n(p.y)}`).join(' L')} Z`;

  let d = '';
  for (let i = 0; i < count; i++) {
    const prev = pts[(i - 1 + count) % count]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % count]!;
    const v1 = { x: prev.x - cur.x, y: prev.y - cur.y };
    const v2 = { x: next.x - cur.x, y: next.y - cur.y };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-6 || l2 < 1e-6) {
      d += `${d ? ' L' : 'M'}${n(cur.x)},${n(cur.y)}`;
      continue;
    }
    const u1 = { x: v1.x / l1, y: v1.y / l1 };
    const u2 = { x: v2.x / l2, y: v2.y / l2 };
    const cos = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
    const theta = Math.acos(cos);
    // 近共线（内角 ≈180°）没有角可倒 —— 留着也只会变成一段不动的弧。
    if (theta < 1e-3 || Math.PI - theta < 1e-3) {
      d += `${d ? ' L' : 'M'}${n(cur.x)},${n(cur.y)}`;
      continue;
    }
    const tanHalf = Math.tan(theta / 2);
    const tMax = Math.min(l1, l2) / 2;
    const wanted = radius / tanHalf;
    const rEff = wanted > tMax ? tMax * tanHalf : radius;
    const t = Math.min(wanted, tMax);

    const a = { x: cur.x + u1.x * t, y: cur.y + u1.y * t };
    const b = { x: cur.x + u2.x * t, y: cur.y + u2.y * t };
    // 叉积 < 0 ⇒ 需要顺时针（SVG 里 sweep=1）才能贴着顶点外接的那一侧转过去。
    // 用矩形右上角验算过：a=(w-r,0) → b=(w,r)，圆心在 (w-r,r)，角度从 -90° 增到 0°。
    const cross = u1.x * u2.y - u1.y * u2.x;
    const sweep = cross < 0 ? 1 : 0;
    d += `${d ? ' L' : 'M'}${n(a.x)},${n(a.y)} A${n(rEff)},${n(rEff)} 0 0 ${sweep} ${n(b.x)},${n(b.y)}`;
  }
  return `${d} Z`;
}

/** 外接矩形的顶点环（rect 与 frame 共用一份定义）。 */
function rectRing(w: number, h: number): Pt[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function ellipse(w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  return `M0,${n(ry)} A${n(rx)},${n(ry)} 0 1 0 ${n(w)},${n(ry)} A${n(rx)},${n(ry)} 0 1 0 0,${n(ry)} Z`;
}

/**
 * 圆环：外圈 + 内圈。
 *
 * 内圈按**各轴比例**缩（不是各减一个 thickness）：直接减会在非正方形盒子里
 * 得到一个偏心的环。
 */
function ring(w: number, h: number, thickness: number): string {
  const rx = w / 2;
  const ry = h / 2;
  const k = Math.max(0.02, 1 - thickness / Math.min(rx, ry));
  const irx = rx * k;
  const iry = ry * k;
  const inner =
    `M${n(rx - irx)},${n(ry)} A${n(irx)},${n(iry)} 0 1 0 ${n(rx + irx)},${n(ry)} ` +
    `A${n(irx)},${n(iry)} 0 1 0 ${n(rx - irx)},${n(ry)} Z`;
  return `${ellipse(w, h)} ${inner}`;
}

/** 方框：矩形挖空。外框圆角时内框的圆角跟着缩，壁厚才均匀。 */
function frame(w: number, h: number, thickness: number, radius: number): string {
  const t = Math.max(1, Math.min(thickness, Math.min(w, h) / 2 - 1));
  const iw = w - t * 2;
  const ih = h - t * 2;
  const ir = Math.max(0, Math.min(radius - t, Math.min(iw, ih) / 2));
  const inner =
    `M${n(t + ir)},${n(t)} H${n(t + iw - ir)} A${n(ir)},${n(ir)} 0 0 1 ${n(t + iw)},${n(t + ir)} ` +
    `V${n(t + ih - ir)} A${n(ir)},${n(ir)} 0 0 1 ${n(t + iw - ir)},${n(t + ih)} ` +
    `H${n(t + ir)} A${n(ir)},${n(ir)} 0 0 1 ${n(t)},${n(t + ih - ir)} ` +
    `V${n(t + ir)} A${n(ir)},${n(ir)} 0 0 1 ${n(t + ir)},${n(t)} Z`;
  return `${roundPolygonPath(rectRing(w, h), radius)} ${inner}`;
}

/** 扇形：从 12 点方向顺时针扫 `angleDeg`。 */
function pie(w: number, h: number, angleDeg: number): string {
  const a = Math.max(1, Math.min(360, angleDeg));
  if (a >= 359.9) return ellipse(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const rad = (a * Math.PI) / 180;
  const x1 = cx;
  const y1 = 0;
  const x2 = cx + cx * Math.cos(-Math.PI / 2 + rad);
  const y2 = cy + cy * Math.sin(-Math.PI / 2 + rad);
  const large = a > 180 ? 1 : 0;
  return `M${n(cx)},${n(cy)} L${n(x1)},${n(y1)} A${n(cx)},${n(cy)} 0 ${large} 1 ${n(x2)},${n(y2)} Z`;
}

/** 正多边形顶点。从正上方起画。 */
function polygonPoints(w: number, h: number, sides: number): Pt[] {
  const count = Math.max(3, Math.round(sides));
  const cx = w / 2;
  const cy = h / 2;
  const out: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count - Math.PI / 2;
    out.push({ x: cx + Math.cos(a) * cx, y: cy + Math.sin(a) * cy });
  }
  return out;
}

/** 星形顶点：外/内半径交替。`waist` 是**谷半径比例**（0..1）。 */
function starPoints(w: number, h: number, sides: number, waist: number): Pt[] {
  const count = Math.max(3, Math.round(sides));
  const k = Math.max(0.05, Math.min(0.98, waist));
  const cx = w / 2;
  const cy = h / 2;
  const out: Pt[] = [];
  for (let i = 0; i < count * 2; i++) {
    const r = i % 2 === 0 ? 1 : k;
    const a = (Math.PI * i) / count - Math.PI / 2;
    out.push({ x: cx + Math.cos(a) * cx * r, y: cy + Math.sin(a) * cy * r });
  }
  return out;
}

export interface ShapeBox {
  w: number;
  h: number;
  /** 像素。对多边形类图形是**顶点圆角**半径。 */
  radius?: number;
  sides?: number;
  /** shape === 'svg' 时的自定义路径（默认按 0..100 坐标系 authored）。 */
  path?: string;
  /** 自定义路径的坐标系，见 `ShapeElement.pathUnit`。缺省 = 0..100 authored。 */
  pathUnit?: 'percent' | 'px';
  /**
   * `shape === 'svg'` 时的填充规则。带洞的路径（环 / 刻度盘 / 嵌套框）必须为
   * true，否则内圈被 nonzero 填实 —— 生成器素材里近一半靠它。
   */
  evenOdd?: boolean;
  /** 圆环 / 方框的壁厚（文档 px）。缺省按短边取一个比例。 */
  inner?: number;
  /** 星形的谷半径比例（0..1，缺省 0.4）。 */
  waist?: number;
  /** 扇形的张角（度，缺省 270）。 */
  angle?: number;
}

/**
 * 图形的**未倒角顶点环**（局部像素坐标）。
 *
 * 这是「多边形类图形长什么样」的唯一定义 —— 圆角（`roundPolygonPath`）与
 * 控制点（`shape-handles.ts`）都从这里取点。分开写的话，改了梯形上底比例
 * 之后控制点会留在旧位置，「拖圆角手柄却动了别的地方」。
 *
 * 不返回顶点环的图形（椭圆 / 圆环 / 直线 / 扇形）返回空数组：它们要么没有
 * 直线边，要么形状不由顶点环描述。
 */
export function shapeVertexRing(shape: ShapeKind, box: ShapeBox): Pt[] {
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  switch (shape) {
    case 'rect':
    case 'frame':
      // 方框的圆角是**外框**的圆角，所以顶点环就是外接矩形。
      return rectRing(w, h);
    case 'triangle':
      return [
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    case 'trapezoid':
      // 上底 50%、下底 100%。
      return [
        { x: w * 0.25, y: 0 },
        { x: w * 0.75, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    case 'parallelogram':
      return [
        { x: w * 0.25, y: 0 },
        { x: w, y: 0 },
        { x: w * 0.75, y: h },
        { x: 0, y: h },
      ];
    case 'arrow':
      return [
        { x: 0, y: h * 0.3 },
        { x: w * 0.6, y: h * 0.3 },
        { x: w * 0.6, y: 0 },
        { x: w, y: h * 0.5 },
        { x: w * 0.6, y: h },
        { x: w * 0.6, y: h * 0.7 },
        { x: 0, y: h * 0.7 },
      ];
    case 'star':
      return starPoints(w, h, box.sides ?? 5, box.waist ?? 0.4);
    case 'polygon':
      return polygonPoints(w, h, box.sides ?? 6);
    default:
      return [];
  }
}

/**
 * 路径坐标 → 元素局部像素的比例（`pathUnit` 的**唯一换算处**）。
 *
 * 顶点编辑、手势写回、布尔运算都要用它：`'percent'` 是 0..100 authored，
 * 各轴分别按 frame 缩放（见 `shapeGeometry('svg')`）；`'px'` 原样就是像素。
 */
export function pathUnitScale(el: Pick<ShapeElement, 'pathUnit' | 'frame'>): { x: number; y: number } {
  if (el.pathUnit === 'px') return { x: 1, y: 1 };
  return { x: el.frame.w / 100, y: el.frame.h / 100 };
}

export function shapeGeometry(shape: ShapeKind, box: ShapeBox): ShapeGeometry {
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const viewBox = `0 0 ${w} ${h}`;
  const short = Math.min(w, h);
  const r = box.radius ?? 0;

  /** 顶点环类图形统一走这一条：**圆角只有一份实现**。 */
  const poly = (): ShapeGeometry => ({
    viewBox,
    d: roundPolygonPath(shapeVertexRing(shape, box), r),
  });

  switch (shape) {
    case 'rect':
      return poly();
    case 'ellipse':
      return { viewBox, d: ellipse(w, h) };
    case 'line':
      return { viewBox, d: `M0,${n(h / 2)} L${n(w)},${n(h / 2)}` };
    case 'triangle':
    case 'star':
    case 'polygon':
    case 'trapezoid':
    case 'parallelogram':
    case 'arrow':
      return poly();
    case 'ring':
      return { viewBox, d: ring(w, h, box.inner ?? short * 0.18), evenOdd: true };
    case 'frame':
      return { viewBox, d: frame(w, h, box.inner ?? short * 0.1, r), evenOdd: true };
    case 'pie':
      return { viewBox, d: pie(w, h, box.angle ?? 270) };
    case 'svg':
      // 自定义路径默认按 0..100 authored，交给调用方包一层 scale 组。
      // `pathUnit === 'px'` 的（文本转路径）就写在元素像素盒里，不缩放。
      // `evenOdd` 必须透出去：带洞路径走 nonzero 会被填成实心（形状参数「没生效」）。
      return {
        viewBox,
        d: box.path?.trim() || `M0,0 H${w} V${h} H0 Z`,
        scaleFrom100: box.pathUnit !== 'px',
        evenOdd: box.evenOdd,
      };
    default:
      return { viewBox, d: `M0,0 H${w} V${h} H0 Z` };
  }
}

/**
 * Ribbon「插入 → 形状」面板的内容。顺序即展示顺序。
 *
 * `labelKey` 而不是 `label`：这是一张模块级常量表，直接存字符串等于把语言
 * 冻结在导入那一刻（见 effects/types.ts 的注释）。
 */
export interface ShapePreset {
  key: string;
  labelKey: MessageKey;
  id: ShapeKind;
  sides?: number;
  radius?: number;
  waist?: number;
  angle?: number;
}

export const SHAPE_PRESETS: ShapePreset[] = [
  { key: 'rect', labelKey: 'shape.rect', id: 'rect' },
  { key: 'round-rect', labelKey: 'shape.roundRect', id: 'rect', radius: 24 },
  { key: 'ellipse', labelKey: 'shape.ellipse', id: 'ellipse' },
  { key: 'triangle', labelKey: 'shape.triangle', id: 'triangle' },
  { key: 'pentagon', labelKey: 'shape.pentagon', id: 'polygon', sides: 5 },
  { key: 'hexagon', labelKey: 'shape.hexagon', id: 'polygon', sides: 6 },
  { key: 'octagon', labelKey: 'shape.octagon', id: 'polygon', sides: 8 },
  { key: 'star5', labelKey: 'shape.star', id: 'star', sides: 5 },
  { key: 'star6', labelKey: 'shape.star6', id: 'star', sides: 6, waist: 0.55 },
  { key: 'trapezoid', labelKey: 'shape.trapezoid', id: 'trapezoid' },
  { key: 'parallelogram', labelKey: 'shape.parallelogram', id: 'parallelogram' },
  { key: 'diamond', labelKey: 'shape.diamond', id: 'polygon', sides: 4 },
  { key: 'pie', labelKey: 'shape.pie', id: 'pie' },
  { key: 'ring', labelKey: 'shape.ring', id: 'ring' },
  { key: 'frame', labelKey: 'shape.frame', id: 'frame', radius: 8 },
  { key: 'arrow', labelKey: 'shape.arrow', id: 'arrow' },
  { key: 'line', labelKey: 'shape.line', id: 'line' },
];

/** 判断某个图形是否只该描边（默认填充为 none）。 */
export function shapeDefaultsToStrokeOnly(shape: ShapeKind): boolean {
  return shape === 'line';
}

/**
 * 某个图形有哪些可调参数。Ribbon 的「图形格式」按它决定显示哪些控件 ——
 * 写死成 if 链的话，「加一个图形」就得回到 Ribbon 里再补一条分支。
 */
export interface ShapeParamSupport {
  /** 顶点圆角。 */
  radius: boolean;
  /** 边数（正多边形 / 星形）。 */
  sides: boolean;
  /** 星形的谷半径比例。 */
  waist: boolean;
  /** 圆环 / 方框的壁厚。 */
  inner: boolean;
  /** 扇形的张角。 */
  angle: boolean;
}

export function shapeParamSupport(shape: ShapeKind): ShapeParamSupport {
  const poly = shape === 'polygon' || shape === 'star';
  return {
    radius:
      shape === 'rect' ||
      shape === 'frame' ||
      shape === 'triangle' ||
      shape === 'star' ||
      shape === 'polygon' ||
      shape === 'trapezoid' ||
      shape === 'parallelogram' ||
      shape === 'arrow',
    sides: poly,
    waist: shape === 'star',
    inner: shape === 'ring' || shape === 'frame',
    angle: shape === 'pie',
  };
}
