import { describe, expect, it } from 'vitest';
import {
  animLayerStyle,
  docStyle,
  elementStyle,
  imageStyle,
  paintCss,
  shapePaintAttrs,
  textStyle,
} from '../../src/typography/css';
import { createShapeElement, createTextElement, createTypographyDocument, defaultTextStyle } from '../../src/typography/document';

const SIZE = { w: 1000, h: 500 };
const doc = createTypographyDocument(SIZE);

describe('paintCss', () => {
  it('none → transparent，solid → 颜色值', () => {
    expect(paintCss({ kind: 'none' })).toBe('transparent');
    expect(paintCss({ kind: 'solid', color: '#ff0000' })).toBe('#ff0000');
  });
});

describe('docStyle', () => {
  it('尺寸是文档的自然尺寸', () => {
    const s = docStyle(doc);
    expect(s.width).toBe('1000px');
    expect(s.height).toBe('500px');
    expect(s.position).toBe('relative');
  });

  it('必须 isolation: isolate —— 否则元素会与编辑器页面背景混合', () => {
    // 这条不加的话，预览里 mix-blend-mode 的基准是编辑器 UI，导出时是黑底，
    // 两边不一致，而且「看起来都正常」，极难定位。
    expect(docStyle(doc)['isolation']).toBe('isolate');
  });

  it('不注入背景色 —— 排版层是要叠到画面上的，自带底会把下面全盖住', () => {
    expect(docStyle(doc)).not.toHaveProperty('background');
    expect(docStyle(doc)).not.toHaveProperty('background-color');
  });
});

describe('elementStyle', () => {
  it('几何用 px、旋转用角度', () => {
    const d = createTypographyDocument(SIZE);
    const el = createTextElement(d.size, { frame: { x: 10, y: 20, w: 300, h: 40, rot: Math.PI / 2 } });
    const s = elementStyle(el);
    expect(s.left).toBe('10px');
    expect(s.top).toBe('20px');
    expect(s.width).toBe('300px');
    expect(s.height).toBe('40px');
    expect(s.transform).toBe('rotate(90deg)');
  });

  it('没有旋转时 transform 是 none，不写 rotate(0deg)', () => {
    const d = createTypographyDocument(SIZE);
    expect(elementStyle(createTextElement(d.size)).transform).toBe('none');
  });

  it('不透明度传字符串、混合模式直传', () => {
    const d = createTypographyDocument(SIZE);
    const el = createTextElement(d.size, { opacity: 0.5, blend: 'screen' });
    const s = elementStyle(el);
    expect(s.opacity).toBe('0.5');
    expect(s['mix-blend-mode']).toBe('screen');
  });

  it('外层不吃指针事件（选择由编辑器自己算，不让 DOM 抢）', () => {
    const d = createTypographyDocument(SIZE);
    expect(elementStyle(createTextElement(d.size))['pointer-events']).toBe('none');
  });
});

describe('animLayerStyle', () => {
  it('内层铺满并带中心变换原点', () => {
    const s = animLayerStyle();
    expect(s.width).toBe('100%');
    expect(s.height).toBe('100%');
    expect(s['transform-origin']).toBe('50% 50%');
  });
});

describe('textStyle', () => {
  const base = defaultTextStyle(SIZE);

  it('字号与字距是 px，行高是纯数字', () => {
    const s = textStyle({ ...base, fontSize: 48, letterSpacing: 2, lineHeight: 1.5 });
    expect(s['font-size']).toBe('48px');
    expect(s['letter-spacing']).toBe('2px');
    expect(s['line-height']).toBe('1.5');
  });

  it('垂直对齐映射到 flex 的 justify-content', () => {
    expect(textStyle({ ...base, vAlign: 'top' })['justify-content']).toBe('flex-start');
    expect(textStyle({ ...base, vAlign: 'middle' })['justify-content']).toBe('center');
    expect(textStyle({ ...base, vAlign: 'bottom' })['justify-content']).toBe('flex-end');
  });

  it('水平对齐直传 text-align', () => {
    expect(textStyle({ ...base, align: 'justify' })['text-align']).toBe('justify');
  });

  it('竖排时主轴翻转（垂直对齐在视觉上变成水平）', () => {
    const s = textStyle({ ...base, writingMode: 'vertical-rl' });
    expect(s['flex-direction']).toBe('row');
    expect(s['writing-mode']).toBe('vertical-rl');
  });

  it('横排时主轴是列', () => {
    expect(textStyle(base)['flex-direction']).toBe('column');
  });

  it('保留换行与长词折行（否则多行文本会挤成一行）', () => {
    const s = textStyle(base);
    expect(s['white-space']).toBe('pre-wrap');
    expect(s['word-break']).toBe('break-word');
  });

  it('撑满元素框', () => {
    const s = textStyle(base);
    expect(s.width).toBe('100%');
    expect(s.height).toBe('100%');
    expect(s.position).toBe('absolute');
  });
});

