/**
 * shared.ts — 生成器共用的小工具与参数工厂。
 *
 * 存在的理由：二十多个生成器里「数量 / 行列 / 间距 / 角度 / 抖动」这些参数反复
 * 出现（报告 §3.3 的六个通用参数键）。每个 spec 各写一遍 ParamDef 会产生
 * 三种不一致：同义参数不同区间、同义文案不同 key、默认值和上限各调一套
 * —— 面板看起来就会「这一项能拖到 200，那一项只能到 20」。
 */

import { mulberry32 } from '../../core/prng';
import type { CheckboxParam, RangeParam, SelectParam } from '../../effects/types';
import type { MessageKey } from '../../i18n/locales';
import type { SvgGenParams } from './types';

/** authored 方盒边长与中心。 */
export const BOX = 100;
export const CENTER = BOX / 2;

export function range(
  key: string,
  labelKey: MessageKey,
  min: number,
  max: number,
  step: number,
  defaultValue: number,
): RangeParam {
  return { type: 'range', key, labelKey, min, max, step, defaultValue };
}

export function select(
  key: string,
  labelKey: MessageKey,
  defaultValue: string,
  options: { labelKey: MessageKey; value: string }[],
): SelectParam {
  return { type: 'select', key, labelKey, defaultValue, options };
}

/** `checkbox` 的值是 0 / 1（ParamDef 的统一口径，见 effects/types.ts）。 */
export function check(key: string, labelKey: MessageKey, on: boolean): CheckboxParam {
  return { type: 'checkbox', key, labelKey, defaultValue: on ? 1 : 0 };
}

/**
 * 图元形状选项（目前只有 `dotgrid` 用）。
 *
 * `cross` 的臂厚由调用方给（`crossPoints` 的第三个参数），所以这里只是一个
 * 形状枚举 —— 参数表里配一个 `visibleWhen` 的滑杆就能调粗细。
 */
export const SHAPE_OPTIONS: { labelKey: MessageKey; value: string }[] = [
  { labelKey: 'gen.opt.circle', value: 'circle' },
  { labelKey: 'gen.opt.square', value: 'square' },
  { labelKey: 'gen.opt.diamond', value: 'diamond' },
  { labelKey: 'gen.opt.triangle', value: 'triangle' },
  { labelKey: 'gen.opt.cross', value: 'cross' },
];

export function num(p: SvgGenParams, key: string, fallback = 0): number {
  const v = Number(p[key]);
  return Number.isFinite(v) ? v : fallback;
}

export function flag(p: SvgGenParams, key: string): boolean {
  return num(p, key, 0) >= 0.5;
}

export function str(p: SvgGenParams, key: string, fallback: string): string {
  const v = p[key];
  return typeof v === 'string' && v ? v : fallback;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export const TAU = Math.PI * 2;

/** 注入式随机。**不要**在生成器里用 `Math.random`（硬约束 1.2）。 */
export function rngOf(seed: number): () => number {
  return mulberry32(seed >>> 0);
}
