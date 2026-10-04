/**
 * snowflake.ts — Reiter 雪花生长模型，`sim` 型。
 *
 * 六角格上每格存一个连续量 `s`（水量），规则四行：
 *
 * ```
 * receptive(i) = s[i] ≥ 1 或任一邻居 s ≥ 1
 * receptive 的格子:  s[i] += γ                    （结晶前沿吸水）
 * 其余格子:          s[i] += (α/2)·(邻居均值 − s[i])  （只做扩散）
 * s[i] ≥ 1 → 永久冻结成冰
 * ```
 *
 * 就这么点东西，长出来的是**真的雪花**：六重对称、主枝上再分叉、枝尖越细。
 * 它和别的 CA 不是一类东西 —— 别的模式是「纹理」，这个是**一个具体的东西**。
 *
 * ## 三个参数各自的脾气
 *
 * - `β`（初始水量）决定长成什么样：低 → 稀疏的枝晶；高 → 厚实的片状。
 *   它是三个里唯一值得反复调的那个。
 * - `γ`（前沿吸水速度）控制生长快慢，也在低 β 时决定枝尖是否分叉。
 * - `α`（扩散系数）越大，水跑得越远、枝越细。
 *
 * ## ⚠️ 需要肉眼核对的地方
 *
 * `receptive` 的判定**必须用旧状态**（同步更新），而且不同实现里「先加 γ 还是
 * 先扩散」「冻结后还算不算邻居」有细微差别，会明显改变枝杈形态。
 * 这里取的是最常见的一套（Reiter 2005 的表述 + StackOverflow 上被广泛复现的那版）。
 * 单测能证明它确定、能长、单调不减；**长得像不像雪花只能靠眼睛**。
 *
 * 六角邻域用 offset 列（odd-q）：偶数列的邻居偏右上/右下，奇数列偏左上/左下。
 */

import { patternFromParam, stampCenteredInto } from './pattern-codec';
import { SnapshotRing } from './sim-util';
import type { GeneratorDef, SimHandle } from './types';

/** 冻结阈值。`s ≥ 1` 即成冰，之后不再变化。 */
const FREEZE_AT = 1;

export interface SnowState {
  s: Float32Array;
  /** 已成冰的格（不再演化）。 */
  frozen: Uint8Array;
  /** receptive：自身已成冰或**任一邻居**已成冰 —— 结晶前沿。 */
  near: Uint8Array;
}

const SNAPSHOT_OPTS = {
  every: 8,
  cap: 48,
  clone: (v: SnowState): SnowState => ({
    s: v.s.slice(),
    frozen: v.frozen.slice(),
    near: v.near.slice(),
  }),
};

export interface SnowRule {
  alpha: number;
  gamma: number;
}

/**
 * 一步（就地更新到 `next`）。返回值用于单测直接查内部浮点场。
 *
 * 必须**读旧写新**：就地把 `s[i] += γ` 写回去，后面的格子在算邻居均值时
 * 读到的就是已加过 γ 的值 —— 生长顺序会依赖遍历方向。
 */
export function snowStep(cur: SnowState, next: SnowState, n: number, rule: SnowRule): void {
  const { alpha, gamma } = rule;
  const half = alpha / 2;
  for (let x = 0; x < n; x++) {
    const odd = (x & 1) === 1;
    const xL = (x === 0 ? n - 1 : x - 1) | 0;
    const xR = (x === n - 1 ? 0 : x + 1) | 0;
    const xUp = odd ? x : xR;
    const xDn = odd ? xL : x;
    for (let y = 0; y < n; y++) {
      const i = y * n + x;
      if (cur.frozen[i]) {
        next.s[i] = FREEZE_AT;
        next.frozen[i] = 1;
        next.near[i] = 1;
        continue;
      }
      const yUp = y === 0 ? n - 1 : y - 1;
      const yDn = y === n - 1 ? 0 : y + 1;
      // 六个邻居（offset 列）
      const a = yUp * n + xUp;
      const b = yUp * n + xDn;
      const c = y * n + xL;
      const d = y * n + xR;
      const e = yDn * n + xUp;
      const f = yDn * n + xDn;
      const sum = cur.s[a]! + cur.s[b]! + cur.s[c]! + cur.s[d]! + cur.s[e]! + cur.s[f]!;
      const receptive =
        cur.s[i]! >= FREEZE_AT ||
        cur.s[a]! >= FREEZE_AT ||
        cur.s[b]! >= FREEZE_AT ||
        cur.s[c]! >= FREEZE_AT ||
        cur.s[d]! >= FREEZE_AT ||
        cur.s[e]! >= FREEZE_AT ||
        cur.s[f]! >= FREEZE_AT;
      let v: number;
      if (receptive) {
        v = cur.s[i]! + gamma;
      } else {
        v = cur.s[i]! + half * (sum / 6 - cur.s[i]!);
      }
      next.near[i] = receptive ? 1 : 0;
      if (v >= FREEZE_AT) {
        v = FREEZE_AT;
        next.frozen[i] = 1;
      } else {
        next.frozen[i] = 0;
      }
      next.s[i] = v;
    }
  }
}

