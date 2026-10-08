/**
 * document.ts — 排版文档模型（纯数据 + 纯函数，**不碰 DOM**）。
 *
 * 三条边界（AGENTS §1 / 本模块的设计前提）：
 *  1. 坐标系独立：左上原点、y 向下、单位 px —— 就是 CSS 坐标系。
 *     dom-snap 后端本质是「序列化 DOM 再截图」，自造数学坐标系只会多一层
 *     换算并与 snapDOM 的 width/height/dpr 语义打架。
 *  2. 文档没有时间概念。它只接受「片段内本地时间」，见 animation.ts。
 *  3. 文档内部只描述元素**版式**。片段层的整体位移/缩放/旋转/不透明度/
 *     混合/适配全部由 SourceClip.transform + curves 走既有合成链负责，
 *     这里一个字都不重复。
 *
 * z 序 = elements 数组下标（0 最底）。**不设独立 z 字段** —— 两处真相
 * 必然不同步，这是项目里反复踩过的坑。
 */

import { newId } from '../core/schema';
import type { ElementAnimation } from './animation';
import { runsFromText, type TextRun } from './rich-text';
import { tr } from '../i18n/index.svelte';
import type { MessageKey } from '../i18n/locales';

/**
 * 元素动画的类型定义在 animation.ts —— 那边需要 TypographyDocument，两边
 * 互相引用，所以**两边的 import 都必须是 `import type`**（编译期擦除，
 * 不产生运行时循环依赖）。这里重新导出，调用方从 document.ts 或
 * animation.ts 取都一样。
 */
export type { ElementAnimation };

export interface Size {
  w: number;
  h: number;
}

/** 渐变的一个色标。`offset` 是 0..1。 */
export interface PaintStop {
  offset: number;
  color: string;
}

/**
 * 程序化纹理的图案。都是**参数化生成**的 SVG `<pattern>`，不是位图 ——
 * 位图要么进工程文件变成大 blob（违反 AGENTS §1.7 的「素材用引用而非拷贝」），
 * 要么就要一套内嵌素材表。程序化生成还顺带解决了「缩放不糊」。
 */
export type TexturePattern = 'dots' | 'grid' | 'diagonal' | 'cross' | 'checker' | 'wave';

export const TEXTURE_PATTERNS: { id: TexturePattern; labelKey: MessageKey }[] = [
  { id: 'dots', labelKey: 'paint.dots' },
  { id: 'grid', labelKey: 'paint.grid' },
  { id: 'diagonal', labelKey: 'paint.diagonal' },
  { id: 'cross', labelKey: 'paint.cross' },
  { id: 'checker', labelKey: 'paint.checker' },
  { id: 'wave', labelKey: 'paint.wave' },
];

/**
 * 填充。
 *
 * 四种都是**同一层的声明**（不是「纯色 + 可选的覆盖」）：一个元素只有一种填充，
 * 用联合类型表达之后，「渐变 + 纯色同时存在时谁赢」这类问题从类型上就不存在。
 * 渲染统一走 SVG `fill="url(#…)"` + `<defs>`（见 render-dom.ts），
 * 于是圆角/描边/布尔这些路径相关的功能全部照常工作。
 */
export type Paint =
  | { kind: 'none' }
  | { kind: 'solid'; color: string }
  /** 线性渐变。`angle` 是**度**：0 = 从左到右，顺时针增大（屏幕坐标，y 向下）。 */
  | { kind: 'linear'; angle: number; stops: PaintStop[] }
  /** 径向渐变，从中心向外。 */
  | { kind: 'radial'; stops: PaintStop[] }
  | {
      kind: 'texture';
      pattern: TexturePattern;
      /** 图案线/点的颜色。 */
      color: string;
      /** 底色。 */
      bg: string;
      /** 图案周期（文档 px）。 */
      scale: number;
      /** 线宽（文档 px）。 */
      thickness: number;
    };

