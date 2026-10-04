/**
 * sandpile.ts — 阿贝尔沙堆（Bak–Tang–Wiesenfeld），`sim` 型。
 *
 * 规则：每格堆着一摞沙粒。**≥ 4 粒就崩塌**：自己减 4，四个 von Neumann 邻居各加 1。
 * 反复崩塌到没有格子 ≥ 4 为止 —— 那个终止状态叫「稳定态」。
 *
 * 它值得做一个生成器的理由只有一条：**一遍遍往里加沙，稳定态会自己长成一个
 * 分形**。那个形状不是谁设计的，是「局部规则 + 大量重复」的产物，而且
 * 每一次加沙都精确地重画它一次。
 *
 * ## 两个实现决定
 *
 * 1. **用工作队列而不是整场扫描。** 整场扫描是 O(格数 × 崩塌轮数)，而队列是
 *    O(总崩塌次数) —— 后者可能小好几个数量级（大部分格子大部分时候是稳定的）。
 * 2. **每一步的随机位置由 `hashSeed(seed, step)` 现算，不用一条长随机流。**
 *    长流的内部游标是状态的一部分：seek 从中间某张快照重放时，游标位置也必须
 *    一起回退，否则重放出来的图和顺序播放不一样。每步现算 hash 就没有这个状态。
 *
 * ## 「阿贝尔」是什么意思
 *
 * 崩塌的**顺序不影响最终稳定态** —— 这是能单测的强不变量（打乱队列顺序、
 * 甚至用两种完全不同的顺序各跑一遍，终止状态逐格相同）。
 */

import { hashSeed, mulberry32 } from '../core/prng';
import { SnapshotRing } from './sim-util';
import type { GeneratorDef, SimHandle } from './types';

/** 崩塌阈值。4 是二维 von Neumann 邻域下的经典取值。 */
export const TOPPLE_AT = 4;

const SNAPSHOT_OPTS = {
  every: 8,
  cap: 48,
  clone: (v: Uint32Array): Uint32Array => v.slice(),
};

/**
 * 每一步最多处理多少次崩塌。
 *
 * 这是一个**防卡死的闸门**，不是模型的一部分。为什么需要它：沙堆逼近饱和
 * （每格都接近 3）时，一粒沙可能引发极其庞大的雪崩 —— 实测把 5000 粒倒进
 * 32² 的格子里、再一次性稳定化，光是那一次雪崩就能跑几十秒。运行期每步都会
 * 稳定化，正常情况下远到不了这个量级，但没有闸门就意味着「用户把撒沙量拉满
 * + 网格调小」可以直接把主线程卡死。
 *
 * **闸门不影响确定性**：上限是步数的固定函数，同样的 t 永远得到同样的中间态。
 * 代价只是「雪崩特别大的那几步，堆暂时没完全稳定」—— 下一步会接着塌。
 */
export const MAX_TOPPLE_PER_STEP = 400_000;

/**
 * 把 `h` 稳定化（就地改）。`order` 只影响**中间过程**，不影响终止状态。
 *
 * `order === 'fifo'` 用队列（广度优先），`'lifo'` 用栈（深度优先）——
 * 单测拿这两种顺序对拍来验证阿贝尔性。
 *
 * 返回**实际处理了多少次崩塌**（探针与单测用）。
 */
export function stabilize(
  h: Uint32Array,
  n: number,
  seedQueue: number[] = [],
  order: 'fifo' | 'lifo' = 'lifo',
  maxTopple: number = MAX_TOPPLE_PER_STEP,
): number {
  const q = seedQueue;
  if (q.length === 0) {
    for (let i = 0; i < n * n; i++) if (h[i]! >= TOPPLE_AT) q.push(i);
  }
  let head = 0;
  let done = 0;
  while (order === 'fifo' ? head < q.length : q.length > 0) {
    if (done >= maxTopple) break;
    const i = order === 'fifo' ? q[head++]! : q.pop()!;
    if (h[i]! < TOPPLE_AT) continue;
    done++;
    h[i] = h[i]! - TOPPLE_AT;
    const x = i % n;
    const y = (i - x) / n;
    // von Neumann + 环面
    const up = ((y === 0 ? n - 1 : y - 1) * n + x) | 0;
    const dn = ((y === n - 1 ? 0 : y + 1) * n + x) | 0;
    const lf = (y * n + (x === 0 ? n - 1 : x - 1)) | 0;
    const rt = (y * n + (x === n - 1 ? 0 : x + 1)) | 0;
    for (const j of [up, dn, lf, rt]) {
      h[j] = h[j]! + 1;
      if (h[j]! >= TOPPLE_AT) q.push(j);
    }
  }
  return done;
}

