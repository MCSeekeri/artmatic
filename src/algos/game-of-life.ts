/**
 * game-of-life.ts — 生命类元胞自动机（B/S 规则族 + 手绘种子），sim 型。
 *
 * 硬约束 1.3 的首次落地：
 *   - 固定步长推进（stepsPerSec，与渲染帧率解耦）；
 *   - 每隔 N=16 步写一次状态快照；
 *   - seek 时从最近的快照重放。
 * 初始态只由 seed + params 决定，所以 seek(f) ≡ 从 0 顺序 step f 次。
 *
 * 网格很小（默认 112²≈12.5k 细胞，一步 <1ms），seek 重放必须同步
 * 可用，放主线程——1.4 管的是每帧预算，这个量级进不了预算。
 *
 * 网格是 `width × height`（列 × 行）。协议本来就是两栏（`SimHandle.gridW/gridH`），
 * 方形只是早期实现里的硬编码；16:9 工程里方形网格会被 contain 成中间一块。
 * v16 之前存的工程只有一个 `size`，由 `core/schema.ts` 的迁移拆成两个相等的值。
 *
 * ## 扩展
 *
 * - `mask`：18 位 B/S 掩码（出生占低 9 位、存活占高 9 位，见 `core/bitmask`），
 *   于是 **Conway 只是这个族里的一个点** —— HighLife、Day&Night、Seeds、
 *   Maze、Coral、Replicator 都是同一个 step 函数换两个整数。
 * - `seedMode: 'pattern'`：初始态由用户手绘（居中裁剪盖印，不消耗 RNG）。
 * - `neighborhood`：Moore(8) / von Neumann(4)。
 * - `wrap`：环面 / 固定边界。
 * - `trail`：死亡细胞的余温衰减。`trail = 0` 时余温恒为 0，
 *   `current()` 的输出与扩展前**逐字节相同** —— 这条是回归底线。
 */

import { mulberry32 } from '../core/prng';
import { birthFromMask, masksFromBS, surviveFromMask } from '../core/bitmask';
import { patternFromParam, stampCentered } from './pattern-codec';
import { gridSizeOf } from './grid-dims';
import { SnapshotRing } from './sim-util';
import { LIVE } from './rule110';
import { bgColorVisible, bgModeParam } from './shader-lib';
import type { MessageKey } from '../i18n/locales';
import type { GeneratorDef, SimHandle } from './types';

/** 网格尺寸约束：与参数表里 `width` / `height` 的 min / max / default 同源。 */
const LIFE_GRID = { min: 64, max: 256, fallback: 112 } as const;

const SNAPSHOT_EVERY = 16;
/** 快照张数上限。超过就抽稀（见 `sim-util.SnapshotRing`），内存有硬上限。 */
const SNAPSHOT_CAP = 64;
const SNAPSHOT_OPTS = {
  every: SNAPSHOT_EVERY,
  cap: SNAPSHOT_CAP,
  clone: (v: { a: Uint8Array; h: Uint8Array }): { a: Uint8Array; h: Uint8Array } => ({
    a: v.a.slice(),
    h: v.h.slice(),
  }),
};

export interface LifeRule {
  /** 出生掩码：bit k = 「恰好 k 个活邻居时死细胞变活」。9 位。 */
  birth: number;
  /** 存活掩码：bit k = 「恰好 k 个活邻居时活细胞存活」。9 位。 */
  survive: number;
  /** 4 邻居（von Neumann）还是 8 邻居（Moore）。 */
  vonNeumann: boolean;
  /** 环面边界。 */
  wrap: boolean;
}

/** Conway 的掩码——`lifeStep()` 用它，于是「旧行为」有了一个唯一定义。 */
export const CONWAY_BIRTH = 1 << 3;
export const CONWAY_SURVIVE = (1 << 2) | (1 << 3);

export function lifeStepRule(cur: Uint8Array, w: number, h: number, cfg: LifeRule): Uint8Array {
  return cfg.wrap ? stepWrap(cur, w, h, cfg) : stepFixed(cur, w, h, cfg);
}

