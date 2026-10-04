/**
 * mandelbrot.ts — 逃逸时间分形家族，realtime 型。
 *
 * 逐帧实时渲染（angel-echo 的分形就是逐帧实时算，不存在跳帧缓存——
 * 那是对确定性的破坏）。性能手段是内部低分辨率 + 放大，不是缓存。
 * u_maxIter 取整在 JS 侧做，避免 shader 里 float 循环边界抖动。
 *
 * **所有变体共用一个 fragment**，靠 `u_variant` 分派 —— 与 angel-echo 的
 * `mathfield` mode 3 / `uMathVariant` 同构。不做成多个 def 是刻意的：
 * 几份近乎逐字相同的 shader 是同一段逻辑的多处实现，迟早会漂。
 *
 * fragment **不含头**：`ALGO_HEAD`（algos/shader-lib.ts）拼在前面，
 * 那里提供了 `vUv` / `outColor` / `u_time` / `u_resolution` / `u_aspect`。
 *
 * ## 变体表
 *
 * | 值 | 变换 | 集合形态 |
 * |---|---|---|
 * | 0 mandel | `z ← z^p + c` | 经典 |
 * | 1 ship | 迭代前 `z ← abs(z)` | 船底尖刺 |
 * | 2 julia | `z` 取像素、`c` 取常数 | 同一条公式的「切片」，极其多样 |
 * | 3 tricorn | 迭代前 `z.y ← −z.y` | 三重对称的曼德巴 |
 * | 4 celtic | 迭代前 `z.x ← |z.x|` | 凯尔特结 |
 *
 * `power`（2..8）把「平方」推广成任意次幂 —— multibrot 的形状随幂次
 * 在「圆润」与「星芒」之间走，是这里最便宜的一个新维度。
 */

import { colorVec3 } from '../core/color';
import { intResParam, type AlgoUniformCtx } from './shader-lib';
import type { GeneratorDef } from './types';

export const MANDELBROT_FRAG = `
uniform vec2 u_center;
uniform float u_zoom;      // 放大倍率（对数滑杆在 JS 侧已取 exp）
uniform int u_maxIter;
uniform int u_variant;     // 见文件头的变体表
uniform float u_power;     // z 的幂次（2 = 经典）
uniform vec2 u_julia;      // julia 变体的常数 c
uniform int u_coloring;    // 0 = 平滑迭代 · 1 = 条带 · 2 = 轨道陷获
uniform int u_palette;     // 0 = 双色 · 1 = 余弦循环
uniform float u_cycle;     // 余弦调色板的相位偏移
uniform vec3 u_colorA;     // **快逃逸**端（远离集合：迭代几十次就发散）
uniform vec3 u_colorB;     // **慢逃逸**端（贴着集合边界：要迭代很多次才发散）
uniform vec3 u_interior;   // 集合内部

vec2 csq(vec2 z) { return vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y); }

vec2 cpowz(vec2 z, float p) {
  float r = length(z);
  if (r < 1e-12) return vec2(0.0);
  float a = atan(z.y, z.x) * p;
  return pow(r, p) * vec2(cos(a), sin(a));
}

vec3 palette(float t) {
  if (u_palette == 1) {
    float ph = t * 6.2831853 + u_cycle * 6.2831853;
    return 0.5 + 0.5 * cos(ph + vec3(0.0, 2.094, 4.188));
  }
  return mix(u_colorA, u_colorB, sqrt(clamp(t, 0.0, 1.0)));
}

void main() {
  vec2 plane = u_center + (vUv - 0.5) * vec2(u_aspect, 1.0) * (3.0 / u_zoom);
  float julia = u_variant == 2 ? 1.0 : 0.0;
  vec2 c = mix(plane, u_julia, julia);
  vec2 z = mix(vec2(0.0), plane, julia);

  int i = 0;
  float x2 = 0.0, y2 = 0.0;
  float trap = 1e9;
  float lastAng = 0.0;
  for (; i < u_maxIter; i++) {
    if (x2 + y2 > 4.0) break;
    if (u_variant == 1) z = abs(z);
    else if (u_variant == 3) z.y = -z.y;
    else if (u_variant == 4) z.x = abs(z.x);
    z = (abs(u_power - 2.0) < 0.01 ? csq(z) : cpowz(z, u_power)) + c;
    x2 = z.x * z.x;
    y2 = z.y * z.y;
    trap = min(trap, length(z));
    lastAng = atan(z.y, z.x);
  }

  if (i >= u_maxIter) {
    outColor = vec4(u_interior, 1.0);
    return;
  }

  // 平滑迭代计数（消色带）
  float sn = float(i) - log2(max(log2(x2 + y2), 1e-9)) + 4.0;
  float smoothT = clamp(sn / float(u_maxIter), 0.0, 1.0);

  if (u_coloring == 1) {
    // 条带：用终点的幅角做等值线，边界上出现一圈圈细密的条纹
    float band = 0.5 + 0.5 * sin(lastAng * 8.0 + sn * 0.35);
    outColor = vec4(palette(clamp(band, 0.0, 1.0)), 1.0);
  } else if (u_coloring == 2) {
    // 轨道陷获：轨道离原点最近的距离 —— 「运笔感」就是从这里来的
    outColor = vec4(palette(clamp(pow(trap * 0.6, 0.6), 0.0, 1.0)), 1.0);
  } else {
    outColor = vec4(palette(smoothT), 1.0);
  }
}`;

