import { describe, expect, it } from 'vitest';
import {
  booleanOp,
  boundsOfMulti,
  multiToPath,
  multiToShape,
  pathToMultiPolygon,
  shapeToMultiPolygon,
  totalArea,
  type MultiPoly,
} from '../../src/typography/path-ops';
import { createShapeElement } from '../../src/typography/document';
import { shapeGeometry } from '../../src/typography/shapes';

const SIZE = { w: 1000, h: 1000 };

/** 轴对齐矩形 → MultiPolygon（测试的基准件）。 */
function rect(x: number, y: number, w: number, h: number): MultiPoly {
  return [
    [
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
    ],
  ];
}

describe('pathToMultiPolygon', () => {
  it('基本的 M/H/V/Z 矩形：一个环、面积正确', () => {
    const mp = pathToMultiPolygon('M0,0 H100 V100 H0 Z');
    expect(mp).toHaveLength(1);
    expect(mp[0]).toHaveLength(1);
    expect(mp[0]![0]).toHaveLength(4);
    expect(totalArea(mp)).toBeCloseTo(10000, 6);
  });

  it('一个命令带多组参数（`L 1 2 3 4`）会展开成多个顶点', () => {
    const mp = pathToMultiPolygon('M0,0 L100,0 100,100 0,100 Z');
    expect(mp[0]![0]).toHaveLength(4);
    expect(totalArea(mp)).toBeCloseTo(10000, 6);
  });

  it('相对命令：小写 l / h / v 走相对坐标', () => {
    expect(totalArea(pathToMultiPolygon('M0,0 h100 v100 h-100 z'))).toBeCloseTo(10000, 6);
  });

  it('`Z` 之后新开的子路径是**另一个**多边形', () => {
    const mp = pathToMultiPolygon('M0,0 H10 V10 H0 Z M100,100 H110 V110 H100 Z');
    expect(mp).toHaveLength(2);
    expect(totalArea(mp)).toBeCloseTo(200, 6);
  });

  it('少于三个点的子路径不构成面（被丢掉，不产生退化环）', () => {
    expect(pathToMultiPolygon('M0,0 L10,10')).toHaveLength(0);
  });

  it('重复的闭合尾点被去掉（Z 前后同一点都不该多出一个顶点）', () => {
    const mp = pathToMultiPolygon('M0,0 H10 V10 H0 L0,0 Z');
    expect(mp[0]![0]).toHaveLength(4);
  });

  it('空路径 / 乱码不抛异常，返回空', () => {
    expect(pathToMultiPolygon('')).toEqual([]);
    expect(pathToMultiPolygon('这不是路径')).toEqual([]);
  });
});

describe('圆弧与贝塞尔的离散化', () => {
  it('椭圆弧的面积逼近 πab（误差 < 1%）', () => {
    const d = shapeGeometry('ellipse', { w: 200, h: 100 }).d;
    const area = totalArea(pathToMultiPolygon(d));
    const exact = Math.PI * 100 * 50;
    expect(Math.abs(area - exact) / exact).toBeLessThan(0.01);
  });

  it('圆角矩形的面积 = 外框 − 四个角被削掉的部分', () => {
    const r = 30;
    const d = shapeGeometry('rect', { w: 200, h: 120, radius: r }).d;
    const area = totalArea(pathToMultiPolygon(d));
    const exact = 200 * 120 - (4 - Math.PI) * r * r;
    expect(Math.abs(area - exact) / exact).toBeLessThan(0.02);
  });

  it('圆弧半径过小时按规范放大（不产生 NaN 顶点）', () => {
    // 弦长 100，给的半径只有 10 —— 规范要求等比放大到 50。
    const mp = pathToMultiPolygon('M0,0 A10,10 0 0 1 100,0 L100,40 L0,40 Z');
    // flat(3) 才是「把所有坐标数字摊平」—— flat(2) 得到的是 [x,y] 对的数组，
    // Number.isFinite([0,0]) 恒为 false，那种断言等于没写。
    const all = mp.flat(3);
    expect(all.every((v) => Number.isFinite(v))).toBe(true);
    expect(totalArea(mp)).toBeGreaterThan(4000);
  });

  it('起终点重合的弧被忽略（否则会算出 NaN）', () => {
    const mp = pathToMultiPolygon('M0,0 A50,50 0 0 1 0,0 L100,0 L100,100 L0,100 Z');
    expect(mp.flat(3).every((v) => Number.isFinite(v))).toBe(true);
    expect(totalArea(mp)).toBeCloseTo(10000, 0);
  });

  it('二次贝塞尔（Q）能解析，最高点落在控制点之内（t=0.5 处为控制点的一半）', () => {
    const mp = pathToMultiPolygon('M0,0 Q50,100 100,0 L100,-30 L0,-30 Z');
    const b = boundsOfMulti(mp)!;
    // 二次贝塞尔在 t=0.5 的 y = 0.25·0 + 0.5·100 + 0.25·0 = 50 ⇒ 最高只到 50，
    // 而不是控制点的 100。这条判据同时钉住「控制点没有被当成曲线上的点」。
    expect(Math.max(b.y + b.h, -b.y)).toBeLessThan(100);
    expect(b.y + b.h).toBeCloseTo(50, 0);
    // 整体外接框：x 0..100，y -30..50
    expect(b.x).toBeCloseTo(0, 1);
    expect(b.y).toBeCloseTo(-30, 1);
  });
});

