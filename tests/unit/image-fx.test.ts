import { describe, expect, it } from 'vitest';
import {
  applyKeyToRgba,
  defaultKeySettings,
  hexToRgb01,
  identityQuad,
  keyKeep,
  luma,
  smoothstep,
} from '../../src/core/image-fx';

/**
 * 色键的 CPU 实现（排版图片元素用）。
 *
 * 判据全部对着 `engine/placement.frag.ts` 的 GLSL 写 —— 两套公式分家时，
 * 表现是「排版里抠得干净、时间轴上边缘发绿」，而且没有任何报错。
 */

const KEY = defaultKeySettings();

describe('hexToRgb01', () => {
  it('六位 hex → 0..1', () => {
    expect(hexToRgb01('#00ff00')).toEqual([0, 1, 0]);
    expect(hexToRgb01('#ff8000')).toEqual([1, 128 / 255, 0]);
  });

  it('坏形状回落黑（调用点已由 schema 挡过一遍）', () => {
    expect(hexToRgb01('00ff00')).toEqual([0, 0, 0]);
    expect(hexToRgb01('#fff')).toEqual([0, 0, 0]);
  });
});

describe('smoothstep', () => {
  it('两端与中点', () => {
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('edge0 >= edge1 时退化成阶跃（GLSL 未定义，这里给可预测行为）', () => {
    expect(smoothstep(1, 1, 0.5)).toBe(0);
    expect(smoothstep(1, 1, 1)).toBe(1);
  });
});

describe('keyKeep', () => {
  it('键色本身完全抠掉', () => {
    expect(keyKeep(0, 1, 0, KEY)).toBe(0);
  });

  it('远离键色的纯色完整保留', () => {
    expect(keyKeep(1, 0, 0, KEY)).toBe(1);
    expect(keyKeep(0, 0, 1, KEY)).toBe(1);
  });

  it('柔边区间里是部分保留（0 < keep < 1）', () => {
    // 距离落在 [t0, t0 + 柔边] 之间：纯绿压到半亮时距离约 0.30，
    // 而 tolerance=0.5 / softness=0.2 的区间是 [0.25, 0.35]。
    const mid = keyKeep(0, 0.5, 0, { ...KEY, tolerance: 0.5, softness: 0.2 });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('容差越大越容易抠掉（单调性）', () => {
    const rgb: [number, number, number] = [0.2, 0.9, 0.2];
    const tight = keyKeep(...rgb, { ...KEY, tolerance: 0.05, softness: 0.02 });
    const loose = keyKeep(...rgb, { ...KEY, tolerance: 0.6, softness: 0.02 });
    expect(loose).toBeLessThan(tight);
  });

  it('阴影下的绿幕与亮绿幕都算同一色度（亮度被剥掉）', () => {
    // 暗绿 / 亮绿：色度同向，距离只由亮度差贡献，而亮度项带 ×0.5 权重 ——
    // 所以压到 40% 亮度的绿幕用同一组参数也抠得掉（这正是它比 RGB 欧氏距离好的地方）。
    const wide = { ...KEY, tolerance: 0.9, softness: 0.1 };
    expect(keyKeep(0, 1, 0, wide)).toBe(0);
    expect(keyKeep(0, 0.4, 0, wide)).toBe(0);
  });
});

describe('luma', () => {
  it('BT.601 权重', () => {
    expect(luma(1, 1, 1)).toBeCloseTo(1, 12);
    expect(luma(1, 0, 0)).toBeCloseTo(0.299, 12);
  });
});

describe('applyKeyToRgba', () => {
  it('键色像素 alpha 归零，远离键色的像素一字不改', () => {
    const data = new Uint8ClampedArray([
      0, 255, 0, 255, // 纯绿 → 抠掉
      255, 0, 0, 255, // 纯红 → 保留
    ]);
    // spill 关掉才谈得上「rgb 一字不改」：默认 spill 会往亮度靠（与 GLSL 一致，
    // 见下一条）。非预乘语义下 alpha 变了而 rgb 不变才是正确的边缘色。
    applyKeyToRgba(data, { ...KEY, spill: 0 });
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
    expect([data[0], data[1], data[2]]).toEqual([0, 255, 0]);
  });

  it('spill = 0 时不改 rgb（只动 alpha）', () => {
    const data = new Uint8ClampedArray([40, 160, 40, 255]);
    const before = [...data];
    applyKeyToRgba(data, { ...KEY, tolerance: 0.8, softness: 0.1, spill: 0 });
    expect([data[0], data[1], data[2]]).toEqual([before[0], before[1], before[2]]);
    expect(data[3]).toBeLessThan(255);
  });

  it('spill = 1 时半透明边缘往亮度靠（去饱和）', () => {
    const data = new Uint8ClampedArray([30, 220, 30, 255]);
    applyKeyToRgba(data, { ...KEY, tolerance: 0.8, softness: 0.4, spill: 1 });
    // 绿通道被拉低、红/蓝被拉高（往亮度靠）
    expect(data[1]).toBeLessThan(220);
    expect(data[0]).toBeGreaterThan(30);
    expect(data[2]).toBeGreaterThan(30);
  });

  it('空数组不炸', () => {
    expect(() => applyKeyToRgba(new Uint8ClampedArray(0), KEY)).not.toThrow();
  });
});

describe('identityQuad', () => {
  it('是单位方四角', () => {
    expect(identityQuad()).toEqual({
      tl: [0, 0],
      tr: [1, 0],
      br: [1, 1],
      bl: [0, 1],
    });
  });

  it('每次返回新对象（原地改一个角不该污染下一次）', () => {
    const a = identityQuad();
    a.tl[0] = 0.4;
    expect(identityQuad().tl[0]).toBe(0);
  });
});
