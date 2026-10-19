import { describe, expect, it } from 'vitest';
import {
  clipCurvePath,
  curveAreaPath,
  curvePath,
  diamondPath,
  fitDomain,
  snapToFrame,
  timeOfX,
  valueOfY,
  xOfTime,
  yOfValue,
  type GraphDomain,
  type PlotBox,
} from '../../src/ui/curve-editor/curve-geometry';
import type { Key } from '../../src/core/curve';

const BOX: PlotBox = { left: 46, top: 12, width: 476, height: 172 };
const DOMAIN: GraphDomain = { t0: 0, t1: 4, v0: 0, v1: 1 };

describe('坐标映射', () => {
  it('时间 / 值双向换算互为逆运算', () => {
    for (const t of [0, 0.37, 2, 4]) {
      expect(timeOfX(xOfTime(t, DOMAIN, BOX), DOMAIN, BOX)).toBeCloseTo(t, 9);
    }
    for (const v of [0, 0.25, 0.9, 1]) {
      expect(valueOfY(yOfValue(v, DOMAIN, BOX), DOMAIN, BOX)).toBeCloseTo(v, 9);
    }
  });

  it('y 轴向上（值越大，屏幕 y 越小），且落在 plot 内', () => {
    expect(yOfValue(1, DOMAIN, BOX)).toBeCloseTo(BOX.top, 9);
    expect(yOfValue(0, DOMAIN, BOX)).toBeCloseTo(BOX.top + BOX.height, 9);
    expect(xOfTime(0, DOMAIN, BOX)).toBeCloseTo(BOX.left, 9);
    expect(xOfTime(4, DOMAIN, BOX)).toBeCloseTo(BOX.left + BOX.width, 9);
  });
});

describe('fitDomain', () => {
  it('装得下越界的关键帧，并在两端留出边距', () => {
    const d = fitDomain(
      [
        { t: -2, v: -3 },
        { t: 6, v: 4 },
      ],
      { t0: 0, t1: 4, v0: 0, v1: 1 },
    );
    expect(d.t0).toBeLessThan(-2);
    expect(d.t1).toBeGreaterThan(6);
    expect(d.v0).toBeLessThan(-3);
    expect(d.v1).toBeGreaterThan(4);
  });

  it('单个关键帧 + 零量程参数也不会除零', () => {
    const d = fitDomain([{ t: 2, v: 0.5 }], { t0: 2, t1: 2, v0: 0.5, v1: 0.5 });
    expect(d.t1 - d.t0).toBeGreaterThan(0);
    expect(d.v1 - d.v0).toBeGreaterThan(0);
    expect(Number.isFinite(xOfTime(2, d, BOX))).toBe(true);
    expect(Number.isFinite(yOfValue(0.5, d, BOX))).toBe(true);
  });
});

describe('curvePath', () => {
  const key = (t: number, v: number, interp: Key['interp'] = 'linear'): Key => ({ t, v, interp });

  it('step 段画成「先水平、再竖直跳变」的直角折线', () => {
    const keys = [key(0, 0, 'step'), key(1, 1)];
    const path = curvePath(keys, DOMAIN, BOX);
    const xb = xOfTime(1, DOMAIN, BOX).toFixed(2);
    // 水平段停在 b.t 处（值仍是 a.v），紧接着在同一条 x 上跳到 b.v
    expect(path).toContain(`L ${xb} ${yOfValue(0, DOMAIN, BOX).toFixed(2)}`);
    expect(path).toContain(`L ${xb} ${yOfValue(1, DOMAIN, BOX).toFixed(2)}`);
  });

  it('首个 key 之前与最后一个 key 之后是水平线', () => {
    const keys = [key(1, 0.2), key(2, 0.8)];
    const path = curvePath(keys, DOMAIN, BOX);
    expect(path.startsWith(`M ${xOfTime(0, DOMAIN, BOX).toFixed(2)}`)).toBe(true);
    expect(path.endsWith(`L ${xOfTime(4, DOMAIN, BOX).toFixed(2)} ${yOfValue(0.8, DOMAIN, BOX).toFixed(2)}`)).toBe(true);
  });

  it('没有关键帧时返回空路径（不画一条假线）', () => {
    expect(curvePath([], DOMAIN, BOX)).toBe('');
  });
});

describe('片段迷你曲线', () => {
  const BOX100: PlotBox = { left: 0, top: 0, width: 100, height: 100 };
  const key = (t: number, v: number, interp: Key['interp'] = 'linear'): Key => ({ t, v, interp });

  it('x 只映射片段范围，片段外的 key 参与求值但不改变映射', () => {
    const keys = [key(0, 0), key(5, 1)];
    const d = clipCurvePath(keys, 2, 4, 0, 1, BOX100);
    // 片段起点 x=0 处，值已经走到 0.4（linear）；终点 t=4 处是 0.8
    expect(d.startsWith('M 0.00 60.00')).toBe(true);
    expect(d.endsWith('L 100.00 20.00')).toBe(true);
  });

  it('值域扩到包住越界的 key（过冲不会被画平）', () => {
    const keys = [key(0, 0), key(1, 5)];
    const d = clipCurvePath(keys, 0, 1, 0, 1, BOX100);
    expect(d.endsWith('L 100.00 0.00')).toBe(true);
  });

  it('空曲线 / 零长度片段返回空串', () => {
    expect(clipCurvePath([], 0, 1, 0, 1, BOX100)).toBe('');
    expect(clipCurvePath([key(0, 0)], 1, 1, 0, 1, BOX100)).toBe('');
  });

  it('curveAreaPath 闭到底边', () => {
    expect(curveAreaPath('M 0 50 L 100 50', BOX100)).toBe('M 0 50 L 100 50 L 100 100 L 0 100 Z');
    expect(curveAreaPath('', BOX100)).toBe('');
  });
});

describe('工具', () => {
  it('diamondPath 是闭合的菱形', () => {
    expect(diamondPath(10, 20, 4)).toBe('M 10 16 L 14 20 L 10 24 L 6 20 Z');
  });

  it('snapToFrame 吸附到帧网格', () => {
    expect(snapToFrame(0.51, 1 / 30)).toBeCloseTo(15 / 30, 9);
    expect(snapToFrame(0.51, 0)).toBe(0.51);
  });
});
