import { describe, expect, it } from 'vitest';
import { jerkOffset } from '../../src/effects/jerk';

/**
 * 「抽动」位移的不变量（画面滚卷的 `jerk` / `jerkRate`）。
 *
 * 这几条是**用户能看见的承诺**，也是 GLSL 侧测不到的部分：
 * 幅度有界（画面不会越飘越远）、刻度内恒定（刻度里仍然是平滑滚动）、
 * 跨刻度突变（否则这个功能等于没做）、坏输入不产生 NaN
 * （NaN 进了 uniform 整帧变黑，而且不报错）。
 */

const RATE = 6;
const AMOUNT = 0.4;
const SEED = 'clip-3f2a';

/** 第 `tick` 格的中点：避开边界上的浮点毛刺。 */
function atTick(tick: number, rate = RATE): number {
  return (tick + 0.5) / rate;
}

describe('jerkOffset', () => {
  it('幅度受约束：任意刻度的位移都在 ±amount 之内', () => {
    for (let tick = 0; tick < 500; tick++) {
      expect(Math.abs(jerkOffset(atTick(tick), RATE, AMOUNT, SEED))).toBeLessThanOrEqual(AMOUNT);
    }
    // 换一组参数再扫一遍：上限必须跟着 amount 走，不是写死的常数。
    for (let tick = 0; tick < 100; tick++) {
      expect(Math.abs(jerkOffset(atTick(tick, 23), 23, 0.05, SEED))).toBeLessThanOrEqual(0.05);
    }
  });

  it('amount = 0 时恒为 0（关掉时画面与老版本逐像素相同）', () => {
    for (let tick = 0; tick < 50; tick++) {
      expect(jerkOffset(atTick(tick), RATE, 0, SEED)).toBe(0);
    }
  });

  it('刻度内恒定：同一个 1/rate 区间里的任意 t 给出同一个位移', () => {
    const rate = 4;
    for (const t0 of [0.02, 1.1, 12.34]) {
      const base = jerkOffset(t0, rate, AMOUNT, SEED);
      // 这一格的终点：刻度网格是 `k/rate`，与 `t0` 无关（算错就跨到下一格了）。
      const end = (Math.floor(t0 * rate) + 1) / rate;
      for (const f of [0.05, 0.3, 0.7, 0.95]) {
        const t = t0 + (end - t0) * f;
        expect(jerkOffset(t, rate, AMOUNT, SEED), `t=${t}`).toBe(base);
      }
    }
  });

  it('跨刻度会换位置：相邻刻度的位移绝大多数都不一样，且差值不是可忽略的', () => {
    const ticks = Array.from({ length: 200 }, (_, i) => jerkOffset(atTick(i), RATE, AMOUNT, SEED));
    let moved = 0;
    let sumDelta = 0;
    for (let i = 1; i < ticks.length; i++) {
      const d = Math.abs(ticks[i]! - ticks[i - 1]!);
      sumDelta += d;
      if (d > 0.02 * AMOUNT) moved++;
    }
    // 实测：97.7% 的边界有变化，平均跳 0.257·幅（两个独立均匀量的理论值 0.267·幅）。
    // 阈值留得宽 —— 它抓的是「序列退化成常量 / 相邻刻度高度相关」，不是分布本身。
    expect(moved / (ticks.length - 1)).toBeGreaterThan(0.9);
    expect(sumDelta / (ticks.length - 1)).toBeGreaterThan(0.5 * AMOUNT);
  });

  it('确定性：同参数同结果，换 seed 换序列', () => {
    const a = Array.from({ length: 20 }, (_, i) => jerkOffset(atTick(i), RATE, AMOUNT, SEED));
    const b = Array.from({ length: 20 }, (_, i) => jerkOffset(atTick(i), RATE, AMOUNT, SEED));
    expect(b).toEqual(a);
    // 同一 t 与帧率 / 渲染路径无关：它只是 (t, rate, amount, seed) 的函数。
    expect(jerkOffset(3, RATE, AMOUNT, SEED)).toBe(jerkOffset(3, RATE, AMOUNT, SEED));

    const other = Array.from({ length: 20 }, (_, i) => jerkOffset(atTick(i), RATE, AMOUNT, 'clip-other'));
    expect(other).not.toEqual(a);
  });

  it('坏输入不产生 NaN（NaN 进 uniform 会整帧变黑且不报错）', () => {
    const bad = [
      jerkOffset(1, 0, AMOUNT, SEED), // rate = 0
      jerkOffset(1, -4, AMOUNT, SEED), // rate < 0
      jerkOffset(1, RATE, -0.2, SEED), // amount < 0
      jerkOffset(Number.NaN, RATE, AMOUNT, SEED), // t = NaN
      jerkOffset(Number.POSITIVE_INFINITY, RATE, AMOUNT, SEED),
      jerkOffset(1, Number.NaN, AMOUNT, SEED), // rate = NaN
    ];
    for (const v of bad) expect(Number.isFinite(v) && v === 0).toBe(true);
  });
});