/** 环面边界。每格同时算 8 邻居与 4 邻居，再按配置取 —— 省掉一个分支分支。 */
function stepWrap(cur: Uint8Array, w: number, h: number, cfg: LifeRule): Uint8Array {
  const next = new Uint8Array(w * h);
  const { birth, survive, vonNeumann } = cfg;
  for (let y = 0; y < h; y++) {
    const yUp = (y === 0 ? h - 1 : y - 1) * w;
    const yDn = (y === h - 1 ? 0 : y + 1) * w;
    const yMid = y * w;
    for (let x = 0; x < w; x++) {
      const xL = x === 0 ? w - 1 : x - 1;
      const xR = x === w - 1 ? 0 : x + 1;
      const n8 =
        cur[yUp + xL]! + cur[yUp + x]! + cur[yUp + xR]! +
        cur[yMid + xL]! + cur[yMid + xR]! +
        cur[yDn + xL]! + cur[yDn + x]! + cur[yDn + xR]!;
      const a = cur[yMid + x]!;
      let k = n8;
      if (vonNeumann) k = cur[yUp + x]! + cur[yMid + xL]! + cur[yMid + xR]! + cur[yDn + x]!;
      next[yMid + x] = a ? (survive >> k) & 1 : (birth >> k) & 1;
    }
  }
  return next;
}

/** 固定边界：网格外一律视为死。 */
function stepFixed(cur: Uint8Array, w: number, h: number, cfg: LifeRule): Uint8Array {
  const next = new Uint8Array(w * h);
  const { birth, survive, vonNeumann } = cfg;
  for (let y = 0; y < h; y++) {
    const hasU = y > 0;
    const hasD = y < h - 1;
    const yUp = (y - 1) * w;
    const yDn = (y + 1) * w;
    const yMid = y * w;
    for (let x = 0; x < w; x++) {
      const hasL = x > 0;
      const hasR = x < w - 1;
      const a = cur[yMid + x]!;
      let k = 0;
      if (vonNeumann) {
        if (hasU) k += cur[yUp + x]!;
        if (hasL) k += cur[yMid + x - 1]!;
        if (hasR) k += cur[yMid + x + 1]!;
        if (hasD) k += cur[yDn + x]!;
      } else {
        if (hasU) {
          if (hasL) k += cur[yUp + x - 1]!;
          k += cur[yUp + x]!;
          if (hasR) k += cur[yUp + x + 1]!;
        }
        if (hasL) k += cur[yMid + x - 1]!;
        if (hasR) k += cur[yMid + x + 1]!;
        if (hasD) {
          if (hasL) k += cur[yDn + x - 1]!;
          k += cur[yDn + x]!;
          if (hasR) k += cur[yDn + x + 1]!;
        }
      }
      next[yMid + x] = a ? (survive >> k) & 1 : (birth >> k) & 1;
    }
  }
  return next;
}

/**
 * 旧签名（被 `tests/unit/algos.test.ts` 钉住）：Conway + Moore + 环面。
 * 与 `lifeStepRule(..., n, n, {birth: CONWAY_BIRTH, survive: CONWAY_SURVIVE, vonNeumann:false, wrap:true})`
 * 逐格等价（有单测钉着这条等价性）。
 */
export function lifeStep(cur: Uint8Array, n: number): Uint8Array {
  return stepWrap(cur, n, n, {
    birth: CONWAY_BIRTH,
    survive: CONWAY_SURVIVE,
    vonNeumann: false,
    wrap: true,
  });
}

/** `trail` 参数（0..1）→ 每步余温衰减量。40 步左右淡出，视觉上刚好是一条尾巴。 */
const TRAIL_MAX_DECAY = 40;

function initAlive(
  params: Record<string, number | string>,
  seed: number,
  w: number,
  h: number,
): Uint8Array {
  const g = new Uint8Array(w * h);
  if (params.seedMode === 'pattern') {
    const bm = patternFromParam(params.pattern);
    if (bm) {
      stampCentered(g, w, h, bm, 1);
      return g; // 手绘种子**不消耗 RNG**，所以画什么就是什么
    }
    // 图案串坏了（手改过工程文件）→ 退回落差最小的随机撒种，不报错、不空白
  }
  const density = Number(params.density) || 0.42;
  const rnd = mulberry32(seed);
  // 只在中间 3/5 区域撒种：贴边撒的群落会立刻撞上边界（环面下则是自我缠绕）。
  // 两轴各算各的，是因为网格现在可以不是正方形。
  const loX = Math.floor(w * 0.2);
  const hiX = Math.ceil(w * 0.8);
  const loY = Math.floor(h * 0.2);
  const hiY = Math.ceil(h * 0.8);
  for (let y = loY; y < hiY; y++) {
    for (let x = loX; x < hiX; x++) g[y * w + x] = rnd() < density ? 1 : 0;
  }
  return g;
}

