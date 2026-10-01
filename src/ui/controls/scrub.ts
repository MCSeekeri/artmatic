/**
 * scrub.ts — 数字输入框「拖拽改值」的纯函数内核（drag-to-tweak）。
 *
 * 交互规范来自创意工具的共同约定（After Effects / Blender / Figma / Houdini）：
 *   无修饰键 —— 横向拖动连续改值
 *   Ctrl     —— 吸附到 step 的整数倍
 *   Alt      —— 精细：灵敏度 ×0.1
 *   Shift    —— 粗调：灵敏度 ×10
 *
 * 三处容易做错、这里刻意处理掉的细节：
 *
 *  1. **换修饰键不跳值。** 若直接用「累计位移 × 灵敏度」，拖动中途按下 Alt
 *     会让值瞬间跳到另一个刻度。做法是维护一个增量锚点：修饰键集合一变就把
 *     锚点重置到当前值/当前位移，于是切换点两侧连续。
 *  2. **位移用累计量而不是增量。** 逐帧累加会因浮点误差缓慢漂移，且丢帧时
 *     会吃掉位移。这里始终用 `dx - anchorDx` 从锚点算。
 *  3. **精度跟着有效步长走。** Alt 模式下有效步长是 step/10，小数位要相应增加，
 *     否则显示出来全是同一个数。
 */

import { clamp, precisionOf, quantize, roundTo } from './slider-math';

export interface Modifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false, shift: false };

export interface ScrubConfig {
  step: number;
  min?: number;
  max?: number;
  /** 多少像素对应一个 step。默认 4——太小会抖，太大拖不动。 */
  pxPerStep?: number;
}

export const DEFAULT_PX_PER_STEP = 4;

/** 拖动超过这个位移才进入 scrub；否则算「点击 → 聚焦文本编辑」。 */
export const SCRUB_THRESHOLD_PX = 3;

/** 修饰键决定的灵敏度倍率。Ctrl 不参与（它改的是「吸附」不是「快慢」）。 */
export function sensitivity(mods: Modifiers): number {
  // Alt 优先于 Shift：两者同按时用户更可能是想要精细（Alt 是「慢」的直觉）。
  if (mods.alt) return 0.1;
  if (mods.shift) return 10;
  return 1;
}

export function effectiveStep(cfg: ScrubConfig, mods: Modifiers): number {
  const s = cfg.step > 0 ? cfg.step : 1;
  // roundTo 消掉 0.1 * 0.1 = 0.010000000000000002 这类噪声，
  // 否则 precisionOf 会算出 18 位小数。
  return roundTo(s * sensitivity(mods), 6);
}

export function modifiersEqual(a: Modifiers, b: Modifiers): boolean {
  return a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift;
}

export interface ScrubSession {
  /** 手势开始时的值。Esc 取消时恢复到这里。 */
  originValue: number;
  /** 增量锚点：修饰键变化时重置，保证切换瞬间不跳值。 */
  anchorValue: number;
  anchorDx: number;
  /** 是否已经越过阈值、真正进入 scrub（否则这次只是点击）。 */
  started: boolean;
}

export function beginScrub(value: number): ScrubSession {
  return { originValue: value, anchorValue: value, anchorDx: 0, started: false };
}

/** 修饰键集合变化时调用：把锚点挪到「当前时刻」，后续增量从这里重新算。 */
export function rebase(s: ScrubSession, currentValue: number, dx: number): ScrubSession {
  return { ...s, anchorValue: currentValue, anchorDx: dx };
}

export function shouldBeginScrub(dx: number, threshold = SCRUB_THRESHOLD_PX): boolean {
  return Math.abs(dx) >= threshold;
}

/**
 * 由锚点 + 当前位移得到新值。**纯函数**：不读时钟、不碰 DOM、不改 session。
 * 调用方决定何时 rebase、何时提交。
 */
export function scrubValue(
  s: ScrubSession,
  dx: number,
  mods: Modifiers,
  cfg: ScrubConfig,
): number {
  const pxPerStep = cfg.pxPerStep && cfg.pxPerStep > 0 ? cfg.pxPerStep : DEFAULT_PX_PER_STEP;
  const step = effectiveStep(cfg, mods);
  const steps = (dx - s.anchorDx) / pxPerStep;
  let next = s.anchorValue + steps * step;

  const min = cfg.min ?? -Infinity;
  const max = cfg.max ?? Infinity;
  next = clamp(next, min, max);

  // Ctrl：吸附到整数刻度。放在钳制之后，端点才不会因吸附越界。
  if (mods.ctrl) next = clamp(quantize(next, Number.isFinite(min) ? min : 0, step), min, max);

  // 精度跟着**有效**步长走，Alt 精细模式下才会显示出变化。
  return roundTo(next, Math.max(precisionOf(step), cfg.step > 1 ? 0 : precisionOf(cfg.step)));
}

/**
 * 收口一个值：钳制 + 取整到精度。
 *
 * `quantize` 默认 true（用于拖动 / 方向键 / 提示框这类「按刻度走」的输入）。
 * **手动键入时应当传 false**：用户打的就是精确值，不该被吸附到 step 格点上。
 * 反例（实测踩到）：时长 min=0.1 step=0.5，键入 30 会被量化成 30.1——因为
 * 30 根本不在 0.1 + k*0.5 这个网格上，凭空多出 0.1 秒。原生 input[type=number]
 * 也不改写用户输入的值，这里的语义与它对齐。
 */
export function commitValue(
  raw: number,
  cfg: ScrubConfig & { precision?: number },
  opts: { quantize?: boolean } = {},
): number {
  const min = cfg.min ?? -Infinity;
  const max = cfg.max ?? Infinity;
  let v = clamp(raw, min, max);
  if (opts.quantize !== false && cfg.step > 0) {
    v = quantize(v, Number.isFinite(min) ? min : 0, cfg.step);
  }
  v = clamp(v, min, max);
  const decimals = cfg.precision ?? precisionOf(cfg.step);
  return roundTo(v, decimals);
}

/** 解析用户输入。空串 / 单个减号返回 null（表示「还在编辑中，别提交」）。 */
export function parseValue(text: string): number | null {
  const s = text.trim().replace(',', '.');
  if (s === '' || s === '-' || s === '.' || s === '-.') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function formatValue(v: number, precision: number): string {
  if (!Number.isFinite(v)) return '';
  return roundTo(v, precision).toFixed(precision);
}
