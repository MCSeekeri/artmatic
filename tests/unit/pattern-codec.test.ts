import { describe, expect, it } from 'vitest';
import {
  MAX_PATTERN_DIM,
  bitmapFromRows,
  bitmapToRows,
  decodePattern,
  emptyBitmap,
  encodePattern,
  invertBitmap,
  liveCount,
  randomBitmap,
  resizeBitmap,
  stampCentered,
  stampRow,
  type Bitmap,
} from '../../src/algos/pattern-codec';
import { mulberry32 } from '../../src/core/prng';

const randomBitmapOf = (w: number, h: number, seed: number): Bitmap => {
  const bm = emptyBitmap(w, h);
  const rnd = mulberry32(seed);
  for (let i = 0; i < bm.data.length; i++) bm.data[i] = rnd() < 0.45 ? 1 : 0;
  return bm;
};

describe('pattern-codec：编码 / 解码往返', () => {
  it('随机位图 round-trip 逐位相等', () => {
    for (const [w, h, seed] of [
      [8, 8, 1],
      [32, 32, 2],
      [37, 11, 3],
      [1, 1, 4],
      [64, 3, 5],
    ] as const) {
      const bm = randomBitmapOf(w, h, seed);
      const round = decodePattern(encodePattern(bm));
      expect(round, `${w}x${h}`).not.toBeNull();
      expect(round!.w).toBe(w);
      expect(round!.h).toBe(h);
      expect(Array.from(round!.data)).toEqual(Array.from(bm.data));
    }
  });

  it('encode 是纯函数：同一位图恒得同串（存档稳定性）', () => {
    const bm = randomBitmapOf(24, 24, 9);
    expect(encodePattern(bm)).toBe(encodePattern(bm));
    // 拷贝一份再编码也必须同串（不能依赖对象身份）
    expect(encodePattern({ ...bm, data: bm.data.slice() })).toBe(encodePattern(bm));
  });

  it('头部自带尺寸 —— 这是「换网格大小还能重新居中」的前提', () => {
    const s = encodePattern(bitmapFromRows(['#.#', '.#.']));
    expect(s.startsWith('3x2:')).toBe(true);
  });
});

describe('pattern-codec：非法输入一律降级，永不抛', () => {
  it('空 / undefined / null → null', () => {
    expect(decodePattern('')).toBeNull();
    expect(decodePattern(undefined)).toBeNull();
    expect(decodePattern(null)).toBeNull();
  });

  it('坏头部 → null', () => {
    expect(decodePattern('abc')).toBeNull();
    expect(decodePattern('12')).toBeNull();
    expect(decodePattern('12x:AAAA')).toBeNull();
    expect(decodePattern('0x5:AAAA')).toBeNull();
    expect(decodePattern('-3x3:AAAA')).toBeNull();
    // 尺寸越界
    expect(decodePattern(`${MAX_PATTERN_DIM + 1}x4:AAAA`)).toBeNull();
  });

  it('全零图案是**合法值**（不是 null）—— 语义是「清空」而不是「回退」', () => {
    const bm = decodePattern(encodePattern(emptyBitmap(8, 8)));
    expect(bm).not.toBeNull();
    expect(liveCount(bm!)).toBe(0);
  });

  it('载荷偏短 → 缺失位补 0，不抛', () => {
    const bm = decodePattern('8x8:AA');
    expect(bm).not.toBeNull();
    expect(bm!.data.length).toBe(64);
    // 前 16 位来自载荷，其余为 0
    expect(bm!.data.slice(16).every((v) => v === 0)).toBe(true);
  });

  it('载荷偏长 → 截断到 w*h，不抛', () => {
    const long = '8x8:' + 'A'.repeat(200);
    const bm = decodePattern(long);
    expect(bm).not.toBeNull();
    expect(bm!.data.length).toBe(64);
  });

  it('未知字符与空白被跳过', () => {
    const base = encodePattern(bitmapFromRows(['#', '.', '#', '.']));
    const payload = base.slice(base.indexOf(':') + 1);
    const noisy = `4x1:${payload.slice(0, 2)}????\n  ${payload.slice(2)}`;
    const bm = decodePattern(noisy);
    expect(bm).not.toBeNull();
    expect(bitmapToRows(bm!)).toEqual(['#.#.']);
  });
});

describe('pattern-codec：位图变换', () => {
  it('stampCentered 居中放置，超出部分裁剪', () => {
    const grid = new Uint8Array(5 * 5);
    stampCentered(grid, 5, 5, bitmapFromRows(['###', '###', '###']), 1);
    // 3×3 在 5×5 里居中 → 偏移 (1,1)
    expect(grid[1 * 5 + 1]).toBe(1);
    expect(grid[3 * 5 + 3]).toBe(1);
    expect(grid[0]).toBe(0);
    expect(grid[4 * 5 + 4]).toBe(0);
  });

  it('stampCentered 对更大的图案做裁剪而不是缩放', () => {
    const grid = new Uint8Array(3 * 3);
    stampCentered(grid, 3, 3, bitmapFromRows(['#####', '#####', '#####', '#####', '#####']), 1);
    // 5×5 盖到 3×3：偏移 (-1,-1)，可见的是中间 3×3 —— 且活格数不超过网格
    expect(grid.every((v) => v === 1)).toBe(true);
  });

  it('stampCentered 是确定性的（同输入同输出）', () => {
    const a = new Uint8Array(16 * 8);
    const b = new Uint8Array(16 * 8);
    const bm = randomBitmapOf(5, 3, 77);
    stampCentered(a, 16, 8, bm, 1);
    stampCentered(b, 16, 8, bm, 1);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('stampRow 只取第 0 行并居中', () => {
    const row = new Uint8Array(9);
    stampRow(row, 9, bitmapFromRows(['.#.', '###']), 1);
    expect(Array.from(row)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  });

  it('resizeBitmap 左上角锚定（改尺寸时画面不位移）', () => {
    const bm = bitmapFromRows(['#..', '...', '..#']);
    const bigger = resizeBitmap(bm, 2, 2);
    expect(bitmapToRows(bigger)).toEqual(['#.', '..']);
    const wider = resizeBitmap(bm, 5, 3);
    expect(bitmapToRows(wider)[0]).toBe('#....');
    expect(bitmapToRows(wider)[2]).toBe('..#..');
  });

  it('invertBitmap 全反相且不改原图', () => {
    const bm = bitmapFromRows(['#.', '.#']);
    const inv = invertBitmap(bm);
    expect(bitmapToRows(inv)).toEqual(['.#', '#.']);
    expect(bitmapToRows(bm)).toEqual(['#.', '.#']);
  });

  it('randomBitmap 走调用方给的随机源（禁止裸 Math.random）', () => {
    const a = randomBitmap(8, 8, mulberry32(5), 0.5);
    const b = randomBitmap(8, 8, mulberry32(5), 0.5);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    const c = randomBitmap(8, 8, mulberry32(6), 0.5);
    expect(Array.from(c.data)).not.toEqual(Array.from(a.data));
  });
});

describe('pattern-codec：由 ASCII 行构造', () => {
  it('允许不等长行（按最长行补齐）', () => {
    const bm = bitmapFromRows(['###', '#', '#####']);
    expect(bm.w).toBe(5);
    expect(bm.h).toBe(3);
    expect(liveCount(bm)).toBe(3 + 1 + 5);
  });

  it('`.` 与空格都是空，其余字符都算活', () => {
    const bm = bitmapFromRows(['. #']);
    expect(Array.from(bm.data)).toEqual([0, 0, 1]);
  });
});