describe('shapePaintAttrs', () => {
  it('无描边时 fill 生效、stroke 为 none', () => {
    const d = createTypographyDocument(SIZE);
    const el = createShapeElement(d.size, 'rect', {
      frame: { x: 0, y: 0, w: 100, h: 100, rot: 0 },
      fill: { kind: 'solid', color: '#123456' },
    });
    const a = shapePaintAttrs(el);
    expect(a.fill).toBe('#123456');
    expect(a.stroke).toBe('none');
  });

  it('描边宽度直接用文档 px（viewBox 与元素盒等尺寸）', () => {
    const d = createTypographyDocument(SIZE);
    const el = createShapeElement(d.size, 'rect', {
      frame: { x: 0, y: 0, w: 200, h: 100, rot: 0 },
      stroke: { color: '#fff', width: 3 },
    });
    // 不做任何换算：非等比缩放时边框不会一边粗一边细
    expect(shapePaintAttrs(el)['stroke-width']).toBe('3');
  });

  it('虚线 / 点线映射到 dasharray', () => {
    const d = createTypographyDocument(SIZE);
    const dashed = createShapeElement(d.size, 'rect', {
      frame: { x: 0, y: 0, w: 100, h: 100, rot: 0 },
      stroke: { color: '#fff', width: 1, style: 'dashed' },
    });
    const dotted = createShapeElement(d.size, 'rect', {
      frame: { x: 0, y: 0, w: 100, h: 100, rot: 0 },
      stroke: { color: '#fff', width: 1, style: 'dotted' },
    });
    expect(shapePaintAttrs(dashed)['stroke-dasharray']).toBeTruthy();
    expect(shapePaintAttrs(dotted)['stroke-dasharray']).toBeTruthy();
    expect(shapePaintAttrs(dashed)['stroke-dasharray']).not.toBe(shapePaintAttrs(dotted)['stroke-dasharray']);
  });

  it('描边宽度与元素尺寸无关（所以不等比缩放不会把边框拉歪）', () => {
    const d = createTypographyDocument(SIZE);
    const mk = (w: number, h: number) =>
      createShapeElement(d.size, 'rect', {
        frame: { x: 0, y: 0, w, h, rot: 0 },
        stroke: { color: '#fff', width: 5 },
      });
    expect(shapePaintAttrs(mk(50, 50))['stroke-width']).toBe('5');
    expect(shapePaintAttrs(mk(500, 20))['stroke-width']).toBe('5');
  });

  it('负宽度的描边被钳到 0，不产生 NaN', () => {
    const d = createTypographyDocument(SIZE);
    const el = createShapeElement(d.size, 'rect', {
      frame: { x: 0, y: 0, w: 0, h: 0, rot: 0 },
      stroke: { color: '#fff', width: -2 },
    });
    expect(shapePaintAttrs(el)['stroke-width']).toBe('0');
  });
});

describe('imageStyle', () => {
  it('无裁剪时图片铺满、fit 直传', () => {
    const d = createTypographyDocument(SIZE);
    const { wrapper, img } = imageStyle({
      kind: 'image', id: 'i', name: '', frame: { x: 0, y: 0, w: 100, h: 100, rot: 0 },
      blend: 'normal', opacity: 1, visible: true, locked: false, animations: [],
      assetId: 'a', fit: 'contain',
    });
    expect(wrapper.overflow).toBe('hidden');
    expect(img.width).toBe('100%');
    expect(img.height).toBe('100%');
    expect(img['object-fit']).toBe('contain');
  });

  it('裁剪窗把源图放大并偏移，正好铺满元素框', () => {
    const d = createTypographyDocument(SIZE);
    const { img } = imageStyle({
      kind: 'image', id: 'i', name: '', frame: { x: 0, y: 0, w: 100, h: 100, rot: 0 },
      blend: 'normal', opacity: 1, visible: true, locked: false, animations: [],
      assetId: 'a', fit: 'fill', crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    });
    expect(img.width).toBe('200.0000%');
    expect(img.height).toBe('200.0000%');
    expect(img.left).toBe('-50.0000%');
    expect(img.top).toBe('-50.0000%');
  });

  it('退化的裁剪窗（宽或高为 0）走无裁剪分支，不产生 Infinity', () => {
    const d = createTypographyDocument(SIZE);
    const { img } = imageStyle({
      kind: 'image', id: 'i', name: '', frame: { x: 0, y: 0, w: 100, h: 100, rot: 0 },
      blend: 'normal', opacity: 1, visible: true, locked: false, animations: [],
      assetId: 'a', fit: 'cover', crop: { x: 0, y: 0, w: 0, h: 0 },
    });
    expect(img.width).toBe('100%');
    expect(JSON.stringify(img)).not.toContain('Infinity');
    expect(JSON.stringify(img)).not.toContain('NaN');
  });

  it('圆角作用在裁窗上', () => {
    const d = createTypographyDocument(SIZE);
    const { wrapper } = imageStyle({
      kind: 'image', id: 'i', name: '', frame: { x: 0, y: 0, w: 100, h: 100, rot: 0 },
      blend: 'normal', opacity: 1, visible: true, locked: false, animations: [],
      assetId: 'a', fit: 'cover', radius: 8,
    });
    expect(wrapper['border-radius']).toBe('8px');
  });
});

describe('舞台与光栅化必须同源', () => {
  it('同一元素两次调用产出完全相同的声明（幂等）', () => {
    const d = createTypographyDocument(SIZE);
    const el = createTextElement(d.size);
    expect(elementStyle(el)).toEqual(elementStyle(el));
    expect(textStyle(el.style)).toEqual(textStyle(el.style));
  });
});
