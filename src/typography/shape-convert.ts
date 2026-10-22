/**
 * shape-convert.ts — 图形之间的**几何改写**：参数化图形转路径、布尔运算、拆分、
 * 文本轮廓落成图形。
 *
 * 纯函数（只碰文档模型 + `path-ops` / `shapes` / `path-nodes`），**不碰 DOM**，
 * 所以编辑器与 agent 控制平面共用同一份实现。原先这几段住在
 * `ui/typography/actions.ts` 里，agent 够不着 —— 那正是「用户能做、Agent 不能做」
 * 的典型形态（见根 AGENTS §1.9）。
 *
 * 两条约定与 UI 一字不差：
 *  - 布尔 / 拆分结果的坐标系恒为 0..100 authored（`multiToShape` 的输出），
 *    几何身份（`clipFrame` / 形状参数 / 动画）全部重置；
 *  - 文本转路径的产物是**像素空间**（`pathUnit:'px'` + `clipFrame`），第一个
 *    产物沿用源元素 id。
 */

import { newId } from '../core/schema';
import {
  type ElementShadow,
  type ShapeElement,
  type TextElement,
  type TypographyDocument,
} from './document';
import { shapeGeometry } from './shapes';
import { mapNodes, parsePathNodes, serializePathNodes } from './path-nodes';
import {
  booleanOp,
  dividePolygons,
  multiToShape,
  shapeToMultiPolygon,
  type BoolOp,
  type MultiPoly,
} from './path-ops';
import type { TextOutlineItem } from './text-outline';

/**
 * 参数化图形 → 手写路径（就地改写，保留元素 id）。
 *
 * 路径按 **0..100 authored** 写（`scaleFrom100` 会把它铺回元素框），所以圆角 /
 * 边数这些参数必须清掉 —— 形状已经是那串路径了，留着它们只会让「图形格式」
 * 面板继续显示一排毫无作用的滑杆。
 *
 * 返回 false = 没有几何可转（已经是 svg / 几何为空）。
 */
export function convertShapeToPath(el: ShapeElement): boolean {
  if (el.shape === 'svg') return false;
  const geo = shapeGeometry(el.shape, {
    w: el.frame.w,
    h: el.frame.h,
    radius: el.radius,
    sides: el.sides,
    waist: el.waist,
    inner: el.inner,
    angle: el.angle,
  });
  if (!geo.d) return false;
  const kx = 100 / Math.max(1, el.frame.w);
  const ky = 100 / Math.max(1, el.frame.h);
  const subs = mapNodes(parsePathNodes(geo.d), (p) => ({ x: p.x * kx, y: p.y * ky }));
  const path = serializePathNodes(subs);
  if (!path) return false;
  el.path = path;
  el.shape = 'svg';
  // 搬洞：不搬这一行，一次「转换为路径」就把圆环 / 方框变成实心盘。
  el.evenOdd = geo.evenOdd ? true : undefined;
  el.radius = undefined;
  el.sides = undefined;
  el.waist = undefined;
  el.inner = undefined;
  el.angle = undefined;
  // 参数化图形本来就不该带生成器元数据；真带上了（手改过的档）也一并清掉。
  el.gen = undefined;
  return true;
}

/**
 * 布尔 / 拆分结果的公共字段：外观与名字跟着来源，**几何身份**全部重置。
 *
 * - `multiToShape` 的输出恒为 0..100 authored，与来源原来的坐标系无关；
 * - `clipFrame` 是「文本框转过来」的语义，结果已是新的外接框，不该继承；
 * - 形状参数（圆角 / 边数 / 腰 / 内径 / 角度）只对原始图形有意义；
 * - 动画清空：多个操作数各有一套，拆分的各片也不该各自重复播同一段；
 * - `groupId` 由调用方决定（布尔清掉；拆分保留原组）。
 */
