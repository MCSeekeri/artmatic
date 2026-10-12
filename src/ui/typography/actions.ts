/**
 * actions.ts — 排版编辑器的语义动作。
 *
 * Ribbon 的描述数组里挂的全是这里的函数。分这一层的理由：Ribbon 的按钮只该
 * 知道「点了我做什么」，不该知道「文档结构长什么样、怎么改才安全」。
 * 于是「加一个按钮」= 在 ribbon-defs 里加一行 + 可能在这里加一个函数，
 * 不需要碰任何组件。
 *
 * 所有写库都经 editorState（commit / 手势事务），这是撤销栈完整的唯一前提。
 */

import { browserPlatform } from '../../platform/browser';
import { appState } from '../app-state.svelte';
import { editorState } from './editor-state.svelte';
import { newId } from '../../core/schema';
import {
  DEFAULT_PAINT_A,
  applyPaintPatch,
  createImageElement,
  createShapeElement,
  createTextElement,
  type ImageElement,
  type MixBlend,
  type ShapeElement,
  type ShapePaintPatch,
  type Stroke,
  type TextStyle,
  type TextureFrame,
  type TypographyDocument,
  type TypographyElement,
  type ZOrderOp,
} from '../../typography/document';
import {
  alignElements,
  boundsOf,
  distribute,
  toRects,
  type AlignAxis,
  type Rect,
} from '../../typography/geometry';
import {
  createCustomAnimation,
  createPresetAnimation,
  parseCustomCss,
  type AnimPreset,
  type AnimTiming,
} from '../../typography/animation';
import { putImageBytes, mimeForImageFilename } from '../../typography/image-assets';
import {
  cloneFragment,
  expandToGroups,
  extractFragment,
  groupElements,
  groupList,
  groupsInSelection,
  ungroupElements,
  type GroupedFragment,
} from '../../typography/groups';
import { shapeGeometry, type ShapePreset } from '../../typography/shapes';
import { ICON_STROKE_WIDTH, iconGridFrames, type IconInsert } from '../../typography/icon-shapes';
import {
  insertNodeOnSegment,
  mapNodes,
  parsePathNodes,
  removeNode,
  serializePathNodes,
} from '../../typography/path-nodes';
import { booleanOp, multiToShape, shapeToMultiPolygon, type BoolOp } from '../../typography/path-ops';
import {
  applySpanStyle,
  clearSpanStyle as clearRunsSpanStyle,
  plainTextOf,
  SPAN_STYLE_KEYS,
  uniformSpanValue,
  type SpanStyleKey,
  type SpanStylePatch,
} from '../../typography/rich-text';
import { tr } from '../../i18n/index.svelte';

/* ------------------------------------------------------------ 选择集工具 */

function selectedIds(): Set<string> {
  return new Set(editorState.selectedIds);
}

/** 可写的元素（锁定的跳过）。 */
function writable(doc: TypographyDocument): TypographyElement[] {
  const ids = selectedIds();
  return doc.elements.filter((el) => ids.has(el.id) && !el.locked);
}

function onlyText(doc: TypographyDocument) {
  return writable(doc).filter((el): el is Extract<TypographyElement, { kind: 'text' }> => el.kind === 'text');
}

function onlyShape(doc: TypographyDocument) {
  return writable(doc).filter((el): el is ShapeElement => el.kind === 'shape');
}

/**
 * 把参数化图形**就地**转成路径（`shape: 'svg'`）。返回是否真的转了。
 *
 * 像素盒坐标 → 0..100 authored。各轴**分别**缩放是必须的：`svg` 图形渲染时会
 * 套一层 `scale(w/100, h/100)`，所以这里存 `100/w`、`100/h`，渲染时正好抵消。
 * 用统一的 100/短边的话，非等比盒里的圆角会变成椭圆弧。
 *
 * 参数化字段一并清掉：留着它们会让「图形格式」面板继续显示一排对当前形状
 * 毫无作用的滑杆（形状已经是那串路径了）。
 */
function shapeToPath(el: ShapeElement): boolean {
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
  el.radius = undefined;
  el.sides = undefined;
  el.waist = undefined;
  el.inner = undefined;
  el.angle = undefined;
  return true;
}

/**
 * 当前处于**顶点编辑态**的那个图形元素。
 *
 * 与 `onlyShape` 的区别很关键：那个返回「选择集里的图形」（可能多个、可能为空），
 * 这个返回「正在被编辑的那**一个**」。顶点写入必须唯一确定目标 —— 用 `onlyShape`
 * 的话，多选时拖一个锚点会把所有选中图形的路径一起改掉（而它们在几何上毫无关系）。
 */
function nodeEditShape(doc: TypographyDocument): ShapeElement | null {
  const id = editorState.nodeEditId;
  if (!id) return null;
  const el = doc.elements.find((e) => e.id === id);
  return el && el.kind === 'shape' ? el : null;
}

function onlyImage(doc: TypographyDocument) {
  return writable(doc).filter((el): el is ImageElement => el.kind === 'image');
}

function anyElement(doc: TypographyDocument): TypographyElement[] {
  return writable(doc);
}

/**
 * 写一个文本属性。**唯一实现** —— 提交路径与「拖动实时预览」路径共用，
 * 两处各写一份的话，「提交生效、预览不变」这类不一致迟早出现。
 */
