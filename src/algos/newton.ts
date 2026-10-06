/**
 * newton.ts — 牛顿分形（zⁿ − 1 的牛顿迭代吸引域），realtime 型。
 *
 * ## 数学
 *
 * 对 `f(z) = zⁿ − 1` 做牛顿迭代：`z ← z − a·f(z)/f'(z)`。
 * 因为 `f'(z) = n·z^(n−1)`，整体可以化简成一个闭式的复数运算：
 *
 * ```
 * z ← z·(1 − a/n) + a/(n·z^(n−1))
 * ```
 *
 * 这里**保持 `f/f'` 的写法**而不是用化简式：化简式在 `z → 0` 时会先产生
 * 一个巨大的 `1/z^(n−1)` 再被 `z` 乘回去，浮点上有抵消；而 `f/f'` 形式
 * 在导数趋零时能干净地判出来（见下面的 `cd_` 检查）。
 *
 * ## 三个参数维度，各自改变什么
 *
 * | 参数 | 作用 |
 * |---|---|
 * | `power` | n 个根把平面分成 n 个吸引域；n=3 是经典的三叉，n=4/5 出现花瓣状 |
 * | `relax` | `a ≠ 1` 的**松弛牛顿**：a<1 时收敛更慢、叶瓣变细；a>1 会发散（画出 Julia 集） |
 * | `coloring` | 同一张图完全不同的读法（吸引域 / 收敛速度 / 平滑距离） |
 *
 * ## 两个 GLSL 陷阱（都真实踩过）
 *
 * 1. **`vec2 / vec2` 是逐分量除法，不是复数除法。** 数学上的 `(f)/(f')` 必须
 *    显式写成 `cdiv`。写成 `a / b` 能编译、能跑，只是结果完全不是牛顿法 ——
 *    画面会是一团噪声，而且看起来「像是分形」，很容易以为只是参数没调好。
 * 2. **`pow(r, p)` 在 `r = 0` 处是 NaN**（`pow(0, 0)` 与 `pow(0, 负)` 都未定义）。
 *    复数幂走极坐标之前必须先挡 `r < eps`。
 *
 * fragment **不含头**：`ALGO_HEAD` 拼在前面，那里提供 `vUv` / `outColor` /
 * `u_time` / `u_resolution` / `u_aspect`。
 */

import { colorVec3 } from '../core/color';
import { intResParam, type AlgoUniformCtx } from './shader-lib';
import type { GeneratorDef } from './types';

export const NEWTON_FRAG = `
uniform vec2  u_center;
uniform float u_zoom;      // 已取 exp 的放大倍率
uniform int   u_power;     // n（z^n − 1 的 n）
uniform float u_relax;     // 松弛系数 a
uniform int   u_maxIter;
uniform float u_tol;       // 收敛判定半径
uniform float u_bail;      // 发散判定半径（|z| 超过它就算跑掉）
uniform int   u_coloring;  // 0 = 吸引域 · 1 = 收敛速度 · 2 = 平滑距离
uniform int   u_palette;   // 0 = 双色 · 1 = 余弦 · 2 = 色轮
uniform float u_cycle;     // 余弦/色轮的相位偏移
uniform vec3  u_colorA;    // 双色的低端 / 发散色
uniform vec3  u_colorB;    // 双色的高端

/* 复数除法。GLSL 的「vec2 / vec2」是逐分量除法，不是这个 —— 见文件头第 1 条。 */
vec2 cdiv(vec2 a, vec2 b) {
  float d = dot(b, b);
  if (d < 1e-20) return vec2(0.0);
  return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d;
}

/* 极坐标复数幂。r → 0 时 pow 未定义，必须先挡。 */
vec2 cpow(vec2 z, float p) {
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
  if (u_palette == 2) {
    // 色轮：把 t 当色相直接转一圈。吸引域模式下 t 只有 n 个离散取值
    // （k/n），于是 n 个吸引域各得一个均匀分布的色相 —— 那正是经典长相。
    float h = fract(t + u_cycle) * 6.2831853;
    return 0.5 + 0.5 * cos(h + vec3(0.0, 2.094, 4.188));
  }
  return mix(u_colorA, u_colorB, sqrt(clamp(t, 0.0, 1.0)));
}

void main() {
  vec2 z = u_center + (vUv - 0.5) * vec2(u_aspect, 1.0) * (4.0 / u_zoom);
  float n = float(u_power);

  int i = 0;
  float d2 = 1e9;          // 到最近根的距离平方
  int root = 0;
  bool diverged = false;

  for (; i < u_maxIter; i++) {
    vec2 zn = cpow(z, n);
    vec2 dz = n * cpow(z, n - 1.0);
    if (dot(dz, dz) < 1e-24) break;      // 导数趋零：这是极点，不是根
    z -= u_relax * cdiv(zn - vec2(1.0, 0.0), dz);

    float r2 = dot(z, z);
    if (r2 > u_bail * u_bail) { diverged = true; break; }

    // n 个根都在单位圆上、幅角是 2πk/n，所以「最近的是哪个根」只看幅角。
    // 比逐个求根再比距离便宜 n 倍，而且没有 n 个临时变量的分配。
    float ang = atan(z.y, z.x) / 6.2831853 * n;
    root = int(floor(ang + 0.5));
    root = ((root % u_power) + u_power) % u_power;
    d2 = r2 + 1.0 - 2.0 * length(z);     // |z − root|²，展开后 |root| = 1
    if (d2 < u_tol * u_tol) break;
  }

  float t;
  if (u_coloring == 1) {
    // 收敛速度：同一吸引域内部也有层次 —— 这个读法最像「地形图」
    t = clamp(float(i) / float(u_maxIter), 0.0, 1.0);
  } else if (u_coloring == 2) {
    // 平滑距离：用 |z − root| 的对数做等值线，根附近是细密的同心环
    t = clamp(log(max(sqrt(max(d2, 0.0)), 1e-9)) / log(max(u_tol, 1e-9)), 0.0, 1.0);
  } else {
    // 吸引域：色相取自根号，亮度取自收敛速度（慢的暗，于是边界显形）
    t = float(root) / n;
  }

  vec3 col = palette(t);
  if (diverged) {
    col = u_colorA;
  } else if (u_coloring == 0) {
    col *= 0.35 + 0.65 * pow(1.0 - clamp(float(i) / float(u_maxIter), 0.0, 1.0), 0.4);
  }
  outColor = vec4(col, 1.0);
}`;

