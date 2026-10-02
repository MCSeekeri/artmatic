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
  MIX_BLENDS,
  type ImageElement,
  type MixBlend,
  type ShapeElement,
  type TextElement,
  type TextStyle,
  type TypographyDocument,
  type TypographyElement,
} from '../../typography/document';
import { ANIM_PRESETS, type AnimTiming } from '../../typography/animation';
import { SHAPE_PRESETS } from '../../typography/shapes';
import type { TypographyActions } from './actions';

/** 「动作型」下拉的占位值：选完不改变显示值，所以可以连点。 */
const SHAPE_PICK = '__pick';
const ANIM_PICK = '__pick-anim';

export interface TypographyRibbonInput {
  doc: TypographyDocument;
  selection: TypographyElement[];
  alignTarget: 'canvas' | 'selection';
  /** 已注册的字体族（字体下拉的内容）。 */
  fontFamilies: string[];
  /** 当前激活的动画预设（若选中元素只挂了一个预设动画）。 */
  activePreset: string | null;
  /** 选中元素上第一个动画的时序（时序控件的显示值来源）。 */
  anim: AnimTiming | null;
  /** 打开「自定义 CSS」弹窗（界面状态，所以由编辑器提供）。 */
  onOpenCustomCss: () => void;
  /** 「转为图片」逃生舱。 */
  onFlatten: () => void;
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

/** 字体下拉的选项：已注册的族 + 文档里正在用的族（后者可能尚未注册）。 */
function fontOptions(input: TypographyRibbonInput, current: string): { value: string; label: string }[] {
  const names = new Set(input.fontFamilies);
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

  /** 时序控件的显示值：取选中元素上的第一个动画。 */
  const anim: AnimTiming | null = selection.flatMap((e) => e.animations)[0] ?? null;

  const tabs: RibbonTabDef[] = [
    /* ------------------------------------------------------------ 开始 */
    {
      id: 'home',
      label: '开始',
      order: 0,
      groups: [
        {
          id: 'font',
          label: '字体',
          items: [
            {
              kind: 'select',
              id: 'font-family',
              label: '字体',
              testid: 'ribbon-font-family',
              // 固定宽度 + 触发区自己 ellipsis：字体名长度不可控，让它撑开的话
              // 整条 Ribbon 的布局会在换字体时跳一下（用户反馈的「tab 跳变」）。
              width: 148,
              optionTestidPrefix: 'ribbon-font-option',
              value: style?.fontFamily ?? '',
              disabled: !hasText,
              options: fontOptions(input, style?.fontFamily ?? ''),
              onchange: (v) => a.setTextProp('fontFamily', v),
            },
            {
              kind: 'select',
              id: 'font-size',
              label: '字号',
              testid: 'ribbon-font-size',
              width: 92,
              value: String(style?.fontSize ?? 0),
              disabled: !hasText,
              options: FONT_SIZES.map((s) => ({ value: String(s), label: String(s) })),
              onchange: (v) => a.setTextProp('fontSize', Number(v)),
            },
            {
              kind: 'toggle',
              id: 'bold',
              label: '加粗',
              icon: 'bold',
              testid: 'ribbon-bold',
              disabled: !hasText,
              active: (style?.fontWeight ?? 400) >= 600,
              onchange: () => a.toggleTextFlag('bold'),
            },
            {
              kind: 'toggle',
              id: 'italic',
              label: '斜体',
              icon: 'italic',
              testid: 'ribbon-italic',
              disabled: !hasText,
              active: style?.fontStyle === 'italic',
              onchange: () => a.toggleTextFlag('italic'),
            },
            {
              kind: 'toggle',
              id: 'underline',
              label: '下划线',
              icon: 'underline',
              testid: 'ribbon-underline',
              disabled: !hasText,
              active: style?.textDecoration === 'underline',
              onchange: () => a.toggleTextFlag('underline'),
            },
            {
              kind: 'toggle',
              id: 'strike',
              label: '删除线',
              icon: 'strikethrough',
              testid: 'ribbon-strike',
              disabled: !hasText,
              active: style?.textDecoration === 'line-through',
              onchange: () => a.toggleTextFlag('strike'),
            },
            {
              kind: 'button',
              id: 'import-font',
              label: '导入字体',
              // 语义是「拿进来」，不是「传上去」—— 用 upload 的箭头朝上会误导。
              icon: 'import',
              testid: 'typo-font-import',
              onselect: () => a.importFont(),
            },
          ],
        },
        {
          id: 'para',
          label: '段落',
          items: [
            {
              kind: 'number',
              id: 'letter-spacing',
              label: '字距',
              testid: 'ribbon-letter-spacing',
              value: style?.letterSpacing ?? 0,
              step: 1,
              suffix: 'px',
              disabled: !hasText,
              onchange: (v) => a.setTextProp('letterSpacing', v),
            },
            {
              kind: 'number',
              id: 'line-height',
              label: '行高',
              testid: 'ribbon-line-height',
              value: style?.lineHeight ?? 1.2,
              step: 0.05,
              precision: 2,
              disabled: !hasText,
              onchange: (v) => a.setTextProp('lineHeight', v),
            },
            {
              kind: 'toggle',
              id: 'align-left',
              label: '左',
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
              label: '中',
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
              label: '右',
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
              label: '两端',
              size: 'small',
              icon: 'text-align-justify',
              testid: 'ribbon-align-justify',
              disabled: !hasText,
              active: style?.align === 'justify',
              onchange: () => a.setTextAlign('justify'),
            },
            {
              kind: 'toggle',
              id: 'valign-top',
              label: '顶',
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
              label: '中',
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
              label: '底',
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
          label: '文本颜色',
          items: [
            {
              kind: 'color',
              id: 'text-color',
              label: '颜色',
              testid: 'ribbon-text-color',
              value: style?.color ?? '#ffffff',
              disabled: !hasText,
              onchange: (v) => a.setTextProp('color', v),
            },
          ],
        },
        {
          id: 'align',
          label: '对齐',
          items: [
            {
              kind: 'segment',
              id: 'align-target',
              label: '对齐到',
              testid: 'typo-align-target',
              value: alignTarget,
              options: [
                { value: 'canvas', label: '画布' },
                { value: 'selection', label: '选区' },
              ],
              onchange: (v) => a.setAlignTarget(v as 'canvas' | 'selection'),
            },
            {
              kind: 'button',
              id: 'align-l',
              label: '左对齐',
              icon: 'align-start-vertical',
              testid: 'typo-align-left',
              disabled: none,
              onselect: () => a.align('left'),
            },
            {
              kind: 'button',
              id: 'align-ch',
              label: '水平居中',
              icon: 'align-center-vertical',
              testid: 'typo-center-h',
              disabled: none,
              onselect: () => a.align('center-h'),
            },
            {
              kind: 'button',
              id: 'align-r',
              label: '右对齐',
              icon: 'align-end-vertical',
              testid: 'typo-align-right',
              disabled: none,
              onselect: () => a.align('right'),
            },
            {
              kind: 'button',
              id: 'align-t',
              label: '顶对齐',
              icon: 'align-start-horizontal',
              testid: 'typo-align-top',
              disabled: none,
              onselect: () => a.align('top'),
            },
            {
              kind: 'button',
              id: 'align-cv',
              label: '垂直居中',
              icon: 'align-center-horizontal',
              testid: 'typo-center-v',
              disabled: none,
              onselect: () => a.align('middle'),
            },
            {
              kind: 'button',
              id: 'align-b',
              label: '底对齐',
              icon: 'align-end-horizontal',
              testid: 'typo-align-bottom',
              disabled: none,
              onselect: () => a.align('bottom'),
            },
            {
              kind: 'button',
              id: 'dist-h',
              label: '横向分布',
              icon: 'align-horizontal-space-between',
              testid: 'typo-distribute-h',
              // 少于 3 个没有「等距」可言
              disabled: n < 3,
              onselect: () => a.align('distribute-h'),
            },
            {
              kind: 'button',
              id: 'dist-v',
              label: '纵向分布',
              icon: 'align-vertical-space-between',
              testid: 'typo-distribute-v',
              disabled: n < 3,
              onselect: () => a.align('distribute-v'),
            },
          ],
        },
        {
          id: 'order',
          label: '层级',
          items: [
            {
              kind: 'button',
              id: 'to-front',
              label: '置顶',
              size: 'small',
              icon: 'bring-to-front',
              testid: 'typo-to-front',
              disabled: none,
              onselect: () => a.order('front'),
            },
            {
              kind: 'button',
              id: 'forward',
              label: '上移',
              size: 'small',
              icon: 'move-up',
              testid: 'typo-forward',
              disabled: none,
              onselect: () => a.order('forward'),
            },
            {
              kind: 'button',
              id: 'backward',
              label: '下移',
              size: 'small',
              icon: 'move-down',
              testid: 'typo-backward',
              disabled: none,
              onselect: () => a.order('backward'),
            },
            {
              kind: 'button',
              id: 'to-back',
              label: '置底',
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
          label: '编辑',
          items: [
            {
              kind: 'button',
              id: 'add-text',
              label: '文本框',
              icon: 'type',
              testid: 'typo-add-text',
              onselect: () => a.addText(),
            },
            {
              kind: 'button',
              id: 'duplicate',
              label: '复制',
              icon: 'copy',
              testid: 'typo-duplicate',
              disabled: none,
              onselect: () => a.duplicateSelection(),
            },
            {
              kind: 'button',
              id: 'delete',
              label: '删除',
              icon: 'trash',
              testid: 'typo-delete',
              disabled: none,
              onselect: () => a.deleteSelection(),
            },
            {
              kind: 'toggle',
              id: 'lock',
              label: '锁定',
              icon: 'lock',
              testid: 'typo-lock',
              disabled: none,
              active: selection.every((e) => e.locked),
              onchange: () => a.toggleFlag('locked'),
            },
            {
              kind: 'toggle',
              id: 'hide',
              label: '隐藏',
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
      label: '插入',
      order: 1,
      groups: [
        {
          id: 'shapes',
          label: '图形',
          items: [
            {
              // 做成下拉而不是图库：图库里塞 7 个形状要占掉 168px 宽 × 全高，
              // 在一个 114px 高的面板里就是「一列挤在一起的小字」（用户原话：
              // 「离谱的列表挤在一个极小的区域」）。
              kind: 'select',
              id: 'shape-picker',
              label: '形状',
              testid: 'typo-shape',
              optionTestidPrefix: 'typo-shape-option',
              width: 128,
              // 动作型下拉：选完不改变显示值，所以连点同一个形状也会重新触发。
              value: SHAPE_PICK,
              options: [
                { value: SHAPE_PICK, label: '选择形状…' },
                ...SHAPE_PRESETS.map((p) => ({ value: p.key, label: p.label })),
              ],
              onchange: (v) => {
                const preset = SHAPE_PRESETS.find((p) => p.key === v);
                if (preset) a.addShape(preset);
              },
            },
          ],
        },
        {
          id: 'media',
          label: '图片',
          items: [
            {
              kind: 'button',
              id: 'add-image',
              label: '插入图片',
              icon: 'image-plus',
              testid: 'typo-add-image',
              onselect: () => a.addImage(),
            },
          ],
        },
      ],
    },

    /* ------------------------------------------------------------ 动画 */
    {
      id: 'anim',
      label: '动画',
      order: 2,
      groups: [
        {
          id: 'presets',
          label: '预设',
          items: [
            {
              kind: 'select',
              id: 'anim-preset',
              label: '动画',
              testid: 'typo-anim-preset',
              optionTestidPrefix: 'typo-anim-option',
              width: 140,
              value: input.activePreset ?? ANIM_PICK,
              options: [
                { value: ANIM_PICK, label: '选择预设…' },
                ...ANIM_PRESETS.map((p) => ({ value: p.id, label: p.label })),
              ],
              onchange: (v) => {
                const preset = ANIM_PRESETS.find((p) => p.id === v);
                if (preset) a.applyPreset(preset.id);
              },
            },
            {
              kind: 'button',
              id: 'clear-anim',
              label: '清除动画',
              icon: 'rotate-cw',
              testid: 'typo-anim-clear',
              disabled: none,
              onselect: () => a.clearAnimations(),
            },
          ],
        },
        {
          id: 'anim-timing',
          label: '时序',
          items: [
            {
              kind: 'number',
              id: 'anim-delay',
              label: '延迟',
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
              label: '时长',
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
              label: '次数',
              testid: 'typo-anim-iterations',
              value: anim ? (anim.iterations === Infinity ? 'inf' : String(anim.iterations)) : '1',
              disabled: !anim,
              options: [
                { value: '1', label: '1 次' },
                { value: '2', label: '2 次' },
                { value: '3', label: '3 次' },
                { value: '5', label: '5 次' },
                { value: 'inf', label: '循环' },
              ],
              onchange: (v) =>
                a.setAnimTiming({ iterations: v === 'inf' ? Infinity : Number(v) }),
            },
            {
              kind: 'select',
              id: 'anim-easing',
              label: '缓动',
              testid: 'typo-anim-easing',
              value: typeof anim?.easing === 'string' ? anim.easing : 'ease',
              disabled: !anim,
              options: [
                { value: 'linear', label: '匀速' },
                { value: 'ease', label: '默认' },
                { value: 'ease-in', label: '渐快' },
                { value: 'ease-out', label: '渐慢' },
                { value: 'ease-in-out', label: '两端缓' },
              ],
              onchange: (v) => a.setAnimTiming({ easing: v as AnimTiming['easing'] }),
            },
            {
              kind: 'select',
              id: 'anim-direction',
              label: '方向',
              testid: 'typo-anim-direction',
              value: anim?.direction ?? 'normal',
              disabled: !anim,
              options: [
                { value: 'normal', label: '正向' },
                { value: 'reverse', label: '反向' },
                { value: 'alternate', label: '往复' },
                { value: 'alternate-reverse', label: '往复（反）' },
              ],
              onchange: (v) => a.setAnimTiming({ direction: v as AnimTiming['direction'] }),
            },
            {
              kind: 'select',
              id: 'anim-fill',
              label: '填充',
              testid: 'typo-anim-fill',
              value: anim?.fill ?? 'both',
              disabled: !anim,
              options: [
                { value: 'none', label: '不保留' },
                { value: 'forwards', label: '保留终态' },
                { value: 'backwards', label: '保留初态' },
                { value: 'both', label: '两端都保留' },
              ],
              onchange: (v) => a.setAnimTiming({ fill: v as AnimTiming['fill'] }),
            },
          ],
        },
        {
          id: 'anim-edit',
          label: '编辑',
          items: [
            {
              kind: 'button',
              id: 'custom-css',
              label: '自定义 CSS',
              icon: 'wand-sparkles',
              testid: 'typo-anim-css',
              disabled: none,
              onselect: () => input.onOpenCustomCss(),
            },
            {
              kind: 'button',
              id: 'clear-anim',
              label: '清除动画',
              icon: 'rotate-cw',
              testid: 'typo-anim-clear',
              disabled: none,
              onselect: () => a.clearAnimations(),
            },
            {
              kind: 'button',
              id: 'flatten',
              label: '转为图片',
              icon: 'image',
              testid: 'typo-flatten',
              onselect: () => input.onFlatten(),
            },
          ],
        },
      ],
    },

    /* ------------------------------------------- [Contextual] 图形格式 */
    {
      id: 'shape-format',
      label: '图形格式',
      contextual: true,
      order: 10,
      groups: [
        {
          id: 'fill',
          label: '填充',
          items: [
            {
              kind: 'color',
              id: 'shape-fill',
              label: '填充',
              icon: 'paint-bucket',
              testid: 'ribbon-shape-fill',
              value: shape?.fill.kind === 'solid' ? shape.fill.color : '#6f64ef',
              onchange: (v) => a.setShapeFill(v),
            },
          ],
        },
        {
          id: 'stroke',
          label: '描边',
          items: [
            {
              kind: 'color',
              id: 'shape-stroke',
              label: '描边色',
              icon: 'square-dashed',
              testid: 'ribbon-shape-stroke',
              value: shape?.stroke?.color ?? '#ffffff',
              onchange: (v) => a.setShapeStroke(v),
            },
            {
              kind: 'number',
              id: 'stroke-width',
              label: '线宽',
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
              label: '线型',
              testid: 'ribbon-stroke-style',
              value: shape?.stroke?.style ?? 'solid',
              options: LINE_STYLES.map((s) => ({
                value: s,
                label: s === 'solid' ? '实线' : s === 'dashed' ? '虚线' : '点线',
              })),
              onchange: (v) => a.setShapeStrokeStyle(v as (typeof LINE_STYLES)[number]),
            },
          ],
        },
        {
          id: 'shape',
          label: '形状',
          items: [
            {
              kind: 'number',
              id: 'radius',
              label: '圆角',
              testid: 'ribbon-shape-radius',
              value: shape?.radius ?? 0,
              min: 0,
              step: 1,
              onchange: (v) => a.setShapeRadius(v),
            },
          ],
        },
        effectsGroup(shape?.blend ?? 'normal', shape?.opacity ?? 1, a),
      ],
    },

    /* ------------------------------------------- [Contextual] 图片格式 */
    {
      id: 'image-format',
      label: '图片格式',
      contextual: true,
      order: 11,
      groups: [
        {
          id: 'image-fit',
          label: '图片样式',
          items: [
            {
              kind: 'select',
              id: 'image-fit',
              label: '适配',
              testid: 'ribbon-image-fit',
              value: image?.fit ?? 'cover',
              options: [
                { value: 'fill', label: '拉伸' },
                { value: 'contain', label: '完整显示' },
                { value: 'cover', label: '铺满裁切' },
                { value: 'none', label: '原始尺寸' },
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
    label: '艺术效果',
    items: [
      {
        kind: 'select' as const,
        id: 'blend',
        label: '混合模式',
        testid: 'ribbon-blend',
        value: blend,
        options: MIX_BLENDS.map((m) => ({ value: m.id, label: m.label })),
        onchange: (v: string) => a.setBlend(v as MixBlend),
      },
      {
        kind: 'number' as const,
        id: 'opacity',
        label: '不透明度',
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