export interface Stroke {
  color: string;
  width: number;
  style?: 'solid' | 'dashed' | 'dotted';
}

/**
 * CSS mix-blend-mode 全量。
 * **与片段层的 8 种 GL blend 是两套东西**：那个作用在合成阶段的两张纹理之间，
 * 这个作用在文档内部的 DOM 元素之间。别混。
 */
export type MixBlend =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

/** 混合模式表。存文案键而非字符串 —— 理由见 effects/types.ts 的注释。 */
export const MIX_BLENDS: { id: MixBlend; labelKey: MessageKey }[] = [
  { id: 'normal', labelKey: 'blend.normal' },
  { id: 'multiply', labelKey: 'blend.multiply' },
  { id: 'screen', labelKey: 'blend.screen' },
  { id: 'overlay', labelKey: 'blend.overlay' },
  { id: 'darken', labelKey: 'blend.darken' },
  { id: 'lighten', labelKey: 'blend.lighten' },
  { id: 'color-dodge', labelKey: 'blend.colorDodge' },
  { id: 'color-burn', labelKey: 'blend.colorBurn' },
  { id: 'hard-light', labelKey: 'blend.hardLight' },
  { id: 'soft-light', labelKey: 'blend.softLight' },
  { id: 'difference', labelKey: 'blend.difference' },
  { id: 'exclusion', labelKey: 'blend.exclusion' },
  { id: 'hue', labelKey: 'blend.hue' },
  { id: 'saturation', labelKey: 'blend.saturation' },
  { id: 'color', labelKey: 'blend.color' },
  { id: 'luminosity', labelKey: 'blend.luminosity' },
];

export interface TextureFrame {
  /** 旋转前外接框左上角（**文档像素**）。 */
  x: number;
  y: number;
  /** 旋转前外接框尺寸（**文档像素**）。 */
  w: number;
  h: number;
  /** 绕框中心旋转，弧度。 */
  rot: number;
}

export interface ElementBase {
  id: string;
  name: string;
  frame: TextureFrame;
  blend: MixBlend;
  /** 0..1 */
  opacity: number;
  visible: boolean;
  locked: boolean;
  animations: ElementAnimation[];
  /**
   * 所属组合 id。undefined = 不属于任何组合。
   *
   * 组合**不改变 z 序的表达方式** —— z 依然是 `elements` 数组下标（见文件头）。
   * 一个组合只是「这几个元素在数组里连续、且共用一个 groupId」，于是
   * 「谁盖着谁」这条不变量的唯一真源没有被动过。
   *
   * 代价是：**成组时必须把成员挪到一起**（见 groups.ts 的 `groupElements`）。
   */
  groupId?: string;
}

/**
 * 组合（Group）。
 *
 * 组合自己不画内容，它只是一层**共享的 CSS 外壳**（背景 / 边框 / 圆角 /
 * 内边距），画在成员的下面 —— 这正是「组合共享背景色、边框等 CSS 属性」
 * 的直接实现，也让成员本身仍是普通的文本/图形元素，不引入嵌套文档模型。
 */
export interface TypographyGroup {
  id: string;
  name: string;
  fill: Paint;
  stroke: Stroke | null;
  /** 外框圆角（px）。 */
  radius: number;
  /** 内边距：外壳比成员外接框大出这么多（px）。 */
  padding: number;
}

export interface TextStyle {
  fontFamily: string;
  /** px */
  fontSize: number;
  /** 100..900 */
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  /** px */
  letterSpacing: number;
  /** 倍数（CSS 数字 line-height） */
  lineHeight: number;
  align: 'left' | 'center' | 'right' | 'justify';
  /** 框内垂直对齐 */
  vAlign: 'top' | 'middle' | 'bottom';
  color: string;
  textDecoration: 'none' | 'underline' | 'line-through';
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** M4 预留；CSS text-autospace 普及前恒为 'none'。 */
  textAutospace?: 'none' | 'normal';
  writingMode: 'horizontal-tb' | 'vertical-rl';
}