function uniform3(gl: WebGL2RenderingContext, loc: WebGLUniformLocation | null | undefined, hex: string): void {
  if (!loc) return;
  const [r, g, b] = colorVec3(hex);
  gl.uniform3f(loc, r, g, b);
}

function uniform1(gl: WebGL2RenderingContext, loc: WebGLUniformLocation | null | undefined, v: number): void {
  if (loc) gl.uniform1f(loc, v);
}

function uniform1i(gl: WebGL2RenderingContext, loc: WebGLUniformLocation | null | undefined, v: number): void {
  if (loc) gl.uniform1i(loc, Math.round(v));
}

const VARIANTS: Record<string, number> = { mandel: 0, ship: 1, julia: 2, tricorn: 3, celtic: 4 };
const COLORINGS: Record<string, number> = { smooth: 0, stripe: 1, orbitTrap: 2 };
const PALETTES: Record<string, number> = { duo: 0, cosine: 1 };

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
        { labelKey: 'algo.mandelbrot.variantJulia', value: 'julia' },
        { labelKey: 'algo.mandelbrot.variantTricorn', value: 'tricorn' },
        { labelKey: 'algo.mandelbrot.variantCeltic', value: 'celtic' },
      ],
    },
    { key: 'cx', labelKey: 'algo.mandelbrot.centerX', type: 'range', min: -2, max: 1, step: 0.0001, defaultValue: -0.6 },
    { key: 'cy', labelKey: 'algo.mandelbrot.centerY', type: 'range', min: -1.5, max: 1.5, step: 0.0001, defaultValue: 0 },
    { key: 'zoom', labelKey: 'algo.mandelbrot.zoom', type: 'range', min: 0, max: 8, step: 0.01, defaultValue: 0, curve: 2 },
    { key: 'maxIter', labelKey: 'algo.mandelbrot.iterations', type: 'range', min: 32, max: 800, step: 16, defaultValue: 224 },
    { key: 'power', labelKey: 'algo.mandelbrot.power', type: 'range', min: 2, max: 8, step: 1, defaultValue: 2 },
    {
      key: 'juliaRe',
      labelKey: 'algo.mandelbrot.juliaRe',
      type: 'range',
      min: -1.5,
      max: 1.5,
      step: 0.0005,
      defaultValue: -0.8,
      visibleWhen: (v) => v.variant === 'julia',
    },
    {
      key: 'juliaIm',
      labelKey: 'algo.mandelbrot.juliaIm',
      type: 'range',
      min: -1.5,
      max: 1.5,
      step: 0.0005,
      defaultValue: 0.156,
      visibleWhen: (v) => v.variant === 'julia',
    },
    {
      key: 'coloring',
      labelKey: 'algo.mandelbrot.coloring',
      type: 'select',
      defaultValue: 'smooth',
      options: [
        { labelKey: 'algo.mandelbrot.colorSmooth', value: 'smooth' },
        { labelKey: 'algo.mandelbrot.colorStripe', value: 'stripe' },
        { labelKey: 'algo.mandelbrot.colorTrap', value: 'orbitTrap' },
      ],
    },
    {
      key: 'palette',
      labelKey: 'algo.mandelbrot.palette',
      type: 'select',
      defaultValue: 'duo',
      options: [
        { labelKey: 'algo.mandelbrot.paletteDuo', value: 'duo' },
        { labelKey: 'algo.mandelbrot.paletteCosine', value: 'cosine' },
      ],
    },
    {
      key: 'cycle',
      labelKey: 'algo.mandelbrot.cycle',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.005,
      defaultValue: 0,
      visibleWhen: (v) => v.palette === 'cosine',
    },
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
    const julia = l['u_julia'];
    if (julia) gl.uniform2f(julia, Number(v.juliaRe ?? -0.8), Number(v.juliaIm ?? 0.156));
    uniform1(gl, l['u_zoom'], Math.pow(2, Number(v.zoom ?? 0)));
    uniform1(gl, l['u_power'], Math.max(2, Math.min(8, Number(v.power ?? 2))));
    uniform1(gl, l['u_cycle'], Number(v.cycle ?? 0));
    uniform1i(gl, l['u_maxIter'], Number(v.maxIter ?? 224));
    uniform1i(gl, l['u_variant'], VARIANTS[String(v.variant)] ?? 0);
    uniform1i(gl, l['u_coloring'], COLORINGS[String(v.coloring)] ?? 0);
    uniform1i(gl, l['u_palette'], PALETTES[String(v.palette)] ?? 0);
    uniform3(gl, l['u_colorA'], String(v.colorA ?? '#000000'));
    uniform3(gl, l['u_colorB'], String(v.colorB ?? '#ffffff'));
    uniform3(gl, l['u_interior'], String(v.colorIn ?? '#000000'));
  },
};
