/**
 * lenia.ts — Lenia（连续元胞自动机），`sim` 型。
 *
 * Chan B.W.-C. 2019《Lenia: Biology of Artificial Life》提出：把生命游戏的
 * 「数 8 个邻居」换成「用环状核做一次加权平均」，再把二值状态换成 [0,1] 的连续量。
 *
 * ```
 * A ← clip[0,1]( A + dt · G(K * A) )
 * G(u) = 2·exp( −(u − μ)² / (2σ²) ) − 1
 * ```
 *
 * `G` 是关键：μ 附近是**正增长**（这块地够密，长），离 μ 远是**负增长**（太稀或太密，
 * 退）。于是它会长出一团**有边界、会蠕动、会分裂**的东西 —— 那不是纹理，
 * 是一个**生物**。这是整个 CA 家族里最像「活的」的一个。
 *
 * ## 性能与它带来的取舍
 *
 * 卷积是 O(格数 × 抽头数)，而抽头数与 R² 成正比 —— 它是 CA 家族里最贵的两个之一
 * （另一个是 SmoothLife）。实测 R=13 时朴素圆盘核约 9M MAC/步。三处缓解：
 *   1. **核预计算成稀疏表**（环状核丢掉权重 < 1e-4 的抽头）；
 *   2. **默认 R=10 而不是原论文的 13**，网格默认 112² —— 小一圈省近一半；
 *   3. **默认 12 步/秒**（约 0.4 步/帧）—— 它本来就慢，低步频看不出区别。
 *
 * ⚠️ **Orbium 没有内置**：那个 20×20 的初始团是参考实现里硬编码的位图，
 * 转录它要先过许可门（见 AGENTS §1.8）。这里用「居中团块 / 手绘图案 / 随机」三种
 * 种子代替 —— Lenia 的吸引盆很宽，一个尺寸合适的团块同样会长成有机体，
 * 只是形状与 Orbium 不同。要内置 Orbium，先核对参考实现许可并登记 CREDITS.md。
 *
 * 内部是 `Float32Array`（连续场），`current()` 才量化成 8 位。
 */

import { mulberry32 } from '../core/prng';
import { patternFromParam, stampCenteredInto } from './pattern-codec';
import { gridSizeOf } from './grid-dims';
import { SnapshotRing, TorusField, annulusKernel } from './sim-util';
import { bgColorVisible, bgModeParam } from './shader-lib';
import type { GeneratorDef, SimHandle } from './types';

/** 网格尺寸约束：与参数表里 `width` / `height` 的 min / max / default 同源。 */
const LENIA_GRID = { min: 48, max: 192, fallback: 112 } as const;

const SNAPSHOT_OPTS = {
  every: 24,
  cap: 48,
  clone: (v: Float32Array): Float32Array => v.slice(),
};

export interface LeniaRule {
  mu: number;
  sigma: number;
  dt: number;
}

/** 生长函数。μ 处 +1、远处 −1、中间过零。 */
function growth(u: number, mu: number, sigma: number): number {
  const d = u - mu;
  return 2 * Math.exp(-(d * d) / (2 * sigma * sigma)) - 1;
}

/**
 * 一步（双缓冲）。纯函数（`field` 只是预计算的核 + 缓冲），单测直接打。
 *
 * 生长函数是**逐格非线性**的，所以卷积必须先全部算完再套 G —— 就地更新会让
 * 后面的格子读到已更新的邻居。`field.convolve` 内部就是「先整场算完再返回」，
 * 所以这条约束由它保证。
 *
 * 卷积走 `TorusField`（halo 快路径）而不是逐抽头回绕：实测 2.06×，
 * 且**逐位相同**，见 `sim-util.ts` 的注释。
 */
