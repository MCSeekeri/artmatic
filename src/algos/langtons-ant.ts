/**
 * langtons-ant.ts — Langton 蚂蚁，sim 型。
 *
 * 移植自 angel-echo `js/automata.js::langtonsAnt()`（同作者内部移植，见 CREDITS.md），
 * 但**换了类型**：上游把 96 个步数快照烘成一张图集（供 `mathfield` 取格播放），
 * 因为它的架构里着色器不能写自己要读的纹理。artmatic 本来就有 `sim` 型
 * —— 固定步长推进 + 快照 + seek 重放（硬约束 1.3），生命游戏就是这么做的。
 * 蚂蚁与生命游戏是**同一类东西**（有状态、不可并行、但单步极便宜），
 * 所以直接用它，不需要图集，也不需要补「图集采样器」这个引擎件。
 *
 * 三条规则、一个无限大的方格，以及大约第 10000 步之后从混沌里长出来的
 * 那条「高速公路」—— 这是它值得存在的全部理由。
 *
 * 确定性：起点居中、朝向固定、**没有任何随机**，所以 `seed` 不参与。
 * 网格是环面（`% size`）—— 上游如此，让蚂蚁走到底也不丢。
 *
 * 性能：一步是两三次数组读写，10 万步是毫秒级。所以快照间隔取得很稀
 * （16384 步），回退重放最坏也就 1.6 万步。
 */

import { LIVE } from './rule110';
import type { GeneratorDef, SimHandle } from './types';

/** 每多少步写一次状态快照。稀一点没关系 —— 单步太便宜了。 */
const SNAPSHOT_EVERY = 16_384;

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

interface AntState {
  grid: Uint8Array;
  x: number;
  y: number;
  dir: number;
}

export function createAnt(params: Record<string, number | string>): SimHandle {
  const size = Math.max(32, Math.round(Number(params.size) || 384));
  const stepsPerSec = Math.max(1, Number(params.rate) || 400);
  const total = size * size;

  const grid = new Uint8Array(total);
  let x = size >> 1;
  let y = size >> 1;
  let dir = 0;
  let step = 0;

  const snapshots = new Map<number, AntState>();
  snapshots.set(0, { grid: grid.slice(), x, y, dir });

  const advance = (target: number): void => {
    while (step < target) {
      const i = y * size + x;
      if (grid[i]) {
        // 白格：右转
        dir = (dir + 3) & 3;
        grid[i] = 0;
      } else {
        // 黑格：左转
        dir = (dir + 1) & 3;
        grid[i] = 1;
      }
      x = (x + DX[dir]! + size) % size;
      y = (y + DY[dir]! + size) % size;
      step++;
      if (step % SNAPSHOT_EVERY === 0) {
        snapshots.set(step, { grid: grid.slice(), x, y, dir });
      }
    }
  };

  return {
    gridW: size,
    gridH: size,
    stepsPerSec,
    seek(simFrame: number): void {
      const target = Math.max(0, Math.floor(simFrame));
      if (target < step) {
        // 回退：找 ≤ target 的最近快照，从它重放（并丢掉它之后的快照）
        let best = 0;
        for (const k of snapshots.keys()) if (k <= target && k > best) best = k;
        const s = snapshots.get(best)!;
        grid.set(s.grid);
        x = s.x;
        y = s.y;
        dir = s.dir;
        step = best;
        for (const k of [...snapshots.keys()]) if (k > best) snapshots.delete(k);
      }
      advance(target);
    },
    current(): Uint8Array {
      const out = new Uint8Array(total);
      for (let i = 0; i < total; i++) if (grid[i]) out[i] = LIVE;
      return out;
    },
  };
}

export const langtonsAntDef: GeneratorDef = {
  id: 'langtons-ant',
  nameKey: 'algo.langtonsAnt',
  kind: 'sim',
  params: [
    { key: 'size', labelKey: 'algo.langtonsAnt.grid', type: 'range', min: 96, max: 768, step: 32, defaultValue: 384 },
    { key: 'rate', labelKey: 'algo.langtonsAnt.speed', type: 'range', min: 10, max: 4000, step: 10, defaultValue: 400 },
    { key: 'colorBg', labelKey: 'algo.langtonsAnt.colorBg', type: 'color', defaultValue: '#06070d' },
    { key: 'colorLive', labelKey: 'algo.langtonsAnt.colorLive', type: 'color', defaultValue: '#c9a2ff' },
  ],
  create: (params) => createAnt(params),
};
