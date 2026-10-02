/**
 * game-of-life.ts — Conway 生命游戏，sim 型（有状态模拟）。
 *
 * 硬约束 1.3 的首次落地：
 *   - 固定步长推进（stepsPerSec，与渲染帧率解耦）；
 *   - 每隔 N=16 步写一次状态快照；
 *   - seek 时从最近的快照重放。
 * 初始态只由 seed + params 决定，所以 seek(f) ≡ 从 0 顺序 step f 次。
 *
 * lifeStep 移植自 angel-echo js/automata.js（环面边界、中间 3/5 区域
 * 撒种、密度略高于临界——群落能活几百代而不是五十代内死成静物）。
 * 网格很小（默认 112²≈12.5k 细胞，一步 <1ms），seek 重放必须同步
 * 可用，放主线程——1.4 管的是每帧预算，这个量级进不了预算。
 */

import { mulberry32 } from '../core/prng';
import { LIVE } from './rule110';
import type { GeneratorDef, SimHandle } from './types';

const SNAPSHOT_EVERY = 16;

export function lifeStep(cur: Uint8Array, n: number): Uint8Array {
  const next = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    const yUp = (y === 0 ? n - 1 : y - 1) * n;
    const yDn = (y === n - 1 ? 0 : y + 1) * n;
    const yMid = y * n;
    for (let x = 0; x < n; x++) {
      const xL = x === 0 ? n - 1 : x - 1;
      const xR = x === n - 1 ? 0 : x + 1;
      const k =
        cur[yUp + xL]! + cur[yUp + x]! + cur[yUp + xR]! +
        cur[yMid + xL]! + cur[yMid + xR]! +
        cur[yDn + xL]! + cur[yDn + x]! + cur[yDn + xR]!;
      const a = cur[yMid + x]!;
      next[yMid + x] = a ? (k === 2 || k === 3 ? 1 : 0) : k === 3 ? 1 : 0;
    }
  }
  return next;
}

export function createLife(params: Record<string, number | string>, seed: number): SimHandle {
  const n = Math.round(Number(params.size) || 112);
  const density = Number(params.density) || 0.42;
  const stepsPerSec = Number(params.rate) || 12;

  const initial = (() => {
    const rnd = mulberry32(seed);
    const g = new Uint8Array(n * n);
    const lo = Math.floor(n * 0.2);
    const hi = Math.ceil(n * 0.8);
    for (let y = lo; y < hi; y++) {
      for (let x = lo; x < hi; x++) g[y * n + x] = rnd() < density ? 1 : 0;
    }
    return g;
  })();

  let frame = 0;
  // TS 5.9 的泛型 TypedArray：显式标 Uint8Array（= ArrayBufferLike），
  // 否则 cur 被 infer 成 ArrayBuffer 版，lifeStep 的返回值赋不进来。
  let cur: Uint8Array = initial;
  const snapshots = new Map<number, Uint8Array>([[0, initial.slice()]]);

  const toLive = (g: Uint8Array): Uint8Array => {
    const out = new Uint8Array(g.length);
    for (let i = 0; i < g.length; i++) if (g[i]) out[i] = LIVE;
    return out;
  };

  const stepTo = (target: number): void => {
    while (frame < target) {
      cur = lifeStep(cur, n);
      frame++;
      if (frame % SNAPSHOT_EVERY === 0) snapshots.set(frame, cur.slice());
    }
  };

  return {
    gridW: n,
    gridH: n,
    stepsPerSec,
    seek(simFrame: number): void {
      const target = Math.max(0, Math.floor(simFrame));
      if (target < frame) {
        // 回退：找 ≤ target 的最近快照重放
        let best = 0;
        for (const k of snapshots.keys()) if (k <= target && k > best) best = k;
        cur = snapshots.get(best)!.slice();
        frame = best;
      }
      stepTo(target);
    },
    current(): Uint8Array {
      return toLive(cur);
    },
  };
}

export const gameOfLifeDef: GeneratorDef = {
  id: 'game-of-life',
  nameKey: 'algo.gameOfLife',
  kind: 'sim',
  params: [
    { key: 'size', labelKey: 'algo.gameOfLife.grid', type: 'range', min: 64, max: 256, step: 16, defaultValue: 112 },
    { key: 'density', labelKey: 'algo.gameOfLife.density', type: 'range', min: 0.1, max: 0.8, step: 0.01, defaultValue: 0.42 },
    { key: 'rate', labelKey: 'algo.gameOfLife.speed', type: 'range', min: 1, max: 60, step: 1, defaultValue: 12 },
    { key: 'colorBg', labelKey: 'algo.gameOfLife.colorBg', type: 'color', defaultValue: '#050a08' },
    { key: 'colorLive', labelKey: 'algo.gameOfLife.colorLive', type: 'color', defaultValue: '#8affc1' },
  ],
  create: createLife,
};
