import { describe, expect, it } from 'vitest';
import {
  ALPHA_LIVE,
  bitmapFromAlpha,
  containRect,
  patternSizeFor,
  stridedAlpha,
} from '../../src/algos/pattern-image';
import { MAX_PATTERN_DIM, bitmapToRows } from '../../src/algos/pattern-codec';

describe('bitmapFromAlpha', () => {
  it('alpha ≥ 阈值是活格，其余是空格', () => {
    const bm = bitmapFromAlpha([0, 200, 128, 255], 2, 2);
    expect(bitmapToRows(bm)).toEqual(['.#', '##']);
  });

  it('阈值就是「不透明度过半」—— 128 而不是 255', () => {
    expect(ALPHA_LIVE).toBe(128);
    // SVG 的细线按网格重绘之后拿到的是覆盖率；要求 255 会把整条线丢掉。
    const bm = bitmapFromAlpha([129], 1, 1);
    expect(bm.data[0]).toBe(1);
    expect(bitmapFromAlpha([127], 1, 1).data[0]).toBe(0);
  });

  it('数据不足时补 0（永不抛）', () => {
    const bm = bitmapFromAlpha([255], 2, 2);
    expect(bitmapToRows(bm)).toEqual(['#.', '..']);
  });

  it('尺寸被钳到合法范围内', () => {
    const bm = bitmapFromAlpha(new Uint8Array(4), 0, 0);
    expect([bm.w, bm.h]).toEqual([1, 1]);
  });
});

describe('containRect', () => {
  it('同比例铺满', () => {
    expect(containRect(1600, 900, 256, 144)).toEqual({ x: 0, y: 0, w: 256, h: 144 });
  });

  it('宽图在方形里左右留边（居中）', () => {
    expect(containRect(1600, 800, 64, 64)).toEqual({ x: 0, y: 16, w: 64, h: 32 });
  });

  it('窄图在方形里上下留边（居中）', () => {
    expect(containRect(300, 900, 64, 64)).toEqual({ x: 21, y: 0, w: 21, h: 64 });
  });

  it('尺寸为 0 不除出 Infinity', () => {
    const r = containRect(0, 0, 32, 16);
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
  });
});

describe('patternSizeFor', () => {
  it('网格尺寸原样返回（导入 = 网格分辨率的采样）', () => {
    expect(patternSizeFor(256, 144)).toEqual({ w: 256, h: 144 });
  });

  it('超过上限时等比缩小，不是横向压扁', () => {
    const { w, h } = patternSizeFor(MAX_PATTERN_DIM * 2, MAX_PATTERN_DIM);
    expect(w).toBe(MAX_PATTERN_DIM);
    expect(h).toBe(MAX_PATTERN_DIM / 2);
    expect(w / h).toBe(2);
  });
});

describe('stridedAlpha', () => {
  it('每隔 4 个取一个（RGBA 的 A）', () => {
    expect(Array.from(stridedAlpha([10, 20, 30, 40, 50, 60, 70, 80], 2))).toEqual([40, 80]);
  });

  it('长度不足时补 0', () => {
    expect(Array.from(stridedAlpha([10, 20, 30, 40], 3))).toEqual([40, 0, 0]);
  });
});
