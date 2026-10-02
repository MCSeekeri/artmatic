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
 */

import type { ShapeKind } from './document';
import type { MessageKey } from '../i18n/locales';

export interface ShapeGeometry {
  /** 与元素盒一致，所以缩放是 1:1。 */
  viewBox: string;
  /** path 的 d。line 这类需要描边的图形也走 path，只是 fill 通常为 none。 */
  d: string;
  /**
   * 需要额外包一层 `<g transform="scale(sx,sy)">` 的图形（目前只有自定义 svg：
   * 它的路径数据按 0..100  authored，与像素盒不同坐标系）。
   */
  scaleFrom100?: boolean;
}

function n(v: number): string {
  // 两位小数：路径字符串要稳定，否则同一图形会因为浮点尾数不同而产出不同的
  // DOM 字符串，破坏光栅化缓存的稳定性。
  return String(Math.round(v * 100) / 100);
}

/** 圆角矩形。radius 是**像素**（钳到短边的一半）。 */
function roundedRect(w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r === 0) return `M0,0 H${n(w)} V${n(h)} H0 Z`;
  return [
    `M${n(r)},0`,
    `H${n(w - r)}`,
    `A${n(r)},${n(r)} 0 0 1 ${n(w)},${n(r)}`,
    `V${n(h - r)}`,
    `A${n(r)},${n(r)} 0 0 1 ${n(w - r)},${n(h)}`,
    `H${n(r)}`,
    `A${n(r)},${n(r)} 0 0 1 0,${n(h - r)}`,
    `V${n(r)}`,
    `A${n(r)},${n(r)} 0 0 1 ${n(r)},0`,
    'Z',
  ].join(' ');
}

function ellipse(w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  return `M0,${n(ry)} A${n(rx)},${n(ry)} 0 1 0 ${n(w)},${n(ry)} A${n(rx)},${n(ry)} 0 1 0 0,${n(ry)} Z`;
}

function star(w: number, h: number, sides: number): string {
  const count = Math.max(3, Math.round(sides));
  const cx = w / 2;
  const cy = h / 2;
  const pts: string[] = [];
  for (let i = 0; i < count * 2; i++) {
    const k = i % 2 === 0 ? 1 : 0.4;
    // 从正上方起画：-90°，与「星形」的视觉预期一致。
    const a = (Math.PI * i) / count - Math.PI / 2;
    pts.push(`${n(cx + Math.cos(a) * cx * k)},${n(cy + Math.sin(a) * cy * k)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function polygon(w: number, h: number, sides: number): string {
  const count = Math.max(3, Math.round(sides));
  const cx = w / 2;
  const cy = h / 2;
  const pts: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count - Math.PI / 2;
    pts.push(`${n(cx + Math.cos(a) * cx)},${n(cy + Math.sin(a) * cy)}`);
  }
  return `M${pts.join(' L')} Z`;
}

export interface ShapeBox {
  w: number;
  h: number;
  /** 像素。 */
  radius?: number;
  sides?: number;
  /** shape === 'svg' 时的自定义路径（按 0..100 坐标系 authored）。 */
  path?: string;
}

export function shapeGeometry(shape: ShapeKind, box: ShapeBox): ShapeGeometry {
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const viewBox = `0 0 ${w} ${h}`;

  switch (shape) {
    case 'rect':
      return { viewBox, d: roundedRect(w, h, box.radius ?? 0) };
    case 'ellipse':
      return { viewBox, d: ellipse(w, h) };
    case 'triangle':
      return { viewBox, d: `M${n(w / 2)},0 L${n(w)},${n(h)} L0,${n(h)} Z` };
    case 'line':
      return { viewBox, d: `M0,${n(h / 2)} L${n(w)},${n(h / 2)}` };
    case 'star':
      return { viewBox, d: star(w, h, box.sides ?? 5) };
    case 'polygon':
      return { viewBox, d: polygon(w, h, box.sides ?? 6) };
    case 'svg':
      // 自定义路径按 0..100 authored，交给调用方包一层 scale 组。
      return { viewBox, d: box.path?.trim() || `M0,0 H${w} V${h} H0 Z`, scaleFrom100: true };
    default:
      return { viewBox, d: `M0,0 H${w} V${h} H0 Z` };
  }
}

/**
 * Ribbon「插入 → 形状」下拉的内容。顺序即展示顺序。
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
}

export const SHAPE_PRESETS: ShapePreset[] = [
  { key: 'rect', labelKey: 'shape.rect', id: 'rect', radius: 0 },
  { key: 'round-rect', labelKey: 'shape.roundRect', id: 'rect', radius: 16 },
  { key: 'ellipse', labelKey: 'shape.ellipse', id: 'ellipse' },
  { key: 'triangle', labelKey: 'shape.triangle', id: 'triangle' },
  { key: 'star', labelKey: 'shape.star', id: 'star', sides: 5 },
  { key: 'hexagon', labelKey: 'shape.hexagon', id: 'polygon', sides: 6 },
  { key: 'line', labelKey: 'shape.line', id: 'line' },
];

/** 判断某个图形是否只该描边（默认填充为 none）。 */
export function shapeDefaultsToStrokeOnly(shape: ShapeKind): boolean {
  return shape === 'line';
}
