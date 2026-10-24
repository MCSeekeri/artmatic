import { describe, expect, it } from 'vitest';
import {
  IMAGE_FILTERS,
  adjustIsDefault,
  applyImageAdjustments,
  applyImageFilter,
  applyImageRecolor,
  coerceImageAdjust,
  coerceImageBorder,
  coerceImageFilter,
  coerceImageRecolor,
  curveLut,
  defaultImageAdjust,
  isImageFilterId,
  recolorIsDefault,
  type CurvePoint,
} from '../../src/typography/image-effects';
import {
  CROP_ASPECTS,
  cropForAspect,
  frameForAlign,
  resizeFrameCentered,
} from '../../src/typography/image-geometry';

/** 一张 2×2 的纯色测试图（可变）。 */
function solid(r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  const d = new Uint8ClampedArray(2 * 2 * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a;
  }
  return d;
}

describe('curveLut', () => {
  it('空曲线 = 恒等', () => {
    const lut = curveLut([]);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
  });

  it('两端各补一段线性：首点在 0.5 时暗部按比例走，不被整段拉平', () => {
    const pts: CurvePoint[] = [{ x: 0.5, y: 0.5 }];
    const lut = curveLut(pts);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBeCloseTo(128, 0);
    expect(lut[255]).toBe(255);
    // 首点左侧是 (0,0) → (0.5,0.5) 的直线
    expect(lut[64]!).toBeGreaterThan(50);
    expect(lut[64]!).toBeLessThan(80);
  });

  it('提亮曲线单调不减', () => {
    const lut = curveLut([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.8 },
      { x: 1, y: 1 },
    ]);
    for (let i = 1; i < 256; i++) expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]!);
    expect(lut[128]!).toBeGreaterThan(128);
  });
});

describe('applyImageAdjustments', () => {
  it('全 0 不动像素（判空后连 LUT 都不建）', () => {
    const d = solid(10, 20, 30);
    applyImageAdjustments(d, defaultImageAdjust());
    expect([...d]).toEqual([10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255]);
  });

  it('亮度 ± 平移', () => {
    const up = solid(100, 100, 100);
    applyImageAdjustments(up, { ...defaultImageAdjust(), brightness: 20 });
    expect(up[0]).toBe(151); // 100 + 51
    const down = solid(100, 100, 100);
    applyImageAdjustments(down, { ...defaultImageAdjust(), brightness: -20 });
    expect(down[0]).toBe(49);
  });

  it('饱和度 -100 = 灰度（三通道相等）', () => {
    const d = solid(200, 40, 20);
    applyImageAdjustments(d, { ...defaultImageAdjust(), saturation: -100 });
    expect(d[0]).toBe(d[1]);
    expect(d[1]).toBe(d[2]);
  });

  it('透明像素原样跳过（RGB 也不动，避免抠图后的边缘被染亮）', () => {
    const d = solid(200, 40, 20, 0);
    applyImageAdjustments(d, { ...defaultImageAdjust(), brightness: 100 });
    expect([d[0], d[1], d[2], d[3]]).toEqual([200, 40, 20, 0]);
  });
});

describe('applyImageRecolor', () => {
  it('亮度 0 → 暗部色，亮度 255 → 亮部色', () => {
    const black = solid(0, 0, 0);
    applyImageRecolor(black, { color: '#ffffff', shadow: '#000000', amount: 1 });
    expect([black[0], black[1], black[2]]).toEqual([0, 0, 0]);

    const white = solid(255, 255, 255);
    applyImageRecolor(white, { color: '#ffffff', shadow: '#000000', amount: 1 });
    expect([white[0], white[1], white[2]]).toEqual([255, 255, 255]);
  });

  it('中灰被映射到渐变的中间（黑→红的 0.5 处）', () => {
    const d = solid(128, 128, 128);
    applyImageRecolor(d, { color: '#ff0000', shadow: '#000000', amount: 1 });
    expect(d[0]).toBeCloseTo(128, -1);
    expect(d[1]).toBe(0);
    expect(d[2]).toBe(0);
  });

  it('amount 0 直接跳过（不改变像素）', () => {
    const d = solid(10, 20, 30);
    applyImageRecolor(d, { color: '#ff0000', shadow: '#0000ff', amount: 0 });
    expect([d[0], d[1], d[2]]).toEqual([10, 20, 30]);
  });
});

