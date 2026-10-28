/**
 * langtons-ant.ts — Langton 蚂蚁与它的「turmite」家族，sim 型。
 *
 * 移植自 angel-echo `js/automata.js::langtonsAnt()`（同作者内部移植，见 CREDITS.md），
 * 但**换了类型**：上游把 96 个步数快照烘成一张图集（供 `mathfield` 取格播放），
 * 因为它的架构里着色器不能写自己要读的纹理。artmatic 本来就有 `sim` 型
 * —— 固定步长推进 + 快照 + seek 重放（硬约束 1.3），生命游戏就是这么做的。
 *
 * 三条规则、一个无限大的方格，以及大约第 10000 步之后从混沌里长出来的
 * 那条「高速公路」—— 这是它值得存在的全部理由。
 *
 * ## 扩展：从「一只蚂蚁一条规则」到 turmite 家族
 *
 * 经典蚂蚁是 turmite 的一个特例：**规则字符串的第 i 个字符描述「踩到颜色 i 时怎么转」**
 * （R = 右转 90°，L = 左转 90°，N = 直行，U = 掉头），转完把该格颜色 +1（模状态数）
 * 再前进一格。`'RL'`（白右转、黑左转）就是 Langton 1970 年代那条。
 *
 * 换成 `'RRLL'` 或 `'RRLLLRLLLRRR'` 会得到完全不同的高速公路与对称性 ——
 * 三条规则、一个无限大方格的全部戏剧性都在这里，所以把规则本身变成参数
 * 是这个生成器最划算的一次扩展。
 *
 * 确定性：起点与朝向由 `startMode` 决定，只有 `random` 用种子；
 * `seed` 不参与其余模式 —— 于是同参数同种子在任何机器上一致。
 * 网格默认环面（`% size`），关掉时撞边界会掉头（而不是卡死）。
 */

import { mulberry32 } from '../core/prng';
import { gridSizeOf } from './grid-dims';
import { SnapshotRing } from './sim-util';
import { LIVE } from './rule110';
import { bgColorVisible, bgModeParam } from './shader-lib';
import type { GeneratorDef, SimHandle } from './types';

/** 网格尺寸约束：与参数表里 `width` / `height` 的 min / max / default 同源。 */
const ANT_GRID = { min: 32, max: 768, fallback: 384 } as const;

/** 每多少步写一次状态快照。稀一点没关系 —— 单步太便宜了。 */
const SNAPSHOT_EVERY = 16_384;
/** 张数上限。超过就抽稀（`sim-util.SnapshotRing`）。 */
const SNAPSHOT_OPTS = {
  every: SNAPSHOT_EVERY,
  cap: 32,
  clone: (v: AntState): AntState => ({
    grid: v.grid.slice(),
    ants: v.ants.map((a) => ({ ...a })),
  }),
};

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export interface TurmiteAnt {
  x: number;
  y: number;
  dir: number;
}

interface AntState {
  grid: Uint8Array;
  ants: TurmiteAnt[];
}

/**
 * 规则串 → 每个状态对应的转向增量（0=直行 / 1=右转 / 2=掉头 / 3=左转）。
 *
 * 容错：只认 `RLNU`（大小写不敏感），其余字符忽略；解析结果不足 2 个状态时
 * 退回 `'RL'`。规则串会经 `project.json` 往返，必须经得起手改。
 */
export function parseTurmite(rule: string): number[] {
  const deltas: number[] = [];
  for (const ch of rule) {
    switch (ch.toUpperCase()) {
      case 'R':
        deltas.push(1);
        break;
      case 'L':
        deltas.push(3);
        break;
      case 'N':
        deltas.push(0);
        break;
      case 'U':
        deltas.push(2);
        break;
      default:
        break;
    }
    if (deltas.length >= 12) break;
  }
  return deltas.length >= 2 ? deltas : [1, 3];
}

/** 颜色值（0..states-1）映射到 0..255。两态时就是原来的 0/255。 */
function cellValue(v: number, states: number): number {
  if (states <= 1) return 0;
  return Math.round((v * 255) / (states - 1));
}

