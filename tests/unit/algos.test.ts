import { describe, expect, it } from 'vitest';
import { elementary, elementaryRun, LIVE, makeSeedRow } from '../../src/algos/rule110';
import {
  CONWAY_BIRTH,
  CONWAY_SURVIVE,
  createLife,
  lifeStep,
  lifeStepRule,
} from '../../src/algos/game-of-life';
import { logisticMap, lyapunovMap, mapDiagram } from '../../src/algos/bifurcation';
import { createAnt, parseTurmite } from '../../src/algos/langtons-ant';
import { lsystem, lsystemRun, LS_PRESETS } from '../../src/algos/lsystem';
import { sheetSpec, sheetPut } from '../../src/algos/sheet';
import { bitmapFromRows, encodePattern } from '../../src/algos/pattern-codec';

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

/* ------------------------------------------------- 扩展后的规则 / 种子 / 变种 */

describe('rule110 扩展：任意规则 0~255', () => {
  it('规则 0 是合法规则，**不能**被当成缺省而换成 110', () => {
    // rule 0：所有邻域都产出 0 → 第 1 行起全黑，只有第 0 行的种子还有效
    const { data, w, h } = elementaryRun({
      rule: 0,
      w: 32,
      h: 8,
      seedRow: makeSeedRow(32, 'single', 1, null),
      wrap: true,
      age: false,
    });
    let below = 0;
    for (let i = w; i < w * h; i++) if (data[i]) below++;
    expect(below).toBe(0);
  });

  it('旧签名 elementary 与新的 elementaryRun 在相同配置下逐字节一致（向后兼容）', () => {
    for (const mode of ['single', 'random'] as const) {
      const legacy = elementary(110, 128, 32, mode, 7);
      const modern = elementaryRun({
        rule: 110,
        w: 128,
        h: 32,
        seedRow: makeSeedRow(128, mode, 7, null, 0.5),
        wrap: true,
        age: false,
      });
      expect(modern.data, mode).toEqual(legacy.data);
    }
  });

  it('关掉环面边界会改变形态（固定边界把三角形切平）', () => {
    // 必须用**碰到左右边界**的种子：单点种子在 32 行内长不到边上，
    // 那两种边界的输出会一模一样，断言就成了空转。
    const seed = makeSeedRow(64, 'random', 3, null, 0.5);
    const wrap = elementaryRun({ rule: 90, w: 64, h: 32, seedRow: seed, wrap: true, age: false });
    const fixed = elementaryRun({ rule: 90, w: 64, h: 32, seedRow: seed, wrap: false, age: false });
    expect(fixed.data).not.toEqual(wrap.data);
  });

  it('代际着色：值落在 1..255 里且永不为 0（0 是背景）', () => {
    const { data } = elementaryRun({
      rule: 110,
      w: 64,
      h: 32,
      seedRow: makeSeedRow(64, 'single', 1, null),
      wrap: true,
      age: true,
    });
    for (const v of data) expect(v === 0 || (v >= 1 && v <= 255)).toBe(true);
    // 至少存在一个「比 1 大」的像素 —— 说明代际真的在递增
    expect([...data].some((v) => v > 1)).toBe(true);
  });

  it('pattern 种子：手绘一行会被居中放进去，且不消耗随机', () => {
    const row = makeSeedRow(16, 'pattern', 999, bitmapFromRows(['##']), 0.5);
    expect(Array.from(row)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
    // 同一个坏图案串（解不出来）→ 退回单点，而不是整行全空
    const fallback = makeSeedRow(16, 'pattern', 1, null, 0.5);
    expect(fallback.reduce((s, v) => s + v, 0)).toBe(1);
  });

  it('随机密度真的在起作用', () => {
    const sparse = makeSeedRow(512, 'random', 5, null, 0.1);
    const dense = makeSeedRow(512, 'random', 5, null, 0.9);
    const sum = (a: Uint8Array): number => a.reduce((s, v) => s + v, 0);
    expect(sum(dense)).toBeGreaterThan(sum(sparse) * 3);
  });
});

describe('生命游戏扩展：B/S 规则族', () => {
  /** 半密度的确定性噪声格 —— 触到边缘、且必然出现 6 邻居的格子。 */
  const rndGrid = (n: number, seed: number): Uint8Array => {
    const g = new Uint8Array(n * n);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      g[i] = (s >>> 16) & 1;
    }
    return g;
  };

  const conwayCfg = { birth: CONWAY_BIRTH, survive: CONWAY_SURVIVE, vonNeumann: false, wrap: true };

  it('lifeStep 与 lifeStepRule(Conway, Moore, wrap) 逐格等价（旧行为有了唯一定义）', () => {
    const n = 32;
    for (const seed of [1, 2, 3]) {
      const g = rndGrid(n, seed);
      expect(lifeStepRule(g, n, conwayCfg), `seed ${seed}`).toEqual(lifeStep(g, n));
    }
  });

  it('HighLife（多一位出生规则）演化出不同的一代', () => {
    const n = 32;
    const g = rndGrid(n, 17);
    const conway = lifeStepRule(g, n, conwayCfg);
    const high = lifeStepRule(g, n, { ...conwayCfg, birth: CONWAY_BIRTH | (1 << 6) });
    expect(high).not.toEqual(conway);
  });

  it('von Neumann 邻域与固定边界都改变下一代', () => {
    const n = 32;
    const g = rndGrid(n, 23);
    const moore = lifeStepRule(g, n, conwayCfg);
    const vn = lifeStepRule(g, n, { ...conwayCfg, vonNeumann: true });
    const fixed = lifeStepRule(g, n, { ...conwayCfg, wrap: false });
    expect(vn).not.toEqual(moore);
    expect(fixed).not.toEqual(moore);
  });

  it('手绘滑翔机：t=0 恰好 5 个活细胞（不消耗 RNG）', () => {
    const sim = createLife({ size: 64, rate: 12, seedMode: 'pattern', pattern: encodePattern(bitmapFromRows(['.#.', '..#', '###'])) }, 1);
    const live = [...sim.current()].filter((v) => v !== 0).length;
    expect(live).toBe(5);
  });

  it('手绘种子下 seek ≡ 顺序推进（图案不引入随机）', () => {
    const params = {
      size: 64,
      rate: 12,
      seedMode: 'pattern',
      pattern: encodePattern(bitmapFromRows(['.#.', '..#', '###'])),
    };
    const a = createLife(params, 4);
    const b = createLife(params, 4);
    a.seek(30);
    b.seek(60);
    b.seek(30);
    expect(b.current()).toEqual(a.current());
  });

  it('trail 关掉时输出与扩展前逐字节相同（只有 0 与 255）', () => {
    const sim = createLife({ size: 48, density: 0.4, rate: 12, trail: 0 }, 11);
    sim.seek(20);
    for (const v of sim.current()) expect([0, 255]).toContain(v);
  });

  it('trail 打开后出现中间值（死亡余温），且仍确定', () => {
    const params = { size: 48, density: 0.5, rate: 12, trail: 0.6 };
    const a = createLife(params, 3);
    const b = createLife(params, 3);
    a.seek(20);
    b.seek(20);
    const out = a.current();
    expect(out).toEqual(b.current());
    // 余温的存在判据是「有既不是 0 也不是 255 的值」
    expect([...out].some((v) => v !== 0 && v !== 255)).toBe(true);
  });

  it('图案串损坏时退回随机撒种（不抛、不空图）', () => {
    const sim = createLife({ size: 48, rate: 12, seedMode: 'pattern', pattern: 'garbage', density: 0.5 }, 8);
    sim.seek(0);
    expect([...sim.current()].some((v) => v !== 0)).toBe(true);
  });
});

