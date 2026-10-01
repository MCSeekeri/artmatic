/**
 * slider-math.ts — 自绘滑杆的像素 ↔ 值换算（纯函数，可单测）。
 *
 * 抽出来是为了把「线性映射」这条契约钉死：E2E 里有一条硬断言——拖动滑杆时
 * 同行数字框必须与 store 逐帧一致。那条断言的几何前提就是这里的
 * `(x - left) / width` 线性映射，写错了它必红。
 */

/** 把值钳进 [min, max]。 */
export function clamp(v: number, min: number, max: number): number {
  if (max < min) return min;
  return v < min ? min : v > max ? max : v;
}

/** 四舍五入到指定小数位，消掉浮点噪声（0.1+0.2 类）。 */
export function roundTo(v: number, decimals: number): number {
  if (!Number.isFinite(v)) return v;
  const f = 10 ** Math.max(0, Math.min(15, decimals));
  return Math.round(v * f) / f;
}

/** 一个 step 值需要几位小数。`0.01` → 2，`1` → 0，`0.5` → 1。 */
export function precisionOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = String(step);
  const e = s.indexOf('e-');
  if (e >= 0) return Number(s.slice(e + 2));
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/**
 * 量化到 step 的整数倍（以 min 为原点）。
 * 以 min 为原点而不是绝对 0，是为了让 `min: 0.5, step: 0.5` 这类区间
 * 也能落在「合法值」上，而不是把 0.5 吸附到 1.0。
 */
export function quantize(v: number, min: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return v;
  return min + Math.round((v - min) / step) * step;
}

/**
 * 横向像素 → 值。**这是滑杆的唯一映射**：
 * 轨道左端 = min，右端 = max，中间线性。
 *
 * `width <= 0`（还没布局，或元素被折叠）时返回 min——不返回 NaN，
 * 否则会顺着 oninput 一路把 NaN 写进 store。
 */
export function valueAtX(
  x: number,
  left: number,
  width: number,
  min: number,
  max: number,
  step = 0,
): number {
  if (!(width > 0)) return min;
  const frac = clamp((x - left) / width, 0, 1);
  const raw = min + frac * (max - min);
  const q = step > 0 ? quantize(raw, min, step) : raw;
  return clamp(roundTo(q, Math.max(precisionOf(step), 4)), min, max);
}

/** 值 → 轨道上的比例位置（0..1），画 thumb 用。 */
export function fractionOf(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

/**
 * 键盘步进的增量。Home/End 走 `null` 表示「直接到端点」。
 * PageUp/PageDown 给 10 步——与原生 `<input type=range>` 一致。
 */
export function keyDelta(key: string, step: number, shift: boolean): number | null {
  const mul = shift ? 10 : 1;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return -step * mul;
    case 'ArrowRight':
    case 'ArrowUp':
      return step * mul;
    case 'PageDown':
      return -step * 10;
    case 'PageUp':
      return step * 10;
    default:
      return null;
  }
}