export interface TextElement extends ElementBase {
  kind: 'text';
  /**
   * 富文本内容 —— **唯一真源**。
   *
   * 曾经是 `text: string`。改成 runs 之后，「纯文本」不再是一个要同步维护的
   * 第二个字段，而是 `plainTextOf(runs)` 这个派生量（见 rich-text.ts）。
   * 两个字段互为真源的话，迟早出现「改了 A 忘了 B」。
   */
  runs: TextRun[];
  style: TextStyle;
  /** true = 宽固定、高随内容（PPT 文本框的默认行为）。 */
  autoHeight: boolean;
}

export type ShapeKind =
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'triangle'
  | 'star'
  | 'polygon'
  | 'trapezoid'
  | 'parallelogram'
  | 'arrow'
  | 'ring'
  | 'frame'
  | 'pie'
  | 'svg';

export interface ShapeElement extends ElementBase {
  kind: 'shape';
  shape: ShapeKind;
  fill: Paint;
  stroke: Stroke | null;
  /**
   * **顶点圆角**，按像素计。对所有多边形类图形有效（矩形 / 三角形 / 星形 /
   * 正多边形 / 梯形 / 平行四边形 / 箭头 / 方框），由 `roundPolygonPath` 统一实现。
   * 早期它只对矩形生效 —— 那是「矩形走 CSS、别的走 SVG」留下的历史包袱。
   */
  radius?: number;
  /** star / polygon 的边数。 */
  sides?: number;
  /** star 的**谷半径比例**（0..1）。越小越锐利 —— 这就是「拖动控点改锐利度」的那个量。 */
  waist?: number;
  /** ring / frame 的壁厚（文档 px）。 */
  inner?: number;
  /** pie 的张角（度）。 */
  angle?: number;
  /** shape === 'svg' 时的路径数据（viewBox 0 0 100 100）。 */
  path?: string;
}

export interface ImageElement extends ElementBase {
  kind: 'image';
  assetId: string;
  fit: 'fill' | 'contain' | 'cover' | 'none';
  radius?: number;
  /** 裁剪窗，相对源图 0..1。缺省即全图。 */
  crop?: { x: number; y: number; w: number; h: number };
}

export type TypographyElement = TextElement | ShapeElement | ImageElement;

/**
 * 字体引用。**字体字节绝不进 project.json**（AGENTS §1.7 + M5「素材用引用
 * 而非拷贝」）：9 MB 的中文字体会把工程文件变成不可用的大 blob。
 *
 * 注意 Project.assets 的 Asset.kind 目前只有 'audio' | 'image'，**没有 'font'** ——
 * M4 的字体走运行期 FontRegistry + 这里的引用，不走 assets。
 */
export interface FontRef {
  id: string;
  family: string;
  /** sfnt = TTF/OTF（可被 HarfBuzz 子集化）；woff/woff2 只能整体内联。 */
  format: 'sfnt' | 'woff2' | 'woff';
  source: { kind: 'builtin' } | { kind: 'file'; path?: string; hash?: string };
}

export interface TypographyDocument {
  /** 文档自然尺寸 px = 光栅化 1.0x 的基准。 */
  size: Size;
  background: Paint;
  /** 数组顺序即 z 序（0 最底，末位最前）。 */
  elements: TypographyElement[];
  fonts: FontRef[];
  /**
   * 组合表。**可选**：老工程没有这个字段，读的时候一律 `?? []`
   * （不做 schema 迁移 —— 缺省语义就是「没有组合」，迁移反而多一个会失败的步骤）。
   */
  groups?: TypographyGroup[];
}

/** 层级调整操作。与 geometry.ts 无关，所以放在文档模型这边。 */
export type ZOrderOp = 'front' | 'back' | 'forward' | 'backward';

