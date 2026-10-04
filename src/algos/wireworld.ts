/**
 * wireworld.ts — Wireworld，四态元胞自动机，`sim` 型。
 *
 * 四个状态，三条规则：
 *
 * ```
 * head(2)  → tail(3)                        电子头必然变成尾巴
 * tail(3)  → conductor(1)                   尾巴必然恢复成导线
 * conductor(1) → head(2)   当 Moore 邻居里**恰好 1 或 2 个**是 head
 * empty(0) → empty(0)
 * ```
 *
 * 它是元胞自动机里少数**直接模拟数字逻辑**的一个 —— 导线、二极管、时钟、
 * 甚至完整的计算机都有人搭过。用它当生成器，画面里跑的是**电子**，
 * 而不是抽象的纹理。
 *
 * ## 为什么默认种子是「环形轨道」而不是随机
 *
 * **随机导线一点意思都没有**：撒一把随机的导体格，电子要么立刻熄、要么原地
 * 抖几下就停 —— 随机结构里不存在「能导通的路」，而 Wireworld 的全部戏剧性
 * 就在于电子沿着**人铺的路**跑。所以：
 *
 * - 默认 `ring`：一条闭合的环形导线 + 一个电子。它会永远绕着跑 ——
 *   这是保证有画面、且一眼看懂「这是 Wireworld」的最小结构。
 * - `pattern`：自己用图案编辑器画电路（这正是 Wave 1 那个编辑器的用武之地）。
 *
 * 三态以上的取值同样编码进 R8（`0 / 64 / 255 / 128`），共享的双色调 tint 够用。
 */

import { patternFromParam, stampCentered } from './pattern-codec';
import { SnapshotRing } from './sim-util';
import type { GeneratorDef, SimHandle } from './types';

export const WW_EMPTY = 0;
export const WW_CONDUCTOR = 1;
export const WW_HEAD = 2;
export const WW_TAIL = 3;

/** 四态 → R8。共享 tint 把亮 = head、半亮 = tail、暗 = 导线、黑 = 空。 */
const WW_BYTE = [0, 64, 255, 128];

const SNAPSHOT_OPTS = {
  every: 16,
  cap: 64,
  clone: (v: Uint8Array): Uint8Array => v.slice(),
};

export function wireworldStep(cur: Uint8Array, n: number): Uint8Array {
  const next = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    const yU = (y === 0 ? n - 1 : y - 1) * n;
    const yD = (y === n - 1 ? 0 : y + 1) * n;
    const yM = y * n;
    for (let x = 0; x < n; x++) {
      const xL = x === 0 ? n - 1 : x - 1;
      const xR = x === n - 1 ? 0 : x + 1;
      const s = cur[yM + x]!;
      if (s === WW_HEAD) {
        next[yM + x] = WW_TAIL;
        continue;
      }
      if (s === WW_TAIL) {
        next[yM + x] = WW_CONDUCTOR;
        continue;
      }
      if (s === WW_EMPTY) continue; // 空恒空
      const heads =
        (cur[yU + xL] === WW_HEAD ? 1 : 0) +
        (cur[yU + x] === WW_HEAD ? 1 : 0) +
        (cur[yU + xR] === WW_HEAD ? 1 : 0) +
        (cur[yM + xL] === WW_HEAD ? 1 : 0) +
        (cur[yM + xR] === WW_HEAD ? 1 : 0) +
        (cur[yD + xL] === WW_HEAD ? 1 : 0) +
        (cur[yD + x] === WW_HEAD ? 1 : 0) +
        (cur[yD + xR] === WW_HEAD ? 1 : 0);
      next[yM + x] = heads === 1 || heads === 2 ? WW_HEAD : WW_CONDUCTOR;
    }
  }
  return next;
}

/**
 * 环形导线 + 一个电子。半径按网格走，保证在任何 size 下都能跑。
 *
 * 环上放**一个** head 与紧跟其后的一个 tail：head 前进时会把下一个导体格
 * 变成 head（它恰好只有 1 个 head 邻居），于是电子绕着环永远跑下去。
 */
export function seedRing(g: Uint8Array, n: number): void {
  const r = Math.max(4, Math.round(n * 0.28));
  const c = (n - 1) / 2;
  const band = 1.0;
  let firstIdx = -1;
  let secondIdx = -1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > r - band && d < r + band) {
        const i = y * n + x;
        g[i] = WW_CONDUCTOR;
        if (firstIdx < 0) firstIdx = i;
        else if (secondIdx < 0) secondIdx = i;
      }
    }
  }
  if (firstIdx >= 0) g[firstIdx] = WW_HEAD;
  if (secondIdx >= 0) g[secondIdx] = WW_TAIL;
}

export function createWireworld(params: Record<string, number | string>): SimHandle {
  const n = Math.max(64, Math.min(384, Math.round(Number(params.size) || 200)));
  const stepsPerSec = Math.max(1, Number(params.rate) || 60);

  // TS 5.9 的泛型 TypedArray：显式标 Uint8Array（= ArrayBufferLike），
  // 否则 cur 被 infer 成 ArrayBuffer 版，wireworldStep 的返回值赋不进来。
  let cur: Uint8Array = new Uint8Array(n * n);
  if (params.seedMode === 'pattern') {
    const bm = patternFromParam(params.pattern);
    if (bm) stampCentered(cur, n, n, bm, WW_CONDUCTOR);
    else seedRing(cur, n);
  } else {
    seedRing(cur, n);
  }

  let frame = 0;
  const snapshots = new SnapshotRing<Uint8Array>(SNAPSHOT_OPTS, cur);
  const out = new Uint8Array(n * n);

  const stepTo = (target: number): void => {
    while (frame < target) {
      cur = wireworldStep(cur, n);
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
      for (let i = 0; i < out.length; i++) out[i] = WW_BYTE[cur[i]!]!;
      return out;
    },
  };
}

export const wireworldDef: GeneratorDef = {
  id: 'wireworld',
  nameKey: 'algo.wireworld',
  kind: 'sim',
  volatile: ['rate', 'colorBg', 'colorLive'],
  params: [
    { key: 'size', labelKey: 'algo.wireworld.grid', type: 'range', min: 96, max: 384, step: 32, defaultValue: 200 },
    {
      key: 'seedMode',
      labelKey: 'algo.wireworld.seedMode',
      type: 'select',
      defaultValue: 'ring',
      options: [
        { labelKey: 'algo.wireworld.seedRing', value: 'ring' },
        { labelKey: 'algo.wireworld.seedPattern', value: 'pattern' },
      ],
    },
    {
      key: 'pattern',
      labelKey: 'algo.wireworld.pattern',
      type: 'pattern',
      defaultValue: '',
      editorSize: 32,
      mode: '2d',
      visibleWhen: (v) => v.seedMode === 'pattern',
    },
    { key: 'rate', labelKey: 'algo.wireworld.speed', type: 'range', min: 2, max: 200, step: 2, defaultValue: 60 },
    { key: 'colorBg', labelKey: 'algo.wireworld.colorBg', type: 'color', defaultValue: '#05070c' },
    { key: 'colorLive', labelKey: 'algo.wireworld.colorLive', type: 'color', defaultValue: '#ffd166' },
  ],
  create: (params) => createWireworld(params),
};
