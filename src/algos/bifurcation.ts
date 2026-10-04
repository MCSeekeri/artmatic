/**
 * bifurcation.ts — 逻辑斯蒂映射的分岔图，bake 型。
 *
 * 移植自 angel-echo `js/automata.js::logisticMap()`（同作者内部移植，见 CREDITS.md）。
 *
 * `x → r·x·(1−x)`，横轴 r∈[2.4, 4.0]，每一列把轨道的落点打上去。周期倍增、
 * r≈3.5699 的混沌起点、以及混沌里那些周期窗口 —— 全都看得见，这正是它值得
 * 做一个生成器的理由：一条只含一个乘法的规则，长出一整张有序与无序的地图。
 *
 * 纯确定性，**没有任何随机**（同一个 `steps`/`keep` 永远得到同一张图），
 * 所以它连 `seed` 都不用，seek 天然精确。
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
 */

import type { GeneratorDef } from './types';

/** 每命中一次轨道落点给这一列加的量。255 / 34 ≈ 7.5 次命中到顶。 */
const HIT = 34;

export function logisticMap(
  w: number,
  h: number,
  steps: number,
  keep: number,
): { data: Uint8Array; w: number; h: number } {
  const out = new Uint8Array(w * h);
  const r0 = 2.4;
  const r1 = 4.0;
  const last = Math.max(1, w - 1);
  for (let x = 0; x < w; x++) {
    const r = r0 + (r1 - r0) * (x / last);
    let v = 0.4;
    for (let i = 0; i < steps; i++) {
      v = r * v * (1 - v);
      if (i < steps - keep) continue;
      const y = Math.min(h - 1, Math.max(0, ((1 - v) * (h - 1)) | 0));
      const idx = y * w + x;
      if (out[idx]! < 255) out[idx] = Math.min(255, out[idx]! + HIT);
    }
  }
  return { data: out, w, h };
}

export const bifurcationDef: GeneratorDef = {
  id: 'bifurcation',
  nameKey: 'algo.bifurcation',
  kind: 'bake',
  reveal: 'front-x',
  params: [
    { key: 'width', labelKey: 'algo.bifurcation.width', type: 'range', min: 256, max: 2048, step: 64, defaultValue: 1024 },
    { key: 'height', labelKey: 'algo.bifurcation.height', type: 'range', min: 128, max: 1024, step: 32, defaultValue: 512 },
    { key: 'steps', labelKey: 'algo.bifurcation.steps', type: 'range', min: 400, max: 4000, step: 100, defaultValue: 2200 },
    { key: 'keep', labelKey: 'algo.bifurcation.keep', type: 'range', min: 100, max: 2000, step: 50, defaultValue: 1100 },
    { key: 'speed', labelKey: 'algo.bifurcation.speed', type: 'range', min: 0, max: 2000, step: 10, defaultValue: 320 },
    { key: 'colorBg', labelKey: 'algo.bifurcation.colorBg', type: 'color', defaultValue: '#07060c' },
    { key: 'colorLive', labelKey: 'algo.bifurcation.colorLive', type: 'color', defaultValue: '#ffd9a0' },
  ],
  bake(params) {
    const w = Math.round(Number(params.width) || 1024);
    const h = Math.round(Number(params.height) || 512);
    const steps = Math.round(Number(params.steps) || 2200);
    const keep = Math.min(steps, Math.round(Number(params.keep) || 1100));
    const { data } = logisticMap(w, h, steps, keep);
    // 前沿跨的是**列**（r 轴），所以归一化用宽度。
    return { data, w, h, frontMax: w };
  },
};