/**
 * 元素在 DOM 里的身份标记（见 render-dom.ts）。
 * 放在这里是因为 animation.ts 的样式表规则也要按它选元素 —— 那两个模块
 * 都依赖 document.ts，把常量放这里可以避免它们互相 import。
 */
export const EL_ID_ATTR = 'data-el-id';

/** 文档**根**节点的标记。`syncDocDom` 靠它把「外层容器」和「文档根」区分开。 */
export const DOC_ROOT_ATTR = 'data-typo-doc';

/**
 * 组合外壳节点的标记。
 *
 * 外壳**不是元素**（没有 `data-el-id`），它只是组共享的那层 CSS 盒子 ——
 * 用一个独立的属性标记，`syncDocDom` 才能把它和元素节点分开处理。
 */
export const GROUP_ID_ATTR = 'data-group-id';

/**
 * 行内文本段的标记（DOM 侧）。
 *
 * 属性值是这一段的 `TextSpanStyle` 的 **JSON**，不是 CSS 文本 ——
 * 从 CSS 反解会丢掉「没有覆盖」和「覆盖成默认值」的区别，而两者的语义不同
 * （前者跟随元素级，后者是钉死的）。
 */
export const SPAN_ATTR = 'data-run';

/**
 * 编辑区当前内容对应的 runs 签名。
 *
 * 同步据此判断「要不要重建文本节点」：签名没变就一个节点都不动 —— 这是
 * 打字时不被抹掉、光标不被弹回的关键。应用行内格式时签名变了才重建。
 */
export const RUNS_SIG_ATTR = 'data-runs-sig';

/**
 * 编辑区已经装过输入守卫（回车 / 粘贴接管）的标记。
 *
 * 文本节点会在「应用行内格式」时被重建，监听器随之消失 —— 所以每次同步之后
 * 都要检查一次并按需重装。这个属性让重装是幂等的。
 */
export const GUARDS_ATTR = 'data-guards';

/**
 * 富文本内层容器的标记。它只是为了避免 flex 把每段文字块级化（见
 * `runsWrapperStyle` 的说明），**不是内容** —— 遍历时透明穿过。
 */
export const RUNS_WRAP_ATTR = 'data-runs-wrap';

/* ------------------------------------------------------------ 默认值 */

/** 内置西文字体（OFL，随软件分发）。中文字体由用户自备，见 FontRegistry。 */
export const DEFAULT_FONT_FAMILY = 'Inter';

export const DEFAULT_FONT_SIZE_RATIO = 0.09;

export function defaultFontSize(size: Size): number {
  // 跟着文档高度走：1080 → 97px，720 → 65px。比写死 96 更经得起改分辨率。
  return Math.max(8, Math.round(size.h * DEFAULT_FONT_SIZE_RATIO));
}

export function defaultTextStyle(size: Size): TextStyle {
  return {
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: defaultFontSize(size),
    fontWeight: 700,
    fontStyle: 'normal',
    letterSpacing: 0,
    lineHeight: 1.2,
    align: 'center',
    vAlign: 'middle',
    color: '#ffffff',
    textDecoration: 'none',
    textTransform: 'none',
    textAutospace: 'none',
    writingMode: 'horizontal-tb',
  };
}

/** 文本框在文档里居中、宽占 80%、高占 16%（autoHeight 下高度只是提示）。 */
function defaultTextFrame(size: Size): TextureFrame {
  const w = Math.round(size.w * 0.8);
  const h = Math.round(size.h * 0.16);
  return { x: Math.round((size.w - w) / 2), y: Math.round((size.h - h) / 2), w, h, rot: 0 };
}

/** 形状默认居中、边长取短边的 30%。 */
function defaultShapeFrame(size: Size): TextureFrame {
  const d = Math.round(Math.min(size.w, size.h) * 0.3);
  return { x: Math.round((size.w - d) / 2), y: Math.round((size.h - d) / 2), w: d, h: d, rot: 0 };
}