export function createLife(params: Record<string, number | string>, seed: number): SimHandle {
  const { w, h } = gridSizeOf(params, LIFE_GRID);
  const total = w * h;
  const stepsPerSec = Number(params.rate) || 12;
  const rawMask = Number(params.mask ?? masksFromBS(CONWAY_BIRTH, CONWAY_SURVIVE));
  const mask = Number.isFinite(rawMask) ? rawMask : masksFromBS(CONWAY_BIRTH, CONWAY_SURVIVE);
  const cfg: LifeRule = {
    birth: birthFromMask(mask),
    survive: surviveFromMask(mask),
    vonNeumann: params.neighborhood === 'vonNeumann',
    wrap: Number(params.wrap ?? 1) !== 0,
  };
  const decay = Math.round(Math.max(0, Math.min(1, Number(params.trail) || 0)) * TRAIL_MAX_DECAY);

  const initial = initAlive(params, seed, w, h);
  let heat = new Uint8Array(total);

  let frame = 0;
  // TS 5.9 的泛型 TypedArray：显式标 Uint8Array（= ArrayBufferLike），
  // 否则 cur 被 infer 成 ArrayBuffer 版，step 的返回值赋不进来。
  let cur: Uint8Array = initial;
  // 快照存**内部精度**（0/1 的 cur 与余温），不是 `current()` 的 8-bit 输出 ——
  // 后者会把每一步的量化误差累积进重放路径。上限见 SnapshotRing。
  const snapshots = new SnapshotRing<{ a: Uint8Array; h: Uint8Array }>(
    SNAPSHOT_OPTS,
    { a: initial, h: heat },
  );

  const stepOnce = (): void => {
    const next = lifeStepRule(cur, w, h, cfg);
    if (decay > 0) {
      const nh = new Uint8Array(total);
      for (let i = 0; i < nh.length; i++) {
        nh[i] = next[i] ? LIVE : Math.max(0, heat[i]! - decay);
      }
      heat = nh;
    } else if (heat.some((v) => v !== 0)) {
      // trail 关掉时余温必须归零，否则「关掉拖尾」不会立刻生效。
      heat = new Uint8Array(total);
    }
    cur = next;
  };

  const stepTo = (target: number): void => {
    while (frame < target) {
      stepOnce();
      frame++;
      if (snapshots.shouldStore(frame)) snapshots.store(frame, { a: cur, h: heat });
    }
  };

  return {
    gridW: w,
    gridH: h,
    stepsPerSec,
    seek(simFrame: number): void {
      const target = Math.max(0, Math.floor(simFrame));
      if (target < frame) {
        // 回退：从 ≤ target 的最近快照重放
        const snap = snapshots.nearestAtOrBefore(target);
        cur = snap.value.a.slice();
        heat = snap.value.h.slice();
        frame = snap.frame;
      }
      stepTo(target);
    },
    current(): Uint8Array {
      const out = new Uint8Array(cur.length);
      if (decay > 0) {
        for (let i = 0; i < out.length; i++) out[i] = cur[i] ? LIVE : heat[i]!;
      } else {
        for (let i = 0; i < out.length; i++) out[i] = cur[i] ? LIVE : 0;
      }
      return out;
    },
  };
}

/** 把「计数集合」写成掩码，省得手算 6152 / 6216 这种魔数。 */
const bsMask = (b: readonly number[], s: readonly number[]): number =>
  masksFromBS(
    b.reduce((m, k) => m | (1 << k), 0),
    s.reduce((m, k) => m | (1 << k), 0),
  );

