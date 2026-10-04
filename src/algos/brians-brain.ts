/**
 * brians-brain.ts — Brian's Brain，三态元胞自动机，`sim` 型。
 *
 * 规则只有三行：
 *   ready(0)       → 恰好 **2** 个 Moore 邻居是 firing 时变成 firing
 *   firing(1)      → 无条件变成 refractory
 *   refractory(2)  → 无条件变回 ready
 *
 * 「三态 + 一个强制冷却期」让它长出别处没有的东西：向外扩张的**脉冲波前**，
 * 而波前后面留不下一片稳定的活细胞 —— 于是画面永远在动，永远不会安定下来。
 * 生命游戏会收敛成静物与振荡子，它不会。
 *
 * 三态的取值直接写进 R8 纹理（`0 / 255 / 128`），于是**共享的那条双色调
 * tint 就够用** —— firing 是亮色、refractory 是半亮、ready 是底色。
 * 不需要自定义着色，也就没有需要派发的私有 uniform。
 *
 * 网格 256² 默认、单步约 0.3–0.8 ms（纯整数加法），所以速度可以给到 120 步/秒。
 */

import { mulberry32 } from '../core/prng';
import { patternFromParam, stampCentered } from './pattern-codec';
import { SnapshotRing } from './sim-util';
import type { GeneratorDef, SimHandle } from './types';

export const BB_READY = 0;
export const BB_FIRING = 1;
export const BB_REFRACTORY = 2;

/** 三态 → R8 字节。共享 tint 把「亮 = 活」映射到 colorLive，够用。 */
const BB_BYTE = [0, 255, 128];

const SNAPSHOT_OPTS = {
  every: 16,
  cap: 64,
  clone: (v: Uint8Array): Uint8Array => v.slice(),
};

/** 一步（环面）。纯函数，单测直接打。 */
export function briansStep(cur: Uint8Array, n: number): Uint8Array {
  const next = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    const yU = (y === 0 ? n - 1 : y - 1) * n;
    const yD = (y === n - 1 ? 0 : y + 1) * n;
    const yM = y * n;
    for (let x = 0; x < n; x++) {
      const xL = x === 0 ? n - 1 : x - 1;
      const xR = x === n - 1 ? 0 : x + 1;
      const s = cur[yM + x]!;
      if (s === BB_FIRING) {
        next[yM + x] = BB_REFRACTORY;
        continue;
      }
      if (s === BB_REFRACTORY) {
        next[yM + x] = BB_READY;
        continue;
      }
      const f =
        (cur[yU + xL] === BB_FIRING ? 1 : 0) +
        (cur[yU + x] === BB_FIRING ? 1 : 0) +
        (cur[yU + xR] === BB_FIRING ? 1 : 0) +
        (cur[yM + xL] === BB_FIRING ? 1 : 0) +
        (cur[yM + xR] === BB_FIRING ? 1 : 0) +
        (cur[yD + xL] === BB_FIRING ? 1 : 0) +
        (cur[yD + x] === BB_FIRING ? 1 : 0) +
        (cur[yD + xR] === BB_FIRING ? 1 : 0);
      next[yM + x] = f === 2 ? BB_FIRING : BB_READY;
    }
  }
  return next;
}

export function createBriansBrain(
  params: Record<string, number | string>,
  seed: number,
): SimHandle {
  const n = Math.max(32, Math.min(512, Math.round(Number(params.size) || 256)));
  const stepsPerSec = Math.max(1, Number(params.rate) || 30);

  // TS 5.9 的泛型 TypedArray：显式标 Uint8Array（= ArrayBufferLike），
  // 否则 cur 被 infer 成 ArrayBuffer 版，briansStep 的返回值赋不进来。
  let cur: Uint8Array = new Uint8Array(n * n);
  if (params.seedMode === 'pattern') {
    const bm = patternFromParam(params.pattern);
    if (bm) stampCentered(cur, n, n, bm, BB_FIRING);
    else seedRandom(cur, n, seed, Number(params.density) || 0.15);
  } else {
    seedRandom(cur, n, seed, Number(params.density) || 0.15);
  }

  let frame = 0;
  const snapshots = new SnapshotRing<Uint8Array>(SNAPSHOT_OPTS, cur);
  const out = new Uint8Array(n * n);

  const stepTo = (target: number): void => {
    while (frame < target) {
      cur = briansStep(cur, n);
      frame++;
      if (snapshots.shouldStore(frame)) snapshots.store(frame, cur);
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
        cur = snap.value.slice();
        frame = snap.frame;
      }
      stepTo(target);
    },
    current(): Uint8Array {
      for (let i = 0; i < out.length; i++) out[i] = BB_BYTE[cur[i]!]!;
      return out;
    },
  };
}

/** 撒种密度默认 0.15：太密会立刻烧成一整片同步波，太稀则第一代就熄。 */
function seedRandom(g: Uint8Array, n: number, seed: number, density: number): void {
  const rnd = mulberry32(seed);
  const d = Math.max(0, Math.min(1, density));
  for (let i = 0; i < n * n; i++) g[i] = rnd() < d ? BB_FIRING : BB_READY;
}

export const briansBrainDef: GeneratorDef = {
  id: 'brians-brain',
  nameKey: 'algo.briansBrain',
  kind: 'sim',
  volatile: ['rate', 'colorBg', 'colorLive'],
  params: [
    { key: 'size', labelKey: 'algo.briansBrain.grid', type: 'range', min: 64, max: 512, step: 32, defaultValue: 256 },
    {
      key: 'seedMode',
      labelKey: 'algo.briansBrain.seedMode',
      type: 'select',
      defaultValue: 'random',
      options: [
        { labelKey: 'algo.briansBrain.seedRandom', value: 'random' },
        { labelKey: 'algo.briansBrain.seedPattern', value: 'pattern' },
      ],
    },
    {
      key: 'pattern',
      labelKey: 'algo.briansBrain.pattern',
      type: 'pattern',
      defaultValue: '',
      editorSize: 32,
      mode: '2d',
      visibleWhen: (v) => v.seedMode === 'pattern',
    },
    {
      key: 'density',
      labelKey: 'algo.briansBrain.density',
      type: 'range',
      min: 0.02,
      max: 0.6,
      step: 0.01,
      defaultValue: 0.15,
      visibleWhen: (v) => v.seedMode !== 'pattern',
    },
    { key: 'rate', labelKey: 'algo.briansBrain.speed', type: 'range', min: 2, max: 120, step: 1, defaultValue: 30 },
    { key: 'colorBg', labelKey: 'algo.briansBrain.colorBg', type: 'color', defaultValue: '#050a12' },
    { key: 'colorLive', labelKey: 'algo.briansBrain.colorLive', type: 'color', defaultValue: '#6fe3ff' },
  ],
  create: createBriansBrain,
};