function baseDefaults(size: Size, over: Partial<ElementBase>): Omit<ElementBase, 'id'> & { id: string } {
  return {
    id: over.id ?? newId(),
    name: over.name ?? '',
    frame: over.frame ?? defaultShapeFrame(size),
    blend: over.blend ?? 'normal',
    opacity: over.opacity ?? 1,
    visible: over.visible ?? true,
    locked: over.locked ?? false,
    animations: over.animations ?? [],
  };
}

/* ------------------------------------------------------------ 构造 */

export function createTypographyDocument(size: Size = { w: 1920, h: 1080 }): TypographyDocument {
  return {
    size: { w: Math.max(2, Math.round(size.w)), h: Math.max(2, Math.round(size.h)) },
    background: { kind: 'none' },
    elements: [],
    fonts: [],
    groups: [],
  };
}

export function createTextElement(
  size: Size,
  over: Partial<TextElement> & { text?: string } = {},
): TextElement {
  const base = baseDefaults(size, over);
  return {
    ...base,
    name: over.name ?? tr('typo.defaultTextName'),
    frame: over.frame ?? defaultTextFrame(size),
    kind: 'text',
    // `text` 只是构造期的便利入参（老调用点与测试都在用），落库的只有 runs。
    runs: over.runs ?? runsFromText(over.text ?? tr('typo.defaultText')),
    style: over.style ?? defaultTextStyle(size),
    autoHeight: over.autoHeight ?? true,
  };
}

/**
 * 填充的**局部更新**（纯函数）。
 *
 * 为什么不是「setFill(paint) 整份替换」：Ribbon 上是一堆独立控件
 * （类型下拉、两个颜色、角度、图案、周期…），每个只知道自己那一项。
 * 让它们各自拼一份完整的 Paint 意味着每加一个控件就要重新拼一次所有字段，
 * 而且「改角度时把纹理参数抹掉」这类 bug 会藏在每一次拼接里。
 *
 * 色标的语义（刻意只做两个色标）：`color` = 第一个色标 / 纯色 / 纹理线色，
 * `color2` = 第二个色标 / 纹理底色。多于两个色标的编辑器属于「等真有人
 * 需要再说」的范畴，而数据模型里 stops 本来就是数组，将来加不需要迁移。
 */
export interface ShapePaintPatch {
  kind?: Paint['kind'];
  color?: string;
  color2?: string;
  angle?: number;
  pattern?: TexturePattern;
  scale?: number;
  thickness?: number;
}

function stopColorOf(paint: Paint, index: number): string | null {
  if (paint.kind !== 'linear' && paint.kind !== 'radial') return null;
  return paint.stops[index]?.color ?? null;
}

export const DEFAULT_PAINT_A = '#6f64ef';
export const DEFAULT_PAINT_B = '#00e3c0';

export function applyPaintPatch(paint: Paint, patch: ShapePaintPatch): Paint {
  const kind = patch.kind ?? paint.kind;
  // 换类型时把能带过去的颜色带过去：用户先在纯色里调好一个色，切到渐变
  // 却发现它变回默认紫，是这类控件最烦的体验。
  const a = patch.color ?? stopColorOf(paint, 0) ?? (paint.kind === 'solid' ? paint.color : null) ?? (paint.kind === 'texture' ? paint.color : null) ?? DEFAULT_PAINT_A;
  const b = patch.color2 ?? stopColorOf(paint, 1) ?? (paint.kind === 'texture' ? paint.bg : null) ?? DEFAULT_PAINT_B;

  switch (kind) {
    case 'none':
      return { kind: 'none' };
    case 'solid':
      return { kind: 'solid', color: a };
    case 'linear':
      return {
        kind: 'linear',
        angle: patch.angle ?? (paint.kind === 'linear' ? paint.angle : 0),
        stops: [
          { offset: 0, color: a },
          { offset: 1, color: b },
        ],
      };
    case 'radial':
      return {
        kind: 'radial',
        stops: [
          { offset: 0, color: a },
          { offset: 1, color: b },
        ],
      };
    case 'texture':
      return {
        kind: 'texture',
        pattern: patch.pattern ?? (paint.kind === 'texture' ? paint.pattern : 'dots'),
        color: a,
        bg: patch.color2 ?? (paint.kind === 'texture' ? paint.bg : 'rgba(0,0,0,0)'),
        scale: patch.scale ?? (paint.kind === 'texture' ? paint.scale : 28),
        thickness: patch.thickness ?? (paint.kind === 'texture' ? paint.thickness : 3),
      };
    default:
      return paint;
  }
}

