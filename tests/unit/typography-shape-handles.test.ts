import { describe, expect, it } from 'vitest';
import { createShapeElement, type ShapeElement } from '../../src/typography/document';
import { shapeHandles, shapeParamValue, type ShapeHandle } from '../../src/typography/shape-handles';
import { shapeVertexRing } from '../../src/typography/shapes';

const SIZE = { w: 400, h: 300 };

function mk(shape: ShapeElement['shape'], over: Partial<ShapeElement> = {}): ShapeElement {
  return createShapeElement(SIZE, shape, { frame: { x: 0, y: 0, w: 200, h: 120, rot: 0 }, ...over });
}

// 「当前参数值」直接用实现导出的那个 —— 测试里再抄一份的话，改缺省值时
// 两边会一起变成错的，守不住任何东西。
const valueOf = shapeParamValue;

const handle = (el: ShapeElement, id: ShapeHandle['param']): ShapeHandle => {
  const h = shapeHandles(el).find((x) => x.id === id);
  expect(h, `${el.shape} 应该有 ${id} 控制点`).toBeTruthy();
  return h!;
};

describe('哪些图形该有控制点', () => {
  it('自定义路径没有任何控制点（形状就是那串数据，交给顶点编辑）', () => {
    expect(shapeHandles(mk('svg', { path: 'M0,0 L100,0 L100,100 Z' }))).toEqual([]);
  });

  it('椭圆与直线没有可拖的参数', () => {
    expect(shapeHandles(mk('ellipse'))).toEqual([]);
    expect(shapeHandles(mk('line'))).toEqual([]);
  });

  it('每个图形只给出真正有意义的那些控制点', () => {
    expect(shapeHandles(mk('rect')).map((h) => h.id)).toEqual(['radius']);
    expect(shapeHandles(mk('star')).map((h) => h.id)).toEqual(['radius', 'waist']);
    expect(shapeHandles(mk('pie')).map((h) => h.id)).toEqual(['angle']);
    expect(shapeHandles(mk('ring')).map((h) => h.id)).toEqual(['inner']);
    expect(shapeHandles(mk('frame')).map((h) => h.id)).toEqual(['radius', 'inner']);
    // 正多边形只有圆角 —— 边数不适合用拖动改（拖过 3.5 边是什么意思？）
    expect(shapeHandles(mk('polygon', { sides: 6 })).map((h) => h.id)).toEqual(['radius']);
  });
});

describe('把手位置 ↔ 取值 必须互逆', () => {
  /*
   * 这一组是本文件的核心判据：**不钉住具体数值**，而是要求「把手所在的位置，
   * 代回它的 read 得到的正是当前参数值」。
   *
   * 于是任何一侧被单独改动（比如把星形内顶点的角度公式换掉却没动 read）
   * 都会在这里红 —— 而钉死坐标的断言在「改了把手位置」时也会红，却分不清
   * 是位置错了还是本来就想改位置。
   */
  const cases: ShapeElement[] = [
    mk('rect', { radius: 24 }),
    mk('triangle', { radius: 10 }),
    mk('star', { sides: 5, waist: 0.4, radius: 8 }),
    mk('star', { sides: 6, waist: 0.55 }),
    mk('polygon', { sides: 8, radius: 6 }),
    mk('trapezoid', { radius: 12 }),
    mk('arrow', { radius: 4 }),
    mk('pie', { angle: 270 }),
    mk('ring', { inner: 20 }),
    mk('frame', { inner: 12, radius: 8 }),
  ];

  it('拖到把手自己所在的位置 = 参数保持原值', () => {
    for (const el of cases) {
      for (const h of shapeHandles(el)) {
        const before = valueOf(el, h.param);
        const at = { x: h.x, y: h.y };
        const got = h.read(at, at, before);
        expect(got, `${el.shape}.${h.param}`).toBeCloseTo(before, 6);
      }
    }
  });

  it('圆角把手到顶点的投影距离等于半径（位置本身就是那个半径的映射）', () => {
    const el = mk('rect', { radius: 30 });
    const h = handle(el, 'radius');
    const ring = shapeVertexRing('rect', { w: el.frame.w, h: el.frame.h, radius: el.radius });
    const vertex = ring[0]!;
    // 沿「顶点 → 质心」方向的投影
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
    const len = Math.hypot(cx - vertex.x, cy - vertex.y);
    const u = { x: (cx - vertex.x) / len, y: (cy - vertex.y) / len };
    const proj = (h.x - vertex.x) * u.x + (h.y - vertex.y) * u.y;
    expect(proj).toBeCloseTo(30, 6);
  });

  it('星形谷点把手就在「归一化半径 = waist」的那条线上', () => {
    const el = mk('star', { sides: 5, waist: 0.4, frame: { x: 0, y: 0, w: 200, h: 200, rot: 0 } });
    const h = handle(el, 'waist');
    const cx = 100;
    const cy = 100;
    expect(Math.hypot((h.x - cx) / cx, (h.y - cy) / cy)).toBeCloseTo(0.4, 6);
    // 且方向是「从正上方起、每隔 π/sides」的那个内顶点
    const a = Math.atan2(h.y - cy, h.x - cx);
    const want = Math.PI / 5 - Math.PI / 2;
    expect(Math.abs(Math.sin(a - want))).toBeLessThan(1e-6);
  });
});

