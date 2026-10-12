import { describe, expect, it } from 'vitest';
import { planEviction, type CacheUsage } from '../../src/engine/video-budget';

const MB = 1024 * 1024;

/** 造一条缓存：`frames` 帧，每帧 `frameMB`（最旧在前）。 */
function cache(used: number, frames: number, frameMB = 8): CacheUsage {
  return { used, sizes: new Array<number>(frames).fill(frameMB * MB) };
}

/** 把计划套用回去，得到生效后的各缓存字节数。 */
function after(caches: readonly CacheUsage[], drop: readonly number[]): number[] {
  return caches.map((c, i) => c.sizes.slice(drop[i] ?? 0).reduce((a, b) => a + b, 0));
}

const totalOf = (bytes: readonly number[]) => bytes.reduce((a, b) => a + b, 0);

describe('视频缓存淘汰决策', () => {
  it('都没超上限时一帧都不动', () => {
    const caches = [cache(1, 3), cache(2, 3)];
    const plan = planEviction(caches, 100 * MB, 100 * MB);
    expect(plan.drop).toEqual([0, 0]);
    expect(plan.overBudget).toBe(false);
  });

  it('单条超了自己的上限：只夹那一条（防一个素材吃掉全局）', () => {
    const caches = [cache(5, 10), cache(1, 2)];
    const plan = planEviction(caches, 32 * MB, 10_000 * MB);
    expect(plan.drop).toEqual([6, 0]); // 10 帧 → 4 帧（32 MB）
    const left = after(caches, plan.drop);
    expect(left[0]).toBe(32 * MB);
    expect(left[1]).toBe(16 * MB);
  });

  it('超全局预算：从**最久没被取用**的那条开始丢，且至少给它留一帧', () => {
    // 三条各 4 帧 × 8 MB = 96 MB，全局预算 40 MB。
    const caches = [cache(10, 4), cache(30, 4), cache(20, 4)];
    const plan = planEviction(caches, 1000 * MB, 40 * MB);
    const left = after(caches, plan.drop);
    // used=10 的那条先被抽干到一帧（8 MB），还差 48 - 8 = … 继续按 used 升序抽。
    expect(plan.drop[0]).toBe(3); // used=10：只剩一帧
    expect(plan.drop[2]).toBe(3); // used=20（次旧）：也只剩一帧
    expect(plan.drop[1]).toBeLessThan(3); // used=30（最新）：被保住
    expect(totalOf(left)).toBeLessThanOrEqual(40 * MB);
    expect(plan.overBudget).toBe(false);
  });

  it('淘汰是**精确**的：套用之后要么回到预算内，要么明确报 overBudget', () => {
    const caches = [cache(1, 7, 3), cache(2, 7, 5), cache(3, 7, 11)];
    for (const budget of [200, 100, 64, 40, 24, 16]) {
      const plan = planEviction(caches, 1000 * MB, budget * MB);
      const left = after(caches, plan.drop);
      if (!plan.overBudget) expect(totalOf(left)).toBeLessThanOrEqual(budget * MB);
      // 停手时每条恰好剩一帧（3 + 5 + 11 MB）。
      else expect(totalOf(left)).toBe((3 + 5 + 11) * MB);
    }
  });

  it('每条的最后一帧永不淘汰（那是这一层正在显示的画面）', () => {
    const caches = [cache(1, 1), cache(2, 1)];
    const plan = planEviction(caches, 1, 1); // 预算荒谬地小
    expect(plan.drop).toEqual([0, 0]);
    expect(plan.overBudget).toBe(true); // 停手 + 明确报出去，而不是删到黑屏
  });

  it('单帧尺寸不同的那条按逐帧算，不按平均（预览 / 导出尺寸会共存）', () => {
    const mixed: CacheUsage = { used: 1, sizes: [8 * MB, 8 * MB, 2 * MB, 2 * MB] };
    const plan = planEviction([mixed], 1000 * MB, 12 * MB);
    // 总 20 MB → 预算 12 MB：丢最旧的 1 帧（8 MB）即正好落到 12 MB。
    expect(plan.drop).toEqual([1]);
    expect(totalOf(after([mixed], plan.drop))).toBe(12 * MB);
  });

  it('各自的上限与全局预算是**两级**：先夹单条，再夹全局', () => {
    const caches = [cache(1, 20, 8), cache(2, 20, 8)];
    const plan = planEviction(caches, 64 * MB, 100 * MB);
    // 单条上限 64 MB（8 帧）：两条各剩 8 帧 = 128 MB > 100 MB → 全局还要再抽
    const left = after(caches, plan.drop);
    expect(left[0]).toBeLessThanOrEqual(64 * MB);
    expect(totalOf(left)).toBeLessThanOrEqual(100 * MB);
    expect(plan.overBudget).toBe(false);
  });
});
