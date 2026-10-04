import { describe, expect, it } from 'vitest';
import { elementary, LIVE } from '../../src/algos/rule110';
import { createLife } from '../../src/algos/game-of-life';
import { logisticMap } from '../../src/algos/bifurcation';
import { createAnt } from '../../src/algos/langtons-ant';
import { lsystem, LS_PRESETS } from '../../src/algos/lsystem';
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

describe('分岔图（logisticMap）', () => {
  it('纯确定性：同参数同图，无随机来源', () => {
    const a = logisticMap(256, 128, 600, 300);
    const b = logisticMap(256, 128, 600, 300);
    expect(a.data).toEqual(b.data);
  });

  it('累加夹在 255，不靠 Uint8Array 回绕（上游的 += 会在密集处点出黑斑）', () => {
    // keep 很大 → 每一列命中次数远多于 255/34，覆盖到「必然触顶」的路径
    const { data } = logisticMap(64, 64, 400, 400);
    // 回绕的形态是出现「很亮旁边一个很暗」；夹住的话最亮恒为 255
    expect(Math.max(...data)).toBe(255);
  });

  it('不是空图：右半（混沌区）比左边更密', () => {
    const w = 256;
    const { data } = logisticMap(w, 128, 800, 400);
    const density = (from: number, to: number): number => {
      let n = 0;
      for (let y = 0; y < 128; y++) for (let x = from; x < to; x++) if (data[y * w + x]) n++;
      return n;
    };
    // r 越大越混沌：右 1/4 的落点覆盖面必然大于 r≈2.4 那一段（那里是单点不动点）
    expect(density(w * 0.75, w)).toBeGreaterThan(density(0, w * 0.25));
  });
});

describe('Langton 蚂蚁 sim：seek ≡ 顺序推进（硬约束 1.3）', () => {
  it('seek(f) 与从 0 顺序 step 到 f 逐细胞一致', () => {
    const params = { size: 64, rate: 400 };
    const a = createAnt(params);
    const b = createAnt(params);
    a.seek(3000);
    b.seek(6000);
    b.seek(3000);
    expect(b.current()).toEqual(a.current());
  });

  it('seek(0) 回到空网格', () => {
    const sim = createAnt({ size: 48, rate: 400 });
    sim.seek(2000);
    sim.seek(0);
    expect([...sim.current()].every((v) => v === 0)).toBe(true);
  });

  it('输出 0/255，且越走格子越多（轨迹只增不减）', () => {
    const sim = createAnt({ size: 64, rate: 400 });
    sim.seek(500);
    const early = sim.current().filter((v) => v !== 0).length;
    for (const v of sim.current()) expect([0, 255]).toContain(v);
    sim.seek(5000);
    // 蚂蚁可以踩回黑格，但**抹掉的是「曾经踩过」**；净面积整体是增长的
    expect(sim.current().filter((v) => v !== 0).length).toBeGreaterThan(early);
  });

  it('网格是环面：走很久也不越界（不抛错、值域仍是 0/255）', () => {
    const sim = createAnt({ size: 32, rate: 400 });
    sim.seek(50_000);
    const out = sim.current();
    expect(out.length).toBe(32 * 32);
    for (const v of out) expect([0, 255]).toContain(v);
  });
});

describe('L-system（离根距离场）', () => {
  it('纯确定性：同预设同纹理', () => {
    const a = lsystem(LS_PRESETS['neuron']!, 192, 108);
    const b = lsystem(LS_PRESETS['neuron']!, 192, 108);
    expect(a.data).toEqual(b.data);
  });

  it('植株像素从 1 起算，**永不为 0**，且最远尖端到 255', () => {
    const { data } = lsystem(LS_PRESETS['plant']!, 192, 108);
    const nonZero = [...data].filter((v) => v !== 0);
    expect(nonZero.length).toBeGreaterThan(100);
    // 0 表示「海龟没来过」；把这里写成 0 会让阈值把它读成最老，整幅画变白
    expect(Math.max(...data)).toBe(255);
  });

  it('不同预设长出不同结构', () => {
    const a = lsystem(LS_PRESETS['neuron']!, 128, 128);
    const b = lsystem(LS_PRESETS['splash']!, 128, 128);
    expect(a.data).not.toEqual(b.data);
  });
});
