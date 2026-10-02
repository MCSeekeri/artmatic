import { describe, expect, it } from 'vitest';
import { SHAPE_PRESETS, shapeDefaultsToStrokeOnly, shapeGeometry } from '../../src/typography/shapes';
import type { ShapeKind } from '../../src/typography/document';

const BOX = { w: 200, h: 100 };

describe('shapeGeometry', () => {
  it('viewBox 与元素盒等尺寸 —— 缩放是 1:1，描边才能用 px', () => {
    expect(shapeGeometry('rect', BOX).viewBox).toBe('0 0 200 100');
  });

  it('尺寸取整且不为 0（退化盒不能产生 NaN 路径）', () => {
    expect(shapeGeometry('rect', { w: 0, h: 0 }).viewBox).toBe('0 0 1 1');
    expect(shapeGeometry('rect', { w: -5, h: 20 }).viewBox).toBe('0 0 1 20');
  });

  it('路径铺满整盒（外接框就是元素盒）', () => {
    const empty = shapeGeometry('rect', BOX);
    expect(empty.d).toContain('M0,0');
    expect(empty.d).toContain('H200');
    expect(empty.d).toContain('V100');
  });

  it('圆角矩形：radius 是像素，且钳到短边的一半', () => {
    expect(shapeGeometry('rect', BOX).d).toContain('M0,0');
    const r16 = shapeGeometry('rect', { ...BOX, radius: 16 }).d;
    expect(r16).toContain('M16,0');
    // 半径超过 50（短边 100 的一半）时被钳住，路径不会自交
    const huge = shapeGeometry('rect', { ...BOX, radius: 999 }).d;
    expect(huge).toContain('M50,0');
  });

  it('椭圆是两段半圆弧，且贴合盒尺寸', () => {
    const d = shapeGeometry('ellipse', BOX).d;
    expect(d).toContain('A100,50');
    expect(d.endsWith('Z')).toBe(true);
  });

  it('直线画在垂直中点', () => {
    expect(shapeGeometry('line', BOX).d).toBe('M0,50 L200,50');
  });

  it('星形 / 多边形按 sides 出顶点', () => {
    const star = shapeGeometry('star', BOX).d;
    expect(star.split('L').length).toBe(10); // 5 角 = 10 个顶点
    const hex = shapeGeometry('polygon', { ...BOX, sides: 6 }).d;
    expect(hex.split('L').length).toBe(6);
  });

  it('sides 有下限，不会退化成一个点', () => {
    const d = shapeGeometry('polygon', { ...BOX, sides: 1 }).d;
    expect(d.split('L').length).toBeGreaterThanOrEqual(3);
  });

  it('自定义路径：保留 authored 坐标系，交给调用方包 scale', () => {
    const g = shapeGeometry('svg', { ...BOX, path: 'M0,0 L50,50' });
    expect(g.scaleFrom100).toBe(true);
    expect(g.d).toBe('M0,0 L50,50');
    // 空路径有兜底，不会产出非法 d
    expect(shapeGeometry('svg', BOX).d.length).toBeGreaterThan(0);
  });

  it('内置图形都不需要 scale 组', () => {
    for (const p of SHAPE_PRESETS) {
      expect(shapeGeometry(p.id, { ...BOX, sides: p.sides, radius: p.radius }).scaleFrom100).toBeUndefined();
    }
  });

  it('同一输入产出同一字符串（光栅化缓存依赖这个）', () => {
    expect(shapeGeometry('star', { ...BOX, sides: 5 }).d).toBe(shapeGeometry('star', { ...BOX, sides: 5 }).d);
  });

  it('宽高互换时路径跟着换（不是简单的缩放）', () => {
    const wide = shapeGeometry('star', { w: 200, h: 100 }).d;
    const tall = shapeGeometry('star', { w: 100, h: 200 }).d;
    expect(wide).not.toBe(tall);
  });
});

describe('SHAPE_PRESETS', () => {
  it('key 唯一（下拉的 value 不能撞）', () => {
    const keys = SHAPE_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('每一项都是合法的 ShapeKind', () => {
    const valid: ShapeKind[] = ['rect', 'ellipse', 'line', 'triangle', 'star', 'polygon', 'svg'];
    for (const p of SHAPE_PRESETS) expect(valid).toContain(p.id);
  });

  it('每一项都能产出非空路径', () => {
    for (const p of SHAPE_PRESETS) {
      const d = shapeGeometry(p.id, { w: 100, h: 60, sides: p.sides, radius: p.radius }).d;
      expect(d.length).toBeGreaterThan(4);
    }
  });
});

describe('shapeDefaultsToStrokeOnly', () => {
  it('只有直线是「只描边」', () => {
    expect(shapeDefaultsToStrokeOnly('line')).toBe(true);
    expect(shapeDefaultsToStrokeOnly('rect')).toBe(false);
    expect(shapeDefaultsToStrokeOnly('ellipse')).toBe(false);
  });
});