/** 生命类 CA 的著名规则。Conway 只是其中一个点。 */
const LIFE_RULES: { labelKey: MessageKey; value: number }[] = [
  { labelKey: 'algo.gol.ruleLife', value: bsMask([3], [2, 3]) },
  { labelKey: 'algo.gol.ruleHighLife', value: bsMask([3, 6], [2, 3]) },
  { labelKey: 'algo.gol.ruleDayNight', value: bsMask([3, 6, 7, 8], [3, 4, 6, 7, 8]) },
  { labelKey: 'algo.gol.ruleSeeds', value: bsMask([2], []) },
  { labelKey: 'algo.gol.ruleMaze', value: bsMask([3], [1, 2, 3, 4, 5]) },
  { labelKey: 'algo.gol.ruleCoral', value: bsMask([3], [4, 5, 6, 7, 8]) },
  { labelKey: 'algo.gol.ruleReplicator', value: bsMask([1, 3, 5, 7], [1, 3, 5, 7]) },
  { labelKey: 'algo.gol.rule2x2', value: bsMask([3, 6], [1, 2, 5]) },
];

export const gameOfLifeDef: GeneratorDef = {
  id: 'game-of-life',
  nameKey: 'algo.gameOfLife',
  kind: 'sim',
  // 速度与配色不参与 create() —— 改它们不该把跑了几百代的群落重建。
  volatile: ['rate', 'colorBg', 'colorLive', 'bgMode'],
  params: [
    { key: 'width', labelKey: 'algo.simGrid.width', type: 'range', min: 64, max: 256, step: 16, defaultValue: 112 },
    { key: 'height', labelKey: 'algo.simGrid.height', type: 'range', min: 64, max: 256, step: 16, defaultValue: 112 },
    {
      key: 'mask',
      labelKey: 'algo.gameOfLife.rules',
      type: 'bitmask',
      bits: 18,
      defaultValue: masksFromBS(CONWAY_BIRTH, CONWAY_SURVIVE),
      groups: [
        { labelKey: 'algo.gol.birth', bits: 9, style: 'count' },
        { labelKey: 'algo.gol.survive', bits: 9, style: 'count' },
      ],
      presets: LIFE_RULES,
    },
    {
      key: 'seedMode',
      labelKey: 'algo.gameOfLife.seedMode',
      type: 'select',
      defaultValue: 'random',
      options: [
        { labelKey: 'algo.gameOfLife.seedRandom', value: 'random' },
        { labelKey: 'algo.gameOfLife.seedPattern', value: 'pattern' },
      ],
    },
    {
      key: 'pattern',
      labelKey: 'algo.gameOfLife.pattern',
      type: 'pattern',
      defaultValue: '',
      editorSize: 32,
      mode: '2d',
      visibleWhen: (v) => v.seedMode === 'pattern',
    },
    {
      key: 'density',
      labelKey: 'algo.gameOfLife.density',
      type: 'range',
      min: 0.1,
      max: 0.8,
      step: 0.01,
      defaultValue: 0.42,
      visibleWhen: (v) => v.seedMode !== 'pattern',
    },
    {
      key: 'neighborhood',
      labelKey: 'algo.gameOfLife.neighborhood',
      type: 'select',
      defaultValue: 'moore',
      options: [
        { labelKey: 'algo.gameOfLife.moore', value: 'moore' },
        { labelKey: 'algo.gameOfLife.vonNeumann', value: 'vonNeumann' },
      ],
    },
    { key: 'wrap', labelKey: 'algo.gameOfLife.wrap', type: 'checkbox', defaultValue: 1 },
    { key: 'trail', labelKey: 'algo.gameOfLife.trail', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
    { key: 'rate', labelKey: 'algo.gameOfLife.speed', type: 'range', min: 1, max: 60, step: 1, defaultValue: 12 },
    {
      key: 'colorBg',
      labelKey: 'algo.gameOfLife.colorBg',
      type: 'color',
      defaultValue: '#050a08',
      visibleWhen: bgColorVisible,
    },
    { key: 'colorLive', labelKey: 'algo.gameOfLife.colorLive', type: 'color', defaultValue: '#8affc1' },
    bgModeParam(),
  ],
  create: createLife,
};