export function createSandpile(params: Record<string, number | string>, seed: number): SimHandle {
  const n = Math.max(32, Math.min(512, Math.round(Number(params.size) || 256)));
  const stepsPerSec = Math.max(1, Number(params.rate) || 30);
  const batchRaw = Math.max(1, Math.min(2000, Math.round(Number(params.batch) || 200)));
  // 撒沙量相对于网格要有上限：格子的容量是 3·n²，一次倒进去太多就永远稳不下来
  // （每步都塌不完，下一轮再往上加）。n²/32 是实测能撑住的比例。
  const batch = Math.max(1, Math.min(batchRaw, Math.floor((n * n) / 32)));
  const center = params.dropMode !== 'random';

  const h = new Uint32Array(n * n);
  let frame = 0;
  const snapshots = new SnapshotRing<Uint32Array>(SNAPSHOT_OPTS, h);
  const out = new Uint8Array(n * n);
  const queue: number[] = [];

  /** 一步 = 撒 `batch` 粒沙 + 稳定化。 */
  const stepOnce = (): void => {
    const rnd = mulberry32(hashSeed(seed, 'sandpile', frame));
    const ci = (n >> 1) * n + (n >> 1);
    for (let g = 0; g < batch; g++) {
      const i = center ? ci : Math.floor(rnd() * n * n);
      h[i] = h[i]! + 1;
      if (h[i]! >= TOPPLE_AT) queue.push(i);
    }
    stabilize(h, n, queue);
    queue.length = 0;
  };

  const stepTo = (target: number): void => {
    while (frame < target) {
      stepOnce();
      frame++;
      if (snapshots.shouldStore(frame)) snapshots.store(frame, h);
    }
  };

  return {
    gridW: n,
    gridH: n,
    stepsPerSec,
    seek(simFrame: number): void {
      const target = Math.max(0, Math.floor(simFrame));
      if (target < frame) {
        const snap = snapshots.nearestAtOrBefore(target);
        h.set(snap.value);
        frame = snap.frame;
      }
      stepTo(target);
    },
    current(): Uint8Array {
      // 稳定态的每格只有 0..3，直接量化就是一片纯黑 —— 必须拉开对比。
      // 用 sqrt 让低值也看得见：稳定态里 2 与 3 的差别才是分形的纹理所在。
      for (let i = 0; i < out.length; i++) {
        const v = h[i]!;
        out[i] = v === 0 ? 0 : Math.min(255, Math.round(Math.sqrt(v) * 96));
      }
      return out;
    },
  };
}

export const sandpileDef: GeneratorDef = {
  id: 'sandpile',
  nameKey: 'algo.sandpile',
  kind: 'sim',
  volatile: ['rate', 'colorBg', 'colorLive', 'palette'],
  params: [
    { key: 'size', labelKey: 'algo.sandpile.grid', type: 'range', min: 64, max: 512, step: 32, defaultValue: 256 },
    {
      key: 'batch',
      labelKey: 'algo.sandpile.batch',
      type: 'range',
      min: 1,
      max: 2000,
      step: 1,
      // 200/步 × 30 步/秒 = 6000 粒/秒：约十秒长到能看出分形。
      // 取 1 的话要跑几十分钟才有一张可看的图。
      defaultValue: 200,
    },
    {
      key: 'dropMode',
      labelKey: 'algo.sandpile.dropMode',
      type: 'select',
      defaultValue: 'center',
      options: [
        { labelKey: 'algo.sandpile.dropCenter', value: 'center' },
        { labelKey: 'algo.sandpile.dropRandom', value: 'random' },
      ],
    },
    { key: 'rate', labelKey: 'algo.sandpile.speed', type: 'range', min: 1, max: 120, step: 1, defaultValue: 30 },
    { key: 'colorBg', labelKey: 'algo.sandpile.colorBg', type: 'color', defaultValue: '#05060c' },
    { key: 'colorLive', labelKey: 'algo.sandpile.colorLive', type: 'color', defaultValue: '#ffd489' },
  ],
  create: createSandpile,
};
