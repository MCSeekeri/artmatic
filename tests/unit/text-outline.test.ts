import { describe, expect, it } from 'vitest';
import { applyTextTransform } from '../../src/typography/text-outline';
import { pickCssWeight } from '../../src/typography/font-registry';
import { pathUnitScale, shapeGeometry } from '../../src/typography/shapes';

/**
 * 「文本转路径」里**可以脱离浏览器测**的那几块：大小写转换、CSS 字重匹配、
 * 路径坐标系。DOM 测量与 HarfBuzz 轮廓在 E2E 里验（`typography-text-path.spec.ts`）。
 */

describe('applyTextTransform —— 与 CSS text-transform 同口径', () => {
  it('none 原样返回', () => {
    expect(applyTextTransform('Ab cD', 'none')).toBe('Ab cD');
  });

  it('uppercase / lowercase', () => {
    expect(applyTextTransform('Ab cD', 'uppercase')).toBe('AB CD');
    expect(applyTextTransform('Ab cD', 'lowercase')).toBe('ab cd');
  });

  it('capitalize 只动每个词的首字母', () => {
    expect(applyTextTransform('hello wORLD  foo', 'capitalize')).toBe('Hello WORLD  Foo');
  });

  it('中文没有大小写，保持原样', () => {
    expect(applyTextTransform('文字 Ab', 'uppercase')).toBe('文字 AB');
  });
});

describe('pickCssWeight —— CSS Fonts 4 的匹配顺序', () => {
  it('目标字重存在时直接命中', () => {
    expect(pickCssWeight(700, [400, 700])).toBe(700);
    expect(pickCssWeight(300, [300, 400])).toBe(300);
  });

  it('400 优先找 500，再往下，再往上', () => {
    expect(pickCssWeight(400, [400, 500])).toBe(400);
    expect(pickCssWeight(400, [300, 500])).toBe(500);
    expect(pickCssWeight(400, [300, 700])).toBe(300);
    expect(pickCssWeight(400, [700, 900])).toBe(700);
  });

  it('500 优先找 400，再往下，再往上', () => {
    expect(pickCssWeight(500, [400, 700])).toBe(400);
    expect(pickCssWeight(500, [300, 700])).toBe(300);
    expect(pickCssWeight(500, [700, 900])).toBe(700);
  });

  it('其余字重：先往小找，再往大找', () => {
    expect(pickCssWeight(600, [400, 700])).toBe(400);
    expect(pickCssWeight(800, [400, 700])).toBe(700);
    expect(pickCssWeight(100, [400, 700])).toBe(400);
  });
});

describe('pathUnit —— 自定义路径的坐标系', () => {
  it('缺省仍是 0..100 authored（生成器的老路径）', () => {
    const geo = shapeGeometry('svg', { w: 200, h: 80, path: 'M0,0 H100 V100 H0 Z' });
    expect(geo.scaleFrom100).toBe(true);
  });

  it("pathUnit: 'px' 不再套 scale 组（文本转路径）", () => {
    const geo = shapeGeometry('svg', {
      w: 200,
      h: 80,
      path: 'M0,0 H200 V80 H0 Z',
      pathUnit: 'px',
    });
    expect(geo.scaleFrom100).toBe(false);
    expect(geo.viewBox).toBe('0 0 200 80');
  });

  it('pathUnitScale 是唯一的换算处：percent 按各轴比例，px 原样', () => {
    expect(pathUnitScale({ pathUnit: undefined, frame: { x: 0, y: 0, w: 200, h: 80, rot: 0 } })).toEqual({
      x: 2,
      y: 0.8,
    });
    expect(pathUnitScale({ pathUnit: 'px', frame: { x: 0, y: 0, w: 200, h: 80, rot: 0 } })).toEqual({
      x: 1,
      y: 1,
    });
  });
});
