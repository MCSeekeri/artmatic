import { describe, expect, it } from 'vitest';
import { elementary, LIVE } from '../../src/algos/rule110';
import { createLife } from '../../src/algos/game-of-life';
import { sheetSpec, sheetPut } from '../../src/algos/sheet';

describe('elementary（Rule 30/90/110）', () => {
  it('活细胞是 LIVE=255，不是 1（R8 归一化的血泪常量）', () => {
    const { data } = elementary(110, 64, 64, 'single', 1);
    const values = new Set(data);
    for (const v of values) expect([0, LIVE]).toContain(v);
    expect(values.has(LIVE)).toBe(true);
  });

  it('同规则同种子同图（确定性）', () => {
    const a = elementary(30, 128, 64, 'random', 42);
    const b = elementary(30, 128, 64, 'random', 42);
    expect(a.data).toEqual(b.data);
    const c = elementary(30, 128, 64, 'random', 43);
    expect(c.data).not.toEqual(a.data);
  });

  it('single 种子从中心一点开始', () => {
    const { data, w } = elementary(110, 65, 8, 'single', 1);
    expect(data[(w >> 1)]).toBe(LIVE); // 第 0 行中心
    expect(data.slice(0, w).reduce((s, v) => s + (v ? 1 : 0), 0)).toBe(1);
  });
});

describe('生命游戏 sim：seek ≡ 顺序推进（硬约束 1.3）', () => {
  it('seek(f) 与从 0 逐步 step 到 f 逐细胞一致', () => {
    const params = { size: 64, density: 0.42, rate: 12 };
    const a = createLife(params, 7);
    const b = createLife(params, 7);
    // a 顺序推进到 50；b 先到 80 再 seek 回 50（走快照重放路径）
    a.seek(50);
    b.seek(80);
    b.seek(50);
    expect(b.current()).toEqual(a.current());
  });

  it('seek(0) 回到初始态', () => {
    const params = { size: 48, density: 0.4, rate: 12 };
    const sim = createLife(params, 99);
    const initial = sim.current().slice();
    sim.seek(40);
    sim.seek(0);
    expect(sim.current()).toEqual(initial);
  });

  it('活细胞输出 0/255', () => {
    const sim = createLife({ size: 32, density: 0.5, rate: 12 }, 3);
    sim.seek(10);
    for (const v of sim.current()) expect([0, 255]).toContain(v);
  });

  it('同 seed 同初始态', () => {
    const a = createLife({ size: 32, density: 0.4, rate: 12 }, 5);
    const b = createLife({ size: 32, density: 0.4, rate: 12 }, 5);
    expect(a.current()).toEqual(b.current());
  });
});

describe('sheet 图集', () => {
  it('sheetSpec 布局不超 maxSide', () => {
    const s = sheetSpec(96, 512);
    expect(s.w).toBeLessThanOrEqual(4096);
    expect(s.cols * s.rows).toBeGreaterThanOrEqual(96);
    expect(s.w).toBe(s.cols * 512);
  });

  it('sheetPut 写到正确的 tile 位置', () => {
    const s = sheetSpec(4, 2);
    const out = new Uint8Array(s.w * s.h);
    const tile = new Uint8Array([1, 2, 3, 4]);
    sheetPut(out, s, 3, tile, 2, 2);
    // tile 3 = 第 1 列第 1 行（cols = min(4, 4096/2)=4 → 每行 4 个? 实际 cols = min(4, 2048)=4）
    const cx = (3 % s.cols) * 2;
    const cy = Math.floor(3 / s.cols) * 2;
    expect(out[cy * s.w + cx]).toBe(1);
    expect(out[(cy + 1) * s.w + cx + 1]).toBe(4);
  });
});