function writeTextProp<K extends keyof TextStyle>(
  doc: TypographyDocument,
  key: K,
  value: TextStyle[K],
): void {
  for (const el of onlyText(doc)) el.style = { ...el.style, [key]: value };
}

/** 对齐目标框：画布，或选区外接框。 */
function targetRect(): Rect {
  const doc = editorState.doc;
  if (appState.typoAlignTarget === 'selection') {
    return boundsOf(toRects(editorState.selected));
  }
  const size = doc?.size ?? { w: 1920, h: 1080 };
  return { id: 'canvas', x: 0, y: 0, w: size.w, h: size.h };
}

/* ------------------------------------------------------------ 动作表 */

export interface TypographyActions {
  /* 文本 */
  setTextProp<K extends keyof TextStyle>(key: K, value: TextStyle[K]): void;
  /**
   * 文本属性的**统一写入口**：编辑中且选中了一段字 ⇒ 写行内覆盖；
   * 否则写元素级。Ribbon 上的文本控件一律走它 —— 让每个控件自己判断
   * 「现在改的是整块还是一段」等于把这个判断抄了 N 份。
   */
  setTextStyle<K extends SpanStyleKey>(key: K, value: TextStyle[K]): void;
  /** 直接写行内覆盖（`null` = 删掉这条覆盖，回到元素级）。 */
  setSpanStyle(patch: SpanStylePatch): void;
  /** 清掉选中范围的**全部**行内覆盖。 */
  clearSpanFormats(): void;
  /** 现在有没有「行内选区」（「清除格式」的可用性）。 */
  hasSpanRange(): boolean;
  /** 拖动调值时的实时预览（不入撤销栈，松手时 `endTextPropLive` 结算一笔）。 */
  setTextPropLive<K extends keyof TextStyle>(key: K, value: TextStyle[K]): void;
  /** 实时预览收尾。没在实时改就什么都不做。 */
  endTextPropLive(): void;
  setTextAlign(value: TextStyle['align']): void;
  setVAlign(value: TextStyle['vAlign']): void;
  toggleTextFlag(key: 'bold' | 'italic' | 'underline' | 'strike'): void;

  /* 插入 */
  addText(): void;
  addShape(preset: ShapePreset): void;
  addImage(): void;
  /** 插入一批图标（来自图标选择器），按给定顺序从左到右排成网格。 */
  addIcons(items: IconInsert[]): void;

  /* 通用元素属性 */
  setBlend(value: MixBlend): void;
  setOpacity(value: number): void;
  /**
   * 元素几何（属性面板的「位置 / 大小 / 旋转」）。
   *
   * 多选语义：改位置时以**首元素为锚整体平移**（相对位置保持），而不是把
   * 每个元素都设成同一个值 —— 后者会把它们叠在一起。宽 / 高 / 旋转只对单选
   * 有意义（多选时「那条边」没有唯一定义，与拖拽缩放不做组版本同源）：
   * 面板在多选时禁用它们，这里再兜一道，非单选直接忽略。
   */
  setFrame(patch: Partial<TextureFrame>): void;
  toggleFlag(key: 'locked' | 'visible'): void;
  duplicateSelection(): void;
  deleteSelection(): void;
  order(op: ZOrderOp): void;

  /* 剪贴板（编辑器内部，不碰系统剪贴板） */
  copySelection(): void;
  cutSelection(): void;
  pasteClipboard(): void;
  /** 剪贴板里有没有东西（右键菜单据此置灰「粘贴」）。 */
  hasClipboard(): boolean;

  /* 组合 */
  groupSelection(): void;
  ungroupSelection(): void;
  /** 选区里有没有可成组的东西（≥2 个元素）。 */
  canGroup(): boolean;
  /** 选区里有没有落在组合里的元素。 */
  canUngroup(): boolean;
  setGroupPaint(patch: ShapePaintPatch): void;
  setGroupStrokeColor(color: string): void;
  setGroupStrokeWidth(width: number): void;
  setGroupNumber(key: 'radius' | 'padding', value: number): void;

  /* 图形 */
  setShapeFill(color: string): void;
  /** 填充类型 / 渐变 / 纹理的**一处**写入路径（见 document.ts 的 applyPaintPatch）。 */
  setShapePaint(patch: ShapePaintPatch): void;
  /**
   * 文本**字形填充**的局部更新（渐变 / 径向 / 纹理）。
   *
   * 与图形填充共用 `applyPaintPatch` —— 只有渲染落点不同（字形走 CSS
   * `background-clip: text`，见 css.ts::textFillStyle）。`solid` / `none`
   * 对字形没有意义：纯色字形仍走 `style.color`，「跟随文字色」由
   * `clearTextFill` 把字段整个清掉。
   */
  setTextFill(patch: ShapePaintPatch): void;
  /** 清掉文本字形填充，回到 `style.color` 纯色字形。 */
  clearTextFill(): void;
  /**
   * **文本框背景**填充的局部更新（属性面板）。
   *
   * 与 `setTextFill` 是两层东西：那个是字形着色（`background-clip: text`），
   * 这个是画在文本元素外壳上的背景（文字之下）。见 TextElement.boxFill。
   */
  setTextBoxFill(patch: ShapePaintPatch): void;
  /** 文本框边框（颜色 / 宽度 / 线型）。局部更新，缺省字段沿用原值。 */
  setTextBoxStroke(patch: Partial<Stroke>): void;
  /**
   * 布尔运算（并 / 差 / 交 / 异或）。作用于选中的图形，结果为**一个** `svg` 图形。
   * 差集是「最前景那个减去其余」，与设计工具一致。
   */
  booleanShapes(op: BoolOp): void;
  /** 选中的图形够不够做布尔运算（≥2 个）。 */
  canBoolean(): boolean;
  setShapeStroke(color: string): void;
  setShapeStrokeWidth(width: number): void;
  setShapeStrokeStyle(style: 'solid' | 'dashed' | 'dotted'): void;
  setShapeRadius(radius: number): void;
  /** 形状参数（边数 / 锐利度 / 壁厚 / 张角）。所有图形共用一条写入路径。 */
  setShapeParam(key: 'sides' | 'waist' | 'inner' | 'angle', value: number): void;

