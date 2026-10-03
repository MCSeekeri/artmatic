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
import { tr } from '../../i18n/index.svelte';

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
              value: style?.fontFamily ?? '',
              disabled: !hasText,
              options: fontOptions(input, style?.fontFamily ?? ''),
              onchange: (v) => a.setTextProp('fontFamily', v),
            },
            {
              kind: 'select',
              id: 'font-size',
              label: tr('rib.fontSize'),
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
              label: tr('rib.bold'),
              icon: 'bold',
              testid: 'ribbon-bold',
              disabled: !hasText,
              active: (style?.fontWeight ?? 400) >= 600,
              onchange: () => a.toggleTextFlag('bold'),
            },
            {
              kind: 'toggle',
              id: 'italic',
              label: tr('rib.italic'),
              icon: 'italic',
              testid: 'ribbon-italic',
              disabled: !hasText,
              active: style?.fontStyle === 'italic',
              onchange: () => a.toggleTextFlag('italic'),
            },
            {
              kind: 'toggle',
              id: 'underline',
              label: tr('rib.underline'),
              icon: 'underline',
              testid: 'ribbon-underline',
              disabled: !hasText,
              active: style?.textDecoration === 'underline',
              onchange: () => a.toggleTextFlag('underline'),
            },
            {
              kind: 'toggle',
              id: 'strike',
              label: tr('rib.strike'),
              icon: 'strikethrough',
              testid: 'ribbon-strike',
              disabled: !hasText,
              active: style?.textDecoration === 'line-through',
              onchange: () => a.toggleTextFlag('strike'),
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
              value: style?.letterSpacing ?? 0,
              step: 1,
              suffix: 'px',
              disabled: !hasText,
              onchange: (v) => a.setTextProp('letterSpacing', v),
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
              value: style?.color ?? '#ffffff',
              disabled: !hasText,
              onchange: (v) => a.setTextProp('color', v),
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
              // 做成下拉而不是图库：图库里塞 7 个形状要占掉 168px 宽 × 全高，
              // 在一个 114px 高的面板里就是「一列挤在一起的小字」（用户原话：
              // 「离谱的列表挤在一个极小的区域」）。
              kind: 'select',
              id: 'shape-picker',
              label: tr('rib.shape'),
              testid: 'typo-shape',
              optionTestidPrefix: 'typo-shape-option',
              width: 128,
              // 动作型下拉：选完不改变显示值，所以连点同一个形状也会重新触发。
              value: SHAPE_PICK,
              options: [
                { value: SHAPE_PICK, label: tr('rib.pickShape') },
                ...SHAPE_PRESETS.map((p) => ({ value: p.key, label: tr(p.labelKey) })),
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
          label: tr('rib.group.media'),
          items: [
            {
              kind: 'button',
              id: 'add-image',
              label: tr('rib.addImage'),
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
              kind: 'color',
              id: 'shape-fill',
              label: tr('rib.shapeFill'),
              icon: 'paint-bucket',
              testid: 'ribbon-shape-fill',
              value: shape?.fill.kind === 'solid' ? shape.fill.color : '#6f64ef',
              onchange: (v) => a.setShapeFill(v),
            },
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
            {
              kind: 'number',
              id: 'radius',
              label: tr('rib.radius'),
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
