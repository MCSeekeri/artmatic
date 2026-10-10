/**
 * ribbon-defs.ts — 把「文档 + 选择集」编译成 Ribbon 的 Tab 描述数组。
 *
 * **纯函数**（除了挂在按钮上的回调）：给定输入就能预测输出，所以
 * 「选中图形时出现图形格式 Tab」「没选中文本时字体组置灰」这些规则
 * 都能单测，不用起浏览器。
 *
 * 这里是唯一的「业务 ↔ Ribbon」翻译层。Ribbon 组件不认识文档，
 * actions 不认识按钮，两边都只通过这一层对接。
 */

import type { RibbonTabDef } from '../ribbon/ribbon-model';
import {
  DEFAULT_PAINT_A,
  DEFAULT_PAINT_B,
  MIX_BLENDS,
  TEXTURE_PATTERNS,
  type ImageElement,
  type MixBlend,
  type Paint,
  type ShapeElement,
  type TextElement,
  type TextStyle,
  type TexturePattern,
  type TypographyDocument,
  type TypographyElement,
  type TypographyGroup,
} from '../../typography/document';
import { ANIM_PRESETS, type AnimTiming } from '../../typography/animation';
import { GRID_LIMITS, type TypoGridPrefs } from '../../typography/grid';
import {
  SHAPE_PRESETS,
  shapeDefaultsToStrokeOnly,
  shapeGeometry,
  shapeParamSupport,
} from '../../typography/shapes';
import type { GalleryCard } from '../ribbon/ribbon-model';
import { uniformSpanValue, type SpanStyleKey } from '../../typography/rich-text';
import type { TypographyActions } from './actions';
import { tr } from '../../i18n/index.svelte';

/** 「动作型」下拉的占位值：选完不改变显示值，所以可以连点。 */
const ANIM_PICK = '__pick-anim';

export interface TypographyRibbonInput {
  doc: TypographyDocument;
  selection: TypographyElement[];
  alignTarget: 'canvas' | 'selection';
  /** 已注册的字体族（字体下拉的内容）。 */
  fontFamilies: string[];
  /**
   * 从**本机**枚举来的族名。与 `fontFamilies` 分开传：那个能嵌入导出，
   * 这个不能 —— 下拉里两者一视同仁（用户挑字体时看的是「长什么样」），
   * 但状态层必须分得清。
   */
  localFontFamilies: string[];
  /** 当前环境支不支持读本机字体（入口按钮据此置灰）。 */
  supportsLocalFonts: boolean;
  /** 当前激活的动画预设（若选中元素只挂了一个预设动画）。 */
  activePreset: string | null;
  /** 选中元素上第一个动画的时序（时序控件的显示值来源）。 */
  anim: AnimTiming | null;
  /** 打开「自定义 CSS」弹窗（界面状态，所以由编辑器提供）。 */
  onOpenCustomCss: () => void;
  /** 打开「插入图标」选择器（同上）。 */
  onOpenIconPicker: () => void;
  /** 「转为图片」逃生舱。 */
  onFlatten: () => void;
  /** 网格 / 画幅线框的当前值。 */
  grid: TypoGridPrefs;
  /** 局部更新网格设置。 */
  onGrid: (patch: Partial<TypoGridPrefs>) => void;
  /** 选区恰好是一个完整组合时，那个组合的定义（「组合格式」控件的取值来源）。 */
  soleGroup: TypographyGroup | null;
  /**
   * 编辑文本时的**行内选区**（纯文本 UTF-16 下标）。
   *
   * 有它 ⇒ 字体/字号/加粗这些控件改的是选中的那一段；没有 ⇒ 改整个元素。
   * 这个判断只做一次（在 `tv()` 与 `a.setTextStyle` 里），不让每个控件各判一遍。
   */
  spanRange: { elId: string; start: number; end: number } | null;
  /**
   * 当前是否处于顶点 / 控制点编辑态。
   *
   * 与 `soleGroup` 一样属于「当前处于哪种细粒度编辑」这一类输入 —— 放在这里
   * 而不是让 Ribbon 自己去读 `editorState`，是为了让这张表保持**纯函数**
   * （能直接单测，也不必知道状态住在哪）。
   */
  nodeEditing: boolean;
}

const FONT_WEIGHTS = [300, 400, 500, 600, 700, 800, 900];
const FONT_SIZES = [12, 16, 20, 24, 32, 40, 48, 64, 72, 96, 128, 160, 200];
const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;

function firstText(sel: TypographyElement[]): TextElement | null {
  return (sel.find((e) => e.kind === 'text') as TextElement | undefined) ?? null;
}
function firstShape(sel: TypographyElement[]): ShapeElement | null {
  return (sel.find((e) => e.kind === 'shape') as ShapeElement | undefined) ?? null;
}
function firstImage(sel: TypographyElement[]): ImageElement | null {
  return (sel.find((e) => e.kind === 'image') as ImageElement | undefined) ?? null;
}

/**
 * 形状面板的缩略图。
 *
 * **直接跑 `shapeGeometry`**，不是手画一套预览图 —— 手画的那套迟早与真实
 * 几何分家（改了梯形比例，面板里还是旧样子）。预览盒固定 100×100，
 * 于是 viewBox 也是 `0 0 100 100`。
 */
function shapeCards(): GalleryCard[] {
  return SHAPE_PRESETS.map((p) => {
    const geo = shapeGeometry(p.id, {
      w: 100,
      h: 100,
      radius: p.radius,
      sides: p.sides,
      waist: p.waist,
      angle: p.angle,
      inner: p.id === 'ring' ? 16 : p.id === 'frame' ? 12 : undefined,
    });
    return {
      id: p.key,
      label: tr(p.labelKey),
      d: geo.d,
      viewBox: geo.viewBox,
      evenOdd: geo.evenOdd,
      // 直线没有面积，填充等于什么都不画。
      outline: shapeDefaultsToStrokeOnly(p.id),
    };
  });
}