describe('滤镜', () => {
  const ALL = IMAGE_FILTERS.map((f) => f.id);

  it('至少 15 个（产品要求）且 id 唯一', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(15);
    expect(new Set(ALL).size).toBe(ALL.length);
    for (const id of ALL) expect(isImageFilterId(id)).toBe(true);
  });

  it.each(ALL)('%s 是确定性的（同输入两次逐字节相同）', (id) => {
    const make = (): Uint8ClampedArray => {
      const d = new Uint8ClampedArray(8 * 8 * 4);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const o = (y * 8 + x) * 4;
          d[o] = x * 31;
          d[o + 1] = y * 31;
          d[o + 2] = (x + y) * 15;
          d[o + 3] = 255;
        }
      }
      return d;
    };
    const a = make();
    const b = make();
    applyImageFilter(a, 8, 8, { id: id as never, amount: 0.8 });
    applyImageFilter(b, 8, 8, { id: id as never, amount: 0.8 });
    expect([...a]).toEqual([...b]);
  });

  it('黑白让三通道相等', () => {
    const d = solid(200, 40, 20);
    applyImageFilter(d, 2, 2, { id: 'grayscale', amount: 1 });
    expect(d[0]).toBe(d[1]);
    expect(d[1]).toBe(d[2]);
  });

  it('反色 = 255 - v', () => {
    const d = solid(200, 40, 20);
    applyImageFilter(d, 2, 2, { id: 'invert', amount: 1 });
    expect([d[0], d[1], d[2]]).toEqual([55, 215, 235]);
  });

  it('马赛克让同一块内的像素相同', () => {
    const d = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = (i / 4) % 255;
      d[i + 1] = 128;
      d[i + 2] = 64;
      d[i + 3] = 255;
    }
    applyImageFilter(d, 16, 16, { id: 'mosaic', amount: 1 });
    // 左上 2×2 块（block 至少 2）内部相等
    expect(d[0]).toBe(d[4]);
  });

  it('amount 0 = 不改画面', () => {
    const d = solid(11, 22, 33);
    applyImageFilter(d, 2, 2, { id: 'sepia', amount: 0 });
    expect([d[0], d[1], d[2]]).toEqual([11, 22, 33]);
  });

  it('未知 id 直接忽略（不抛）', () => {
    const d = solid(11, 22, 33);
    applyImageFilter(d, 2, 2, { id: 'nope' as never, amount: 1 });
    expect([d[0], d[1], d[2]]).toEqual([11, 22, 33]);
  });
});