  /* 顶点 / 控制点编辑 */
  /** 进入 / 退出顶点编辑（Ribbon 按钮与快捷键共用同一个入口）。 */
  toggleNodeEdit(): void;
  /** 把参数化图形转成路径。之后它的形状由顶点决定，参数控件不再适用。 */
  convertToPath(): void;
  /** 双击路径：在命中位置插一个锚点（de Casteljau 细分，形状不变）。 */
  addPathNode(hit: { sub: number; seg: number; t: number }): void;
  /** 双击锚点：删掉它（相邻两段合并成一段）。 */
  deletePathNode(index: number): void;

  /* 图片 */
  setImageFit(value: ImageElement['fit']): void;

  /* 对齐 */
  align(axis: AlignAxis): void;
  setAlignTarget(target: 'canvas' | 'selection'): void;

  /* 动画 */
  applyPreset(preset: AnimPreset): void;
  setAnimTiming(patch: Partial<AnimTiming>): void;
  /** 写入手写 keyframes 体。返回 false 表示代码非法（未写入）。 */
  applyCustomCss(css: string): boolean;
  clearAnimations(): void;

  /* 字体 */
  importFont(): void;
  /**
   * 读**本机已安装**的字体族，并进字体下拉。
   *
   * 与 `importFont` 的区别：那个是把字体**文件**注册进 `FontRegistry`（有字节、
   * 导出时可子集化嵌入）；这个只是拿到一串系统的族名 —— 不产生任何资产，
   * 换台机器就没有了。
   */
  loadLocalFonts(): void;