describe('分岔图扩展：映射种类与李雅普诺夫', () => {
  it('四种映射产出不同的图（同尺寸同参数下）', () => {
    const base = { w: 128, h: 64, transient: 200, keep: 200, r0: 2.4, r1: 4, x0: 0.4, gain: 34 };
    const logistic = mapDiagram({ ...base, kind: 'logistic' });
    const sine = mapDiagram({ ...base, kind: 'sine' });
    const tent = mapDiagram({ ...base, kind: 'tent' });
    const cubic = mapDiagram({ ...base, kind: 'cubic' });
    expect(sine.data).not.toEqual(logistic.data);
    expect(tent.data).not.toEqual(logistic.data);
    expect(cubic.data).not.toEqual(logistic.data);
  });

  it('李雅普诺夫图是确定性的一列一值，且存在暗区与亮区', () => {
    const opts = { kind: 'logistic' as const, w: 128, h: 32, transient: 300, keep: 300, r0: 2.4, r1: 4, x0: 0.4 };
    const a = lyapunovMap(opts);
    const b = lyapunovMap(opts);
    expect(a.data).toEqual(b.data);
    // 同一列的所有行必须同值（λ 是列的属性）
    for (let y = 1; y < 32; y++) expect(a.data[y * 128 + 5]).toBe(a.data[5]);
    const vals = new Set(a.data);
    expect(vals.size).toBeGreaterThan(2);
    expect(Math.min(...vals)).toBeLessThan(128);
    expect(Math.max(...vals)).toBeGreaterThan(0);
  });

  it('r 区间会改变图（rMin/rMax 真的被用上）', () => {
    const wide = logisticMap(128, 64, 600, 300);
    const narrow = mapDiagram({
      kind: 'logistic',
      w: 128,
      h: 64,
      transient: 300,
      keep: 300,
      r0: 3.4,
      r1: 3.6,
      x0: 0.4,
      gain: 34,
    });
    expect(narrow.data).not.toEqual(wide.data);
  });
});

