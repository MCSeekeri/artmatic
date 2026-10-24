import { describe, expect, it } from 'vitest';
import {
  RD_PRESETS,
  RD_V_SCALE,
  createReactionDiffusion,
  initRd,
  rdStep,
} from '../../src/algos/reaction-diffusion';
import { cacheHash, liveRate, stripVolatile } from '../../src/algos/runtime';
import { mulberry32 } from '../../src/core/prng';
import { encodePattern, bitmapFromRows } from '../../src/algos/pattern-codec';

const sum = (a: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s;
};

const rndField = (n: number, seed: number): { u: Float32Array; v: Float32Array } => {
  const u = new Float32Array(n * n);
  const v = new Float32Array(n * n);
  const rnd = mulberry32(seed);
  for (let i = 0; i < n * n; i++) {
    u[i] = 0.3 + rnd() * 0.7;
    v[i] = rnd() * 0.35;
  }
  return { u, v };
};

describe('rdStep：解析不变量（证明 step 写对了）', () => {
  it('F = k = 0 时 Σ(u+v) 守恒 —— Laplacian 权重和为 0 且反应项相消', () => {
    const n = 24;
    const { u, v } = rndField(n, 7);
    const tmpU = new Float32Array(n * n);
    const tmpV = new Float32Array(n * n);
    const before = sum(u) + sum(v);
    for (let i = 0; i < 80; i++) rdStep(u, v, tmpU, tmpV, n, n, 0, 0, 1, 0.5);
    const after = sum(u) + sum(v);
    // float32 累积舍入；相对误差 1e-4 已经很宽松
    expect(Math.abs(after - before) / Math.abs(before)).toBeLessThan(1e-4);
  });

  it('v ≡ 0 的均匀场是精确不动点（无反应 + Laplacian 对常数是 0）', () => {
    const n = 12;
    const u = new Float32Array(n * n).fill(0.6);
    const v = new Float32Array(n * n);
    const tmpU = new Float32Array(n * n);
    const tmpV = new Float32Array(n * n);
    for (let i = 0; i < 10; i++) rdStep(u, v, tmpU, tmpV, n, n, 0, 0, 1, 0.5);
    for (let i = 0; i < n * n; i++) {
      expect(u[i]).toBeCloseTo(0.6, 6);
      expect(v[i]).toBe(0);
    }
  });

  it('f = k = 0 时 u 掉多少 v 就升多少（反应项只是搬运，不是增减）', () => {
    const n = 12;
    const u = new Float32Array(n * n).fill(0.6);
    const v = new Float32Array(n * n).fill(0.2);
    const tmpU = new Float32Array(n * n);
    const tmpV = new Float32Array(n * n);
    const u0 = sum(u);
    const v0 = sum(v);
    for (let i = 0; i < 5; i++) rdStep(u, v, tmpU, tmpV, n, n, 0, 0, 1, 0.5);
    // 均匀场没有扩散通量，所以场的每一格都精确按 uv² 的量搬运
    expect(sum(u)).toBeLessThan(u0);
    expect(sum(v)).toBeGreaterThan(v0);
    expect(sum(u) + sum(v)).toBeCloseTo(u0 + v0, 4);
  });

  it('双缓冲：结果与「遍历顺序」无关（同一输入两次调用逐位相等）', () => {
    const n = 16;
    const a = rndField(n, 3);
    const b = rndField(n, 3);
    const ta = new Float32Array(n * n);
    const tb = new Float32Array(n * n);
    for (let i = 0; i < 20; i++) {
      rdStep(a.u, a.v, ta, tb, n, n, 0.0545, 0.062, 1, 0.5);
      rdStep(b.u, b.v, ta, tb, n, n, 0.0545, 0.062, 1, 0.5);
    }
    expect(Array.from(b.u)).toEqual(Array.from(a.u));
    expect(Array.from(b.v)).toEqual(Array.from(a.v));
  });

  it('F > 0 时质量不再守恒（进料项确实在供货）', () => {
    const n = 16;
    const { u, v } = rndField(n, 11);
    const tmpU = new Float32Array(n * n);
    const tmpV = new Float32Array(n * n);
    const before = sum(u) + sum(v);
    for (let i = 0; i < 60; i++) rdStep(u, v, tmpU, tmpV, n, n, 0.0545, 0.062, 1, 0.5);
    const after = sum(u) + sum(v);
    expect(Math.abs(after - before)).toBeGreaterThan(1);
  });
});