export function booleanResultFrom(
  src: ShapeElement,
  id: string,
  shaped: { path: string; frame: { x: number; y: number; w: number; h: number } },
  keepGroup: boolean,
): ShapeElement {
  return {
    ...structuredClone(src),
    id,
    kind: 'shape',
    shape: 'svg',
    path: shaped.path,
    frame: { x: shaped.frame.x, y: shaped.frame.y, w: shaped.frame.w, h: shaped.frame.h, rot: 0 },
    pathUnit: undefined,
    clipFrame: undefined,
    radius: undefined,
    sides: undefined,
    waist: undefined,
    inner: undefined,
    angle: undefined,
    animations: [],
    groupId: keepGroup ? src.groupId : undefined,
  };
}

/** 参与几何运算的元素：未锁定的图形，按 **z 序**（底 → 顶）。 */
function operands(doc: TypographyDocument, ids: readonly string[]): ShapeElement[] {
  const picked = new Set(ids);
  return doc.elements.filter(
    (e): e is ShapeElement => picked.has(e.id) && e.kind === 'shape' && !e.locked,
  );
}

/** 把 `fresh` 放到 `top` 原来所在的 z 位置（不改变其它元素的相对顺序）。 */
function spliceAt(doc: TypographyDocument, ids: Set<string>, topId: string, fresh: ShapeElement[]): void {
  const topIndex = doc.elements.findIndex((e) => e.id === topId);
  let insertAt = 0;
  for (let i = 0; i < topIndex; i++) if (!ids.has(doc.elements[i]!.id)) insertAt += 1;
  const kept = doc.elements.filter((e) => !ids.has(e.id));
  doc.elements = [...kept.slice(0, insertAt), ...fresh, ...kept.slice(insertAt)];
}

/**
 * 布尔运算。`op` 的语义与编辑器一致：**差集按 z 序**，最底下的那个是被减数
 * （「后画的挖掉先画的」）。
 *
 * 返回新元素 id；结果为**空**（交集为空 / 被减没了）时返回 null 且**不改文档** ——
 * 改成一个空图形没有意义。
 */
export function applyBoolean(
  doc: TypographyDocument,
  ids: readonly string[],
  op: BoolOp,
): string | null {
  const ordered = operands(doc, ids);
  if (ordered.length < 2) return null;
  const order = ordered.map((e) => e.id);
  const result = booleanOp(op, ordered.map(shapeToMultiPolygon));
  const shaped = multiToShape(result);
  if (!shaped) return null;

  const top = ordered[ordered.length - 1]!;
  const fresh = booleanResultFrom(top, newId(), shaped, false);
  spliceAt(doc, new Set(order), top.id, [fresh]);
  return fresh.id;
}

/**
 * 拆分：把重叠区域切成互不重叠的若干片，每片沿用「盖在它最上面的那个操作数」
 * 的外观 —— A−B 是 A 的颜色，重叠区与 B−A 是 B 的颜色。全用最顶层的话，A 独有
 * 的部分会被染成 B 的色，拆分就失去了「保留原观感」的意义。
 *
 * 返回新元素 id 列表（空数组 = 没有可切的区域，文档不变）。
 */
export function applyDivide(doc: TypographyDocument, ids: readonly string[]): string[] {
  const ordered = operands(doc, ids);
  if (ordered.length < 2) return [];
  const regions = dividePolygons(ordered.map(shapeToMultiPolygon));
  const fresh: ShapeElement[] = [];
  for (const region of regions) {
    const shaped = multiToShape(region.mp);
    if (!shaped) continue;
    fresh.push(booleanResultFrom(ordered[region.top]!, newId(), shaped, true));
  }
  if (!fresh.length) return [];
  spliceAt(doc, new Set(ordered.map((o) => o.id)), ordered[ordered.length - 1]!.id, fresh);
  return fresh.map((e) => e.id);
}

/**
 * 文本转路径的产物 → 一组 `ShapeElement`。
 *
 * 三条约定（与 ui/typography/actions.ts 原本的注释同源）：
 *  - 路径是**像素空间**（`pathUnit:'px'` + `clipFrame`）：文本框通常是几百乘几十，
 *    落回 0..100 authored 会把描边拉成一边粗一边细。
 *  - **第一个产物沿用源元素的 id**：它就是「这个元素变成了路径」。
 *  - **动画 id 逐个换新**：同一段文字按颜色拆成多个图形时，动画要各演各的。
 */
