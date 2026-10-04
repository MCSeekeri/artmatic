/**
 * mandelbrot.ts — 逃逸时间分形（Mandelbrot / Burning Ship），realtime 型。
 *
 * 逐帧实时渲染（angel-echo 的分形就是逐帧实时算，不存在跳帧缓存——
 * 那是对确定性的破坏）。性能手段是内部低分辨率 + 放大，不是缓存。
 * u_maxIter 取整在 JS 侧做，避免 shader 里 float 循环边界抖动。
 *
 * **两个变体共用一个 fragment**，靠 `u_variant` 分派 —— 与 angel-echo 的
 * `mathfield` mode 3 / `uMathVariant` 同构。Burning Ship 的全部差别只有一行：
 * 迭代前对虚部取绝对值，破坏共轭对称，于是集合长成船底的样子。
 * 不做成两个 def 是刻意的：两份近乎逐字相同的 shader 是同一段逻辑的两处实现，
 * 迟早会漂。
 *
 * fragment **不含头**：`ALGO_HEAD`（algos/shader-lib.ts）拼在前面，
 * 那里提供了 `vUv` / `outColor` / `u_time` / `u_resolution` / `u_aspect`。
 */

import { colorVec3 } from '../core/color';
import { intResParam, type AlgoUniformCtx } from './shader-lib';
import type { GeneratorDef } from './types';

export const MANDELBROT_FRAG = `
uniform vec2 u_center;
uniform float u_zoom;      // 放大倍率（对数滑杆在 JS 侧已取 exp）
uniform int u_maxIter;
uniform int u_variant;     // 0 = Mandelbrot · 1 = Burning Ship
uniform vec3 u_colorA;     // **快逃逸**端（远离集合：迭代几十次就发散）
uniform vec3 u_colorB;     // **慢逃逸**端（贴着集合边界：要迭代很多次才发散）
uniform vec3 u_interior;   // 集合内部

void main() {
  vec2 c = u_center + (vUv - 0.5) * vec2(u_aspect, 1.0) * (3.0 / u_zoom);
  vec2 z = vec2(0.0);
  int i = 0;
  float x2 = 0.0, y2 = 0.0;
  for (; i < u_maxIter; i++) {
    if (x2 + y2 > 4.0) break;
    // Burning Ship：取绝对值那一步是整个变体的全部。
    vec2 az = u_variant == 1 ? abs(z) : z;
    z = vec2(az.x * az.x - az.y * az.y, 2.0 * az.x * az.y) + c;
    x2 = z.x * z.x;
    y2 = z.y * z.y;
  }
  if (i >= u_maxIter) {
    outColor = vec4(u_interior, 1.0);
    return;
  }
  // 平滑迭代计数，消色带
  float sn = float(i) - log2(max(log2(x2 + y2), 1e-9)) + 4.0;
  float t = clamp(sn / float(u_maxIter), 0.0, 1.0);
  outColor = vec4(mix(u_colorA, u_colorB, sqrt(t)), 1.0);
}`;

function uniform3(gl: WebGL2RenderingContext, loc: WebGLUniformLocation | null | undefined, hex: string): void {
  if (!loc) return;
  const [r, g, b] = colorVec3(hex);
  gl.uniform3f(loc, r, g, b);
}

const VARIANTS: Record<string, number> = { mandel: 0, ship: 1 };

export const mandelbrotDef: GeneratorDef = {
  id: 'mandelbrot',
  nameKey: 'algo.mandelbrot',
  kind: 'realtime',
  fragment: MANDELBROT_FRAG,
  params: [
    {
      key: 'variant',
      labelKey: 'algo.mandelbrot.variant',
      type: 'select',
      defaultValue: 'mandel',
      options: [
        { labelKey: 'algo.mandelbrot.variantMandel', value: 'mandel' },
        { labelKey: 'algo.mandelbrot.variantShip', value: 'ship' },
      ],
    },
    { key: 'cx', labelKey: 'algo.mandelbrot.centerX', type: 'range', min: -2, max: 1, step: 0.0001, defaultValue: -0.6 },
    { key: 'cy', labelKey: 'algo.mandelbrot.centerY', type: 'range', min: -1.5, max: 1.5, step: 0.0001, defaultValue: 0 },
    { key: 'zoom', labelKey: 'algo.mandelbrot.zoom', type: 'range', min: 0, max: 8, step: 0.01, defaultValue: 0, curve: 2 },
    { key: 'maxIter', labelKey: 'algo.mandelbrot.iterations', type: 'range', min: 32, max: 800, step: 16, defaultValue: 224 },
    /*
     * 默认色是**纯黑白**，与「通道错位」这类特效的缩略图共用一条要求：
     * 它们在彩色画面上是分不开的色块，只有硬边才读得出偏移。
     * 极性取经典的「天空黑 · 边界白环 · 集合内部黑」—— 边界那圈白最细最亮，
     * 通道错位与边缘类特效的偏移正是在它上面一眼可见。
     *
     * 注意**文案标签此前是反的**（`colorA` 被标成「慢逃逸」）：`t` 随迭代次数增大，
     * 所以 `colorA` 是**快逃逸**端。这里一并改正。
     */
    { key: 'colorA', labelKey: 'algo.mandelbrot.colorFast', type: 'color', defaultValue: '#000000' },
    { key: 'colorB', labelKey: 'algo.mandelbrot.colorSlow', type: 'color', defaultValue: '#ffffff' },
    { key: 'colorIn', labelKey: 'algo.mandelbrot.colorInner', type: 'color', defaultValue: '#000000' },
    intResParam(),
  ],
  setUniforms: (gl, l, v, _ctx: AlgoUniformCtx) => {
    const center = l['u_center'];
    if (center) gl.uniform2f(center, Number(v.cx ?? -0.6), Number(v.cy ?? 0));
    const zoom = l['u_zoom'];
    if (zoom) gl.uniform1f(zoom, Math.pow(2, Number(v.zoom ?? 0)));
    const iter = l['u_maxIter'];
    if (iter) gl.uniform1i(iter, Math.round(Number(v.maxIter ?? 224)));
    const variant = l['u_variant'];
    if (variant) gl.uniform1i(variant, VARIANTS[String(v.variant)] ?? 0);
    uniform3(gl, l['u_colorA'], String(v.colorA ?? '#0b1e3a'));
    uniform3(gl, l['u_colorB'], String(v.colorB ?? '#ffd27f'));
    uniform3(gl, l['u_interior'], String(v.colorIn ?? '#000000'));
  },
};