describe('校验 / 判空', () => {
  it('adjust 全 0 = 默认', () => {
    expect(adjustIsDefault(undefined)).toBe(true);
    expect(adjustIsDefault(defaultImageAdjust())).toBe(true);
    expect(adjustIsDefault({ ...defaultImageAdjust(), soften: 1 })).toBe(false);
    // 空曲线的对象仍算默认（curvesEmpty 判的是「有没有点」）
    expect(adjustIsDefault({ ...defaultImageAdjust(), curves: {} })).toBe(true);
    expect(
      adjustIsDefault({ ...defaultImageAdjust(), curves: { master: [{ x: 0.5, y: 0.6 }] } }),
    ).toBe(false);
  });

  it('recolor amount 0 = 没有效果', () => {
    expect(recolorIsDefault(undefined)).toBe(true);
    expect(recolorIsDefault({ color: '#fff', shadow: '#000', amount: 0 })).toBe(true);
    expect(recolorIsDefault({ color: '#fff', shadow: '#000', amount: 0.1 })).toBe(false);
  });

  it('coerceImageAdjust 夹取区间并保留未给的键', () => {
    const a = coerceImageAdjust({ brightness: 999, contrast: -999 }, { ...defaultImageAdjust(), sharpen: 30 });
    expect(a?.brightness).toBe(100);
    expect(a?.contrast).toBe(-100);
    expect(a?.sharpen).toBe(30);
  });

  it('coerceImageAdjust：curves:null 清空、坏曲线丢弃但保留其它项', () => {
    const base = {
      ...defaultImageAdjust(),
      curves: { master: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    };
    expect(coerceImageAdjust({ curves: null }, base)?.curves).toBeUndefined();
    const bad = coerceImageAdjust({ curves: 'nope' }, base);
    expect(bad?.curves).toEqual(base.curves);
  });

  it('coerceImageRecolor 只收 #hex', () => {
    expect(coerceImageRecolor({ color: 'red' })).toBeNull();
    expect(coerceImageRecolor({ color: '#abc' })).toEqual({ color: '#abc', shadow: '#1b2a4a', amount: 1 });
  });

  it('coerceImageBorder 宽度 0..200', () => {
    expect(coerceImageBorder({ width: 9999 })?.width).toBe(200);
    expect(coerceImageBorder({ width: 0 })).toEqual({ color: '#ffffff', width: 0 });
    expect(coerceImageBorder({ color: 'x' })).toBeNull();
  });

  it('边框色可以收主题槽位引用（渲染期解析），重新着色不行（要吃像素）', () => {
    expect(coerceImageBorder({ color: '@accent1' })?.color).toBe('@accent1');
    expect(coerceImageBorder({ color: '@accent1.l80' })?.color).toBe('@accent1.l80');
    // 抠图 / 重新着色的颜色参与逐像素计算，引用在那里不是颜色
    expect(coerceImageRecolor({ color: '@accent1' })).toBeNull();
  });

  it('coerceImageFilter 要求已知 id', () => {
    expect(coerceImageFilter({ id: 'nope' })).toBeNull();
    expect(coerceImageFilter({ id: 'mosaic' })).toEqual({ id: 'mosaic', amount: 0.6 });
    expect(coerceImageFilter({ id: 'mosaic', amount: 5 })?.amount).toBe(1);
  });
});

describe('图片几何', () => {
  it('原图比例 16:9 裁 16:9 = 整张（crop 为 null）', () => {
    expect(cropForAspect({ w: 1920, h: 1080 }, null)).toBeNull();
    const r = cropForAspect({ w: 1920, h: 1080 }, 16 / 9);
    expect(r?.w).toBeCloseTo(1, 5);
    expect(r?.h).toBeCloseTo(1, 5);
  });

  it('4:3 图裁 1:1 = 居中竖切，窗口比例对得上源像素', () => {
    const r = cropForAspect({ w: 400, h: 300 }, 1)!;
    expect(r.h).toBeCloseTo(1, 5);
    expect(r.w).toBeCloseTo(0.75, 5);
    expect(r.x).toBeCloseTo(0.125, 5);
    expect(r.y).toBeCloseTo(0, 5);
    // 窗口的**源像素**宽高比必须正好是 1
    expect((r.w * 400) / (r.h * 300)).toBeCloseTo(1, 5);
  });

  it('方图裁 2:1 = 居中横切', () => {
    const r = cropForAspect({ w: 100, h: 100 }, 2)!;
    expect(r.w).toBeCloseTo(1, 5);
    expect(r.h).toBeCloseTo(0.5, 5);
    expect(r.y).toBeCloseTo(0.25, 5);
  });

  it('素材尺寸未知时不猜（返回 null）', () => {
    expect(cropForAspect({ w: 0, h: 0 }, 1)).toBeNull();
  });

  it('每个预设都给出有限数', () => {
    for (const p of CROP_ASPECTS) {
      if (p.ratio === null) continue;
      const r = cropForAspect({ w: 800, h: 600 }, p.ratio)!;
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('对齐画布：居中 / 适应 / 铺满 / 拉伸', () => {
    const f = { x: 10, y: 20, w: 400, h: 200, rot: 0 };
    const canvas = { w: 1000, h: 1000 };
    expect(frameForAlign(f, canvas, 'center')).toEqual({ x: 300, y: 400 });
    // fit：按小比例的边缩放（1000/400=2.5 vs 1000/200=5 → 取 2.5）
    const fit = frameForAlign(f, canvas, 'fit');
    expect(fit.w).toBe(1000);
    expect(fit.h).toBe(500);
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(250);
    const fill = frameForAlign(f, canvas, 'fill');
    expect(fill.w).toBe(2000);
    expect(fill.h).toBe(1000);
    expect(fill.x).toBe(-500);
    expect(frameForAlign(f, canvas, 'stretch')).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
    expect(frameForAlign(f, canvas, 'center-h')).toEqual({ x: 300 });
  });

  it('改大小保持中心', () => {
    const f = { x: 100, y: 100, w: 200, h: 100, rot: 0 };
    const p = resizeFrameCentered(f, { w: 100 }, true);
    // 等比：h 跟着减半，中心 (200, 150) 不动
    expect(p.w).toBe(100);
    expect(p.h).toBe(50);
    expect(p.x).toBe(150);
    expect(p.y).toBe(125);
    const free = resizeFrameCentered(f, { h: 200 }, false);
    expect(free.w).toBe(200);
    expect(free.h).toBe(200);
    expect(free.y).toBe(50);
  });
});