describe('布尔运算', () => {
  const a = rect(0, 0, 100, 100);
  const b = rect(50, 50, 100, 100);

  it('并集：两块面积相加再减掉重叠部分', () => {
    expect(totalArea(booleanOp('union', [a, b]))).toBeCloseTo(17500, 4);
  });

  it('交集：只留重叠的那 50×50', () => {
    expect(totalArea(booleanOp('intersection', [a, b]))).toBeCloseTo(2500, 4);
  });

  it('差集：第一个减掉其余', () => {
    expect(totalArea(booleanOp('difference', [a, b]))).toBeCloseTo(7500, 4);
    // 顺序反过来的结果是另一块 —— 这条钉住「差集不是对称的」。
    expect(totalArea(booleanOp('difference', [b, a]))).toBeCloseTo(7500, 4);
    const other = booleanOp('difference', [rect(0, 0, 200, 50), rect(0, 0, 50, 200)]);
    expect(boundsOfMulti(other)).toEqual({ x: 50, y: 0, w: 150, h: 50 });
  });

  it('异或：两块面积相加减掉两倍重叠', () => {
    expect(totalArea(booleanOp('xor', [a, b]))).toBeCloseTo(15000, 4);
  });

  it('挖洞：大方块减小方块得到**带洞**的多边形（两个环）', () => {
    const result = booleanOp('difference', [rect(0, 0, 100, 100), rect(30, 30, 40, 40)]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(2);
    expect(totalArea(result)).toBeCloseTo(10000 - 1600, 4);
  });

  it('不相交的两块做并集 → 两个独立多边形', () => {
    const result = booleanOp('union', [rect(0, 0, 10, 10), rect(100, 100, 10, 10)]);
    expect(result).toHaveLength(2);
    expect(totalArea(result)).toBeCloseTo(200, 4);
  });

  it('只有一个操作数时原样返回', () => {
    expect(booleanOp('union', [a])).toEqual(a);
  });

  it('没有操作数时返回空', () => {
    expect(booleanOp('union', [])).toEqual([]);
  });
});

describe('multiToShape（归一化到 0..100 authored）', () => {
  it('外接框成为新 frame，路径被归一化进 100×100', () => {
    const mp = booleanOp('union', [rect(200, 300, 100, 50), rect(250, 320, 100, 50)]);
    const shaped = multiToShape(mp)!;
    expect(shaped.frame).toEqual({ x: 200, y: 300, w: 150, h: 70 });
    const coords = shaped.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(Math.min(...coords)).toBeGreaterThanOrEqual(-0.01);
    expect(Math.max(...coords)).toBeLessThanOrEqual(100.01);
  });

  it('路径能被重新解析，且面积比例保持不变', () => {
    const mp = booleanOp('difference', [rect(0, 0, 100, 100), rect(30, 30, 40, 40)]);
    const shaped = multiToShape(mp)!;
    const back = pathToMultiPolygon(shaped.path);
    // 原框正好是 100×100 ⇒ 归一化的比例因子是 1，面积原样保留。
    expect(totalArea(back)).toBeCloseTo(8400, 1);
  });

  it('空输入返回 null（调用方据此「不改文档」）', () => {
    expect(multiToShape([])).toBeNull();
  });
});

describe('shapeToMultiPolygon（元素 → 文档坐标）', () => {
  it('把元素的 frame 偏移算进去', () => {
    const el = createShapeElement(SIZE, 'rect', {
      frame: { x: 200, y: 300, w: 100, h: 50, rot: 0 },
    });
    const mp = shapeToMultiPolygon(el);
    expect(boundsOfMulti(mp)).toEqual({ x: 200, y: 300, w: 100, h: 50 });
  });

  it('round-rect 的面积小于整块（圆角真的被削掉了）', () => {
    const el = createShapeElement(SIZE, 'rect', {
      frame: { x: 0, y: 0, w: 200, h: 100, rot: 0 },
      radius: 30,
    });
    expect(totalArea(shapeToMultiPolygon(el))).toBeLessThan(20000);
    expect(totalArea(shapeToMultiPolygon(el))).toBeGreaterThan(18000);
  });

  it('星形的面积小于外接框', () => {
    const el = createShapeElement(SIZE, 'star', {
      frame: { x: 0, y: 0, w: 200, h: 200, rot: 0 },
      sides: 5,
    });
    expect(totalArea(shapeToMultiPolygon(el))).toBeLessThan(200 * 200);
  });

  it('自定义 svg 图形按 0..100 缩放回元素尺寸', () => {
    const el = createShapeElement(SIZE, 'svg', {
      frame: { x: 100, y: 100, w: 300, h: 150, rot: 0 },
      path: 'M0,0 H100 V100 H0 Z',
    });
    expect(boundsOfMulti(shapeToMultiPolygon(el))).toEqual({ x: 100, y: 100, w: 300, h: 150 });
  });
});

describe('multiToPath', () => {
  it('每个环独立成一段 M…Z', () => {
    const d = multiToPath(booleanOp('difference', [rect(0, 0, 100, 100), rect(30, 30, 40, 40)]));
    expect(d.match(/M/g)!.length).toBe(2);
    expect(d.match(/Z/g)!.length).toBe(2);
  });

  it('同一输入产出同一字符串（光栅化缓存的稳定性依赖它）', () => {
    const mp = booleanOp('union', [rect(0, 0, 100, 100), rect(50, 50, 100, 100)]);
    expect(multiToPath(mp)).toBe(multiToPath(mp));
  });
});