export function leniaStep(
  field: TorusField,
  a: Float32Array,
  next: Float32Array,
  rule: LeniaRule,
): void {
  field.convolve(a);
  const conv = field.conv;
  const { mu, sigma, dt } = rule;
  for (let i = 0; i < next.length; i++) {
    const v = a[i]! + dt * growth(conv[i]!, mu, sigma);
    next[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
}

export function createLenia(params: Record<string, number | string>, seed: number): SimHandle {
  const { w, h } = gridSizeOf(params, LENIA_GRID);
  const total = w * h;
  const stepsPerSec = Math.max(1, Number(params.rate) || 12);
  const R = Math.max(4, Math.min(16, Math.round(Number(params.R) || 10)));
  const rule: LeniaRule = {
    mu: Math.max(0.02, Math.min(0.6, Number(params.mu) || 0.15)),
    sigma: Math.max(0.002, Math.min(0.08, Number(params.sigma) || 0.015)),
    dt: Math.max(0.01, Math.min(0.4, Number(params.dt) || 0.1)),
  };
  const kernel = annulusKernel(R);
  // 核是常量 → 偏移表算一次就够（每步重建会把 2× 的收益吃回去）
  const field = new TorusField(w, h, kernel);

  const buf: [Float32Array, Float32Array] = [new Float32Array(total), new Float32Array(total)];
  const { seedMode } = params;

  if (seedMode === 'pattern') {
    const bm = patternFromParam(params.pattern);
    if (bm) stampCenteredInto(w, h, bm, (i) => (buf[0]![i] = 1));
    else seedBlob(buf[0]!, w, h, Number(params.seedSize) || 14);
  } else if (seedMode === 'random') {
    const rnd = mulberry32(seed);
    const d = Math.max(0, Math.min(1, Number(params.seedDensity) || 0.3));
    for (let i = 0; i < buf[0]!.length; i++) buf[0]![i] = rnd() < d ? rnd() : 0;
  } else if (seedMode === 'noise') {
    // 整场低幅噪声：会自发长出很多小生物（多核），与「一个团」是两种观感
    const rnd = mulberry32(seed);
    for (let i = 0; i < buf[0]!.length; i++) buf[0]![i] = rnd() * 0.5;
  } else {
    seedBlob(buf[0]!, w, h, Number(params.seedSize) || 14);
  }

  let which = 0;
  let frame = 0;
  const snapshots = new SnapshotRing<Float32Array>(SNAPSHOT_OPTS, buf[0]!);
  const out = new Uint8Array(total);

  const stepTo = (target: number): void => {
    while (frame < target) {
      leniaStep(field, buf[which]!, buf[1 - which]!, rule);
      which = 1 - which;
      frame++;
      if (snapshots.shouldStore(frame)) snapshots.store(frame, buf[which]!);
    }
  };

  return {
    gridW: w,
    gridH: h,
    stepsPerSec,
    seek(simFrame: number): void {
      const target = Math.max(0, Math.floor(simFrame));
      if (target < frame) {
        const snap = snapshots.nearestAtOrBefore(target);
        buf[which]!.set(snap.value);
        frame = snap.frame;
      }
      stepTo(target);
    },
    current(): Uint8Array {
      const src = buf[which]!;
      for (let i = 0; i < out.length; i++) {
        const v = src[i]!;
        out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
      }
      return out;
    },
  };
}

function seedBlob(a: Float32Array, w: number, h: number, radius: number): void {
  const r = Math.max(2, Math.round(radius));
  const cx = w >> 1;
  const cy = h >> 1;
  const r2 = r * r;
  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) a[y * w + x] = 1;
    }
  }
}

export const leniaDef: GeneratorDef = {
  id: 'lenia',
  nameKey: 'algo.lenia',
  kind: 'sim',
  volatile: ['rate', 'colorBg', 'colorLive', 'bgMode'],
  params: [
    { key: 'width', labelKey: 'algo.simGrid.width', type: 'range', min: 48, max: 192, step: 16, defaultValue: 112 },
    { key: 'height', labelKey: 'algo.simGrid.height', type: 'range', min: 48, max: 192, step: 16, defaultValue: 112 },
    // 默认 R=10 而不是原论文的 13：卷积成本按 R² 涨，112²+R=13 实测约 9M MAC/步
    { key: 'R', labelKey: 'algo.lenia.radius', type: 'range', min: 4, max: 16, step: 1, defaultValue: 10 },
    { key: 'mu', labelKey: 'algo.lenia.mu', type: 'range', min: 0.02, max: 0.6, step: 0.005, defaultValue: 0.15 },
    // ⚠️ 默认 σ=0.03 而**不是** Orbium 的 0.015：实测 σ=0.015 在任何 μ 下
    // 都一步就死（μ=0.1/0.15/0.2/0.3 全部 ink=0），σ=0.03/0.05 才活
    // （t=400 有 1700~3700 格）。原因是 Orbium 那套窄 σ 配的是它自己那个
    // **环形**初始位图；我们用手绘/团块种子时，生长函数的窗口必须更宽才接得住。
    { key: 'sigma', labelKey: 'algo.lenia.sigma', type: 'range', min: 0.005, max: 0.08, step: 0.001, defaultValue: 0.03 },
    { key: 'dt', labelKey: 'algo.lenia.dt', type: 'range', min: 0.01, max: 0.4, step: 0.01, defaultValue: 0.1 },
    {
      key: 'seedMode',
      labelKey: 'algo.lenia.seedMode',
      type: 'select',
      defaultValue: 'blob',
      options: [
        { labelKey: 'algo.lenia.seedBlob', value: 'blob' },
        { labelKey: 'algo.lenia.seedPattern', value: 'pattern' },
        { labelKey: 'algo.lenia.seedNoise', value: 'noise' },
        { labelKey: 'algo.lenia.seedRandom', value: 'random' },
      ],
    },
    {
      key: 'pattern',
      labelKey: 'algo.lenia.pattern',
      type: 'pattern',
      defaultValue: '',
      editorSize: 32,
      mode: '2d',
      visibleWhen: (v) => v.seedMode === 'pattern',
    },
    {
      key: 'seedSize',
      labelKey: 'algo.lenia.seedSize',
      type: 'range',
      min: 4,
      max: 40,
      step: 1,
      defaultValue: 14,
      visibleWhen: (v) => v.seedMode === 'blob',
    },
    {
      key: 'seedDensity',
      labelKey: 'algo.lenia.seedDensity',
      type: 'range',
      min: 0.05,
      max: 0.9,
      step: 0.05,
      defaultValue: 0.3,
      visibleWhen: (v) => v.seedMode === 'random',
    },
    { key: 'rate', labelKey: 'algo.lenia.speed', type: 'range', min: 2, max: 40, step: 1, defaultValue: 12 },
    {
      key: 'colorBg',
      labelKey: 'algo.lenia.colorBg',
      type: 'color',
      defaultValue: '#04070c',
      visibleWhen: bgColorVisible,
    },
    { key: 'colorLive', labelKey: 'algo.lenia.colorLive', type: 'color', defaultValue: '#7cf2c0' },
    bgModeParam(),
  ],
  create: createLenia,
};
