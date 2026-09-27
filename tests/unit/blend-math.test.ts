import { describe, expect, it } from 'vitest';
import { blendRef, BLEND_MODE_INDEX } from '../../src/engine/blend.frag';
import { drawSizeFor } from '../../src/engine/placement.frag';

/** blendRef 是 BLEND_FRAG 的 CPU 镜像——这里的已知值同时钉死两边。 */
describe('blendRef 已知值', () => {
  const main = [0.2, 0.4, 0.6, 1];

  it('normal：按 a 插值', () => {
    const out = blendRef(main, [1, 0, 0, 1], 'normal', 0.5);
    expect(out[0]).toBeCloseTo(0.6);
    expect(out[1]).toBeCloseTo(0.2);
    expect(out[2]).toBeCloseTo(0.3);
    expect(out[3]).toBe(1);
  });

  it('multiply：a=1 时直乘', () => {
    const out = blendRef([0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 1], 'multiply', 1);
    expect(out[0]).toBeCloseTo(0.25);
  });

  it('add：带 0.8 系数且截顶', () => {
    expect(blendRef([0.5, 0.5, 0.5, 1], [1, 1, 1, 1], 'add', 1)).toEqual([1, 1, 1, 1]);
    expect(blendRef([0.1, 0.1, 0.1, 1], [0.5, 0.5, 0.5, 1], 'add', 1)[0]).toBeCloseTo(0.5);
  });

  it('screen：0.5 对 0.5 得 0.75', () => {
    expect(blendRef([0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 1], 'screen', 1)[0]).toBeCloseTo(0.75);
  });

  it('difference / subtract / exclusion', () => {
    expect(blendRef([0.8, 0, 0, 1], [0.3, 0, 0, 1], 'difference', 1)[0]).toBeCloseTo(0.5);
    expect(blendRef([0.2, 0, 0, 1], [0.5, 0, 0, 1], 'subtract', 1)[0]).toBe(0);
    expect(blendRef([0.8, 0, 0, 1], [0.3, 0, 0, 1], 'exclusion', 1)[0]).toBeCloseTo(0.62);
  });

  it('overlay：暗侧亮侧分段', () => {
    expect(blendRef([0.4, 0, 0, 1], [0.7, 0, 0, 1], 'overlay', 1)[0]).toBeCloseTo(0.56);
    expect(blendRef([0.8, 0, 0, 1], [0.7, 0, 0, 1], 'overlay', 1)[0]).toBeCloseTo(0.88);
  });

  it('alpha 是 source-over 累积', () => {
    const out = blendRef([0, 0, 0, 0.5], [1, 1, 1, 0.5], 'normal', 1);
    expect(out[3]).toBeCloseTo(0.75);
  });

  it('层 alpha=0 时下层原样', () => {
    expect(blendRef(main, [1, 1, 1, 0], 'normal', 1)).toEqual(main);
  });

  it('八种模式都有编号且互不相同', () => {
    const ids = Object.values(BLEND_MODE_INDEX);
    expect(new Set(ids).size).toBe(8);
  });
});

describe('drawSizeFor', () => {
  it('contain：完整装入，保持宽高比', () => {
    expect(drawSizeFor('contain', 1920, 1080, 1000, 1000, 1, 1)).toEqual([1080, 1080]);
  });
  it('cover：铺满裁溢出', () => {
    expect(drawSizeFor('cover', 1920, 1080, 1000, 1000, 1, 1)).toEqual([1920, 1920]);
  });
  it('stretch：拉满加 transform 倍率', () => {
    expect(drawSizeFor('stretch', 1920, 1080, 4, 4, 0.5, 2)).toEqual([960, 2160]);
  });
});
