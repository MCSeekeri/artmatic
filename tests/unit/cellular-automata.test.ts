import { describe, expect, it } from 'vitest';
import { BB_FIRING, BB_READY, BB_REFRACTORY, briansStep, createBriansBrain } from '../../src/algos/brians-brain';
import { createCyclicCa, cyclicStep } from '../../src/algos/cyclic-ca';
import { TOPPLE_AT, createSandpile, stabilize } from '../../src/algos/sandpile';
import { createSnowflake, snowStep, HEX_NB_EVEN, HEX_NB_ODD, type SnowState } from '../../src/algos/snowflake';
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
    const t1 = briansStep(g, n, n);
    expect(t1[3 * n + 3]).toBe(BB_REFRACTORY);
    // 它的邻居各只有 1 个激发邻居 → 生不出新格
    expect([...t1].filter((v) => v === BB_FIRING)).toHaveLength(0);
    const t2 = briansStep(t1, n, n);
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
    cyclicStep(build(), a, n, n, rule);
    cyclicStep(build(), b, n, n, rule);
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
  /**
   * ⚠️ 出厂默认**必须能完整稳定化**。
   *
   * 中心落点把所有的沙倒进同一个格子，总崩塌数 ≈ (总沙量)^1.5，与网格大小
   * 无关。所以「默认值把网格铺到多满」直接决定它会不会撞上
   * `MAX_TOPPLE_PER_STEP` 那道防卡死闸门 —— 而撞上的表现**不是报错**，
   * 是稳定化被截断、格子里留着 h >= 4 的塔，画面静默地不再表达模型状态
   * （实测出厂旧默认 256²/200 粒在 t=8s 起就出现 400+ 个这样的格子）。
   *
   * 判据用 `current()` 的映射反推：`v = min(255, round(sqrt(h)*96))`，
   * 稳定态 h <= 3 ⇒ v <= 166。所以 **v > 166 就是没塌完的格子**。
   */
  it('出厂默认跑满一整条时间轴之后，没有 h >= 4 的格子残留', () => {
    const p = defaults('sandpile');
    const rate = Number(p['rate']) || 30;
    const sim = createSandpile(p, 1);
    sim.seek(24 * rate); // 与开箱 demo 同长

    const out = sim.current();
    let bad = 0;
    for (const v of out) if (v > 166) bad++;
    expect(bad, '默认参数撞上了防卡死闸门 —— 画面已不再是沙堆的稳定态').toBe(0);
  });

  it('预先堆得很高的格子会一路塌到稳定，而不是只塌一次就停手', () => {
    // 回归守卫。曾经的问题：崩塌之后不重新入队，只靠「邻居推高它时才入队」——
    // 于一格 h=40 会被弹出一次、塌到 36，然后队列空掉、稳定化**就此结束**。
    // 出厂默认的中心落点一次往同一格倒 200 粒，正是这个坑；它当时看起来正常，
    // 只是因为 `stepOnce` 把同一格重复推进队列 200 次，200 个重复条目凑出了
    // 够用的弹出次数 —— 巧合而已。
    const n = 16;
    const h = new Uint32Array(n * n);
    h[0] = 40;
    const done = stabilize(h, n, n, [], 'lifo', Number.POSITIVE_INFINITY);
    expect(done, '40 粒至少塌 10 次').toBeGreaterThanOrEqual(10);
    for (const v of h) expect(v).toBeLessThan(TOPPLE_AT);
  });

  it('稳定化后没有格子 ≥ 4', () => {
    const n = 32;
    const h = new Uint32Array(n * n);
    // ⚠️ 粒数必须**装得下**：格子的容量是 3·n²（这里 3072）。
    // 倒进超过容量的沙，在环面上永远稳不下来 —— 那不是 bug，是「装不下」。
    for (let i = 0; i < 2000; i++) h[(i * 37) % h.length] = (h[(i * 37) % h.length] ?? 0) + 1;
    stabilize(h, n, n, [], 'lifo');
    for (const v of h) expect(v).toBeLessThan(TOPPLE_AT);
  });

  it('单步崩塌有上限（防止一次雪崩把主线程卡死）', () => {
    const n = 64;
    const h = new Uint32Array(n * n);
    // 故意倒得远超容量：不设闸门的话这里会跑几十秒
    for (let i = 0; i < 200_000; i++) h[i % h.length] = h[i % h.length]! + 1;
    const done = stabilize(h, n, n, [], 'lifo', 50_000);
    expect(done).toBe(50_000);
    // 闸门只限制「处理了多少次」，不影响确定性：同样的上限两次结果相同
    const h2 = new Uint32Array(h.length);
    for (let i = 0; i < 200_000; i++) h2[i % h2.length] = h2[i % h2.length]! + 1;
    stabilize(h2, n, n, [], 'lifo', 50_000);
    expect(Array.from(h2)).toEqual(Array.from(h));
  });

  it('**阿贝尔性**：崩塌顺序不影响最终稳定态', () => {
    const n = 24;
    /*
     * ⚠️ 这个输入有两个约束，都不显然：
     *
     * 1. **总沙量要不超容量**（3·n² = 1728）。超过时环面上不存在稳定态，
     *    稳定化永不终止、只能被 `maxTopple` 截断，而截断点与顺序有关 ——
     *    那时这条断言比的其实是两个被截断的中间态。原先是 4000 粒。
     * 2. **不能把沙堆在一格里**。一格 170 粒要连续塌几十次，实测 13 个这样的
     *    尖峰要 400 万次以上崩塌 —— 又会顶到闸门。600 粒散开（平均一格一粒）
     *    才是这条性质真正便宜、干净的工作区。
     */
    const build = (): Uint32Array => {
      const h = new Uint32Array(n * n);
      let s = 999;
      for (let i = 0; i < 600; i++) {
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
    stabilize(fifo, n, n, seeds(fifo), 'fifo');
    stabilize(lifo, n, n, seeds(lifo), 'lifo');
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
    stabilize(h, n, n, [], 'lifo');
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

  /* ---------------------------------------------------------- 邻域几何
     这两条是**返工过一次的那个 bug 的直接判据**。第一版的偶数列邻居写成
     `{(±1,-1),(±1,0),(±1,+1)}`、奇数列写成另一套，两套互不对称 ⇒ 那不是
     六角格。当时没有任何守卫，代价是「长出来是一个朝左张开的楔形」，
     而单测（确定 / 能长 / 冰单调不减）**全都通过**。 */

  const neighborsOf = (x: number, y: number, n: number): string[] => {
    const nb = (x & 1) === 1 ? HEX_NB_ODD : HEX_NB_EVEN;
    const out: string[] = [];
    for (let k = 0; k < 6; k++) {
      const xx = (((x + nb[k * 2]!) % n) + n) % n;
      const yy = (((y + nb[k * 2 + 1]!) % n) + n) % n;
      out.push(`${xx},${yy}`);
    }
    return out;
  };

  it('六角邻域：6 个邻居互不相同', () => {
    const n = 16;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        const ns = neighborsOf(x, y, n);
        expect(new Set(ns).size, `(${x},${y}) 有重复邻居`).toBe(6);
      }
    }
  });

  it('六角邻域：邻接必须**双向**，且关于竖轴镜像对称', () => {
    /* 双向：Q 在 N(P) 里 ⟺ P 在 N(Q) 里。破坏这条的邻域不是任何一张图，
       各列的生长条件会互不相同。
       镜像：dx → -dx 必须把邻居集合映回自身（六角格的 6 重对称含这条）。 */
    const n = 12;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        const ns = neighborsOf(x, y, n);
        for (const s of ns) {
          const [qx, qy] = s.split(',').map(Number) as [number, number];
          expect(neighborsOf(qx, qy, n), `(${x},${y})→(${qx},${qy}) 不双向`).toContain(`${x},${y}`);
        }
        const mirrored = ns
          .map((s) => {
            const [qx, qy] = s.split(',').map(Number) as [number, number];
            return `${((2 * x - qx) % n + n) % n},${qy}`;
          })
          .sort();
        expect(mirrored, `(${x},${y}) 的邻域不镜像对称`).toEqual([...ns].sort());
      }
    }
  });

  /* ------------------------------------------------------------ u 场规则
     Reiter 的 `s = u + v`：receptive 格（冰 + 冰的紧邻）在扩散场里贡献 **0**。
     旧实现用原始 `s` 算邻居均值 ⇒ 冰格以 1.0 参与平均 ⇒ 晶体反过来向周围
     供水 ⇒ 生长与几何无关 ⇒ 只能长成实心圆盘。 */

  it('扩散在 u 场上做：紧邻吸水、次邻被抽干、远场不动', () => {
    const n = 16;
    const mk = (): SnowState => ({
      s: new Float32Array(n * n).fill(0.5),
      frozen: new Uint8Array(n * n),
      near: new Uint8Array(n * n),
    });
    const cur = mk();
    const next = mk();
    cur.s[8 * n + 8] = 1;
    cur.frozen[8 * n + 8] = 1;
    snowStep(cur, next, n, { alpha: 1, gamma: 0.001 });

    const at = (x: number, y: number): number => next.s[y * n + x]!;
    expect(at(8, 8)).toBe(1); // 冰不变
    expect(next.near[9 * n + 8]).toBe(1);
    expect(at(8, 9), '紧邻（receptive）该吸水').toBeGreaterThan(0.5);
    expect(at(8, 10), '次邻该被冰遮掉水源、水量下降').toBeLessThan(0.5);
    expect(at(2, 2), '远场一格之内不该变').toBeCloseTo(0.5, 6);
  });

  it('晶体必须长成各向同性的六角星（质心留在中心）', () => {
    /* 楔形 bug 的行为判据：旧实现长出来的形状朝一个方向张开，冰的质心会
       明显偏离中心。取已长开但还没顶到钉扎圈的时刻（n=192、400 步）。 */
    const n = 192;
    const sim = createSnowflake({ size: n, beta: 0.48, gamma: 0.0008, alpha: 1, rate: 30 });
    sim.seek(400);
    const out = sim.current();
    const c = n >> 1;
    let sx = 0;
    let sy = 0;
    let count = 0;
    let rMax = 1;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (out[y * n + x] !== 255) continue;
        sx += x;
        sy += y;
        count++;
        const d = Math.hypot(x - c, y - c);
        if (d > rMax) rMax = d;
      }
    }
    expect(count, '没长出东西').toBeGreaterThan(50);
    const drift = Math.hypot(sx / count - c, sy / count - c) / rMax;
    expect(drift, `质心偏移 ${(drift * 100).toFixed(1)}% 半径（应 < 8%）`).toBeLessThan(0.08);
  });

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
