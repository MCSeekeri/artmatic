/**
 * icon-shapes.ts — Lucide 图标 → `ShapeElement(shape:'svg')` 的路径数据。
 *
 * 图标为什么走形状而不是图片素材（`ImageElement` + SVG blob）：
 *
 *  - Lucide 的语义就是「无填充 + 圆头描边」，与 ShapeElement 的
 *    `fill: {kind:'none'}` + `stroke` 一一对应 —— 插入之后颜色 / 粗细 / 混合
 *    模式这些既有控件立刻可用；而 SVG 走 `<img>` 时 `currentColor` 会失效
 *    （隔离文档里没有可继承的颜色），颜色只能写死。
 *  - 不进素材表：少一条 `putImageBytes` + 台账登记的链路，序列化天然支持
 *    （`ShapeElement.path` 本来就是个字符串）。
 *
 * 坐标系：图标 authored 在 24×24，而 `shape:'svg'` 按 **0..100** authored
 * （见 shapes.ts 的 `scaleFrom100`），所以统一乘 `100/24`。线宽同理：
 * Lucide 的 2（24 单位）对应 100 单位里的 `ICON_STROKE_WIDTH`。
 *
 * 坐标经过 `parsePathNodes` → `mapNodes` → `serializePathNodes` 归一化：
 * 弧变贝塞尔（视觉等价），`H`/`V` 变绝对坐标，输出格式与「转为路径」的
 * 既有实现完全一致（都是 2 位小数、`M` + `L`/`C`/`Z`），因此光栅化缓存的
 * 稳定性口径也一致。
 */

import type { Size, TextureFrame } from './document';
import { mapNodes, parsePathNodes, serializePathNodes, type SubPath } from './path-nodes';

/** Lucide 图标的 authored 边长（官方 viewBox 0 0 24 24）。 */
export const ICON_AUTHORED = 24;
/** `shape:'svg'` 的 authored 边长（见 shapes.ts 的 `scaleFrom100`）。 */
export const SHAPE_BOX = 100;
/** Lucide 的描边粗细（24 单位制）。 */
const LUCIDE_STROKE = 2;

/**
 * 图标元素的默认 `stroke.width`（100 单位制）。
 * `100/12 ≈ 8.33` —— 在任意元素尺寸下都等于「24 单位里的 2」的**等比**粗细。
 */
export const ICON_STROKE_WIDTH = (LUCIDE_STROKE / ICON_AUTHORED) * SHAPE_BOX;

/** 待插入的一个图标：名字（也用作元素名）+ 已经算好的路径数据。 */
export interface IconInsert {
  name: string;
  path: string;
}

/** 一个图元的属性表。值是 iconData 里的原始 JSON 值（数字或字符串）。 */
export type IconAttrs = Readonly<Record<string, string | number>>;
/** 一个图元：`[标签, 属性]`（Lucide 的 iconNode 格式）。 */
export type IconPrimitive = readonly [string, IconAttrs];
export type IconNode = readonly IconPrimitive[];