export function createShapeElement(  size: Size,
  shape: ShapeKind,
  over: Partial<ShapeElement> = {},
): ShapeElement {
  const base = baseDefaults(size, over);
  // 直线只该描边：默认给填充的话它什么都看不见（面积为零），
  // 用户会以为「插入图形」坏了。
  const strokeOnly = shape === 'line';
  const line = defaultShapeFrame(size);
  return {
    ...base,
    name: over.name ?? tr('typo.defaultShapeName'),
    frame:
      over.frame ??
      (strokeOnly ? { ...line, y: Math.round(size.h / 2) - 1, h: 2 } : line),
    kind: 'shape',
    shape,
    fill: over.fill ?? (strokeOnly ? { kind: 'none' } : { kind: 'solid', color: '#6f64ef' }),
    stroke: over.stroke ?? (strokeOnly ? { color: '#ffffff', width: 4, style: 'solid' } : null),
    radius: over.radius,
    sides: over.sides,
    waist: over.waist,
    inner: over.inner,
    angle: over.angle,
    path: over.path,
  };
}

export function createImageElement(
  size: Size,
  assetId: string,
  over: Partial<ImageElement> = {},
): ImageElement {
  const base = baseDefaults(size, over);
  return {
    ...base,
    name: over.name ?? tr('typo.defaultImageName'),
    kind: 'image',
    assetId,
    fit: over.fit ?? 'cover',
    radius: over.radius,
    crop: over.crop,
  };
}

/* ------------------------------------------------------------ 查询与修改 */

/**
 * 返回**文档里的真实对象**（不是拷贝）。
 * 手势层要直接改它，所以刻意不给副本 —— 给副本会踩 store 那条
 * 「改了浅拷贝 → commit 判定无变化 → 不入撤销栈也不 bump version」的老坑。
 */
export function elementById(doc: TypographyDocument, id: string): TypographyElement | null {
  return doc.elements.find((e) => e.id === id) ?? null;
}

export function elementsByIds(doc: TypographyDocument, ids: string[]): TypographyElement[] {
  const set = new Set(ids);
  return doc.elements.filter((e) => set.has(e.id));
}

/** 删除若干元素。返回新数组（纯函数）。 */
export function removeElements(doc: TypographyDocument, ids: string[]): TypographyDocument {
  const set = new Set(ids);
  return { ...doc, elements: doc.elements.filter((e) => !set.has(e.id)) };
}

/**
 * 层级调整。**保持被选元素的相对顺序**。
 *
 * forward / backward 的遍历方向很关键：朝上移时从最上层开始、朝下移时从最下层
 * 开始，否则同一批元素会互相推挤导致净位移小于 1 层。
 */