export function buildTextOutlineShapes(
  source: TextElement,
  items: readonly TextOutlineItem[],
  shadows: readonly ElementShadow[],
): ShapeElement[] {
  const common = {
    name: source.name,
    frame: { ...source.frame },
    blend: source.blend,
    opacity: source.opacity,
    visible: source.visible,
    locked: source.locked,
    groupId: source.groupId,
    transform3d: source.transform3d ? structuredClone(source.transform3d) : undefined,
    blur: source.blur,
    // 文本框本来就是 overflow: hidden：溢出的字形 / 描边不该在转换后冒出来。
    clipFrame: true,
  };
  /*
   * 阴影要**分角色**给：`shadows` 是「文字阴影 + 元素阴影」，只该落在字形 /
   * 装饰线上；文本框底色与高亮只该带**元素阴影**（原来它们也不吃 text-shadow）。
   */
  const elementShadows = (source.shadows ?? []).map((s) => ({ ...s }));

  return items.map((item, i): ShapeElement => {
    const glyphLike = item.role === 'glyph' || item.role === 'decoration';
    const base = {
      ...common,
      id: i === 0 ? source.id : newId(),
      animations: source.animations.map((a) => ({ ...structuredClone(a), id: newId() })),
      shadows: glyphLike
        ? shadows.length
          ? shadows.map((s) => ({ ...s }))
          : undefined
        : elementShadows.length
          ? elementShadows.map((s) => ({ ...s }))
          : undefined,
    };
    if (item.role === 'box') {
      return {
        ...base,
        kind: 'shape',
        shape: 'rect',
        fill: item.paint,
        stroke: item.stroke ? { ...item.stroke } : null,
      };
    }
    const glyphStroke =
      item.role === 'glyph' && source.glyphStroke && source.glyphStroke.width > 0
        ? {
            color: source.glyphStroke.color,
            width: source.glyphStroke.width,
            // `-webkit-text-stroke` 没有线型；带上原字段会让 SVG 画出虚线。
            style: 'solid' as const,
          }
        : null;
    return {
      ...base,
      kind: 'shape',
      shape: 'svg',
      path: item.d,
      pathUnit: 'px',
      fill: item.paint,
      stroke: glyphStroke,
    };
  });
}

/**
 * 用轮廓结果替换源文本元素（就地改文档，返回新元素 id 列表）。
 *
 * 按颜色拆成多个图形时包成一个组合：拖动 / 选择仍是一件事。源元素本来就在组里
 * 就不另建 —— 组合是扁平的，不能套娃。
 */
export function applyTextToPath(
  doc: TypographyDocument,
  sourceId: string,
  items: readonly TextOutlineItem[],
  shadows: readonly ElementShadow[],
): string[] {
  const idx = doc.elements.findIndex((e) => e.id === sourceId);
  if (idx < 0) return [];
  const src = doc.elements[idx]!;
  if (src.kind !== 'text') return [];
  const shapes = buildTextOutlineShapes(src, items, shadows);
  if (!shapes.length) return [];
  doc.elements.splice(idx, 1, ...shapes);
  if (shapes.length > 1 && !src.groupId) {
    const gid = newId();
    for (const s of shapes) s.groupId = gid;
    doc.groups = [
      ...(doc.groups ?? []),
      // padding 0：原文本没有「外扩一圈」的语义，默认的 8 会让选择框变大。
      { id: gid, name: src.name, fill: { kind: 'none' }, stroke: null, radius: 0, padding: 0 },
    ];
  }
  return shapes.map((s) => s.id);
}

/** 供调用方判断「这几个 id 能不能做布尔」：>= 2 个未锁定图形。 */
export function canBoolean(doc: TypographyDocument, ids: readonly string[]): boolean {
  return operands(doc, ids).length >= 2;
}

/** 多边形的面积（给调用方判空用）。 */
export type { MultiPoly };