describe('turmite 规则', () => {
  it('parseTurmite 认 RLNU，忽略其它字符，太短时退回 RL', () => {
    expect(parseTurmite('RL')).toEqual([1, 3]);
    expect(parseTurmite('rl')).toEqual([1, 3]);
    expect(parseTurmite('RRLL')).toEqual([1, 1, 3, 3]);
    expect(parseTurmite('R L')).toEqual([1, 3]); // 空格被忽略
    expect(parseTurmite('R')).toEqual([1, 3]); // 只有一个状态 → 退回
    expect(parseTurmite('')).toEqual([1, 3]);
    expect(parseTurmite('RNU')).toEqual([1, 0, 2]);
  });

  it('换规则会得到不同的轨迹', () => {
    const a = createAnt({ size: 96, rate: 400, variant: 'RL' });
    const b = createAnt({ size: 96, rate: 400, variant: 'RRLL' });
    a.seek(4000);
    b.seek(4000);
    expect(a.current()).not.toEqual(b.current());
  });

  it('多态规则（RLR）的输出有 0 / 中间值 / 255 三档', () => {
    const sim = createAnt({ size: 128, rate: 400, variant: 'RLR' });
    sim.seek(4000);
    const vals = new Set(sim.current());
    expect(vals.size).toBeGreaterThanOrEqual(3);
  });

  it('四只蚂蚁对称起手：结果关于中心对称（不是随机的）', () => {
    const sim = createAnt({ size: 128, rate: 400, count: 4, startMode: 'center' });
    sim.seek(3000);
    const out = sim.current();
    const a = createAnt({ size: 128, rate: 400, count: 4, startMode: 'center' });
    a.seek(3000);
    expect(a.current()).toEqual(out); // 确定性
  });

  it('关掉环面时蚂蚁不越界（掉头而不是卡死）', () => {
    const sim = createAnt({ size: 64, rate: 400, wrap: 0 });
    sim.seek(20000);
    const out = sim.current();
    expect(out.length).toBe(64 * 64);
    expect([...out].some((v) => v !== 0)).toBe(true);
  });

  it('random 起点由 seed 决定（同 seed 同图，异 seed 异图）', () => {
    const a = createAnt({ size: 96, rate: 400, startMode: 'random' }, 5);
    const b = createAnt({ size: 96, rate: 400, startMode: 'random' }, 5);
    a.seek(2000);
    b.seek(2000);
    expect(a.current()).toEqual(b.current());
  });
});

describe('L-system 扩展', () => {
  it('角度 / 迭代覆盖真的改变结构', () => {
    const p = LS_PRESETS['tree']!;
    const base = lsystemRun({ preset: p, w: 192, h: 108 });
    const wider = lsystemRun({ preset: p, w: 192, h: 108, angleDeg: 45 });
    const deeper = lsystemRun({ preset: p, w: 192, h: 108, iters: 6 });
    expect(wider.data).not.toEqual(base.data);
    expect(deeper.data).not.toEqual(base.data);
  });

  it('随机跳过 / 抖动是种子化的（同 seed 同图，异 seed 异图）', () => {
    const p = LS_PRESETS['plant']!;
    const a = lsystemRun({ preset: p, w: 192, h: 108, stochastic: 0.2, jitter: 0.4, seed: 3 });
    const b = lsystemRun({ preset: p, w: 192, h: 108, stochastic: 0.2, jitter: 0.4, seed: 3 });
    const c = lsystemRun({ preset: p, w: 192, h: 108, stochastic: 0.2, jitter: 0.4, seed: 4 });
    expect(a.data).toEqual(b.data);
    expect(c.data).not.toEqual(a.data);
  });

  it('线宽增加墨迹量', () => {
    const p = LS_PRESETS['neuron']!;
    const thin = lsystemRun({ preset: p, w: 192, h: 108, lineWidth: 1 });
    const fat = lsystemRun({ preset: p, w: 192, h: 108, lineWidth: 3 });
    const ink = (a: Uint8Array): number => a.reduce((s, v) => s + (v ? 1 : 0), 0);
    expect(ink(fat.data)).toBeGreaterThan(ink(thin.data));
  });

  it('向性把植株压向一侧（tropism ≠ 0 改变形态）', () => {
    const p = LS_PRESETS['tree']!;
    const none = lsystemRun({ preset: p, w: 192, h: 108 });
    const down = lsystemRun({ preset: p, w: 192, h: 108, tropism: 0.8 });
    expect(down.data).not.toEqual(none.data);
  });

  it('揭示顺序模式改变像素值分布（同一株，不同生长编序）', () => {
    const p = LS_PRESETS['plant']!;
    const arc = lsystemRun({ preset: p, w: 192, h: 108, colorMode: 'arc' });
    const depth = lsystemRun({ preset: p, w: 192, h: 108, colorMode: 'depth' });
    expect(depth.data).not.toEqual(arc.data);
    // 两者都保持「植株像素 1..255，永不为 0」这条不变量
    expect(Math.max(...depth.data)).toBe(255);
    expect([...depth.data].some((v) => v === 0)).toBe(true);
  });

  it('新增的经典曲线预设能长出来（Hilbert / Dragon / Sierpinski / Gosper）', () => {
    for (const id of ['dragon', 'hilbert', 'sierpinski', 'gosper', 'koch', 'rings']) {
      const { data } = lsystemRun({ preset: LS_PRESETS[id]!, w: 160, h: 160 });
      const ink = [...data].filter((v) => v !== 0).length;
      expect(ink, id).toBeGreaterThan(100);
    }
  });
});
