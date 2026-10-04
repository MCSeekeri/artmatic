import { describe, expect, it } from 'vitest';
import { BB_FIRING, BB_READY, BB_REFRACTORY, briansStep, createBriansBrain } from '../../src/algos/brians-brain';
import { createCyclicCa, cyclicStep } from '../../src/algos/cyclic-ca';
import { TOPPLE_AT, createSandpile, stabilize } from '../../src/algos/sandpile';
import { createSnowflake, snowStep, type SnowState } from '../../src/algos/snowflake';
import { getGenerator } from '../../src/algos/registry';

/** 用**注册表里的默认参数**跑 —— 测的就是用户点下去会看到什么。 */
const defaults = (id: string): Record<string, number | string> => {
  const p: Record<string, number | string> = {};
  for (const d of getGenerator(id)!.params) p[d.key] = d.defaultValue;
  return p;
};

/** 相邻两步变了几格。对多态/连续场，这比「非零格数」有意义得多。 */
const changedBetween = (step: (t: number) => Uint8Array, t: number): number => {
  const a = step(t).slice();
  const b = step(t + 1);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

describe("Brian's Brain", () => {
  it('只有三个取值（0 / 255 / 128），没有第四种', () => {
    const sim = createBriansBrain(defaults('brians-brain'), 3);
    sim.seek(30);
    for (const v of sim.current()) expect([0, 255, 128]).toContain(v);
  });

  it('一个孤立的激发格恰好两步衰减回 ready（且生不出别人）', () => {
    const n = 8;
    const g = new Uint8Array(n * n);
    g[3 * n + 3] = BB_FIRING;
    const t1 = briansStep(g, n);
    expect(t1[3 * n + 3]).toBe(BB_REFRACTORY);
    // 它的邻居各只有 1 个激发邻居 → 生不出新格
    expect([...t1].filter((v) => v === BB_FIRING)).toHaveLength(0);
    const t2 = briansStep(t1, n);
    expect(t2.every((v) => v === BB_READY)).toBe(true);
  });

  it('seek ≡ 顺序推进 / seek(0) 回初态', () => {
    const p = defaults('brians-brain');
    const a = createBriansBrain(p, 7);
    const b = createBriansBrain(p, 7);
    a.seek(200);
    b.seek(400);
    b.seek(200);
    expect(b.current()).toEqual(a.current());
    const c = createBriansBrain(p, 7);
    const init = c.current().slice();
    c.seek(150);
    c.seek(0);
    expect(c.current()).toEqual(init);
  });

  it('默认参数下画面是活的（t=600 仍有激发/冷却格，不是全黑）', () => {
    const sim = createBriansBrain(defaults('brians-brain'), 3);
    sim.seek(600);
    const alive = [...sim.current()].filter((v) => v !== 0).length;
    expect(alive).toBeGreaterThan(100);
  });
});

describe('循环元胞自动机', () => {
  const stepOf = (p: Record<string, number | string>, seed = 4) => {
    const s = createCyclicCa(p, seed);
    return (t: number) => {
      s.seek(t);
      return s.current();
    };
  };

  it('状态数不越界（输出只有 K 档，且从 0 到 255 均分）', () => {
    const s = createCyclicCa({ ...defaults('cyclic-ca'), states: 8 }, 4);
    s.seek(100);
    const levels = [...new Set(s.current())];
    expect(levels).toHaveLength(8);
    expect(Math.max(...levels)).toBe(255);
    expect(Math.min(...levels)).toBe(0);
  });

  // 这条是**实测抓出来的真 bug 的回归守卫**：默认原来是 K=12 / θ=2 / Moore，
  // 而那个组合在一步之内把整场冻死（8 个邻居落在指定状态的概率只有 1/12，
  // 期望不到 1 个）。表现是「选了这个生成器，画面一动不动」。
  it('默认参数下画面**必须一直在动**（不许冻结）', () => {
    const p = defaults('cyclic-ca');
    const step = stepOf(p);
    // t=60 与 t=600 两处都查：有些配置会慢慢地僵掉
    expect(changedBetween(step, 60), 't=60 附近已经冻住了').toBeGreaterThan(0);
    expect(changedBetween(step, 600), 't=600 附近已经冻住了').toBeGreaterThan(0);
  });

  it('阈值太高 + 状态数太大 → 必然冻结（相变点是可预测的）', () => {
    // θ=3 配 K=20：邻居落在指定状态的概率 1/20 × 8 ≈ 0.4 —— 一步就死
    const step = stepOf({ ...defaults('cyclic-ca'), states: 20, threshold: 3 });
    expect(changedBetween(step, 120)).toBe(0);
  });

  it('cyclicStep 是同步更新：结果只由旧态决定，与调用顺序无关', () => {
    const n = 32;
    const k = 5;
    const build = (): Uint8Array => {
      const g = new Uint8Array(n * n);
      let s = 12345;
      for (let i = 0; i < g.length; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        g[i] = (s >>> 8) % k;
      }
      return g;
    };
    const rule = { k, theta: 1, vonNeumann: false, wrap: true };
    const a = new Uint8Array(n * n);
    const b = new Uint8Array(n * n);
    cyclicStep(build(), a, n, rule);
    cyclicStep(build(), b, n, rule);
    expect(b).toEqual(a);
  });

  it('seek ≡ 顺序推进', () => {
    const p = defaults('cyclic-ca');
    const a = createCyclicCa(p, 9);
    const b = createCyclicCa(p, 9);
    a.seek(300);
    b.seek(700);
    b.seek(300);
    expect(b.current()).toEqual(a.current());
  });
});

describe('阿贝尔沙堆', () => {
  it('稳定化后没有格子 ≥ 4', () => {
    const n = 32;
    const h = new Uint32Array(n * n);
    // ⚠️ 粒数必须**装得下**：格子的容量是 3·n²（这里 3072）。
    // 倒进超过容量的沙，在环面上永远稳不下来 —— 那不是 bug，是「装不下」。
    for (let i = 0; i < 2000; i++) h[(i * 37) % h.length] = (h[(i * 37) % h.length] ?? 0) + 1;
    stabilize(h, n, [], 'lifo');
    for (const v of h) expect(v).toBeLessThan(TOPPLE_AT);
  });

  it('单步崩塌有上限（防止一次雪崩把主线程卡死）', () => {
    const n = 64;
    const h = new Uint32Array(n * n);
    // 故意倒得远超容量：不设闸门的话这里会跑几十秒
    for (let i = 0; i < 200_000; i++) h[i % h.length] = h[i % h.length]! + 1;
    const done = stabilize(h, n, [], 'lifo', 50_000);
    expect(done).toBe(50_000);
    // 闸门只限制「处理了多少次」，不影响确定性：同样的上限两次结果相同
    const h2 = new Uint32Array(h.length);
    for (let i = 0; i < 200_000; i++) h2[i % h2.length] = h2[i % h2.length]! + 1;
    stabilize(h2, n, [], 'lifo', 50_000);
    expect(Array.from(h2)).toEqual(Array.from(h));
  });

  it('**阿贝尔性**：崩塌顺序不影响最终稳定态', () => {
    const n = 24;
    const build = (): Uint32Array => {
      const h = new Uint32Array(n * n);
      let s = 999;
      for (let i = 0; i < 4000; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const idx = s % h.length;
        h[idx] = h[idx]! + 1;
      }
      // 先把明显超标的格找出来当队列起点（两种顺序用同一个起点集合，
      // 差别只在弹出方向）
      return h;
    };
    const fifo = build();
    const lifo = build();
    const seeds = (h: Uint32Array): number[] => {
      const q: number[] = [];
      for (let i = 0; i < h.length; i++) if (h[i]! >= TOPPLE_AT) q.push(i);
      return q;
    };
    stabilize(fifo, n, seeds(fifo), 'fifo');
    stabilize(lifo, n, seeds(lifo), 'lifo');
    expect(Array.from(lifo)).toEqual(Array.from(fifo));
  });

  it('环面边界下总沙粒守恒（崩塌只是搬运）', () => {
    const n = 16;
    const h = new Uint32Array(n * n);
    let s = 4242;
    for (let i = 0; i < 3000; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      h[s % h.length] = h[s % h.length]! + 1;
    }
    const total = h.reduce((a, b) => a + b, 0);
    stabilize(h, n, [], 'lifo');
    expect(h.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it('默认参数下确实在长（撒沙量真的起作用）', () => {
    const sim = createSandpile(defaults('sandpile'), 4);
    sim.seek(30);
    const early = [...sim.current()].filter((v) => v !== 0).length;
    sim.seek(120);
    const late = [...sim.current()].filter((v) => v !== 0).length;
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
  });

  it('seek ≡ 顺序推进', () => {
    // 用**默认尺寸**（256²）：撒沙量上限是按 n²/32 收过的，小网格 + 默认撒沙量
    // 会立刻逼近饱和，每步的雪崩代价让重放慢到几十秒 —— 那是测试选了极端比例，
    // 不是模型的常态。
    const p = defaults('sandpile');
    const a = createSandpile(p, 5);
    const b = createSandpile(p, 5);
    a.seek(40);
    b.seek(90);
    b.seek(40);
    expect(b.current()).toEqual(a.current());
  });
});

describe('Reiter 雪花', () => {
  const frozenCount = (out: Uint8Array): number => {
    let n = 0;
    for (const v of out) if (v === 255) n++;
    return n;
  };

  it('冰只增不减（晶体不会融化）', () => {
    const sim = createSnowflake({ ...defaults('snowflake'), size: 128 });
    let prev = 0;
    for (const t of [5, 20, 50, 100, 200]) {
      sim.seek(t);
      const n = frozenCount(sim.current());
      expect(n, `t=${t} 的冰量小于上一采样点`).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(prev).toBeGreaterThan(1);
  });

  it('β（初始水量）真的控制生长：越大长得越多', () => {
    const at = (beta: number): number => {
      const s = createSnowflake({ ...defaults('snowflake'), size: 160, beta });
      s.seek(400);
      return frozenCount(s.current());
    };
    const thin = at(0.2);
    const thick = at(0.8);
    expect(thin).toBeGreaterThan(0);
    expect(thick).toBeGreaterThan(thin);
  });

  it('已经是冰的格子永远不再变（冻结是永久的）', () => {
    const n = 16;
    const cur: SnowState = {
      s: new Float32Array(n * n).fill(0.5),
      frozen: new Uint8Array(n * n),
      near: new Uint8Array(n * n),
    };
    cur.s[8 * n + 8] = 1;
    cur.frozen[8 * n + 8] = 1;
    const next: SnowState = {
      s: new Float32Array(n * n),
      frozen: new Uint8Array(n * n),
      near: new Uint8Array(n * n),
    };
    for (let i = 0; i < 5; i++) {
      snowStep(cur, next, n, { alpha: 1, gamma: 0.01 });
      const ts = cur.s;
      const tf = cur.frozen;
      const tn = cur.near;
      cur.s = next.s;
      cur.frozen = next.frozen;
      cur.near = next.near;
      next.s = ts;
      next.frozen = tf;
      next.near = tn;
      expect(cur.frozen[8 * n + 8]).toBe(1);
      expect(cur.s[8 * n + 8]).toBe(1);
    }
  });

  it('确定性 + seek ≡ 顺序推进', () => {
    const p = { ...defaults('snowflake'), size: 96 };
    const a = createSnowflake(p);
    const b = createSnowflake(p);
    a.seek(150);
    b.seek(300);
    b.seek(150);
    expect(b.current()).toEqual(a.current());
    const c = createSnowflake(p);
    const first = c.current().slice();
    c.seek(80);
    c.seek(0);
    expect(c.current()).toEqual(first);
  });
});