/** 字体下拉的选项：已注册的族 + 文档里正在用的族（后者可能尚未注册）。 */function fontOptions(input: TypographyRibbonInput, current: string): { value: string; label: string }[] {
  const names = new Set([...input.fontFamilies, ...input.localFontFamilies]);
  for (const el of input.doc.elements) {
    if (el.kind === 'text') names.add(el.style.fontFamily);
  }
  if (current) names.add(current);
  return [...names].map((f) => ({ value: f, label: f }));
}

export function buildTypographyTabs(
  input: TypographyRibbonInput,
  a: TypographyActions,
): RibbonTabDef[] {
  const { selection, alignTarget } = input;
  const n = selection.length;
  const text = firstText(selection);
  const shape = firstShape(selection);
  const image = firstImage(selection);
  const hasText = text !== null;
  /** 一个元素都没选中时，几乎所有编辑动作都没意义 —— 置灰而不是隐藏。 */
  const none = n === 0;

  const style: TextStyle | null = text?.style ?? null;
  /** 当前（第一个）图形支持哪些形状参数。没选中图形时全 false，整组为空。 */
  const support = shapeParamSupport(shape?.shape ?? 'rect');

  /* 填充：控件按类型展开。取值一律从 `shape` 上读，没有图形时给默认值
     （此时控件是禁用态，值只是占位）。 */
  const fillKind: Paint['kind'] = shape?.fill.kind ?? 'solid';
  const fillColorA =
    shape?.fill.kind === 'solid' || shape?.fill.kind === 'texture'
      ? shape.fill.color
      : shape?.fill.kind === 'linear' || shape?.fill.kind === 'radial'
        ? (shape.fill.stops[0]?.color ?? DEFAULT_PAINT_A)
        : DEFAULT_PAINT_A;
  const fillColorB =
    shape?.fill.kind === 'texture'
      ? shape.fill.bg
      : shape?.fill.kind === 'linear' || shape?.fill.kind === 'radial'
        ? (shape.fill.stops[1]?.color ?? DEFAULT_PAINT_B)
        : DEFAULT_PAINT_B;

  /* 组合：只在**选区恰好是一个完整的组**时才出现「组合格式」选项卡。 */
  /*
   * 文本属性的**当前值**：有行内选区就读区间上的生效值，否则读元素级。
   *
   * 读「生效值」而不是「补丁」：一段没写覆盖、元素级是 700 的字，加粗按钮必须
   * 是按下态 —— 否则用户会以为「明明加粗了，按钮却没亮」。
   */
  const range = input.spanRange;
  function tv<K extends SpanStyleKey>(key: K): TextStyle[K] | null {
    if (!text) return null;
    if (range) {
      const u = uniformSpanValue(text.runs, range.start, range.end, text.style, key);
      // 区间内不一致时回落到元素级：这比「硬选一个」诚实，也让再次点击的行为可预期。
      if (u.uniform) return u.value;
    }
    return text.style[key];
  }

  /** 有行内选区 ⇒ 这次改的是一段字（「清除格式」按钮据此显示）。 */
  const hasSpan = range !== null && text !== null;

  const group = input.soleGroup;
  /** 布尔运算至少要两个图形（多了才有「并」可言）。 */
  const canBool = selection.filter((e) => e.kind === 'shape').length >= 2;
  const groupFillColor =
    group?.fill.kind === 'solid' || group?.fill.kind === 'texture'
      ? group.fill.color
      : group?.fill.kind === 'linear' || group?.fill.kind === 'radial'
        ? (group.fill.stops[0]?.color ?? DEFAULT_PAINT_A)
        : DEFAULT_PAINT_A;

  /** 时序控件的显示值：取选中元素上的第一个动画。 */
  const anim: AnimTiming | null = selection.flatMap((e) => e.animations)[0] ?? null;

  const tabs: RibbonTabDef[] = [
    /* ------------------------------------------------------------ 开始 */
    {
      id: 'home',
      label: tr('rib.home'),
      order: 0,
      groups: [
        {
          id: 'font',
          label: tr('rib.group.font'),
          items: [
            {
              kind: 'select',
              id: 'font-family',
              label: tr('rib.fontFamily'),
              testid: 'ribbon-font-family',
              // 固定宽度 + 触发区自己 ellipsis：字体名长度不可控，让它撑开的话
              // 整条 Ribbon 的布局会在换字体时跳一下（用户反馈的「tab 跳变」）。
              width: 148,
              optionTestidPrefix: 'ribbon-font-option',
              value: tv('fontFamily') ?? '',
              disabled: !hasText,
              options: fontOptions(input, tv('fontFamily') ?? ''),
              onchange: (v) => a.setTextStyle('fontFamily', v),
            },
            {
              kind: 'select',
              id: 'font-size',
              label: tr('rib.fontSize'),
              testid: 'ribbon-font-size',
              width: 92,
              // 可编辑 + numeric：能直接输 37（预设里没有），也能点箭头挑预设。
              editable: true,
              numeric: true,
              value: String(tv('fontSize') ?? 0),
              disabled: !hasText,
              options: FONT_SIZES.map((s) => ({ value: String(s), label: String(s) })),
              onchange: (v) => a.setTextStyle('fontSize', Number(v)),
            },
            {
              kind: 'toggle',
              id: 'bold',
              label: tr('rib.bold'),
              icon: 'bold',
              testid: 'ribbon-bold',
              disabled: !hasText,
              active: (tv('fontWeight') ?? 400) >= 600,
              onchange: () => a.toggleTextFlag('bold'),
            },
            {
              kind: 'toggle',
              id: 'italic',
              label: tr('rib.italic'),
              icon: 'italic',
              testid: 'ribbon-italic',
              disabled: !hasText,
              active: tv('fontStyle') === 'italic',
              onchange: () => a.toggleTextFlag('italic'),
            },
            {
              kind: 'toggle',
              id: 'underline',
              label: tr('rib.underline'),
              icon: 'underline',
              testid: 'ribbon-underline',
              disabled: !hasText,
              active: tv('textDecoration') === 'underline',
              onchange: () => a.toggleTextFlag('underline'),
            },
            {
              kind: 'toggle',
              id: 'strike',
              label: tr('rib.strike'),
              icon: 'strikethrough',
              testid: 'ribbon-strike',
              disabled: !hasText,
              active: tv('textDecoration') === 'line-through',
              onchange: () => a.toggleTextFlag('strike'),
            },
            {
              kind: 'button',
              id: 'clear-format',
              label: tr('typo.clearFormat'),
              // 只在「选了一段字」时可用 —— 它清的是行内覆盖，没选区时无对象。
              icon: 'eraser',
              testid: 'typo-clear-format',
              disabled: !hasSpan,
              onselect: () => a.clearSpanFormats(),
            },
            {
              kind: 'button',
              id: 'load-local-fonts',
              label: tr('rib.loadLocalFonts'),
              // 「系统里已有的字体」—— 用字体字形而不是 import（那个是把文件拿进来）。
              icon: 'a-large-small',
              testid: 'typo-local-fonts',
              /*
               * 不支持就置灰。Firefox / Safari / 移动端上这个 API 根本不存在，
               * 让它可点只会得到一句「你的浏览器不行」—— 不如一开始就说清楚。
               * 另外它要求**用户手势**，所以只能挂在按钮上，不能在启动时自动跑。
               */
              disabled: !input.supportsLocalFonts,
              onselect: () => a.loadLocalFonts(),
            },
            {
              kind: 'button',
              id: 'import-font',
              label: tr('rib.importFont'),
              // 语义是「拿进来」，不是「传上去」—— 用 upload 的箭头朝上会误导。
              icon: 'import',
              testid: 'typo-font-import',
              onselect: () => a.importFont(),
            },
          ],
        },
        {
          id: 'para',
          label: tr('rib.group.para'),
          items: [
            {
              kind: 'number',
              id: 'letter-spacing',
              label: tr('rib.letterSpacing'),
              testid: 'ribbon-letter-spacing',
              value: tv('letterSpacing') ?? 0,
              step: 1,
              suffix: 'px',
              disabled: !hasText,
              // 有行内选区时不做实时预览：那需要把「拖动中的值」实时写进 runs，
              // 而每一帧重写 runs 都会重建 DOM、把选区弄丢 —— 预览反而看不清。
              // 元素级那条路不受影响，仍然是拖动即所见。
              ...(hasSpan
                ? {}
                : {
                    oninput: (v: number) => a.setTextPropLive('letterSpacing', v),
                    onliveend: () => a.endTextPropLive(),
                  }),
              onchange: (v) => a.setTextStyle('letterSpacing', v),
            },
            {
              kind: 'number',
              id: 'line-height',
              label: tr('rib.lineHeight'),
              testid: 'ribbon-line-height',
              value: style?.lineHeight ?? 1.2,
              step: 0.05,
              precision: 2,
              disabled: !hasText,
              oninput: (v) => a.setTextPropLive('lineHeight', v),
              onliveend: () => a.endTextPropLive(),
              onchange: (v) => a.setTextProp('lineHeight', v),
            },
          ],
        },
        /* 文本对齐拆成独立两组并排成两行：整组都是小按钮，一字排开要横着
           占掉两百多像素，而它只占 24px 高。两行之后省下的宽度留给字体组。 */
        {
          id: 'align-text-h',
          label: tr('rib.group.alignTextH'),
          layout: 'grid',
          items: [
            {
              kind: 'toggle',
              id: 'align-left',
              label: tr('rib.alignHLeft'),
              size: 'small',
              icon: 'text-align-start',
              testid: 'ribbon-align-left',
              disabled: !hasText,
              active: style?.align === 'left',
              onchange: () => a.setTextAlign('left'),
            },
            {
              kind: 'toggle',
              id: 'align-center',
              label: tr('rib.alignHCenter'),
              size: 'small',
              icon: 'text-align-center',
              testid: 'ribbon-align-center',
              disabled: !hasText,
              active: style?.align === 'center',
              onchange: () => a.setTextAlign('center'),
            },
            {
              kind: 'toggle',
              id: 'align-right',
              label: tr('rib.alignHRight'),
              size: 'small',
              icon: 'text-align-end',
              testid: 'ribbon-align-right',
              disabled: !hasText,
              active: style?.align === 'right',
              onchange: () => a.setTextAlign('right'),
            },
            {
              kind: 'toggle',
              id: 'align-justify',
              label: tr('rib.alignHJustify'),
              size: 'small',
              icon: 'text-align-justify',
              testid: 'ribbon-align-justify',
              disabled: !hasText,
              active: style?.align === 'justify',
              onchange: () => a.setTextAlign('justify'),
            },
          ],
        },
        {
          id: 'align-text-v',
          label: tr('rib.group.alignTextV'),
          layout: 'grid',
          items: [
            {
              kind: 'toggle',
              id: 'valign-top',
              label: tr('rib.alignVTop'),
              size: 'small',
              icon: 'align-start-horizontal',
              testid: 'ribbon-valign-top',
              disabled: !hasText,
              active: style?.vAlign === 'top',
              onchange: () => a.setVAlign('top'),
            },
            {
              kind: 'toggle',
              id: 'valign-middle',
              label: tr('rib.alignVMiddle'),
              size: 'small',
              icon: 'align-center-horizontal',
              testid: 'ribbon-valign-middle',
              disabled: !hasText,
              active: style?.vAlign === 'middle',
              onchange: () => a.setVAlign('middle'),
            },
            {
              kind: 'toggle',
              id: 'valign-bottom',
              label: tr('rib.alignVBottom'),
              size: 'small',
              icon: 'align-end-horizontal',
              testid: 'ribbon-valign-bottom',
              disabled: !hasText,
              active: style?.vAlign === 'bottom',
              onchange: () => a.setVAlign('bottom'),
            },
          ],
        },
        {
          id: 'text-color',
          label: tr('rib.group.textColor'),
          items: [
            {
              kind: 'color',
              id: 'text-color',
              label: tr('rib.color'),
              testid: 'ribbon-text-color',
              value: tv('color') ?? '#ffffff',
              disabled: !hasText,
              onchange: (v) => a.setTextStyle('color', v),
            },
          ],
        },
        {
          id: 'align',
          label: tr('rib.group.align'),
          items: [
            {
              kind: 'segment',
              id: 'align-target',
              label: tr('rib.alignTo'),
              testid: 'typo-align-target',
              value: alignTarget,
              options: [
                { value: 'canvas', label: tr('rib.alignTargetCanvas') },
                { value: 'selection', label: tr('rib.alignTargetSelection') },
              ],
              onchange: (v) => a.setAlignTarget(v as 'canvas' | 'selection'),
            },
            {
              kind: 'button',
              id: 'align-l',
              label: tr('rib.alignLeft'),
              icon: 'align-start-vertical',
              testid: 'typo-align-left',
              disabled: none,
              onselect: () => a.align('left'),
            },
            {
              kind: 'button',
              id: 'align-ch',
              label: tr('rib.centerH'),
              icon: 'align-center-vertical',
              testid: 'typo-center-h',
              disabled: none,
              onselect: () => a.align('center-h'),
            },
            {
              kind: 'button',
              id: 'align-r',
              label: tr('rib.alignRight'),
              icon: 'align-end-vertical',
              testid: 'typo-align-right',
              disabled: none,
              onselect: () => a.align('right'),
            },
            {
              kind: 'button',
              id: 'align-t',
              label: tr('rib.alignTop'),
              icon: 'align-start-horizontal',
              testid: 'typo-align-top',
              disabled: none,
              onselect: () => a.align('top'),
            },
            {
              kind: 'button',
              id: 'align-cv',
              label: tr('rib.centerV'),
              icon: 'align-center-horizontal',
              testid: 'typo-center-v',
              disabled: none,
              onselect: () => a.align('middle'),
            },
            {
              kind: 'button',
              id: 'align-b',
              label: tr('rib.alignBottom'),
              icon: 'align-end-horizontal',
              testid: 'typo-align-bottom',
              disabled: none,
              onselect: () => a.align('bottom'),
            },
            {
              kind: 'button',
              id: 'dist-h',
              label: tr('rib.distributeH'),
              icon: 'align-horizontal-space-between',
              testid: 'typo-distribute-h',
              // 少于 3 个没有「等距」可言
              disabled: n < 3,
              onselect: () => a.align('distribute-h'),
            },
            {
              kind: 'button',
              id: 'dist-v',
              label: tr('rib.distributeV'),
              icon: 'align-vertical-space-between',
              testid: 'typo-distribute-v',
              disabled: n < 3,
              onselect: () => a.align('distribute-v'),
            },
          ],
        },
        {
          id: 'order',
          label: tr('rib.group.order'),
          layout: 'grid',
          items: [
            {
              kind: 'button',
              id: 'to-front',
              label: tr('rib.toFront'),
              size: 'small',
              icon: 'bring-to-front',
              testid: 'typo-to-front',
              disabled: none,
              onselect: () => a.order('front'),
            },
            {
              kind: 'button',
              id: 'forward',
              label: tr('common.up'),
              size: 'small',
              icon: 'move-up',
              testid: 'typo-forward',
              disabled: none,
              onselect: () => a.order('forward'),
            },
            {
              kind: 'button',
              id: 'backward',
              label: tr('common.down'),
              size: 'small',
              icon: 'move-down',
              testid: 'typo-backward',
              disabled: none,
              onselect: () => a.order('backward'),
            },
            {
              kind: 'button',
              id: 'to-back',
              label: tr('rib.toBack'),
              size: 'small',
              icon: 'send-to-back',
              testid: 'typo-to-back',
              disabled: none,
              onselect: () => a.order('back'),
            },
          ],
        },
        {
          id: 'edit',
          label: tr('rib.group.edit'),
          items: [
            {
              kind: 'button',
              id: 'add-text',
              label: tr('rib.addText'),
              icon: 'type',
              testid: 'typo-add-text',
              onselect: () => a.addText(),
            },
            {
              kind: 'button',
              id: 'duplicate',
              label: tr('rib.duplicate'),
              icon: 'copy',
              testid: 'typo-duplicate',
              disabled: none,
              onselect: () => a.duplicateSelection(),
            },
            {
              kind: 'button',
              id: 'delete',
              label: tr('common.delete'),
              icon: 'trash',
              testid: 'typo-delete',
              disabled: none,
              onselect: () => a.deleteSelection(),
            },
            {
              kind: 'toggle',
              id: 'lock',
              label: tr('rib.lock'),
              icon: 'lock',
              testid: 'typo-lock',
              disabled: none,
              active: selection.every((e) => e.locked),
              onchange: () => a.toggleFlag('locked'),
            },
            {
              kind: 'toggle',
              id: 'hide',
              label: tr('rib.hide'),
              icon: 'eye-off',
              testid: 'typo-hide',
              disabled: none,
              active: selection.every((e) => !e.visible),
              onchange: () => a.toggleFlag('visible'),
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------------------ 插入 */
    {
      id: 'insert',
      label: tr('rib.insert'),
      order: 1,
      groups: [
        {
          id: 'shapes',
          label: tr('rib.group.shapes'),
          items: [
            {
              // 预览图面板而不是下拉：形状靠名字挑不出来，必须看见。
              // 缩略图用 `shapeGeometry` 生成，与舞台上渲染的是同一份几何。
              kind: 'gallery',
              id: 'shape-picker',
              label: tr('rib.shape'),
              testid: 'typo-shape',
              columns: 6,
              cards: shapeCards(),
              onselect: (key) => {
                const preset = SHAPE_PRESETS.find((p) => p.key === key);
                if (preset) a.addShape(preset);
              },
            },
          ],
        },
        {
          id: 'media',
          label: tr('rib.group.media'),
          items: [
            {
              kind: 'button',
              id: 'add-text',
              label: tr('rib.addText'),
              icon: 'type',
              testid: 'typo-insert-text',
              onselect: () => a.addText(),
            },
            {
              kind: 'button',
              id: 'add-image',
              label: tr('rib.addImage'),
              icon: 'image-plus',
              testid: 'typo-add-image',
              onselect: () => a.addImage(),
            },
            {
              // 图标是**矢量图形**，不是素材：选择器里挑完直接进文档（见
              // icon-shapes.ts），所以按钮排在「插入」组而不是「图片」语义里，
              // 但它和图片一样是「挑一个外面的东西进来」，就近放置。
              kind: 'button',
              id: 'add-icon',
              label: tr('rib.addIcon'),
              icon: 'shapes',
              testid: 'typo-insert-icon',
              onselect: () => input.onOpenIconPicker(),
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------------------ 动画 */
    {
      id: 'anim',
      label: tr('rib.anim'),
      order: 2,
      groups: [
        {
          id: 'presets',
          label: tr('rib.group.presets'),
          items: [
            {
              kind: 'select',
              id: 'anim-preset',
              label: tr('rib.anim'),
              testid: 'typo-anim-preset',
              optionTestidPrefix: 'typo-anim-option',
              width: 140,
              value: input.activePreset ?? ANIM_PICK,
              options: [
                { value: ANIM_PICK, label: tr('rib.pickAnim') },
                ...ANIM_PRESETS.map((p) => ({ value: p.id, label: tr(p.labelKey) })),
              ],
              onchange: (v) => {
                const preset = ANIM_PRESETS.find((p) => p.id === v);
                if (preset) a.applyPreset(preset.id);
              },
            },
            {
              kind: 'button',
              id: 'clear-anim',
              label: tr('rib.clearAnim'),
              icon: 'rotate-cw',
              testid: 'typo-anim-clear',
              disabled: none,
              onselect: () => a.clearAnimations(),
            },
          ],
        },
        {
          id: 'anim-timing',
          label: tr('rib.group.timing'),
          items: [
            {
              kind: 'number',
              id: 'anim-delay',
              label: tr('rib.animDelay'),
              testid: 'typo-anim-delay',
              value: anim?.delay ?? 0,
              min: 0,
              step: 0.05,
              precision: 2,
              suffix: 's',
              disabled: !anim,
              onchange: (v) => a.setAnimTiming({ delay: v }),
            },
            {
              kind: 'number',
              id: 'anim-duration',
              label: tr('rib.animDuration'),
              testid: 'typo-anim-duration',
              value: anim?.duration ?? 0.6,
              min: 0.01,
              step: 0.05,
              precision: 2,
              suffix: 's',
              disabled: !anim,
              onchange: (v) => a.setAnimTiming({ duration: v }),
            },
            {
              kind: 'select',
              id: 'anim-iterations',
              label: tr('rib.animIterations'),
              testid: 'typo-anim-iterations',
              value: anim ? (anim.iterations === Infinity ? 'inf' : String(anim.iterations)) : '1',
              disabled: !anim,
              options: [
                { value: '1', label: tr('rib.iter1') },
                { value: '2', label: tr('rib.iter2') },
                { value: '3', label: tr('rib.iter3') },
                { value: '5', label: tr('rib.iter5') },
                { value: 'inf', label: tr('rib.iterLoop') },
              ],
              onchange: (v) =>
                a.setAnimTiming({ iterations: v === 'inf' ? Infinity : Number(v) }),
            },
            {
              kind: 'select',
              id: 'anim-easing',
              label: tr('rib.animEasing'),
              testid: 'typo-anim-easing',
              value: typeof anim?.easing === 'string' ? anim.easing : 'ease',
              disabled: !anim,
              options: [
                { value: 'linear', label: tr('rib.easingLinear') },
                { value: 'ease', label: tr('rib.easingEase') },
                { value: 'ease-in', label: tr('rib.easingEaseIn') },
                { value: 'ease-out', label: tr('rib.easingEaseOut') },
                { value: 'ease-in-out', label: tr('rib.easingEaseInOut') },
              ],
              onchange: (v) => a.setAnimTiming({ easing: v as AnimTiming['easing'] }),
            },
            {
              kind: 'select',
              id: 'anim-direction',
              label: tr('rib.animDirection'),
              testid: 'typo-anim-direction',
              value: anim?.direction ?? 'normal',
              disabled: !anim,
              options: [
                { value: 'normal', label: tr('rib.dirNormal') },
                { value: 'reverse', label: tr('rib.dirReverse') },
                { value: 'alternate', label: tr('rib.dirAlternate') },
                { value: 'alternate-reverse', label: tr('rib.dirAlternateReverse') },
              ],
              onchange: (v) => a.setAnimTiming({ direction: v as AnimTiming['direction'] }),
            },
            {
              kind: 'select',
              id: 'anim-fill',
              label: tr('rib.animFill'),
              testid: 'typo-anim-fill',
              value: anim?.fill ?? 'both',
              disabled: !anim,
              options: [
                { value: 'none', label: tr('rib.fillNone') },
                { value: 'forwards', label: tr('rib.fillForwards') },
                { value: 'backwards', label: tr('rib.fillBackwards') },
                { value: 'both', label: tr('rib.fillBoth') },
              ],
              onchange: (v) => a.setAnimTiming({ fill: v as AnimTiming['fill'] }),
            },
          ],
        },
        {
          id: 'anim-edit',
          label: tr('rib.group.edit'),
          items: [
            {
              kind: 'button',
              id: 'custom-css',
              label: tr('rib.customCss'),
              icon: 'wand-sparkles',
              testid: 'typo-anim-css',
              disabled: none,
              onselect: () => input.onOpenCustomCss(),
            },
            {
              kind: 'button',
              id: 'clear-anim',
              label: tr('rib.clearAnim'),
              icon: 'rotate-cw',
              testid: 'typo-anim-clear',
              disabled: none,
              onselect: () => a.clearAnimations(),
            },
            {
              kind: 'button',
              id: 'flatten',
              label: tr('rib.flatten'),
              icon: 'image',
              testid: 'typo-flatten',
              onselect: () => input.onFlatten(),
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------------------ 视图 */
    {
      id: 'view',
      label: tr('rib.view'),
      order: 3,
      groups: [
        {
          id: 'grid',
          label: tr('rib.group.grid'),
          items: [
            {
              kind: 'toggle',
              id: 'grid-show',
              label: tr('rib.gridShow'),
              icon: 'grid-2x2',
              testid: 'ribbon-grid-show',
              active: input.grid.enabled,
              onchange: () => input.onGrid({ enabled: !input.grid.enabled }),
            },
            {
              kind: 'toggle',
              id: 'grid-snap',
              label: tr('rib.gridSnap'),
              icon: 'magnet',
              testid: 'ribbon-grid-snap',
              // 显示与吸附解耦：PPT 也是两个独立开关（可对齐网格但不显示它）。
              active: input.grid.snap,
              onchange: () => input.onGrid({ snap: !input.grid.snap }),
            },
            {
              kind: 'segment',
              id: 'grid-mode',
              label: tr('rib.gridUnit'),
              testid: 'ribbon-grid-mode',
              value: input.grid.mode,
              options: [
                { value: 'px', label: tr('rib.gridPx') },
                { value: 'percent', label: tr('rib.gridPercent') },
              ],
              onchange: (v) => input.onGrid({ mode: v === 'percent' ? 'percent' : 'px' }),
            },
            {
              kind: 'number',
              id: 'grid-size',
              label: tr('rib.gridSize'),
              testid: 'ribbon-grid-size',
              value: input.grid.size,
              min: input.grid.mode === 'percent' ? GRID_LIMITS.minPct : GRID_LIMITS.minPx,
              max: input.grid.mode === 'percent' ? GRID_LIMITS.maxPct : GRID_LIMITS.maxPx,
              step: input.grid.mode === 'percent' ? 1 : 4,
              precision: 0,
              suffix: input.grid.mode === 'percent' ? '%' : 'px',
              onchange: (v) => input.onGrid({ size: v }),
            },
          ],
        },
        {
          id: 'grid-lines',
          label: tr('rib.group.gridLines'),
          layout: 'grid',
          items: [
            {
              kind: 'toggle',
              id: 'grid-show-x',
              label: tr('rib.gridVertical'),
              size: 'small',
              icon: 'move-horizontal',
              testid: 'ribbon-grid-show-x',
              active: input.grid.showX,
              onchange: () => input.onGrid({ showX: !input.grid.showX }),
            },
            {
              kind: 'toggle',
              id: 'grid-show-y',
              label: tr('rib.gridHorizontal'),
              size: 'small',
              icon: 'arrow-up-down',
              testid: 'ribbon-grid-show-y',
              active: input.grid.showY,
              onchange: () => input.onGrid({ showY: !input.grid.showY }),
            },
            {
              kind: 'toggle',
              id: 'grid-frame',
              label: tr('rib.canvasFrame'),
              size: 'small',
              icon: 'frame',
              testid: 'ribbon-canvas-frame',
              active: input.grid.frame,
              onchange: () => input.onGrid({ frame: !input.grid.frame }),
            },
          ],
        },
      ],
    },

    /* ------------------------------------------- [Contextual] 图形格式 */
    {
      id: 'shape-format',
      label: tr('rib.shapeFormat'),
      contextual: true,
      order: 10,
      groups: [
        {
          id: 'fill',
          label: tr('rib.group.fill'),
          items: [
            {
              kind: 'select',
              id: 'fill-kind',
              label: tr('rib.fillKind'),
              testid: 'ribbon-fill-kind',
              width: 108,
              value: fillKind,
              disabled: !shape,
              optionTestidPrefix: 'ribbon-fill-kind-option',
              options: [
                { value: 'none', label: tr('rib.fillNoneShort') },
                { value: 'solid', label: tr('rib.fillSolid') },
                { value: 'linear', label: tr('rib.fillLinear') },
                { value: 'radial', label: tr('rib.fillRadial') },
                { value: 'texture', label: tr('rib.fillTexture') },
              ],
              onchange: (v) => a.setShapePaint({ kind: v as Paint['kind'] }),
            },
            // 控件按**填充类型**展开：不做无意义的置灰 —— 一个渐变里冒出
            // 「纹理周期」这种参数，比少一个控件更让人困惑。
            ...(fillKind !== 'none'
              ? [
                  {
                    kind: 'color' as const,
                    id: 'shape-fill',
                    label: fillKind === 'texture' ? tr('rib.textureInk') : fillKind === 'solid' ? tr('rib.shapeFill') : tr('rib.gradientFrom'),
                    icon: 'paint-bucket' as const,
                    testid: 'ribbon-shape-fill',
                    value: fillColorA,
                    disabled: !shape,
                    onchange: (v: string) => a.setShapePaint({ color: v }),
                  },
                ]
              : []),
            ...(fillKind === 'linear' || fillKind === 'radial' || fillKind === 'texture'
              ? [
                  {
                    kind: 'color' as const,
                    id: 'shape-fill-2',
                    label: fillKind === 'texture' ? tr('rib.textureBg') : tr('rib.gradientTo'),
                    icon: 'droplet' as const,
                    testid: 'ribbon-shape-fill-2',
                    value: fillColorB,
                    disabled: !shape,
                    onchange: (v: string) => a.setShapePaint({ color2: v }),
                  },
                ]
              : []),
            ...(fillKind === 'linear'
              ? [
                  {
                    kind: 'number' as const,
                    id: 'fill-angle',
                    label: tr('rib.gradientAngle'),
                    testid: 'ribbon-fill-angle',
                    value: shape?.fill.kind === 'linear' ? shape.fill.angle : 0,
                    step: 15,
                    suffix: '°',
                    disabled: !shape,
                    onchange: (v: number) => a.setShapePaint({ angle: v }),
                  },
                ]
              : []),
            ...(fillKind === 'texture'
              ? [
                  {
                    kind: 'select' as const,
                    id: 'fill-pattern',
                    label: tr('rib.texturePattern'),
                    testid: 'ribbon-fill-pattern',
                    width: 100,
                    value: shape?.fill.kind === 'texture' ? shape.fill.pattern : 'dots',
                    disabled: !shape,
                    optionTestidPrefix: 'ribbon-fill-pattern-option',
                    options: TEXTURE_PATTERNS.map((t) => ({ value: t.id, label: tr(t.labelKey) })),
                    onchange: (v: string) => a.setShapePaint({ pattern: v as TexturePattern }),
                  },
                  {
                    kind: 'number' as const,
                    id: 'fill-scale',
                    label: tr('rib.textureScale'),
                    testid: 'ribbon-fill-scale',
                    value: shape?.fill.kind === 'texture' ? shape.fill.scale : 28,
                    min: 2,
                    step: 2,
                    suffix: 'px',
                    disabled: !shape,
                    onchange: (v: number) => a.setShapePaint({ scale: Math.max(2, v) }),
                  },
                  {
                    kind: 'number' as const,
                    id: 'fill-thickness',
                    label: tr('rib.textureThickness'),
                    testid: 'ribbon-fill-thickness',
                    value: shape?.fill.kind === 'texture' ? shape.fill.thickness : 3,
                    min: 0.5,
                    step: 0.5,
                    precision: 1,
                    suffix: 'px',
                    disabled: !shape,
                    onchange: (v: number) => a.setShapePaint({ thickness: Math.max(0.5, v) }),
                  },
                ]
              : []),
          ],
        },
        {
          id: 'stroke',
          label: tr('rib.group.stroke'),
          items: [
            {
              kind: 'color',
              id: 'shape-stroke',
              label: tr('rib.strokeColor'),
              icon: 'square-dashed',
              testid: 'ribbon-shape-stroke',
              value: shape?.stroke?.color ?? '#ffffff',
              onchange: (v) => a.setShapeStroke(v),
            },
            {
              kind: 'number',
              id: 'stroke-width',
              label: tr('rib.strokeWidth'),
              testid: 'ribbon-stroke-width',
              value: shape?.stroke?.width ?? 0,
              min: 0,
              step: 1,
              suffix: 'px',
              onchange: (v) => a.setShapeStrokeWidth(v),
            },
            {
              kind: 'select',
              id: 'stroke-style',
              label: tr('rib.strokeStyle'),
              testid: 'ribbon-stroke-style',
              value: shape?.stroke?.style ?? 'solid',
              options: LINE_STYLES.map((s) => ({
                value: s,
                label: s === 'solid' ? tr('rib.lineSolid') : s === 'dashed' ? tr('rib.lineDashed') : tr('rib.lineDotted'),
              })),
              onchange: (v) => a.setShapeStrokeStyle(v as (typeof LINE_STYLES)[number]),
            },
          ],
        },
        {
          id: 'shape',
          label: tr('rib.group.shape'),
          items: [
            // 参数控件按**图形支持什么**显示（`shapeParamSupport`），不是写死一串。
            // 加一种图形只需要在 shapes.ts 里声明它支持哪些参数，这里一行都不用动。
            ...(support.radius
              ? [
                  {
                    kind: 'number' as const,
                    id: 'radius',
                    label: tr('rib.radius'),
                    testid: 'ribbon-shape-radius',
                    value: shape?.radius ?? 0,
                    min: 0,
                    step: 1,
                    onchange: (v: number) => a.setShapeRadius(v),
                  },
                ]
              : []),
            ...(support.sides
              ? [
                  {
                    kind: 'number' as const,
                    id: 'sides',
                    label: tr('rib.sides'),
                    testid: 'ribbon-shape-sides',
                    value: shape?.sides ?? (shape?.shape === 'star' ? 5 : 6),
                    min: 3,
                    max: 60,
                    step: 1,
                    onchange: (v: number) => a.setShapeParam('sides', Math.max(3, Math.round(v))),
                  },
                ]
              : []),
            ...(support.waist
              ? [
                  {
                    kind: 'number' as const,
                    id: 'waist',
                    label: tr('rib.starWaist'),
                    testid: 'ribbon-shape-waist',
                    value: shape?.waist ?? 0.4,
                    min: 0.05,
                    max: 0.98,
                    step: 0.02,
                    precision: 2,
                    onchange: (v: number) => a.setShapeParam('waist', v),
                  },
                ]
              : []),
            ...(support.inner
              ? [
                  {
                    kind: 'number' as const,
                    id: 'inner',
                    label: tr('rib.borderWidth'),
                    testid: 'ribbon-shape-inner',
                    value: shape?.inner ?? 0,
                    min: 0,
                    step: 1,
                    suffix: 'px',
                    onchange: (v: number) => a.setShapeParam('inner', Math.max(0, v)),
                  },
                ]
              : []),
            ...(support.angle
              ? [
                  {
                    kind: 'number' as const,
                    id: 'angle',
                    label: tr('rib.pieAngle'),
                    testid: 'ribbon-shape-angle',
                    value: shape?.angle ?? 270,
                    min: 1,
                    max: 360,
                    step: 5,
                    suffix: '°',
                    onchange: (v: number) => a.setShapeParam('angle', v),
                  },
                ]
              : []),
          ],
        },
        {
          id: 'nodes',
          label: tr('rib.group.nodes'),
          items: [
            {
              kind: 'toggle',
              id: 'node-edit',
              label: tr('rib.nodeEdit'),
              size: 'small',
              icon: 'spline',
              testid: 'typo-node-edit',
              active: input.nodeEditing,
              disabled: !shape,
              onchange: () => a.toggleNodeEdit(),
            },
            {
              kind: 'button',
              id: 'to-path',
              label: tr('rib.toPath'),
              size: 'small',
              icon: 'spline',
              testid: 'typo-to-path',
              // 参数化图形才能「转为路径」；已经是路径的（含布尔运算结果）
              // 再点一次没有任何意义 —— 置灰比「点了没反应」诚实。
              disabled: !shape || shape.shape === 'svg',
              onselect: () => a.convertToPath(),
            },
          ],
        },
        {
          id: 'boolean',
          label: tr('rib.group.boolean'),
          layout: 'grid',
          items: [
            {
              kind: 'button',
              id: 'bool-union',
              label: tr('rib.boolUnion'),
              size: 'small',
              icon: 'squares-unite',
              testid: 'typo-bool-union',
              disabled: !canBool,
              onselect: () => a.booleanShapes('union'),
            },
            {
              kind: 'button',
              id: 'bool-subtract',
              label: tr('rib.boolSubtract'),
              size: 'small',
              icon: 'squares-subtract',
              testid: 'typo-bool-subtract',
              disabled: !canBool,
              onselect: () => a.booleanShapes('difference'),
            },
            {
              kind: 'button',
              id: 'bool-intersect',
              label: tr('rib.boolIntersect'),
              size: 'small',
              icon: 'squares-intersect',
              testid: 'typo-bool-intersect',
              disabled: !canBool,
              onselect: () => a.booleanShapes('intersection'),
            },
            {
              kind: 'button',
              id: 'bool-xor',
              label: tr('rib.boolXor'),
              size: 'small',
              icon: 'squares-exclude',
              testid: 'typo-bool-xor',
              disabled: !canBool,
              onselect: () => a.booleanShapes('xor'),
            },
          ],
        },
        effectsGroup(shape?.blend ?? 'normal', shape?.opacity ?? 1, a),
      ],
    },

    /* ------------------------------------------- [Contextual] 组合格式 */
    {
      id: 'group-format',
      label: tr('rib.groupFormat'),
      contextual: true,
      order: 12,
      groups: [
        {
          id: 'group-box',
          label: tr('rib.group.groupBox'),
          items: [
            {
              kind: 'color',
              id: 'group-fill',
              label: tr('rib.groupBackdrop'),
              icon: 'square' as const,
              testid: 'ribbon-group-fill',
              value: groupFillColor,
              onchange: (v) => a.setGroupPaint({ color: v, kind: 'solid' }),
            },
            {
              kind: 'toggle',
              id: 'group-nofill',
              label: tr('rib.fillNoneShort'),
              icon: 'square-dashed',
              testid: 'ribbon-group-nofill',
              active: group?.fill.kind === 'none',
              onchange: () => a.setGroupPaint({ kind: group?.fill.kind === 'none' ? 'solid' : 'none' }),
            },
            {
              kind: 'color',
              id: 'group-border',
              label: tr('rib.groupBorder'),
              icon: 'frame' as const,
              testid: 'ribbon-group-border',
              value: group?.stroke?.color ?? '#ffffff',
              onchange: (v) => a.setGroupStrokeColor(v),
            },
            {
              kind: 'number',
              id: 'group-border-width',
              label: tr('rib.groupBorderWidth'),
              testid: 'ribbon-group-border-width',
              value: group?.stroke?.width ?? 0,
              min: 0,
              step: 1,
              suffix: 'px',
              onchange: (v) => a.setGroupStrokeWidth(v),
            },
            {
              kind: 'number',
              id: 'group-radius',
              label: tr('rib.groupRadius'),
              testid: 'ribbon-group-radius',
              value: group?.radius ?? 0,
              min: 0,
              step: 1,
              onchange: (v) => a.setGroupNumber('radius', v),
            },
            {
              kind: 'number',
              id: 'group-padding',
              label: tr('rib.groupPadding'),
              testid: 'ribbon-group-padding',
              value: group?.padding ?? 8,
              min: 0,
              step: 1,
              onchange: (v) => a.setGroupNumber('padding', v),
            },
          ],
        },
        {
          id: 'group-action',
          label: tr('rib.groupAction'),
          items: [
            {
              kind: 'button',
              id: 'ungroup',
              label: tr('rib.ungroup'),
              icon: 'ungroup',
              testid: 'typo-ungroup',
              onselect: () => a.ungroupSelection(),
            },
          ],
        },
      ],
    },

    /* ------------------------------------------- [Contextual] 图片格式 */
    {
      id: 'image-format',
      label: tr('rib.imageFormat'),
      contextual: true,
      order: 11,
      groups: [
        {
          id: 'image-fit',
          label: tr('rib.group.imageStyle'),
          items: [
            {
              kind: 'select',
              id: 'image-fit',
              label: tr('rib.imageFit'),
              testid: 'ribbon-image-fit',
              value: image?.fit ?? 'cover',
              options: [
                { value: 'fill', label: tr('rib.fitFill') },
                { value: 'contain', label: tr('rib.fitContain') },
                { value: 'cover', label: tr('rib.fitCover') },
                { value: 'none', label: tr('rib.fitNone') },
              ],
              onchange: (v) => a.setImageFit(v as ImageElement['fit']),
            },
          ],
        },
        effectsGroup(image?.blend ?? 'normal', image?.opacity ?? 1, a),
      ],
    },
  ];

  return tabs;
}

/** 「艺术效果」组：混合模式 + 不透明度。图形格式与图片格式共用。 */
function effectsGroup(blend: MixBlend, opacity: number, a: TypographyActions) {
  return {
    id: 'effects',
    label: tr('rib.group.effects'),
    items: [
      {
        kind: 'select' as const,
        id: 'blend',
        label: tr('rib.blend'),
        testid: 'ribbon-blend',
        value: blend,
        options: MIX_BLENDS.map((m) => ({ value: m.id, label: tr(m.labelKey) })),
        onchange: (v: string) => a.setBlend(v as MixBlend),
      },
      {
        kind: 'number' as const,
        id: 'opacity',
        label: tr('rib.opacity'),
        testid: 'ribbon-opacity',
        value: opacity,
        min: 0,
        max: 1,
        step: 0.05,
        precision: 2,
        onchange: (v: number) => a.setOpacity(v),
      },
    ],
  };
}
