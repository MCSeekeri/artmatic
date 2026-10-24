import { describe, expect, it } from 'vitest';
import {
  CANVAS_RATIOS,
  MIN_CANVAS_EDGE,
  footprintOf,
  sizeForRatio,
  withLockedAspect,
} from '../../src/typography/canvas-size';

/**
 * 画布「画幅」计算。
 *
 * 这里最要紧的一条是 `footprintOf` 与渲染侧**同源**：读数说 960×240，画面上就
 * 得是 960×240。所以断言直接对着 `drawSizeFor` 的语义写，而不是复刻一遍公式。
 */

const FRAME = { w: 1920, h: 1080 };

describe('sizeForRatio', () => {
  it('16:9 装进 16:9 工程 = 工程本身', () => {
    expect(sizeForRatio(16 / 9, FRAME)).toEqual({ w: 1920, h: 1080 });
  });

  it('正方形取画面的短边', () => {
    expect(sizeForRatio(1, FRAME)).toEqual({ w: 1080, h: 1080 });
  });

  it('竖幅按高度撑满、宽度收窄', () => {
    expect(sizeForRatio(9 / 16, FRAME)).toEqual({ w: 608, h: 1080 });
  });

  it('宽幅按宽度撑满、高度收窄', () => {
    expect(sizeForRatio(21 / 9, FRAME)).toEqual({ w: 1920, h: 823 });
  });

  it('比例非法时退回工程尺寸，不产出 0 / NaN', () => {
    expect(sizeForRatio(0, FRAME)).toEqual({ w: 1920, h: 1080 });
    expect(sizeForRatio(NaN, FRAME)).toEqual({ w: 1920, h: 1080 });
    expect(sizeForRatio(1, { w: 0, h: 0 })).toEqual({ w: MIN_CANVAS_EDGE, h: MIN_CANVAS_EDGE });
  });

  it('预设表里只有「工程」那条不写比例', () => {
    const project = CANVAS_RATIOS.filter((p) => p.ratio === null);
    expect(project.map((p) => p.id)).toEqual(['project']);
  });

  it('预设表的 id 与比例逐条对得上（id 同时是按钮文案与 testid）', () => {
    expect(CANVAS_RATIOS.map((p) => p.id)).toEqual(['project', '16:9', '9:16', '1:1', '4:5']);
    const [, w169, h916, square, fourFive] = CANVAS_RATIOS.map((p) => p.ratio);
    expect(w169).toBeCloseTo(16 / 9, 10);
    expect(h916).toBeCloseTo(9 / 16, 10);
    expect(square).toBe(1);
    expect(fourFive).toBeCloseTo(4 / 5, 10);
  });

  it('工程尺寸某一轴为 0：只钳那一轴，另一轴照抄（不除出 0×0）', () => {
    expect(sizeForRatio(1, { w: 0, h: 500 })).toEqual({ w: MIN_CANVAS_EDGE, h: 500 });
    expect(sizeForRatio(1, { w: 500, h: 0 })).toEqual({ w: 500, h: MIN_CANVAS_EDGE });
  });
});

describe('withLockedAspect', () => {
  it('改宽 → 高按当前画幅重算', () => {
    expect(withLockedAspect({ w: 1080, h: 1080 }, 'w', 540)).toEqual({ w: 540, h: 540 });
    expect(withLockedAspect({ w: 608, h: 1080 }, 'w', 304)).toEqual({ w: 304, h: 540 });
  });

  it('改高 → 宽按当前画幅重算', () => {
    expect(withLockedAspect({ w: 1920, h: 1080 }, 'h', 540)).toEqual({ w: 960, h: 540 });
  });


  it('钳到下限，且不产生 0 边', () => {
    const out = withLockedAspect({ w: 1920, h: 1080 }, 'w', 0);
    expect(out.w).toBe(MIN_CANVAS_EDGE);
    expect(out.h).toBeGreaterThanOrEqual(MIN_CANVAS_EDGE);
  });

  it('画布已有 0 边时退回正方形，不除出 Infinity', () => {
    // 除零会给出 Infinity，它会一路写进 doc.size 再进 GLSL（画面直接空掉）。
    expect(withLockedAspect({ w: 0, h: 100 }, 'w', 50)).toEqual({ w: 50, h: 50 });
    expect(withLockedAspect({ w: 100, h: 0 }, 'h', 300)).toEqual({ w: 300, h: 300 });
    expect(withLockedAspect({ w: 0, h: 0 }, 'h', 300)).toEqual({ w: 300, h: 300 });
  });
});

describe('footprintOf', () => {
  it('画布等于工程尺寸 + contain = 占满画面', () => {
    expect(footprintOf(FRAME, FRAME, 'contain')).toEqual({ w: 1920, h: 1080, pctW: 100, pctH: 100 });
  });

  it('缩放到 50% 就是画面的一半', () => {
    const f = footprintOf(FRAME, FRAME, 'contain', 0.5, 0.5);
    expect(f).toEqual({ w: 960, h: 540, pctW: 50, pctH: 50 });
  });

  it('同比例改画布像素**不改变**上屏大小（contain 的必然结果）', () => {
    // 这是「改了画布尺寸画面没变小」这个误解的来源，读数必须如实反映。
    expect(footprintOf({ w: 1280, h: 720 }, FRAME, 'contain')).toEqual({
      w: 1920, h: 1080, pctW: 100, pctH: 100,
    });
  });

  it('换画幅才让它不占满全屏', () => {
    // 1080×1080 在 1920×1080 里 = 正中一个方块（高占满、宽 56%）
    expect(footprintOf({ w: 1080, h: 1080 }, FRAME, 'contain')).toEqual({
      w: 1080, h: 1080, pctW: 56, pctH: 100,
    });
  });

  it('stretch 忽略比例，直接等于工程画面 × 缩放', () => {
    expect(footprintOf({ w: 800, h: 200 }, FRAME, 'stretch', 0.5, 0.5)).toEqual({
      w: 960, h: 540, pctW: 50, pctH: 50,
    });
  });

  it('工程画面为 0 时百分比取 0，不是 NaN', () => {
    // 读数是界面文案，NaN 会原样显示成「NaN%」。
    const f = footprintOf({ w: 100, h: 100 }, { w: 0, h: 0 }, 'contain');
    expect(f.pctW).toBe(0);
    expect(f.pctH).toBe(0);
  });
});
