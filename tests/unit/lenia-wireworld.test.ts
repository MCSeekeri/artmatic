import { describe, expect, it } from 'vitest';
import { createLenia, leniaStep } from '../../src/algos/lenia';
import { createWireworld, seedRing, wireworldStep, WW_CONDUCTOR, WW_HEAD, WW_TAIL } from '../../src/algos/wireworld';
import { TorusField, annulusKernel, type SparseKernel } from '../../src/algos/sim-util';
import { getGenerator } from '../../src/algos/registry';
import { encodePattern, bitmapFromRows } from '../../src/algos/pattern-codec';

const defaults = (id: string): Record<string, number | string> => {
  const p: Record<string, number | string> = {};
  for (const d of getGenerator(id)!.params) p[d.key] = d.defaultValue;
  return p;
};

const ink = (out: Uint8Array, t = 8): number => {
  let n = 0;
  for (const v of out) if (v > t) n++;
  return n;
};

/**
 * ⚠️ Lenia 的每个用例都要显式给超时。
 *
 * 卷积是 O(格数 × 抽头数)，实测 112²/R=10 约 4 ms/步（走 `TorusField` 的
 * halo 快路径之后；朴素回绕写法是 7.8 ms）—— 一个「跑到 t=400」的用例本身
 * 就是 1.6 秒，在整套跑（50 个文件并行）时仍可能顶破 vitest 默认的 5 秒。
 * 给它 30 秒是**如实反映它的成本**，不是掩盖慢；要再快得换 FFT 卷积。
 */
const LENIA_TIMEOUT = 30_000;

/**
 * 朴素参照实现：逐抽头做环面回绕。`TorusField` 的正确性判据就是「与它逐位相同」
 * ——halo 最容易错的地方是**四个角**（上下 halo 只复制了中段没连左右一起复制）。
 */
function naiveConvolve(src: Float32Array, n: number, k: SparseKernel): Float32Array {
  const out = new Float32Array(n * n);
  const taps = k.w.length;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let acc = 0;
      for (let t = 0; t < taps; t++) {
        const yy = y + k.dy[t]!;
        const xx = x + k.dx[t]!;
        const wy = yy < 0 ? yy + n : yy >= n ? yy - n : yy;
        const wx = xx < 0 ? xx + n : xx >= n ? xx - n : xx;
        acc += k.w[t]! * src[wy * n + wx]!;
      }
      out[y * n + x] = acc;
    }
  }
  return out;
}

describe('TorusField 卷积', () => {
  it('与朴素环面卷积**逐位相同**（覆盖 R 比网格小得多、以及 R 接近网格的两种情形）', () => {
    for (const [n, R] of [
      [64, 10],
      [24, 6],
      [20, 9], // R 接近 n/2：halo 的四个角最容易错
    ] as const) {
      const k = annulusKernel(R);
      const src = new Float32Array(n * n);
      for (let i = 0; i < src.length; i++) src[i] = Math.sin(i * 0.7) * 0.5 + 0.5;
      const ref = naiveConvolve(src, n, k);
      const field = new TorusField(n, k);
      field.convolve(src);
      expect(Array.from(field.conv), `n=${n} R=${R}`).toEqual(Array.from(ref));
    }
  });

  it('抽头数就是 πR² —— 环状核在 width=0.15 下实际是**整个圆盘**', () => {
    // 这条钉住的是**成本模型**而不是函数值：谁把 width/eps 调窄、或者以为
    // 稀疏化已经剪掉了大半抽头，都会在这里看到真实数字。317 = π·10²。
    // 想降成本要动的是 halo 快路径或 R，不是 eps。
    for (const R of [4, 6, 10, 12]) {
      const taps = annulusKernel(R).w.length;
      const disc = Math.PI * R * R;
      expect(Math.abs(taps - disc) / disc, `R=${R} 抽头=${taps}`).toBeLessThan(0.08);
    }
  });
});

