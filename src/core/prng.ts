/**
 * prng.ts — 确定性随机。硬约束 1.2：任何随机都要带种子。
 *
 * 移植自 angel-echo js/util.js 的 mulberry32（同作者内部移植，见 CREDITS.md）。
 * JS 侧需要随机的地方走 withSeededRandom；GLSL 侧收 u_seed uniform，
 * 由 hashSeed(project.seed, instanceId, frameIndex) 派生——同一个 t 永远得到
 * 同一个 seed，预览与导出是同一次随机。
 */

/** 确定性 PRNG：同 seed 同序列，每次 reload 一致。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把若干部分混成一个 32 位种子（FNV-1a 风格）。 */
export function hashSeed(...parts: (number | string)[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

/**
 * 用种子随机数跑一段逻辑。rng 只在 fn 的作用域里存活，
 * 不污染任何全局状态——本项目不存在「全局 Math.random」的等价物。
 */
export function withSeededRandom<T>(seed: number, fn: (rng: () => number) => T): T {
  return fn(mulberry32(seed));
}

/** 帧级种子：同一工程同一帧 → 同一种子。 */
export function frameSeed(projectSeed: number, frameIndex: number): number {
  return hashSeed(projectSeed, frameIndex);
}