export function createAnt(params: Record<string, number | string>, seed = 1): SimHandle {
  const { w, h } = gridSizeOf(params, ANT_GRID);
  const stepsPerSec = Math.max(1, Number(params.rate) || 400);
  const total = w * h;
  const rule = parseTurmite(String(params.variant ?? 'RL'));
  const states = rule.length;
  const wrap = Number(params.wrap ?? 1) !== 0;
  const antCount = Math.max(1, Math.min(4, Math.round(Number(params.count) || 1)));
  const startMode = String(params.startMode ?? 'center');

  const grid = new Uint8Array(total);
  const ants: TurmiteAnt[] = [];
  {
    const rnd = mulberry32(seed);
    const midX = w >> 1;
    const midY = h >> 1;
    if (startMode === 'random') {
      for (let i = 0; i < antCount; i++) {
        ants.push({
          x: Math.floor(rnd() * w),
          y: Math.floor(rnd() * h),
          dir: Math.floor(rnd() * 4) & 3,
        });
      }
    } else if (startMode === 'corner') {
      // 角起手：四只蚂蚁绕成一圈，看不出「中心爆开」那套对称
      const qx = Math.max(2, Math.floor(w / 4));
      const qy = Math.max(2, Math.floor(h / 4));
      const spots: [number, number][] = [
        [qx, qy],
        [w - 1 - qx, qy],
        [w - 1 - qx, h - 1 - qy],
        [qx, h - 1 - qy],
      ];
      for (let i = 0; i < antCount; i++) {
        const [x, y] = spots[i % 4]!;
        ants.push({ x, y, dir: i & 3 });
      }
    } else if (antCount === 1) {
      ants.push({ x: midX, y: midY, dir: 0 });
    } else if (antCount === 2) {
      // 两只隔开一段距离，但别把其中一只推出边界（窄网格上 4 格就会）
      const gap = Math.max(1, Math.min(4, midX >> 1));
      ants.push({ x: Math.max(0, midX - gap), y: midY, dir: 1 });
      ants.push({ x: Math.min(w - 1, midX + gap), y: midY, dir: 3 });
    } else {
      // 4 只：四象限、四个朝向 —— 环面下会长出四重旋转对称的图案
      const qx = w >> 2;
      const qy = h >> 2;
      ants.push({ x: midX - qx, y: midY - qy, dir: 0 });
      ants.push({ x: midX + qx, y: midY - qy, dir: 1 });
      ants.push({ x: midX + qx, y: midY + qy, dir: 2 });
      ants.push({ x: midX - qx, y: midY + qy, dir: 3 });
    }
  }

  let step = 0;
  // 存**内部状态**（网格 0..states-1 与蚂蚁位置），不是 `current()` 的 8-bit 输出。
  const snapshots = new SnapshotRing<AntState>(SNAPSHOT_OPTS, { grid, ants });

  const advance = (target: number): void => {
    while (step < target) {
      for (const ant of ants) {
        const i = ant.y * w + ant.x;
        const c = grid[i]!;
        ant.dir = (ant.dir + rule[c]!) & 3;
        grid[i] = (c + 1) % states;
        const nx = ant.x + DX[ant.dir]!;
        const ny = ant.y + DY[ant.dir]!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          if (wrap) {
            ant.x = (nx + w) % w;
            ant.y = (ny + h) % h;
          } else {
            // 固定边界：掉头而不是原地卡住（后者会让蚂蚁永远停在一个格子上）
            ant.dir = (ant.dir + 2) & 3;
          }
        } else {
          ant.x = nx;
          ant.y = ny;
        }
      }
      step++;
      if (snapshots.shouldStore(step)) snapshots.store(step, { grid, ants });
    }
  };

  return {
    gridW: w,
    gridH: h,
    stepsPerSec,
    seek(simFrame: number): void {
      const target = Math.max(0, Math.floor(simFrame));
      if (target < step) {
        // 回退：从 ≤ target 的最近快照重放。
        // 刻意**不丢弃** target 之后的快照 —— step 是确定性的，同一帧的旧快照与
        // 重算出来的状态逐位相同，留着还能省一次重放。
        const snap = snapshots.nearestAtOrBefore(target);
        grid.set(snap.value.grid);
        for (let i = 0; i < ants.length; i++) {
          const a = snap.value.ants[i]!;
          ants[i]!.x = a.x;
          ants[i]!.y = a.y;
          ants[i]!.dir = a.dir;
        }
        step = snap.frame;
      }
      advance(target);
    },
    current(): Uint8Array {
      const out = new Uint8Array(total);
      for (let i = 0; i < total; i++) {
        const v = grid[i]!;
        if (v) out[i] = cellValue(v, states);
      }
      return out;
    },
  };
}

