import { describe, expect, it } from 'vitest';
import {
  SHAPE_PRESETS,
  roundPolygonPath,
  shapeDefaultsToStrokeOnly,
  shapeGeometry,
  shapeParamSupport,
} from '../../src/typography/shapes';
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

  it('路径铺满整盒（坐标范围正好是 0..w / 0..h）', () => {
    // 钉**几何**而不是命令名：`rect` 现在与其它多边形共用 `roundPolygonPath`，
    // 同一个矩形可以由 `M0,0 H200 …` 或 `M0,0 L200,0 …` 两种写法描述。
    // 断言「含 H200」会把「换了一种等价写法」误判成回归。
    const coords = [...shapeGeometry('rect', BOX).d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)];
    const xs = coords.map((m) => Number(m[1]));
    const ys = coords.map((m) => Number(m[2]));
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(200);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(100);
  });

  it('圆角矩形：radius 是像素；超限时弧半径缩回短边的一半', () => {
    const r16 = shapeGeometry('rect', { ...BOX, radius: 16 }).d;
    // 四个角各一段弧，半径就是 16
    expect(r16.match(/A16,16/g)!.length).toBe(4);

    // 半径 999 远大于短边的一半（50）⇒ 弧半径被缩到 50，路径不会鼓出去
    const huge = shapeGeometry('rect', { ...BOX, radius: 999 }).d;
    expect(huge).toContain('A50,50');
    expect(huge).not.toContain('A999');
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

/* ------------------------------------------------------------ 通用圆角 */

describe('roundPolygonPath', () => {
  const SQUARE = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it('radius 0 = 纯折线（与旧实现逐位相同）', () => {
    expect(roundPolygonPath(SQUARE, 0)).toBe('M0,0 L100,0 L100,100 L0,100 Z');
  });

  it('radius > 0 时每个顶点换成一段圆弧', () => {
    const d = roundPolygonPath(SQUARE, 10);
    expect(d.match(/A/g)!.length).toBe(4);
    expect(d.endsWith('Z')).toBe(true);
    // 顶点 0 (0,0) 的切点是 (0,10) 与 (10,0)，弧半径 10。
    expect(d.startsWith('M0,10 A10,10 0 0 1 10,0')).toBe(true);
    // 相邻两段弧之间保留直边：顶点 1 的切点从 (90,0) 开始。
    expect(d).toContain('L90,0 A10,10 0 0 1 100,10');
  });

  it('半径过大时收在边中点上，不会自交', () => {
    // 边长 100，切点最远只能到中点（tMax = 50）；半径 10000 会被缩回去。
    const d = roundPolygonPath(SQUARE, 10000);
    // 弧半径必须被缩到 50（不再是 10000），否则图形会鼓出去
    expect(d).not.toContain('A10000');
    expect(d.match(/A50,50/g)!.length).toBe(4);
    // 切点正好落在边中点，直边长度归零
    expect(d).toContain('L50,0 A50,50 0 0 1 100,50');
  });

  it('顶点数少于 3 返回空串（调用方不会拿到非法 d）', () => {
    expect(roundPolygonPath([{ x: 0, y: 0 }, { x: 1, y: 1 }], 4)).toBe('');
  });


});

describe('新增图形', () => {
  it('带洞的图形标了 evenOdd（否则洞会被填满，看起来参数没生效）', () => {
    expect(shapeGeometry('ring', BOX).evenOdd).toBe(true);
    expect(shapeGeometry('frame', BOX).evenOdd).toBe(true);
    expect(shapeGeometry('rect', BOX).evenOdd).toBeUndefined();
  });

  it('圆环路径含两段闭合子路径', () => {
    const d = shapeGeometry('ring', BOX).d;
    expect(d.match(/M/g)!.length).toBe(2);
  });

  it('壁厚越厚，内圈越小', () => {
    const thin = shapeGeometry('ring', { ...BOX, inner: 5 }).d;
    const thick = shapeGeometry('ring', { ...BOX, inner: 40 }).d;
    expect(thin).not.toBe(thick);
  });

  it('扇形按张角走：360° 退化成椭圆', () => {
    expect(shapeGeometry('pie', { ...BOX, angle: 360 }).d).toBe(shapeGeometry('ellipse', BOX).d);
    const quarter = shapeGeometry('pie', { ...BOX, angle: 90 }).d;
    // 小于 180° 用 large-arc=0
    expect(quarter).toContain('A100,50 0 0 1');
  });

  it('星形的锐利度参数真的改变几何', () => {
    const sharp = shapeGeometry('star', { ...BOX, sides: 5, waist: 0.15 }).d;
    const blunt = shapeGeometry('star', { ...BOX, sides: 5, waist: 0.8 }).d;
    expect(sharp).not.toBe(blunt);
  });

  it('三角形/梯形/平行四边形/箭头 也吃圆角', () => {
    for (const k of ['triangle', 'trapezoid', 'parallelogram', 'arrow'] as ShapeKind[]) {
      expect(shapeGeometry(k, BOX).d).not.toContain('A');
      expect(shapeGeometry(k, { ...BOX, radius: 8 }).d).toContain('A');
    }
  });
});

describe('shapeParamSupport', () => {
  it('声明的参数与实际几何一致：radius 支持 = 路径里真的会出现弧（给非零半径时）', () => {
    const kinds: ShapeKind[] = [
      'rect',
      'ellipse',
      'line',
      'triangle',
      'star',
      'polygon',
      'trapezoid',
      'parallelogram',
      'arrow',
      'ring',
      'frame',
      'pie',
      'svg',
    ];
    for (const k of kinds) {
      const supported = shapeParamSupport(k).radius;
      if (!supported) continue;
      // 支持圆角的图形，给半径就必须出现圆弧段 —— 否则这个开关是个摆设。
      expect(shapeGeometry(k, { ...BOX, radius: 6 }).d).toContain('A');
    }
  });

  it('边数只对多边形与星形开放', () => {
    expect(shapeParamSupport('polygon').sides).toBe(true);
    expect(shapeParamSupport('star').sides).toBe(true);
    expect(shapeParamSupport('rect').sides).toBe(false);
  });

  it('锐利度只属于星形，壁厚只属于圆环/方框，张角只属于扇形', () => {
    expect(shapeParamSupport('star').waist).toBe(true);
    expect(shapeParamSupport('polygon').waist).toBe(false);
    expect(shapeParamSupport('ring').inner).toBe(true);
    expect(shapeParamSupport('frame').inner).toBe(true);
    expect(shapeParamSupport('rect').inner).toBe(false);
    expect(shapeParamSupport('pie').angle).toBe(true);
    expect(shapeParamSupport('ellipse').angle).toBe(false);
  });
});