export function reorderElements(
  doc: TypographyDocument,
  ids: string[],
  op: ZOrderOp,
): TypographyDocument {
  const set = new Set(ids);
  const els = doc.elements;

  if (op === 'front' || op === 'back') {
    const sel = els.filter((e) => set.has(e.id));
    const rest = els.filter((e) => !set.has(e.id));
    return { ...doc, elements: op === 'front' ? [...rest, ...sel] : [...sel, ...rest] };
  }

  const next = els.slice();
  const dir = op === 'forward' ? 1 : -1;
  const idxs: number[] = [];
  for (let i = 0; i < next.length; i++) if (set.has(next[i]!.id)) idxs.push(i);
  if (dir === 1) idxs.reverse();

  for (const i of idxs) {
    const j = i + dir;
    if (j < 0 || j >= next.length) continue;
    // 相邻的元素也被选中时不动 —— 交换它们等于原地打转。
    if (set.has(next[j]!.id)) continue;
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return { ...doc, elements: next };
}

/**
 * 改文档尺寸，所有元素按比例重排。
 *
 * 字号/字距/描边宽度按 `min(sx, sy)` 缩放而不是各轴分别缩放：文字没有
 * 「纵向拉伸」这种合法语义，按各自轴缩会得到一个被压扁的字。取 min 保证
 * 缩小文档时文字不会反而溢出。
 */
export function resizeDocument(doc: TypographyDocument, size: Size): TypographyDocument {
  const w = Math.max(2, Math.round(size.w));
  const h = Math.max(2, Math.round(size.h));
  const sx = w / doc.size.w;
  const sy = h / doc.size.h;
  const k = Math.min(sx, sy);

  const elements = doc.elements.map((el) => {
    const next: TypographyElement = {
      ...el,
      frame: {
        x: el.frame.x * sx,
        y: el.frame.y * sy,
        w: el.frame.w * sx,
        h: el.frame.h * sy,
        rot: el.frame.rot,
      },
    };
    if (next.kind === 'text') {
      next.style = {
        ...next.style,
        fontSize: Math.max(1, next.style.fontSize * k),
        letterSpacing: next.style.letterSpacing * k,
      };
    }
    if (next.kind === 'shape' && next.stroke) {
      next.stroke = { ...next.stroke, width: next.stroke.width * k };
    }
    return next;
  });

  return { ...doc, size: { w, h }, elements };
}

/**
 * 文档用到的全部码点（**子集化的输入**，见 font/subset-hb.ts）。
 *
 * 按码点排序而不是按出现顺序：字形集只要内容相同就必须产出同一个字符串，
 * 否则「打字顺序不同 → 缓存键不同 → 反复重新子集化」。
 * 排序用 codePointAt 而非码元，代理对（emoji / 生僻字）不会被拆坏。
 */
export function collectGlyphs(doc: TypographyDocument): string {
  const set = new Set<string>();
  for (const el of doc.elements) {
    if (el.kind !== 'text') continue;
    // 每一段都要收 —— 只收第一段的话，后加粗的那几个字会缺字形（渲染成豆腐块）。
    for (const run of el.runs) {
      // for...of 按**码点**切分字符串。不要改成按 .length 索引 —— 那会把代理对切碎。
      for (const ch of run.text) set.add(ch);
    }
  }
  return [...set].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!).join('');
}

/** 文档里出现的字体族（去重，按出现顺序）。**含行内覆盖的字体**。 */
export function usedFontFamilies(doc: TypographyDocument): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (f: string | undefined): void => {
    if (!f || seen.has(f)) return;
    seen.add(f);
    out.push(f);
  };
  for (const el of doc.elements) {
    if (el.kind !== 'text') continue;
    push(el.style.fontFamily);
    // 某一段单独换了字体的话，那个字体也得进子集化清单 ——
    // 漏了的表现是「那一段变成豆腐块」，而且只在导出时才看得出来。
    for (const run of el.runs) push(run.style?.fontFamily);
  }
  return out;
}

/** 文档用到的字体引用（按 usedFontFamilies 过滤 doc.fonts）。 */
export function usedFonts(doc: TypographyDocument): FontRef[] {
  const used = new Set(usedFontFamilies(doc));
  return doc.fonts.filter((f) => used.has(f.family));
}
