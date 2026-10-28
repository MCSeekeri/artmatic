/**
 * bifurcation.ts — 一维映射的分岔图，bake 型。
 *
 * 移植自 angel-echo `js/automata.js::logisticMap()`（同作者内部移植，见 CREDITS.md）。
 *
 * `x → f(r, x)`，横轴 r，每一列把轨道的落点打上去。周期倍增、r≈3.5699 的
 * 混沌起点、以及混沌里那些周期窗口 —— 全都看得见，这正是它值得做一个生成器
 * 的理由：一条只含一个乘法的规则，长出一整张有序与无序的地图。
 *
 * 纯确定性，**没有任何随机**（同一个参数永远得到同一张图），所以它连 `seed`
 * 都不用，seek 天然精确。
 *
 * ## 两条来自上游的血泪口径
 *
 * 1. **`keep` 必须大。** 轨道的一小段在图的左半边只画出一条一像素宽的曲线 ——
 *    而这片段的每列只有 1–2 像素宽，裁短了那条曲线根本不在画面上，整幅图会
 *    退化成「左边空空、右下一团」。上游默认 1100 是试出来的。
 * 2. **累加要夹住 255，不能靠 `Uint8Array` 回绕。** 上游写 `out[i] += 34`，
 *    在 `Uint8Array` 上超过 255 会回绕成小数（238+34 → 16），在密度最高的
 *    区域点出**黑斑**。这里显式 `min(255, ...)` —— 与上游的差异只有这一处，
 *    且是修掉一个明确的伪影。
 *
 * 揭示方式是 `'front-x'`（逐列算出来），见 types.ts 的 `BakeReveal`。
 *
 * ## 扩展
 *
 * - `map`：logistic / sine / tent / cubic。四个一维映射的图形态完全不同，
 *   而实现只差两行（`f` 与 `f'`）。
 * - `rMin` / `rMax`：放大到感兴趣的那一小段 r（混沌窗口里全是细节）。
 * - `x0` / `steps`：初值与瞬态长度（`steps - keep` 是被丢掉的瞬态）。
 * - `colorMode: 'lyapunov'`：不算落点，改算李雅普诺夫指数
 *   `λ = mean(log|f'(x)|)`。λ>0 是混沌、λ<0 是周期 —— 在混沌图底部那条
 *   蓝色的「周期窗口」在 λ 图上会变成一块清晰的黑斑，这是密度图看不出的结构。
 */

import { bgColorVisible, bgModeParam } from './shader-lib';
import type { GeneratorDef } from './types';

/** 每命中一次轨道落点给这一列加的量。255 / 34 ≈ 7.5 次命中到顶。 */
const HIT = 34;

export type MapKind = 'logistic' | 'sine' | 'tent' | 'cubic';

const MAP_KINDS: Record<string, MapKind> = {
  logistic: 'logistic',
  sine: 'sine',
  tent: 'tent',
  cubic: 'cubic',
};

/** 一维映射本体。 */
export function mapStep(kind: MapKind, r: number, x: number): number {
  switch (kind) {
    case 'sine':
      return r * Math.sin(Math.PI * x);
    case 'tent':
      return r * Math.min(x, 1 - x);
    case 'cubic':
      return r * x * (1 - x * x);
    default:
      return r * x * (1 - x);
  }
}

/** 对应的导数 —— 李雅普诺夫指数要用。 */
export function mapDeriv(kind: MapKind, r: number, x: number): number {
  switch (kind) {
    case 'sine':
      return r * Math.PI * Math.cos(Math.PI * x);
    case 'tent':
      return x < 0.5 ? r : -r;
    case 'cubic':
      return r * (1 - 3 * x * x);
    default:
      return r * (1 - 2 * x);
  }
}

export interface DiagramOptions {
  kind: MapKind;
  w: number;
  h: number;
  /** 被丢弃的瞬态步数（轨道要先跑到吸引子上）。 */
  transient: number;
  /** 被保留并落点的步数。 */
  keep: number;
  r0: number;
  r1: number;
  x0: number;
  /** 每次命中累加的量。 */
  gain: number;
}

/** 沿 r 逐列推进，把轨道落点累加成密度图。 */
export function mapDiagram(o: DiagramOptions): { data: Uint8Array; w: number; h: number } {
  const { w, h, kind } = o;
  const out = new Uint8Array(w * h);
  const total = Math.max(1, o.transient) + Math.max(1, o.keep);
  const last = Math.max(1, w - 1);
  const gain = Math.max(1, o.gain);
  for (let x = 0; x < w; x++) {
    const r = o.r0 + (o.r1 - o.r0) * (x / last);
    let v = o.x0;
    for (let i = 0; i < total; i++) {
      v = mapStep(kind, r, v);
      // 发散区（r 超出这个映射的有效区间）会让 v 跑到 inf/NaN。
      // 重置而不是让 NaN 一路污染下去 —— 那会在整列上留下一个洞。
      if (!Number.isFinite(v)) v = o.x0;
      if (i < o.transient) continue;
      const y = Math.min(h - 1, Math.max(0, ((1 - v) * (h - 1)) | 0));
      const idx = y * w + x;
      if (out[idx]! < 255) out[idx] = Math.min(255, out[idx]! + gain);
    }
  }
  return { data: out, w, h };
}

/**
 * 李雅普诺夫指数图：`λ = mean(log|f'(x)|)`，>0 混沌（亮），<0 周期（暗）。
 * 值域经验上落在约 [−3, 1]，线性映到 0..255。
 */