/** 24 单位制的数字格式化：三位小数，避免浮点尾数进入路径字符串。 */
function f(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/**
 * 单个图元 → 一条 `d` 片段（24 单位制）。
 *
 * 覆盖 Lucide 全量数据里出现过的 7 种标签（path / circle / ellipse / rect /
 * line / polyline / polygon，全量扫描见 `tests/unit/typography-icon-shapes.test.ts`
 * 的口径）。未知标签返回空串由调用方忽略。
 */
export function primitivePath(tag: string, attrs: IconAttrs): string {
  const g = (key: string, def = 0): number => {
    const raw = attrs[key];
    const num = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(num) ? num : def;
  };

  switch (tag) {
    case 'path':
      return typeof attrs.d === 'string' ? attrs.d.trim() : '';

    case 'circle': {
      const cx = g('cx');
      const cy = g('cy');
      /*
       * `fill="currentColor"` 的小圆点（chart-scatter / palette / tag / vault
       * 这几族）在原 SVG 里是**实心**的，而整条 path 只有一种 fill —— 用描边
       * 模拟实心圆，半径要减去半个线宽（描边向外扩 stroke/2）。
       * r ≤ stroke/2 时退化成「零长度线段 + round cap」＝ 一个圆点，
       * 直径等于线宽（原图是 2r，r = 0.5 时略粗一点，这是描边能表达的极限）。
       */
      const r = g('r') - (attrs.fill !== undefined && attrs.fill !== 'none' ? LUCIDE_STROKE / 2 : 0);
      if (r <= 1e-3) return `M${f(cx)},${f(cy)} L${f(cx)},${f(cy)}`;
      return (
        `M${f(cx - r)},${f(cy)} ` +
        `a${f(r)},${f(r)} 0 1 0 ${f(r * 2)},0 ` +
        `a${f(r)},${f(r)} 0 1 0 ${f(-r * 2)},0`
      );
    }

    case 'ellipse': {
      const cx = g('cx');
      const cy = g('cy');
      const rx = g('rx');
      const ry = g('ry');
      if (rx <= 1e-3 || ry <= 1e-3) return `M${f(cx)},${f(cy)} L${f(cx)},${f(cy)}`;
      return (
        `M${f(cx - rx)},${f(cy)} ` +
        `a${f(rx)},${f(ry)} 0 1 0 ${f(rx * 2)},0 ` +
        `a${f(rx)},${f(ry)} 0 1 0 ${f(-rx * 2)},0`
      );
    }

    case 'rect': {
      const x = g('x');
      const y = g('y');
      const w = g('width');
      const h = g('height');
      if (w <= 0 || h <= 0) return '';
      // SVG 规范：只给 rx 或只给 ry 时另一个取同值；各自钳到半边长。
      const rawRx = attrs.rx !== undefined ? g('rx') : Number.NaN;
      const rawRy = attrs.ry !== undefined ? g('ry') : Number.NaN;
      let rx = Number.isFinite(rawRx) ? rawRx : Number.isFinite(rawRy) ? rawRy : 0;
      let ry = Number.isFinite(rawRy) ? rawRy : rx;
      rx = Math.max(0, Math.min(rx, w / 2));
      ry = Math.max(0, Math.min(ry, h / 2));
      if (rx < 1e-3 || ry < 1e-3) {
        return `M${f(x)},${f(y)} H${f(x + w)} V${f(y + h)} H${f(x)} Z`;
      }
      return (
        `M${f(x + rx)},${f(y)} H${f(x + w - rx)} ` +
        `A${f(rx)},${f(ry)} 0 0 1 ${f(x + w)},${f(y + ry)} ` +
        `V${f(y + h - ry)} ` +
        `A${f(rx)},${f(ry)} 0 0 1 ${f(x + w - rx)},${f(y + h)} ` +
        `H${f(x + rx)} ` +
        `A${f(rx)},${f(ry)} 0 0 1 ${f(x)},${f(y + h - ry)} ` +
        `V${f(y + ry)} ` +
        `A${f(rx)},${f(ry)} 0 0 1 ${f(x + rx)},${f(y)} Z`
      );
    }

    case 'line':
      return `M${f(g('x1'))},${f(g('y1'))} L${f(g('x2'))},${f(g('y2'))}`;

    case 'polyline':
    case 'polygon': {
      const nums = String(attrs.points ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (nums.length < 4 || nums.length % 2 !== 0 || nums.some((v) => !Number.isFinite(v))) return '';
      let d = `M${f(nums[0]!)},${f(nums[1]!)}`;
      for (let i = 2; i + 1 < nums.length; i += 2) d += ` L${f(nums[i]!)},${f(nums[i + 1]!)}`;
      return tag === 'polygon' ? `${d} Z` : d;
    }

    default:
      return '';
  }
}

/**
 * Lucide iconNode → **0..100 authored** 的单条 `d`（塞进 `ShapeElement.path`）。
 *
 * 多个图元合并成一条路径：`shape:'svg'` 只支持一条 `d`，而各图元在这里
 * 本来就共享同一套描边属性（颜色 / 粗细 / 圆头），合并不会丢失表达力。
 *
 * ⚠️ **每个图元必须独立解析**：在独立的 `<path>` 里，相对命令（`m` / `a` / `l`）
 * 的当前点从 `(0,0)` 起算；一旦把几个 `d` 拼成一条字符串再解析，相对命令就会
 * 接着**上一条子路径的终点** —— 图标会整体错位（`a-large-small` 这类含 `m`
 * 的图标偏移 30 多个单位）。合并发生在**子路径层**，不是字符串层。
 */
export function iconNodeToPath(node: IconNode): string {
  const subs: SubPath[] = [];
  for (const [tag, attrs] of node) {
    const d = primitivePath(tag, attrs);
    if (d) subs.push(...parsePathNodes(d));
  }
  if (!subs.length) return '';

  const k = SHAPE_BOX / ICON_AUTHORED;
  return serializePathNodes(mapNodes(subs, (p) => ({ x: p.x * k, y: p.y * k })));
}

/**
 * 多个图标一次性插入时的排布（纯几何）。
 *
 * 单图标 = 形状的既有默认（短边 30%、居中）；多图标排成**近正方形的网格**并
 * 随数量收缩单格，保证整组不超出画布 80% —— 挨个手动拖开是最烦的收尾工作。
 * 顺序按「选中顺序」从左到右、从上到下填充。
 */
export function iconGridFrames(size: Size, count: number): TextureFrame[] {
  const n = Math.max(1, Math.floor(count));
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const ideal = Math.min(size.w, size.h) * 0.3;
  const d = Math.max(
    24,
    Math.round(Math.min(ideal, (size.w * 0.8) / (cols * 1.3), (size.h * 0.8) / (rows * 1.3))),
  );
  const gap = Math.round(d * 0.3);
  const gw = cols * d + (cols - 1) * gap;
  const gh = rows * d + (rows - 1) * gap;
  const x0 = Math.round((size.w - gw) / 2);
  const y0 = Math.round((size.h - gh) / 2);

  const out: TextureFrame[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({ x: x0 + col * (d + gap), y: y0 + row * (d + gap), w: d, h: d, rot: 0 });
  }
  return out;
}