describe('拖动换算', () => {
  it('圆角：沿对角线往外拖会变大，往里拖会变小', () => {
    const el = mk('rect', { radius: 30 });
    const h = handle(el, 'radius');
    const at = { x: h.x, y: h.y };
    const ring = shapeVertexRing('rect', { w: el.frame.w, h: el.frame.h });
    const vertex = ring[0]!;
    const dir = { x: h.x - vertex.x, y: h.y - vertex.y };
    const len = Math.hypot(dir.x, dir.y);
    const u = { x: dir.x / len, y: dir.y / len };

    const out = h.read({ x: at.x + u.x * 20, y: at.y + u.y * 20 }, at, 30);
    const into = h.read({ x: at.x - u.x * 20, y: at.y - u.y * 20 }, at, 30);
    expect(out).toBeCloseTo(50, 4);
    expect(into).toBeCloseTo(10, 4);
  });

  it('圆角：垂直于对角线的乱拖不影响（用的是投影，不是距离）', () => {
    const el = mk('rect', { radius: 30 });
    const h = handle(el, 'radius');
    const at = { x: h.x, y: h.y };
    const ring = shapeVertexRing('rect', { w: el.frame.w, h: el.frame.h });
    const vertex = ring[0]!;
    const dir = { x: at.x - vertex.x, y: at.y - vertex.y };
    const len = Math.hypot(dir.x, dir.y);
    // 垂直于「顶点 → 把手」方向的单位向量
    const perp = { x: -dir.y / len, y: dir.x / len };
    const got = h.read({ x: at.x + perp.x * 30, y: at.y + perp.y * 30 }, at, 30);
    expect(got).toBeCloseTo(30, 6);
  });

  it('圆角被钳在 [0, 短边的一半]', () => {
    const el = mk('rect', { radius: 30 });
    const h = handle(el, 'radius');
    const at = { x: h.x, y: h.y };
    expect(h.read({ x: at.x + 1000, y: at.y + 1000 }, at, 30)).toBeCloseTo(60, 6);
    expect(h.read({ x: at.x - 1000, y: at.y - 1000 }, at, 30)).toBe(0);
  });

  it('扇形：正右方 = 90°，正下方 = 180°，正左方 = 270°', () => {
    const el = mk('pie', { frame: { x: 0, y: 0, w: 200, h: 200, rot: 0 }, angle: 90 });
    const h = handle(el, 'angle');
    const at = { x: h.x, y: h.y };
    expect(h.read({ x: 150, y: 100 }, at, 90)).toBeCloseTo(90, 6);
    expect(h.read({ x: 100, y: 150 }, at, 90)).toBeCloseTo(180, 6);
    // 正左方那条从 180° 出发：与 90° 的差**正好**是 180°，而 180° 是方向歧义点
    // （往左往右一样远），单帧里无从判断。真实拖动是连续的、每帧只走几度，
    // 永远不会落到这个点上 —— 测试也不该构造它。
    expect(h.read({ x: 50, y: 100 }, at, 180)).toBeCloseTo(270, 6);
  });

  it('扇形：从大角度侧拖到正上方得到 360（整圆），不是 1（一条缝）', () => {
    // 0° 与 360° 是同一个方向。张角钳在 [1, 360]，不特判的话「拖到顶」
    // 会落成 1° —— 一个几乎空白的扇形，而用户明明是把把手拉到了正上方。
    const el = mk('pie', { frame: { x: 0, y: 0, w: 200, h: 200, rot: 0 }, angle: 270 });
    const h = handle(el, 'angle');
    const at = { x: h.x, y: h.y };
    expect(h.read({ x: 100, y: 50 }, at, 270)).toBe(360);
  });

  it('扇形：跨越 0°/360° 时走最短路径，不会整圈翻过去', () => {
    const el = mk('pie', { frame: { x: 0, y: 0, w: 200, h: 200, rot: 0 }, angle: 2 });
    const h = handle(el, 'angle');
    const at = { x: h.x, y: h.y };
    // 指针在正上方略偏左（≈358° 的位置）。从 2° 出发的最短路径是往 0 走 4°，
    // 而不是绕一大圈到 358 —— 判据写成「离最近的端点不超过 10°」才抓得住
    // 「翻过去」这个错误（翻过去会落在 180 附近）。
    const got = h.read({ x: 95, y: 50 }, at, 2);
    expect(Math.min(got, 360 - got)).toBeLessThan(10);
  });

  it('圆环：壁厚随指针靠近中心而变大', () => {
    const el = mk('ring', { frame: { x: 0, y: 0, w: 200, h: 200, rot: 0 }, inner: 20 });
    const h = handle(el, 'inner');
    const at = { x: h.x, y: h.y };
    const outer = Math.min(100, 100);
    const near = h.read({ x: 100 + 20, y: 100 }, at, el.inner!);
    const far = h.read({ x: 100 + 90, y: 100 }, at, el.inner!);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeCloseTo((1 - 0.2) * outer, 4);
  });

  it('方框：壁厚是「指针到右边 / 下边距离的较小者」', () => {
    const el = mk('frame', { frame: { x: 0, y: 0, w: 200, h: 120, rot: 0 }, inner: 12 });
    const h = handle(el, 'inner');
    const at = { x: h.x, y: h.y };
    expect(h.read({ x: 160, y: 80 }, at, 12)).toBeCloseTo(40, 6);
    expect(h.read({ x: 190, y: 110 }, at, 12)).toBeCloseTo(10, 6);
  });
});

describe('坐标系', () => {
  it('把手坐标是**未旋转**的局部坐标（旋转由调用方叠加）', () => {
    const flat = mk('rect', { radius: 24, frame: { x: 0, y: 0, w: 200, h: 120, rot: 0 } });
    const turned = mk('rect', { radius: 24, frame: { x: 50, y: 60, w: 200, h: 120, rot: 0.7 } });
    const a = handle(flat, 'radius');
    const b = handle(turned, 'radius');
    // 位置与尺寸相同 ⇒ 把手局部坐标必须一致，旋转和平移都不该渗进来
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  });
});