export function lyapunovMap(o: Omit<DiagramOptions, 'gain'>): { data: Uint8Array; w: number; h: number } {
  const { w, h, kind } = o;
  const out = new Uint8Array(w * h);
  const keep = Math.max(1, o.keep);
  const total = Math.max(1, o.transient) + keep;
  const last = Math.max(1, w - 1);
  for (let x = 0; x < w; x++) {
    const r = o.r0 + (o.r1 - o.r0) * (x / last);
    let v = o.x0;
    let sum = 0;
    for (let i = 0; i < total; i++) {
      const d = mapDeriv(kind, r, v);
      v = mapStep(kind, r, v);
      if (!Number.isFinite(v)) v = o.x0;
      if (i < o.transient) continue;
      sum += Math.log(Math.abs(d) + 1e-12);
    }
    const lambda = sum / keep;
    const t = Math.max(0, Math.min(1, (lambda + 2) / 3));
    // 整列同值：李雅普诺夫指数是**列的属性**，不是一个分布。
    const val = Math.round(t * 255);
    for (let y = 0; y < h; y++) out[y * w + x] = val;
  }
  return { data: out, w, h };
}

/**
 * 旧签名（被 `tests/unit/algos.test.ts` 钉住）：logistic、r∈[2.4,4]、x0=0.4、
 * `steps` 是总步数、`keep` 是保留的尾部。
 */
export function logisticMap(
  w: number,
  h: number,
  steps: number,
  keep: number,
): { data: Uint8Array; w: number; h: number } {
  // `keep > steps` 时上游的语义是「全都保留」；新实现里 transient 会被算成 0、
  // total 会被算成 keep > steps —— 那就多迭代了。钳一下，两种口径就一致了。
  const kept = Math.max(1, Math.min(steps, keep));
  return mapDiagram({
    kind: 'logistic',
    w,
    h,
    transient: Math.max(0, steps - kept),
    keep: kept,
    r0: 2.4,
    r1: 4.0,
    x0: 0.4,
    gain: HIT,
  });
}

export const bifurcationDef: GeneratorDef = {
  id: 'bifurcation',
  nameKey: 'algo.bifurcation',
  kind: 'bake',
  reveal: 'front-x',
  volatile: ['speed', 'colorBg', 'colorLive', 'bgMode'],
  params: [
    {
      key: 'map',
      labelKey: 'algo.bifurcation.map',
      type: 'select',
      defaultValue: 'logistic',
      options: [
        { labelKey: 'algo.bifurcation.mapLogistic', value: 'logistic' },
        { labelKey: 'algo.bifurcation.mapSine', value: 'sine' },
        { labelKey: 'algo.bifurcation.mapTent', value: 'tent' },
        { labelKey: 'algo.bifurcation.mapCubic', value: 'cubic' },
      ],
    },
    { key: 'width', labelKey: 'algo.bifurcation.width', type: 'range', min: 256, max: 2048, step: 64, defaultValue: 1024 },
    { key: 'height', labelKey: 'algo.bifurcation.height', type: 'range', min: 128, max: 1024, step: 32, defaultValue: 512 },
    { key: 'rMin', labelKey: 'algo.bifurcation.rMin', type: 'range', min: -1, max: 4, step: 0.005, defaultValue: 2.4 },
    { key: 'rMax', labelKey: 'algo.bifurcation.rMax', type: 'range', min: -1, max: 4, step: 0.005, defaultValue: 4 },
    { key: 'x0', labelKey: 'algo.bifurcation.x0', type: 'range', min: 0.01, max: 0.99, step: 0.01, defaultValue: 0.4 },
    { key: 'steps', labelKey: 'algo.bifurcation.steps', type: 'range', min: 400, max: 4000, step: 100, defaultValue: 2200 },
    { key: 'keep', labelKey: 'algo.bifurcation.keep', type: 'range', min: 100, max: 2000, step: 50, defaultValue: 1100 },
    {
      key: 'colorMode',
      labelKey: 'algo.bifurcation.colorMode',
      type: 'select',
      defaultValue: 'density',
      options: [
        { labelKey: 'algo.bifurcation.modeDensity', value: 'density' },
        { labelKey: 'algo.bifurcation.modeLyapunov', value: 'lyapunov' },
      ],
    },
    {
      key: 'gain',
      labelKey: 'algo.bifurcation.gain',
      type: 'range',
      min: 4,
      max: 100,
      step: 2,
      defaultValue: HIT,
      visibleWhen: (v) => v.colorMode !== 'lyapunov',
    },
    { key: 'speed', labelKey: 'algo.bifurcation.speed', type: 'range', min: 0, max: 2000, step: 10, defaultValue: 320 },
    {
      key: 'colorBg',
      labelKey: 'algo.bifurcation.colorBg',
      type: 'color',
      defaultValue: '#07060c',
      visibleWhen: bgColorVisible,
    },
    { key: 'colorLive', labelKey: 'algo.bifurcation.colorLive', type: 'color', defaultValue: '#ffd9a0' },
    bgModeParam(),
  ],
  bake(params) {
    const w = Math.round(Number(params.width) || 1024);
    const h = Math.round(Number(params.height) || 512);
    const steps = Math.round(Number(params.steps) || 2200);
    const keep = Math.min(steps, Math.round(Number(params.keep) || 1100));
    const kind = MAP_KINDS[String(params.map)] ?? 'logistic';
    const r0 = Number(params.rMin ?? 2.4);
    const r1 = Number(params.rMax ?? 4);
    const x0 = Number(params.x0 ?? 0.4);
    const transient = Math.max(0, steps - keep);
    const shared = { kind, w, h, transient, keep, r0, r1, x0 };
    const { data } =
      params.colorMode === 'lyapunov'
        ? lyapunovMap(shared)
        : mapDiagram({ ...shared, gain: Math.round(Number(params.gain) || HIT) });
    // 前沿跨的是**列**（r 轴），所以归一化用宽度。
    return { data, w, h, frontMax: w };
  },
};