describe('反应扩散 sim：硬约束 1.3', () => {
  const params = { size: 48, preset: 'coral', rate: 120, seedMode: 'blob', seedSize: 6 };

  it('seek(f) 与从 0 顺序 step 到 f 逐字节一致（含快退回放路径）', () => {
    const a = createReactionDiffusion(params, 5);
    const b = createReactionDiffusion(params, 5);
    a.seek(300);
    b.seek(600);
    b.seek(300);
    expect(b.current()).toEqual(a.current());
  });

  it('精确回退一步也一致（走的是「找最近快照重放」那条路）', () => {
    const a = createReactionDiffusion(params, 9);
    const b = createReactionDiffusion(params, 9);
    a.seek(199);
    b.seek(200);
    b.seek(199);
    expect(b.current()).toEqual(a.current());
  });

  it('seek(0) 回到初始态', () => {
    const sim = createReactionDiffusion(params, 3);
    const initial = sim.current().slice();
    sim.seek(400);
    sim.seek(0);
    expect(sim.current()).toEqual(initial);
  });

  it('同 seed 同参数完全一致，异 seed 不同', () => {
    // 随机撒点要够密才会成簇 —— 稀疏的单格种子会全部死掉，那时「两张图不同」
    // 是一条**空转**断言（都在黑图上通过）。先证明非空，再比不同。
    // maze 是实测在区域撒种下长得最好的预设（0.4 密度 → 8000+ 格）；
    // coral 在这个密度下反而全空 —— 换它这条断言又会变成空转。
    const rp = { size: 64, preset: 'maze', rate: 120, seedMode: 'random', seedDensity: 0.4 };
    const a = createReactionDiffusion(rp, 4);
    const b = createReactionDiffusion(rp, 4);
    const c = createReactionDiffusion(rp, 5);
    a.seek(200);
    b.seek(200);
    c.seek(200);
    const active = (out: Uint8Array): number => {
      let n = 0;
      for (let j = 1; j < out.length; j += 2) if (out[j]! > 0) n++;
      return n;
    };
    expect(active(a.current()), '随机撒点应当长出东西，否则下面两条是空转').toBeGreaterThan(0);
    expect(b.current()).toEqual(a.current());
    expect(active(c.current())).toBeGreaterThan(0);
    expect(c.current()).not.toEqual(a.current());
  });

  it('异 seed 至少在 t = 0 就不同（种子真的进了初值）', () => {
    const rp = { size: 48, seedMode: 'random', seedDensity: 0.4 };
    const a = createReactionDiffusion(rp, 4);
    const c = createReactionDiffusion(rp, 5);
    expect(c.current()).not.toEqual(a.current());
  });
});

describe('反应扩散 sim：通道与量化', () => {
  const params = { size: 32, preset: 'coral', rate: 120, seedMode: 'blob', seedSize: 5 };

  it('声明 2 通道，current() 长度是 w*h*2（交错）', () => {
    const sim = createReactionDiffusion(params, 1);
    expect(sim.channels).toBe(2);
    expect(sim.current().length).toBe(32 * 32 * 2);
  });

  it('输出落在 0..255 内且确实有「非零的 v 通道」（图案长出来了）', () => {
    const sim = createReactionDiffusion(params, 1);
    sim.seek(600);
    const out = sim.current();
    let vMax = 0;
    for (let j = 1; j < out.length; j += 2) vMax = Math.max(vMax, out[j]!);
    expect(vMax).toBeGreaterThan(20);
    for (const byte of out) expect(byte).toBeGreaterThanOrEqual(0);
  });

  it('u 通道（第 0 位）在初始时到处都是满的 —— 只有种子区被消耗', () => {
    const sim = createReactionDiffusion(params, 1);
    const out = sim.current();
    let full = 0;
    for (let j = 0; j < out.length; j += 2) if (out[j]! > 200) full++;
    // 32² = 1024 格里，种子半径 5 只占约 81 格
    expect(full).toBeGreaterThan(900);
  });
});