export function createSnowflake(params: Record<string, number | string>): SimHandle {
  const n = Math.max(64, Math.min(512, Math.round(Number(params.size) || 320)));
  const stepsPerSec = Math.max(1, Number(params.rate) || 10);
  const rule: SnowRule = {
    alpha: Math.max(0, Number(params.alpha) || 1),
    gamma: Math.max(0, Number(params.gamma) || 0.01),
  };
  const beta = Math.max(0.05, Math.min(0.95, Number(params.beta) || 0.6));

  const cur: SnowState = {
    s: new Float32Array(n * n).fill(beta),
    frozen: new Uint8Array(n * n),
    near: new Uint8Array(n * n),
  };
  const next: SnowState = {
    s: new Float32Array(n * n),
    frozen: new Uint8Array(n * n),
    near: new Uint8Array(n * n),
  };

  // 单核（中心一格）或多核（手绘图案 —— 每个亮格都是一个核）
  const plantAt = (i: number): void => {
    cur.s[i] = FREEZE_AT;
    cur.frozen[i] = 1;
  };
  if (params.seedMode === 'pattern') {
    const bm = patternFromParam(params.pattern);
    if (bm) stampCenteredInto(n, n, bm, plantAt);
    else plantAt((n >> 1) * n + (n >> 1));
  } else {
    plantAt((n >> 1) * n + (n >> 1));
  }
  // `seed` 不参与：这个模型是纯确定性的（初值只有一个核）

  let frame = 0;
  const snapshots = new SnapshotRing<SnowState>(SNAPSHOT_OPTS, cur);
  const out = new Uint8Array(n * n);

  const stepTo = (target: number): void => {
    while (frame < target) {
      snowStep(cur, next, n, rule);
      // 交换（`snowStep` 写满每一格，交换安全）
      const ts = cur.s;
      const tf = cur.frozen;
      const tn = cur.near;
      cur.s = next.s;
      cur.frozen = next.frozen;
      cur.near = next.near;
      next.s = ts;
      next.frozen = tf;
      next.near = tn;
      frame++;
      if (snapshots.shouldStore(frame)) {
        // 快照要一份**独立副本**：cur 的三条数组下一轮就会被当成写入缓冲
        snapshots.store(frame, cur);
      }
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
        cur.s.set(snap.value.s);
        cur.frozen.set(snap.value.frozen);
        cur.near.set(snap.value.near);
        frame = snap.frame;
      }
      stepTo(target);
    },
    current(): Uint8Array {
      for (let i = 0; i < out.length; i++) {
        if (cur.frozen[i]) out[i] = 255; // 冰
        else if (cur.near[i]) out[i] = 170; // 结晶前沿
        else out[i] = Math.max(0, Math.min(120, Math.round(cur.s[i]! * 150))); // 过冷水
      }
      return out;
    },
  };
}

export const snowflakeDef: GeneratorDef = {
  id: 'snowflake',
  nameKey: 'algo.snowflake',
  kind: 'sim',
  volatile: ['rate', 'colorBg', 'colorLive'],
  params: [
    { key: 'size', labelKey: 'algo.snowflake.grid', type: 'range', min: 128, max: 512, step: 32, defaultValue: 320 },
    {
      key: 'beta',
      labelKey: 'algo.snowflake.beta',
      type: 'range',
      min: 0.1,
      max: 0.85,
      step: 0.01,
      defaultValue: 0.6,
    },
    { key: 'alpha', labelKey: 'algo.snowflake.alpha', type: 'range', min: 0.5, max: 1.5, step: 0.01, defaultValue: 1 },
    {
      key: 'gamma',
      labelKey: 'algo.snowflake.gamma',
      type: 'range',
      min: 0.0005,
      max: 0.02,
      step: 0.0005,
      defaultValue: 0.01,
    },
    {
      key: 'seedMode',
      labelKey: 'algo.snowflake.seedMode',
      type: 'select',
      defaultValue: 'single',
      options: [
        { labelKey: 'algo.snowflake.seedSingle', value: 'single' },
        { labelKey: 'algo.snowflake.seedPattern', value: 'pattern' },
      ],
    },
    {
      key: 'pattern',
      labelKey: 'algo.snowflake.pattern',
      type: 'pattern',
      defaultValue: '',
      editorSize: 32,
      mode: '2d',
      visibleWhen: (v) => v.seedMode === 'pattern',
    },
    { key: 'rate', labelKey: 'algo.snowflake.speed', type: 'range', min: 1, max: 60, step: 1, defaultValue: 10 },
    { key: 'colorBg', labelKey: 'algo.snowflake.colorBg', type: 'color', defaultValue: '#04121f' },
    { key: 'colorLive', labelKey: 'algo.snowflake.colorLive', type: 'color', defaultValue: '#dff3ff' },
  ],
  create: (params) => createSnowflake(params),
};