const COLORINGS: Record<string, number> = { basin: 0, speed: 1, smooth: 2 };
const PALETTES: Record<string, number> = { duo: 0, cosine: 1, hue: 2 };

export const newtonDef: GeneratorDef = {
  id: 'newton',
  nameKey: 'algo.newton',
  kind: 'realtime',
  fragment: NEWTON_FRAG,
  params: [
    { key: 'power', labelKey: 'algo.newton.power', type: 'range', min: 2, max: 8, step: 1, defaultValue: 3 },
    {
      key: 'relax',
      labelKey: 'algo.newton.relax',
      type: 'range',
      min: 0.4,
      max: 1.4,
      step: 0.005,
      // 1.0 = 标准牛顿法。往下调收敛变慢、叶瓣变细；往上调会有一圈点发散
      // （那些点画出来就是这条迭代的 Julia 集）。
      defaultValue: 1,
    },
    { key: 'maxIter', labelKey: 'algo.newton.iterations', type: 'range', min: 16, max: 400, step: 8, defaultValue: 96 },
    { key: 'tol', labelKey: 'algo.newton.tolerance', type: 'range', min: 0.0001, max: 0.05, step: 0.0001, defaultValue: 0.001 },
    { key: 'bail', labelKey: 'algo.newton.bail', type: 'range', min: 4, max: 512, step: 4, defaultValue: 64 },
    { key: 'cx', labelKey: 'algo.newton.centerX', type: 'range', min: -2.5, max: 2.5, step: 0.0005, defaultValue: 0 },
    { key: 'cy', labelKey: 'algo.newton.centerY', type: 'range', min: -2.5, max: 2.5, step: 0.0005, defaultValue: 0 },
    { key: 'zoom', labelKey: 'algo.newton.zoom', type: 'range', min: 0, max: 8, step: 0.01, defaultValue: 0, curve: 2 },
    {
      key: 'coloring',
      labelKey: 'algo.newton.coloring',
      type: 'select',
      defaultValue: 'basin',
      options: [
        { labelKey: 'algo.newton.colorBasin', value: 'basin' },
        { labelKey: 'algo.newton.colorSpeed', value: 'speed' },
        { labelKey: 'algo.newton.colorSmooth', value: 'smooth' },
      ],
    },
    {
      key: 'palette',
      labelKey: 'algo.newton.palette',
      type: 'select',
      defaultValue: 'hue',
      options: [
        { labelKey: 'algo.newton.paletteDuo', value: 'duo' },
        { labelKey: 'algo.newton.paletteCosine', value: 'cosine' },
        { labelKey: 'algo.newton.paletteHue', value: 'hue' },
      ],
    },
    {
      key: 'cycle',
      labelKey: 'algo.newton.cycle',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.005,
      defaultValue: 0,
      visibleWhen: (v) => v.palette === 'cosine' || v.palette === 'hue',
    },
    { key: 'colorA', labelKey: 'algo.newton.colorA', type: 'color', defaultValue: '#0a0a12' },
    { key: 'colorB', labelKey: 'algo.newton.colorB', type: 'color', defaultValue: '#f2e9dc' },
    intResParam(),
  ],
  setUniforms: (gl, l, v, _ctx: AlgoUniformCtx) => {
    const center = l['u_center'];
    if (center) gl.uniform2f(center, Number(v.cx ?? 0), Number(v.cy ?? 0));
    const f1 = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1f(loc, value);
    };
    const i1 = (name: string, value: number): void => {
      const loc = l[name];
      if (loc) gl.uniform1i(loc, Math.round(value));
    };
    const c3 = (name: string, hex: string): void => {
      const loc = l[name];
      if (!loc) return;
      const [r, g, b] = colorVec3(hex);
      gl.uniform3f(loc, r, g, b);
    };

    f1('u_zoom', Math.pow(2, Number(v.zoom ?? 0)));
    i1('u_power', Math.max(2, Math.min(8, Number(v.power ?? 3))));
    f1('u_relax', Math.max(0.05, Number(v.relax ?? 1)));
    i1('u_maxIter', Math.max(4, Number(v.maxIter ?? 96)));
    // 收敛半径必须**远小于** 1：单位圆上相邻两根本来就只隔 2π/n。
    // 给到 0.3 之类的值会让三个吸引域在中心附近互相吃掉，图变成一个玩具球。
    f1('u_tol', Math.max(1e-6, Math.min(0.25, Number(v.tol ?? 0.001))));
    f1('u_bail', Math.max(1.5, Number(v.bail ?? 64)));
    i1('u_coloring', COLORINGS[String(v.coloring)] ?? 0);
    i1('u_palette', PALETTES[String(v.palette)] ?? 2);
    f1('u_cycle', Number(v.cycle ?? 0));
    c3('u_colorA', String(v.colorA ?? '#0a0a12'));
    c3('u_colorB', String(v.colorB ?? '#f2e9dc'));
  },
};