describe('反应扩散：种子策略', () => {
  it('blob 种子的半径真的起作用（半径越大初始活性区越大）', () => {
    const small = createReactionDiffusion({ size: 48, seedMode: 'blob', seedSize: 3 }, 1);
    const big = createReactionDiffusion({ size: 48, seedMode: 'blob', seedSize: 20 }, 1);
    const active = (out: Uint8Array): number => {
      let n = 0;
      for (let j = 1; j < out.length; j += 2) if (out[j]! > 0) n++;
      return n;
    };
    expect(active(big.current())).toBeGreaterThan(active(small.current()) * 3);
  });

  it('pattern 种子把图案盖上去（与同尺寸的 blob 不同）', () => {
    const pattern = encodePattern(bitmapFromRows(['##.##', '#...#', '##.##']));
    const seeded = createReactionDiffusion({ size: 48, seedMode: 'pattern', pattern }, 1);
    const blob = createReactionDiffusion({ size: 48, seedMode: 'blob', seedSize: 6 }, 1);
    expect(seeded.current()).not.toEqual(blob.current());
  });

  it('pattern 串损坏时退回团块（不抛、也不是全零）', () => {
    const sim = createReactionDiffusion({ size: 48, seedMode: 'pattern', pattern: 'garbage' }, 1);
    const out = sim.current();
    let vActive = 0;
    for (let j = 1; j < out.length; j += 2) if (out[j]! > 0) vActive++;
    expect(vActive).toBeGreaterThan(0);
  });

  it('initRd 的 pattern 路径与 stampCentered 的居中语义一致', () => {
    const n = 16;
    const bm = bitmapFromRows(['#']);
    const single = initRd({ w: n, h: n, seedMode: 'pattern', pattern: encodePattern(bm), seedSize: 1, seedDensity: 0, seed: 1 });
    // 单格图案 → 只有一个格被种下，且落在中心
    const planted: number[] = [];
    for (let i = 0; i < n * n; i++) if (single.v[i]! > 0) planted.push(i);
    const mid = Math.floor((n - 1) / 2); // 与 stampCenteredInto 同一口径（floor）
    expect(planted).toEqual([mid * n + mid]);
  });
});

describe('反应扩散：(F,k) 预设表', () => {
  it('数值与文献口径一致（回归：这些数不能被悄悄改动）', () => {
    expect(RD_PRESETS['coral']).toEqual({ f: 0.0545, k: 0.062 });
    expect(RD_PRESETS['spots']).toEqual({ f: 0.0367, k: 0.0649 });
    expect(RD_PRESETS['maze']).toEqual({ f: 0.029, k: 0.057 });
    expect(RD_PRESETS['worms']).toEqual({ f: 0.058, k: 0.065 });
    expect(RD_PRESETS['holes']).toEqual({ f: 0.039, k: 0.058 });
  });

  it('bubbles 已被移除 —— 它在标准种子下什么都不长（加回来必须配一套强种子）', () => {
    expect(RD_PRESETS['bubbles']).toBeUndefined();
  });

  it('预设让出 F/k 参数的默认值（选同一预设两次得到同一模拟）', () => {
    const a = createReactionDiffusion({ size: 32, preset: 'mitosis', seedMode: 'blob' }, 2);
    const b = createReactionDiffusion({ size: 32, preset: 'mitosis', seedMode: 'blob' }, 2);
    a.seek(200);
    b.seek(200);
    expect(b.current()).toEqual(a.current());
  });

  it('custom 时走 feed/kill 参数（与同值的预设逐字节相同）', () => {
    const custom = createReactionDiffusion(
      { size: 32, preset: 'custom', feed: 0.0545, kill: 0.062, seedMode: 'blob' },
      2,
    );
    const coral = createReactionDiffusion({ size: 32, preset: 'coral', seedMode: 'blob' }, 2);
    custom.seek(150);
    coral.seek(150);
    // coral 预设就是 0.0545/0.062 → 两条路径必须给出同一张图
    expect(custom.current()).toEqual(coral.current());
  });

  it('spots 预设长出**稳定**的孤立斑点（不生长也不消失）', () => {
    const sim = createReactionDiffusion(
      { size: 96, preset: 'spots', seedMode: 'blob', seedSize: 4 },
      4,
    );
    const active = (): number => {
      const out = sim.current();
      let n = 0;
      for (let j = 1; j < out.length; j += 2) if (out[j]! > 8) n++;
      return n;
    };
    sim.seek(600);
    const at600 = active();
    sim.seek(3000);
    const at3000 = active();
    expect(at600, 'spots 应当长出东西').toBeGreaterThan(50);
    // 「spots」这个词的意思就是斑点稳定下来；如果它持续增长，那其实是 coral/etc
    expect(Math.abs(at3000 - at600)).toBeLessThan(at600 * 0.2);
  });

  it('RD_V_SCALE 与 tint 里的除法口径一致', () => {
    expect(RD_V_SCALE).toBe(3);
  });
});

