/**
 * registry.ts — 生成器注册表与调用口径。
 *
 * 三件事收在这里，别处不许各写一份：
 *
 *  1. **默认值合并**。元素上存的是「合并后的全量参数」，但读旧档 / 插件数据时
 *     可能缺键 —— `build()` 前统一补齐，生成器内部就不必到处写 `?? 默认值`。
 *  2. **种子推进**。`nextSeed` 用 LCG，不碰 `Math.random()`（硬约束 1.2）：
 *     「换一个」与「回到旧种子」都必须是可复现的。
 *  3. **命令预算**。超过 `GEN_MAX_COMMANDS` 只告警，**不静默改用户参数** ——
 *     悄悄降档的表现是「明明把数量拖到最大了，图却没变」。
 */

import type { MessageKey } from '../../i18n/locales';
import { GEN_MAX_COMMANDS, type SvgGenGroup, type SvgGenParams, type SvgGenResult, type SvgGenSpec } from './types';
import { GRID_GENERATORS } from './defs/grid';
import { RADIAL_GENERATORS } from './defs/radial';
import { LINE_GENERATORS } from './defs/line';
import { OUTLINE_GENERATORS } from './defs/outline';
import { CONTOUR_GENERATORS } from './defs/contour';
import { ISO_GENERATORS } from './defs/iso';
import { CODE_GENERATORS } from './defs/code';

/** 选择器与面板的分组顺序（也就是报告 §9.6 的六组）。 */
export const GEN_GROUPS: { id: SvgGenGroup; labelKey: MessageKey }[] = [
  { id: 'grid', labelKey: 'gen.group.grid' },
  { id: 'radial', labelKey: 'gen.group.radial' },
  { id: 'line', labelKey: 'gen.group.line' },
  { id: 'outline', labelKey: 'gen.group.outline' },
  { id: 'iso', labelKey: 'gen.group.iso' },
  { id: 'code', labelKey: 'gen.group.code' },
];

/** 全部生成器（顺序 = 选择器里的展示顺序）。 */
export const SVG_GENERATORS: SvgGenSpec[] = [
  ...GRID_GENERATORS,
  ...RADIAL_GENERATORS,
  ...LINE_GENERATORS,
  ...OUTLINE_GENERATORS,
  // 等高线归「轮廓」组（语义就是轮廓线），但实现放在自己的文件里。
  ...CONTOUR_GENERATORS,
  ...ISO_GENERATORS,
  ...CODE_GENERATORS,
];

const BY_ID = new Map(SVG_GENERATORS.map((g) => [g.id, g]));

/** 未知 id（旧档 / 别的插件写的）返回 null，由调用方降级而不是抛错。 */
export function generatorById(id: string | undefined | null): SvgGenSpec | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

export function generatorsInGroup(group: SvgGenGroup): SvgGenSpec[] {
  return SVG_GENERATORS.filter((g) => g.group === group);
}

/** 某个 spec 的默认参数（新插入时写进元素的那份）。 */
export function defaultsOf(spec: SvgGenSpec): SvgGenParams {
  const out: SvgGenParams = {};
  for (const p of spec.params) out[p.key] = p.defaultValue;
  return out;
}

/** 默认值 + 传入值（传入的缺键 / 非数值一律回落到默认值）。 */
export function mergeParams(spec: SvgGenSpec, params: SvgGenParams | undefined): SvgGenParams {
  const out = defaultsOf(spec);
  if (!params) return out;
  for (const p of spec.params) {
    const v = params[p.key];
    if (v === undefined) continue;
    if (p.type === 'range') {
      const n = Number(v);
      if (Number.isFinite(n)) out[p.key] = n;
    } else if (p.type === 'checkbox') {
      out[p.key] = Number(v) >= 0.5 ? 1 : 0;
    } else if (typeof v === 'string') {
      out[p.key] = v;
    }
  }
  return out;
}

/**
 * 下一个种子。LCG（与 `mulberry32` 同族），只保证「可复现」，不追求统计质量。
 *
 * 刻意**不用** `(seed + 1)`:相邻种子在 mulberry32 里前几个输出高度相关，
 * 「换一个」会摇出看着几乎一样的图。
 */
export function nextSeed(seed: number): number {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
}

/** 只告警一次（拖动滑杆时每帧都会越界，控制台会刷屏）。 */
const budgetWarned = new Set<string>();

function run(spec: SvgGenSpec, params: SvgGenParams, seed: number): SvgGenResult {
  const merged = mergeParams(spec, params);
  const r = spec.build(merged, seed >>> 0);
  if (r.commands > GEN_MAX_COMMANDS && !budgetWarned.has(spec.id)) {
    budgetWarned.add(spec.id);
    console.warn(
      `[svg-gen] ${spec.id} 产生了 ${r.commands} 条路径命令，超过预算 ${GEN_MAX_COMMANDS}`,
    );
  }
  return r;
}

/** 按 id 生成（未知 id → null）。 */
export function buildGenerator(
  id: string | undefined | null,
  params: SvgGenParams | undefined,
  seed: number,
): SvgGenResult | null {
  const spec = generatorById(id);
  return spec ? run(spec, params ?? defaultsOf(spec), seed) : null;
}

/** 已知 spec 时直接用（避免一次查表）。 */
export function buildFromSpec(spec: SvgGenSpec, params: SvgGenParams | undefined, seed: number): SvgGenResult {
  return run(spec, params ?? defaultsOf(spec), seed);
}