describe('Lenia', () => {
  it('场恒在 [0,1] 内（输出字节恒在 0..255，且不小于 0）', () => {
    const n = 24;
    const k = annulusKernel(6);
    const a = new Float32Array(n * n).fill(1.4); // 故意给越界初值
    const next = new Float32Array(n * n);
    leniaStep(new TorusField(n, k), a, next, { mu: 0.15, sigma: 0.03, dt: 0.1 });
    for (const v of next) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const a2 = new Float32Array(n * n).fill(-3);
    leniaStep(new TorusField(n, k), a2, next, { mu: 0.15, sigma: 0.03, dt: 0.1 });
    for (const v of next) expect(v).toBe(0);
  }, LENIA_TIMEOUT);

  // 这条是**实测抓出来的真 bug 的回归守卫**：默认 σ 原来是 Orbium 的 0.015，
  // 而那个值配我们自己的团块/手绘种子在任何 μ 下都一步就死（画面全黑）。
  it('默认参数下长得出东西（t=400 仍有生物）', () => {
    const sim = createLenia(defaults('lenia'), 4);
    sim.seek(400);
    expect(ink(sim.current()), 'σ 默认值把生长窗口关死了').toBeGreaterThan(200);
  }, LENIA_TIMEOUT);

  it('σ=0.015（Orbium 那套）配团块种子会死 —— 说明默认值不是随便改的', () => {
    const sim = createLenia({ ...defaults('lenia'), sigma: 0.015 }, 4);
    sim.seek(400);
    expect(ink(sim.current())).toBe(0);
  }, LENIA_TIMEOUT);

  it('核半径 R 与 μ 真的影响结果', () => {
    // 48²/t=200 而不是默认的 112²/t=300：这一条要跑两次，用最小能分辨差异的规模
    const at = (p: Record<string, number | string>): number => {
      const s = createLenia({ ...defaults('lenia'), size: 48, ...p }, 4);
      s.seek(200);
      return ink(s.current());
    };
    const a = at({ mu: 0.15 });
    const b = at({ mu: 0.3 });
    expect(a).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  }, LENIA_TIMEOUT);

  it('确定性 + seek ≡ 顺序推进 + seek(0)', () => {
    const p = { ...defaults('lenia'), size: 64 };
    const a = createLenia(p, 6);
    const b = createLenia(p, 6);
    a.seek(200);
    b.seek(400);
    b.seek(200);
    expect(b.current()).toEqual(a.current());
    const c = createLenia(p, 6);
    const first = c.current().slice();
    c.seek(120);
    c.seek(0);
    expect(c.current()).toEqual(first);
  }, LENIA_TIMEOUT);
});

describe('Wireworld', () => {
  it('只有四个取值（空 0 / 导线 64 / 电子 255 / 尾巴 128）', () => {
    const sim = createWireworld(defaults('wireworld'));
    sim.seek(40);
    for (const v of sim.current()) expect([0, 64, 128, 255]).toContain(v);
  });

  it('环形种子：铺出导线、放了一个电子与一条尾巴', () => {
    const n = 64;
    const g = new Uint8Array(n * n);
    seedRing(g, n, n);
    const count = (s: number): number => [...g].filter((v) => v === s).length;
    expect(count(WW_CONDUCTOR)).toBeGreaterThan(50);
    expect(count(WW_HEAD)).toBe(1);
    expect(count(WW_TAIL)).toBe(1);
  });

  it('电子永远绕着环跑（t=400 还有电子，不会熄）', () => {
    const sim = createWireworld(defaults('wireworld'));
    let heads = 0;
    for (const t of [0, 50, 200, 400]) {
      sim.seek(t);
      heads = [...sim.current()].filter((v) => v === 255).length;
      expect(heads, `t=${t} 电子熄了`).toBeGreaterThan(0);
    }
  });

  it('三条规则正确：head→tail、tail→导体、导体在 1~2 个 head 邻居时→head', () => {
    const n = 8;
    const g = new Uint8Array(n * n);
    // 一条水平导线 + 中间一个电子
    for (let x = 1; x < 7; x++) g[3 * n + x] = WW_CONDUCTOR;
    g[3 * n + 3] = WW_HEAD;
    g[3 * n + 4] = WW_TAIL;
    const next = wireworldStep(g, n, n);
    expect(next[3 * n + 3]).toBe(WW_TAIL); // head 变尾巴
    expect(next[3 * n + 4]).toBe(WW_CONDUCTOR); // 尾巴恢复导线
    expect(next[3 * n + 2]).toBe(WW_HEAD); // 左邻恰有 1 个 head → 变电子
    expect(next[3 * n + 1]).toBe(WW_CONDUCTOR); // 再远一格没有 head 邻居 → 不变
    expect(next[0]).toBe(0); // 空恒空
  });

  it('手绘图案种子真的进了模拟', () => {
    const p = encodePattern(bitmapFromRows(['#######', '#.....#', '#######']));
    const a = createWireworld({ ...defaults('wireworld'), size: 64, seedMode: 'pattern', pattern: p });
    const b = createWireworld({ ...defaults('wireworld'), size: 64, seedMode: 'ring' });
    expect(a.current()).not.toEqual(b.current());
  });

  it('确定性 + seek ≡ 顺序推进 + seek(0)', () => {
    const p = defaults('wireworld');
    const a = createWireworld(p);
    const b = createWireworld(p);
    a.seek(120);
    b.seek(300);
    b.seek(120);
    expect(b.current()).toEqual(a.current());
    const c = createWireworld(p);
    const first = c.current().slice();
    c.seek(80);
    c.seek(0);
    expect(c.current()).toEqual(first);
  });
});