describe('volatile：改播放参数不重建模拟', () => {
  it('stripVolatile 剔掉列出的键，保留其余（顺序不变，哈希才稳定）', () => {
    const params = { preset: 'coral', rate: 120, colorBg: '#000000', size: 160, palette: 'duotone' };
    const stripped = stripVolatile(params, ['rate', 'colorBg', 'palette']);
    expect(Object.keys(stripped)).toEqual(['preset', 'size']);
    expect(stripped).toEqual({ preset: 'coral', size: 160 });
  });

  it('没给 volatile 时原样返回（零成本）', () => {
    const params = { a: 1, b: 'x' };
    expect(stripVolatile(params, undefined)).toBe(params);
    expect(stripVolatile(params, [])).toBe(params);
  });

  it('cacheHash 忽略 volatile 键 —— 改配色/速度不产生新的构造哈希', () => {
    const base = { preset: 'coral', size: 160, rate: 120, colorBg: '#04060a', palette: 'duotone' };
    const vol = ['rate', 'colorBg', 'colorLive', 'palette', 'contrast', 'showU'];
    const h0 = cacheHash('reaction-diffusion', base, vol, 7);
    // 播放/着色参数全改一遍 —— 哈希必须一动不动，否则「拉一下滑杆就重建模拟」
    const tweaked = { ...base, rate: 240, colorBg: '#ffffff', palette: 'thermal' };
    expect(cacheHash('reaction-diffusion', tweaked, vol, 7)).toBe(h0);
    // 真正的构造参数改了 → 必须换哈希（否则改了尺寸/预设画面不变）
    expect(cacheHash('reaction-diffusion', { ...base, size: 256 }, vol, 7)).not.toBe(h0);
    expect(cacheHash('reaction-diffusion', { ...base, preset: 'maze' }, vol, 7)).not.toBe(h0);
    // seed 参与
    expect(cacheHash('reaction-diffusion', base, vol, 8)).not.toBe(h0);
    // 没声明 volatile 的 def（旧生成器）行为不变
    expect(cacheHash('x', base, undefined, 1)).toBe(`x|${JSON.stringify(base)}|1`);
  });

  it('liveRate 从当前参数读；非法值退回句柄那份而不是 0', () => {
    expect(liveRate({ rate: 240 }, 120)).toBe(240);
    expect(liveRate({}, 120)).toBe(120);
    expect(liveRate({ rate: 0 }, 120)).toBe(120);
    expect(liveRate({ rate: -5 }, 120)).toBe(120);
    expect(liveRate({ rate: Number.NaN }, 120)).toBe(120);
    expect(liveRate({ rate: '90' }, 120)).toBe(90);
  });
});