/** turmite 规则串就是选项的值 —— 它本身就是最短的那个说明。 */
const TURMITE_VARIANTS = [
  { labelKey: 'algo.langtonsAnt.vRL', value: 'RL' },
  { labelKey: 'algo.langtonsAnt.vRRLL', value: 'RRLL' },
  { labelKey: 'algo.langtonsAnt.vRLR', value: 'RLR' },
  { labelKey: 'algo.langtonsAnt.vLRRR', value: 'LRRR' },
  { labelKey: 'algo.langtonsAnt.vLLRR', value: 'LLRR' },
  { labelKey: 'algo.langtonsAnt.vRLRR', value: 'RLRR' },
  { labelKey: 'algo.langtonsAnt.vRLLR', value: 'RLLR' },
  { labelKey: 'algo.langtonsAnt.vLong', value: 'RRLLLRLLLRRR' },
] as const;

export const langtonsAntDef: GeneratorDef = {
  id: 'langtons-ant',
  nameKey: 'algo.langtonsAnt',
  kind: 'sim',
  volatile: ['rate', 'colorBg', 'colorLive', 'bgMode'],
  params: [
    {
      key: 'variant',
      labelKey: 'algo.langtonsAnt.variant',
      type: 'select',
      defaultValue: 'RL',
      options: TURMITE_VARIANTS.map((v) => ({ labelKey: v.labelKey, value: v.value })),
    },
    { key: 'width', labelKey: 'algo.simGrid.width', type: 'range', min: 32, max: 768, step: 32, defaultValue: 384 },
    { key: 'height', labelKey: 'algo.simGrid.height', type: 'range', min: 32, max: 768, step: 32, defaultValue: 384 },
    {
      key: 'startMode',
      labelKey: 'algo.langtonsAnt.startMode',
      type: 'select',
      defaultValue: 'center',
      options: [
        { labelKey: 'algo.langtonsAnt.startCenter', value: 'center' },
        { labelKey: 'algo.langtonsAnt.startCorner', value: 'corner' },
        { labelKey: 'algo.langtonsAnt.startRandom', value: 'random' },
      ],
    },
    {
      key: 'count',
      labelKey: 'algo.langtonsAnt.count',
      type: 'select',
      defaultValue: '1',
      options: [
        { labelKey: 'algo.langtonsAnt.count1', value: '1' },
        { labelKey: 'algo.langtonsAnt.count2', value: '2' },
        { labelKey: 'algo.langtonsAnt.count4', value: '4' },
      ],
    },
    { key: 'wrap', labelKey: 'algo.langtonsAnt.wrap', type: 'checkbox', defaultValue: 1 },
    { key: 'rate', labelKey: 'algo.langtonsAnt.speed', type: 'range', min: 10, max: 4000, step: 10, defaultValue: 400 },
    {
      key: 'colorBg',
      labelKey: 'algo.langtonsAnt.colorBg',
      type: 'color',
      defaultValue: '#06070d',
      visibleWhen: bgColorVisible,
    },
    { key: 'colorLive', labelKey: 'algo.langtonsAnt.colorLive', type: 'color', defaultValue: '#c9a2ff' },
    bgModeParam(),
  ],
  create: (params, seed) => createAnt(params, seed),
};