  /* 逃生舱 */
  /** 把排版文档 1:1 烘焙成一张 PNG，并把片段改成 image 源。 */
  flattenToImage(localSec: number): void;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/* ------------------------------------------------------------ 剪贴板
 *
 * 状态存在 `editorState.clipboard`（响应式），不在这里的模块作用域 ——
 * 原因见那边的注释：右键菜单的「粘贴」可用性必须跟着它变。
 * 这里只留纯函数。
 */
const PASTE_OFFSET = 24;

function writeClipboard(frag: GroupedFragment): void {
  editorState.clipboard = frag;
  editorState.pasteCount = 1;
}

/**
 * 当前的行内选区（**校验过它确实落在一个存在的文本元素上**）。
 *
 * 校验这一步不能省：编辑中切换元素 / 文档被重建时 `textRange` 可能指向一个
 * 已经不存在的元素，直接拿 start/end 去切片会切到别人身上。
 */
function textSpanRange(): { elId: string; start: number; end: number } | null {
  const r = editorState.textRange;
  if (!r) return null;
  const doc = editorState.doc;
  const el = doc?.elements.find((x) => x.id === r.elId);
  if (!el || el.kind !== 'text') return null;
  const total = plainTextOf(el.runs).length;
  const start = Math.max(0, Math.min(r.start, total));
  const end = Math.max(0, Math.min(r.end, total));
  return end > start ? { elId: r.elId, start, end } : null;
}

/**
 * 当前**格式上下文**里某个文本属性的生效值。
 *
 * 有行内选区 ⇒ 取区间上的统一值（混合时取区间起点的值，交给调用方决定要不要
 * 当作「不定态」）；没有 ⇒ 取首个选中文本元素的元素级值。
 * 返回 null = 根本没有作用对象（按钮那时本来就是禁用态）。
 */
function currentTextValue<K extends SpanStyleKey>(key: K): TextStyle[K] | null {
  const doc = editorState.doc;
  const range = textSpanRange();
  if (doc && range) {
    const el = doc.elements.find((x) => x.id === range.elId);
    if (el && el.kind === 'text') {
      return uniformSpanValue(el.runs, range.start, range.end, el.style, key).value;
    }
  }
  const t = editorState.selected.find((e) => e.kind === 'text');
  return t && t.kind === 'text' ? t.style[key] : null;
}

/** 把片段复制一份并落进文档（粘贴 / 复制 / Ctrl 拖曳共用）。 */
function placeFragment(
  frag: GroupedFragment,
  offset: number,
  select: boolean,
  label: string,
): TypographyElement[] {
  const clone = cloneFragment(frag, offset, newId);
  editorState.commit(label, (doc) => {
    doc.elements = [...doc.elements, ...clone.elements];
    if (clone.groups.length) doc.groups = [...(doc.groups ?? []), ...clone.groups];
  });
  if (select) {
    queueMicrotask(() => editorState.setSelection(clone.elements.map((e) => e.id)));
  }
  return clone.elements;
}

export function createTypographyActions(): TypographyActions {
  return {
    /* ---------------------------------------------------------- 文本 */

    setTextProp(key, value) {
      // 实时预览进行中：这一笔属于那个手势事务，不能再开一条撤销记录
      // （否则一次拖拽会变成「预览一条 + 提交一条」两条，Ctrl+Z 要按两次）。
      if (editorState.gestureActive) {
        editorState.live((doc) => writeTextProp(doc, key, value));
        return;
      }
      editorState.commit(tr('typo.undo.textProp'), (doc) => writeTextProp(doc, key, value));
    },

    setTextStyle(key, value) {
      // 行内选区只对「可以行内覆盖」的属性有意义；行高 / 对齐这类段落属性
      // 永远写元素级（同一行里两种行高谁也画不对，见 rich-text.ts）。
      if (this.hasSpanRange() && (SPAN_STYLE_KEYS as readonly string[]).includes(key)) {
        this.setSpanStyle({ [key]: value } as SpanStylePatch);
        return;
      }
      this.setTextProp(key, value);
    },

    setSpanStyle(patch) {
      const r = textSpanRange();
      if (!r) return;
      editorState.commit(tr('typo.undo.spanStyle'), (d) => {
        const el = d.elements.find((x) => x.id === r.elId);
        if (el && el.kind === 'text') el.runs = applySpanStyle(el.runs, r.start, r.end, patch);
      });
    },

    clearSpanFormats() {
      const r = textSpanRange();
      if (!r) return;
      editorState.commit(tr('typo.undo.clearFormat'), (d) => {
        const el = d.elements.find((x) => x.id === r.elId);
        if (el && el.kind === 'text') el.runs = clearRunsSpanStyle(el.runs, r.start, r.end);
      });
    },

    hasSpanRange() {
      return textSpanRange() !== null;
    },

    setTextPropLive(key, value) {      if (!editorState.gestureActive) editorState.beginGesture();
      editorState.live((doc) => writeTextProp(doc, key, value));
    },

    endTextPropLive() {
      if (!editorState.gestureActive) return;
      editorState.endGesture(tr('typo.undo.textProp'));
    },

    setTextAlign(value) {
      editorState.commit(tr('typo.undo.textAlign'), (doc) => {
        for (const el of onlyText(doc)) el.style = { ...el.style, align: value };
      });
    },

    setVAlign(value) {
      editorState.commit(tr('typo.undo.vAlign'), (doc) => {
        for (const el of onlyText(doc)) el.style = { ...el.style, vAlign: value };
      });
    },

    toggleTextFlag(flag) {
      /*
       * 开关的语义是「在**当前生效值**上取反」，不是「把元素级取反」。
       * 一段字已经被行内加粗过、而元素级不是粗体时，按钮是按下态 —— 再点一次
       * 必须取消它，而不是把元素级设成粗体（那看起来像「点了没反应，反而更粗了」）。
       */
      if (flag === 'bold') {
        const v = currentTextValue('fontWeight');
        if (v === null) return;
        this.setTextStyle('fontWeight', v >= 600 ? 400 : 700);
        return;
      }
      if (flag === 'italic') {
        const v = currentTextValue('fontStyle');
        if (v === null) return;
        this.setTextStyle('fontStyle', v === 'italic' ? 'normal' : 'italic');
        return;
      }
      const v = currentTextValue('textDecoration');
      if (v === null) return;
      const want = flag === 'underline' ? 'underline' : 'line-through';
      // 两种装饰共用一个 CSS 属性，所以「当前是另一种装饰」时直接换成新的，
      // 而不是先取消——用户的意图是「要这个」，不是「不要那个」。
      this.setTextStyle('textDecoration', v === want ? 'none' : want);
    },

    /* ---------------------------------------------------------- 插入 */

    addText() {
      editorState.commit(tr('typo.undo.addText'), (doc) => {
        const el = createTextElement(doc.size);
        doc.elements = [...doc.elements, el];
        queueMicrotask(() => editorState.selectOnly(el.id));
      });
    },

    addShape(preset) {
      editorState.commit(tr('typo.undo.addShape'), (doc) => {
        const el = createShapeElement(doc.size, preset.id, {
          radius: preset.radius,
          sides: preset.sides,
          waist: preset.waist,
          angle: preset.angle,
        });
        doc.elements = [...doc.elements, el];
        queueMicrotask(() => editorState.selectOnly(el.id));
      });
    },

    /**
     * 插入图标 = 插入一组「无填充 + 描边」的 `shape:'svg'` 图形。
     *
     * 为什么不是图片：图标语义正好落在 ShapeElement 的表达力里（见
     * `icon-shapes.ts`），于是描边颜色 / 线宽 / 混合模式这些既有控件插入后
     * 立刻可用，也不占素材表。元素名直接用图标名（`arrow-up` 这样）——
     * 图层面板里一眼能认出是哪个图标，比一排「形状」有用得多。
     */
    addIcons(items) {
      if (!items.length) return;
      editorState.commit(tr('typo.undo.addIcons'), (doc) => {
        const frames = iconGridFrames(doc.size, items.length);
        const els = items.map((item, i) =>
          createShapeElement(doc.size, 'svg', {
            name: item.name,
            frame: frames[i],
            path: item.path,
            fill: { kind: 'none' },
            stroke: { color: DEFAULT_PAINT_A, width: ICON_STROKE_WIDTH, style: 'solid' },
          }),
        );
        doc.elements = [...doc.elements, ...els];
        // 一次事务 = 一次撤销；插入完直接选中，接着就能拖走或改颜色。
        queueMicrotask(() => editorState.setSelection(els.map((e) => e.id)));
      });
    },

    addImage() {
      void (async () => {
        const picked = await browserPlatform.pickImageFile();
        if (!picked) return;
        const assetId = newId();
        // ① 渲染期解引用：snapDOM 要能把 <img> 取下来内联进快照。
        putImageBytes(assetId, picked.data, mimeForImageFilename(picked.name));
        // ② 持久化：字节进素材仓，并在工程的素材表里登记一条。
        //    两个都要 —— 只有 ① 保存时找不到字节（重开丢图），
        //    只有 ② 当时画面上就是空的。
        appState.assets.put(assetId, new Uint8Array(picked.data.slice(0)), {
          kind: 'image',
          name: picked.name,
          originName: picked.name,
        });
        appState.store.commit(tr('typo.undo.registerImageAsset'), (p) => {
          p.assets[assetId] = { id: assetId, kind: 'image', name: picked.name };
        });
        editorState.commit(tr('typo.undo.addImage'), (doc) => {
          const el = createImageElement(doc.size, assetId, { name: picked.name });
          doc.elements = [...doc.elements, el];
          queueMicrotask(() => editorState.selectOnly(el.id));
        });
      })();
    },

    /* ---------------------------------------------------- 通用属性 */

    setBlend(value) {
      editorState.commit(tr('typo.undo.blend'), (doc) => {
        for (const el of anyElement(doc)) el.blend = value;
      });
    },

    setOpacity(value) {
      editorState.commit(tr('typo.undo.opacity'), (doc) => {
        for (const el of anyElement(doc)) el.opacity = Math.max(0, Math.min(1, value));
      });
    },

    setFrame(patch) {
      const ids = new Set(editorState.groupAwareIds);
      if (!ids.size) return;
      editorState.commit(tr('typo.undo.frame'), (doc) => {
        const targets = doc.elements.filter((el) => ids.has(el.id) && !el.locked);
        const anchor = targets[0];
        if (!anchor) return;
        const single = targets.length === 1;
        const dx = patch.x !== undefined ? patch.x - anchor.frame.x : 0;
        const dy = patch.y !== undefined ? patch.y - anchor.frame.y : 0;
        for (const el of targets) {
          const f = el.frame;
          el.frame = {
            x: patch.x !== undefined ? (single ? patch.x : f.x + dx) : f.x,
            y: patch.y !== undefined ? (single ? patch.y : f.y + dy) : f.y,
            // 宽 / 高 / 旋转只在单选时生效（见接口注释）。宽高至少 1px：
            // 0 宽的元素在画布上再也点不回来。
            w: single && patch.w !== undefined ? Math.max(1, patch.w) : f.w,
            h: single && patch.h !== undefined ? Math.max(1, patch.h) : f.h,
            rot: single && patch.rot !== undefined ? patch.rot : f.rot,
          };
        }
      });
    },

    toggleFlag(key) {
      editorState.commit(key === 'locked' ? tr('typo.undo.lock') : tr('typo.undo.hide'), (doc) => {
        for (const el of writable(doc)) el[key] = !el[key];
      });
    },

    duplicateSelection() {
      const doc = editorState.doc;
      if (!doc) return;
      const frag = extractFragment(doc, editorState.groupAwareIds);
      if (!frag.elements.length) return;
      placeFragment(frag, 24, true, tr('typo.undo.duplicate'));
    },

    deleteSelection() {
      const ids = new Set(selectedIds());
      if (!ids.size) return;
      editorState.commit(tr('typo.undo.delete'), (doc) => {
        doc.elements = doc.elements.filter((el) => !ids.has(el.id) || el.locked);
      });
      editorState.clearSelection();
    },

    order(op) {
      // 唯一实现在 editorState（图层面板的上下移也走它），这里只做转发。
      editorState.order(op);
    },

    /* ---------------------------------------------------------- 剪贴板 */

    copySelection() {
      const doc = editorState.doc;
      if (!doc) return;
      writeClipboard(extractFragment(doc, editorState.groupAwareIds));
    },

    cutSelection() {
      const doc = editorState.doc;
      if (!doc) return;
      const frag = extractFragment(doc, editorState.groupAwareIds);
      if (!frag.elements.length) return;
      writeClipboard(frag);
      this.deleteSelection();
    },

    pasteClipboard() {
      const frag = editorState.clipboard;
      if (!frag?.elements.length) return;
      // 连续粘贴要一份比一份更靠右下，否则第二份会**完全盖住**第一份，
      // 看起来像「粘贴没反应」。剪贴板里存的始终是**未偏移**的原件，
      // 所以偏移量随次数累加，而不是在已偏移的副本上再偏移。
      placeFragment(frag, PASTE_OFFSET * editorState.pasteCount, true, tr('typo.undo.paste'));
      editorState.pasteCount += 1;
    },

    hasClipboard() {
      return (editorState.clipboard?.elements.length ?? 0) > 0;
    },

    /* ---------------------------------------------------------- 组合 */

    groupSelection() {
      const doc = editorState.doc;
      if (!doc) return;
      const ids = editorState.selectedIds;
      if (ids.length < 2) return;
      const name = tr('typo.groupName');
      editorState.commit(tr('typo.undo.group'), (d) => {
        const next = groupElements(d, ids, name);
        if (next === d) return;
        d.elements = next.elements;
        d.groups = next.groups;
      });
      // 成组后整体选中（成员 id 没变，但 selection 的语义要落到「整组」）
      queueMicrotask(() => {
        const gid = editorState.selectedGroupIds[0];
        if (gid) editorState.selectGroup(gid);
      });
    },

    ungroupSelection() {
      const doc = editorState.doc;
      if (!doc) return;
      const ids = editorState.selectedIds;
      if (!groupsInSelection(doc, ids).length) return;
      editorState.commit(tr('typo.undo.ungroup'), (d) => {
        const next = ungroupElements(d, ids);
        d.elements = next.elements;
        d.groups = next.groups;
      });
    },

    canGroup() {
      return editorState.selectedIds.length >= 2;
    },

    canUngroup() {
      const doc = editorState.doc;
      return !!doc && groupsInSelection(doc, editorState.selectedIds).length > 0;
    },

    setGroupPaint(patch) {
      const doc = editorState.doc;
      const gid = editorState.soleSelectedGroupId;
      if (!doc || !gid) return;
      editorState.commit(tr('typo.undo.groupStyle'), (d) => {
        d.groups = groupList(d).map((g) => (g.id === gid ? { ...g, fill: applyPaintPatch(g.fill, patch) } : g));
      });
    },

    setGroupStrokeColor(color) {
      const gid = editorState.soleSelectedGroupId;
      if (!gid) return;
      editorState.commit(tr('typo.undo.groupStyle'), (d) => {
        d.groups = groupList(d).map((g) =>
          g.id === gid
            ? { ...g, stroke: g.stroke ? { ...g.stroke, color } : { color, width: 2, style: 'solid' } }
            : g,
        );
      });
    },

    setGroupStrokeWidth(width) {
      const gid = editorState.soleSelectedGroupId;
      if (!gid) return;
      const w = Math.max(0, width);
      editorState.commit(tr('typo.undo.groupStyle'), (d) => {
        d.groups = groupList(d).map((g) => (g.id === gid ? { ...g, stroke: { ...(g.stroke ?? { color: '#ffffff', style: 'solid' as const }), width: w } } : g));
      });
    },

    setGroupNumber(key, value) {
      const gid = editorState.soleSelectedGroupId;
      if (!gid) return;
      const v = Math.max(0, value);
      editorState.commit(tr('typo.undo.groupStyle'), (d) => {
        d.groups = groupList(d).map((g) => (g.id === gid ? { ...g, [key]: v } : g));
      });
    },

    /* ---------------------------------------------------------- 图形 */

    setShapeFill(color) {
      editorState.commit(tr('typo.undo.shapeFill'), (doc) => {
        for (const el of onlyShape(doc)) el.fill = { kind: 'solid', color };
      });
    },

    setShapePaint(patch) {
      editorState.commit(tr('typo.undo.shapeFill'), (doc) => {
        for (const el of onlyShape(doc)) el.fill = applyPaintPatch(el.fill, patch);
      });
    },

    setTextFill(patch) {
      // 起步用一份纯色：applyPaintPatch 会把颜色带到新类型，于是「第一次点
      // 渐变」不会得到一份没有颜色、画出来全透明的填充。
      editorState.commit(tr('typo.undo.shapeFill'), (doc) => {
        for (const el of onlyText(doc)) {
          el.fill = applyPaintPatch(el.fill ?? { kind: 'solid', color: DEFAULT_PAINT_A }, patch);
        }
      });
    },

    clearTextFill() {
      editorState.commit(tr('typo.undo.shapeFill'), (doc) => {
        for (const el of onlyText(doc)) el.fill = undefined;
      });
    },

    setTextBoxFill(patch) {
      // 与 setTextFill 同款：起步给一份纯色，applyPaintPatch 会把颜色带进新类型。
      editorState.commit(tr('typo.undo.shapeFill'), (doc) => {
        for (const el of onlyText(doc)) {
          el.boxFill = applyPaintPatch(el.boxFill ?? { kind: 'solid', color: DEFAULT_PAINT_A }, patch);
        }
      });
    },

    setTextBoxStroke(patch) {
      editorState.commit(tr('typo.undo.shapeStroke'), (doc) => {
        for (const el of onlyText(doc)) {
          const cur = el.boxStroke;
          el.boxStroke = {
            color: patch.color ?? cur?.color ?? '#ffffff',
            // 宽度 0 = 无边框（与图形描边同一套语义：不做「有 / 无」两态，
            // 少一个状态就少一处「为什么这里还有个隐形边框」）。
            width: patch.width !== undefined ? Math.max(0, patch.width) : (cur?.width ?? 2),
            style: patch.style ?? cur?.style ?? 'solid',
          };
        }
      });
    },

    setShapeStroke(color) {
      editorState.commit(tr('typo.undo.shapeStroke'), (doc) => {
        for (const el of onlyShape(doc)) {
          el.stroke = el.stroke ? { ...el.stroke, color } : { color, width: 4, style: 'solid' };
        }
      });
    },

    setShapeStrokeWidth(width) {
      editorState.commit(tr('typo.undo.strokeWidth'), (doc) => {
        for (const el of onlyShape(doc)) {
          // 本来没有描边时也**创建**：面板与 Ribbon 上「先调宽度、再挑颜色」
          // 是常见顺序，静默不生效会让人以为控件坏了。宽度 0 在视觉上仍然
          // 等于没有描边，所以这不会给用户多出一个隐形状态。
          el.stroke = el.stroke
            ? { ...el.stroke, width: Math.max(0, width) }
            : { color: '#ffffff', width: Math.max(0, width), style: 'solid' };
        }
      });
    },

    setShapeStrokeStyle(style) {
      editorState.commit(tr('typo.undo.strokeStyle'), (doc) => {
        for (const el of onlyShape(doc)) {
          el.stroke = el.stroke ? { ...el.stroke, style } : { color: '#ffffff', width: 4, style };
        }
      });
    },

    setShapeRadius(radius) {
      editorState.commit(tr('typo.undo.radius'), (doc) => {
        for (const el of onlyShape(doc)) el.radius = Math.max(0, radius);
      });
    },

    setShapeParam(key, value) {
      editorState.commit(tr('typo.undo.shapeParam'), (doc) => {
        for (const el of onlyShape(doc)) el[key] = value;
      });
    },

    /* ---------------------------------------------------- 顶点 / 控制点编辑 */

    toggleNodeEdit() {
      const el = editorState.selected[0];
      if (!el || el.kind !== 'shape') return;
      if (editorState.nodeEditId === el.id) {
        editorState.nodeEditId = null;
        return;
      }
      /*
       * 参数化图形还没有「顶点」可编辑 —— 它的形状由公式给出。这里顺手转成
       * 路径，与进入编辑**合成一笔撤销**：按一次 Ctrl+Z 应当回到「还是参数化
       * 图形、也没在编辑」，而不是先退回一个「已经是路径但已退出编辑」的
       * 中间态（那对用户毫无意义）。
       */
      if (el.shape !== 'svg') {
        editorState.commit(tr('typo.undo.toPath'), (doc) => {
          const target = doc.elements.find((e) => e.id === el.id);
          if (target && target.kind === 'shape') shapeToPath(target);
        });
      }
      editorState.nodeEditId = el.id;
    },

    convertToPath() {
      editorState.commit(tr('typo.undo.toPath'), (doc) => {
        for (const el of onlyShape(doc)) shapeToPath(el);
      });
    },

    addPathNode(hit) {
      editorState.commit(tr('typo.undo.addNode'), (doc) => {
        const el = nodeEditShape(doc);
        if (!el) return;
        const subs = parsePathNodes(el.path ?? '');
        const sp = subs[hit.sub];
        if (!sp) return;
        subs[hit.sub] = insertNodeOnSegment(sp, hit.seg, hit.t);
        el.path = serializePathNodes(subs);
      });
    },

    deletePathNode(index) {
      editorState.commit(tr('typo.undo.deleteNode'), (doc) => {
        const el = nodeEditShape(doc);
        if (!el) return;
        const subs = parsePathNodes(el.path ?? '');
        const sp = subs[0];
        if (!sp) return;
        const next = removeNode(sp, index);
        // 少于下限时 `removeNode` 原样返回 —— 那是「拒绝删除」，不该留一条空撤销。
        if (next === sp) return;
        subs[0] = next;
        el.path = serializePathNodes(subs);
      });
    },

    /* ---------------------------------------------------- 布尔运算 */

    canBoolean() {
      return editorState.selected.filter((e) => e.kind === 'shape' && !e.locked).length >= 2;
    },

    booleanShapes(op) {
      const doc = editorState.doc;
      if (!doc) return;
      // 只取图形，并按 **z 序**排列 —— 差集的语义依赖顺序（最前景减去其余）。
      const picked = new Set(
        editorState.selected.filter((e) => e.kind === 'shape' && !e.locked).map((e) => e.id),
      );
      const ordered = doc.elements.filter((e) => picked.has(e.id)) as ShapeElement[];
      if (ordered.length < 2) return;

      const top = ordered[ordered.length - 1]!;
      const freshId = newId();
      let empty = false;

      editorState.commit(tr('typo.undo.boolean'), (d) => {
        const result = booleanOp(op, ordered.map(shapeToMultiPolygon));
        const shaped = multiToShape(result);
        if (!shaped) {
          // 交集为空 / 被减没了。改成一个空图形没有意义，干脆不动，让用户看到提示。
          empty = true;
          return;
        }
        const fresh: ShapeElement = {
          ...structuredClone(top),
          id: freshId,
          kind: 'shape',
          shape: 'svg',
          path: shaped.path,
          frame: { x: shaped.frame.x, y: shaped.frame.y, w: shaped.frame.w, h: shaped.frame.h, rot: 0 },
          // 形状参数只对原始图形有意义，转成自定义路径后全部清掉。
          radius: undefined,
          sides: undefined,
          waist: undefined,
          inner: undefined,
          angle: undefined,
          // 动画与组合都不跟着走：多个操作数各有一套，没有共同的解释。
          animations: [],
          groupId: undefined,
          fill: { ...top.fill },
          stroke: top.stroke ? { ...top.stroke } : null,
        };

        const ids = new Set(ordered.map((o) => o.id));
        const topIndex = d.elements.findIndex((e) => e.id === top.id);
        let insertAt = 0;
        for (let i = 0; i < topIndex; i++) if (!ids.has(d.elements[i]!.id)) insertAt += 1;
        const kept = d.elements.filter((e) => !ids.has(e.id));
        d.elements = [...kept.slice(0, insertAt), fresh, ...kept.slice(insertAt)];
      });

      if (empty) {
        appState.flash(tr('typo.booleanEmpty'), 'error');
        return;
      }
      queueMicrotask(() => editorState.setSelection([freshId]));
    },

    /* ---------------------------------------------------------- 图片 */

    setImageFit(value) {
      editorState.commit(tr('typo.undo.imageFit'), (doc) => {
        for (const el of onlyImage(doc)) el.fit = value;
      });
    },

    /* ---------------------------------------------------------- 对齐 */

    align(axis) {
      const rects = toRects(editorState.selected.filter((e) => !e.locked));
      if (!rects.length) return;

      if (axis === 'distribute-h' || axis === 'distribute-v') {
        const axisShort = axis === 'distribute-h' ? 'h' : 'v';
        const map = distribute(rects, axisShort);
        if (!map.size) return;
        editorState.commit(tr('typo.undo.distribute'), (doc) => {
          for (const el of anyElement(doc)) {
            const v = map.get(el.id);
            if (v === undefined) continue;
            if (axisShort === 'h') el.frame.x = r2(v);
            else el.frame.y = r2(v);
          }
        });
        return;
      }

      const map = alignElements(rects, targetRect(), axis);
      editorState.commit(tr('typo.undo.align'), (doc) => {
        for (const el of anyElement(doc)) {
          const p = map.get(el.id);
          if (!p) continue;
          el.frame.x = r2(p.x);
          el.frame.y = r2(p.y);
        }
      });
    },

    setAlignTarget(target) {
      appState.typoAlignTarget = target;
    },

    /* ---------------------------------------------------------- 动画 */

    applyPreset(preset) {
      editorState.commit(tr('typo.undo.addAnim'), (doc) => {
        for (const el of anyElement(doc)) {
          const anim = createPresetAnimation(preset, newId());
          el.animations = [...el.animations, anim];
        }
      });
    },

    clearAnimations() {
      editorState.commit(tr('typo.undo.clearAnim'), (doc) => {
        for (const el of anyElement(doc)) el.animations = [];
      });
    },

    setAnimTiming(patch) {
      editorState.commit(tr('typo.undo.animTiming'), (doc) => {
        for (const el of anyElement(doc)) {
          el.animations = el.animations.map((a) => ({ ...a, ...patch }));
        }
      });
    },

    applyCustomCss(css) {
      // 解析（含清洗）放在写库之前：非法代码绝不能进文档 —— 一旦进了，光栅化时
      // animationStyleSheet 会跳过它，但用户已经以为「保存成功」了。
      // 支持旧单 body 与「多个 @keyframes 块 + 逗号分隔 animation 简写」两种形态。
      const parsed = parseCustomCss(css);
      if (!parsed.ok) return false;
      editorState.commit(tr('typo.undo.customAnim'), (doc) => {
        for (const el of anyElement(doc)) {
          const prev = el.animations[0];
          // 继承上一段动画的时序，否则用户手写一段 keyframes 之后时长会跳回
          // 默认的 0.6s，「只是改了下缓动」变成了「动画变快了」。
          // （多动画简写自带每条时序，这里的字段只服务于旧单 body 形态。）
          const over: Partial<AnimTiming> & { animation?: string } = prev
            ? {
                delay: prev.delay,
                duration: prev.duration,
                iterations: prev.iterations,
                easing: prev.easing,
                direction: prev.direction,
                fill: prev.fill,
              }
            : {};
          if (parsed.animation) over.animation = parsed.animation;
          el.animations = [createCustomAnimation(newId(), parsed.css, over)];
        }
      });
      return true;
    },

    loadLocalFonts() {
      // 异步但不 await：提示在 `appState.loadLocalFonts` 里发。
      void appState.loadLocalFonts();
    },

    importFont() {
      void (async () => {
        const picked = await browserPlatform.pickFontFiles();
        if (!picked?.length) return;
        let ok = 0;
        for (const f of picked) {
          try {
            await appState.fonts.registerFile(f.name, f.data);
            ok += 1;
          } catch (err) {
            console.warn(`[typo] 字体 ${f.name} 导入失败`, err);
          }
        }
        appState.refreshFontFamilies();
        appState.flash(
          ok === picked.length
            ? tr('typo.fontsImported', { ok })
            : tr('typo.fontsImportedPartial', { ok, total: picked.length }),
        );
      })();
    },

    flattenToImage(localSec) {
      const clipId = editorState.clipId;
      const doc = editorState.doc;
      if (!clipId || !doc) return;
      void (async () => {
        const canvas = await appState.textRaster.rasterizeOnce(doc, doc.size.w, doc.size.h, localSec);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
        if (!blob) {
          appState.flash(tr('typo.bakeFailed'), 'error');
          return;
        }
        const assetId = newId();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        putImageBytes(assetId, bytes.buffer, 'image/png');
        appState.assets.put(assetId, bytes, {
          kind: 'image',
          name: tr('typo.bakedName'),
          originName: 'flatten.png',
        });
        appState.store.updateClip(clipId, tr('typo.undo.flatten'), (clip) => {
          if (clip.kind === 'source' && clip.source.type === 'text') {
            clip.source = { type: 'image', assetId };
          }
        });
        appState.store.commit(tr('typo.undo.registerImageAsset'), (p) => {
          p.assets[assetId] = { id: assetId, kind: 'image', name: tr('typo.bakedName') };
        });
        // 源已经不是 text 了，编辑页必须关掉 —— 留着会指向一个不存在的文档。
        appState.closeTypographyView();
      })();
    },
  };
}
