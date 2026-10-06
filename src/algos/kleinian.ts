/**
 * kleinian.ts — Kleinian 群极限集，realtime 型。
 *
 * ## 在画什么
 *
 * 群由两个 Möbius 变换生成：`a(z) = 1/z + (−v + iu)` 与 `b(z) = z + 2`。
 * 它的**极限集**是一个有无穷多圆互相相切的链（结构极强），用逃逸时间法可以
 * 逐像素判定「这个点属不属于极限集」：
 *
 * 1. 把点用 `b` 的周期（2）折回中央平行四边形；
 * 2. 若在 Line3 上方，对中心做点对称（这一步与 `a` 的平移项共用 `c = −v + iu`）；
 * 3. 施加 `a`；
 * 4. 若 `y < 0`（落进最大的那个圆内）→ **属于**极限集；
 * 5. 若迭代点与前两步的点几乎重合（进入 2-循环）→ **不属于**；
 * 6. 否则回到第 1 步。
 *
 * ## 来源与它的适用范围（重要）
 *
 * 出处是 **Unity Graphics Programming 第 4 卷第 2 章「Limit sets of Kleinian
 * groups」**（Jos Leys 的算法）。原文把每一步都写出来了，包括 Line3 那串看起来
 * 像魔数的常数 —— 所以这里**不是凭记忆写的**（`apollonian` 那条 DE 就是凭记忆
 * 写错的，见 AGENTS §5.6）。
 *
 * ⚠️ **但这些常数（1.95 / 7.2 / 15）是按 `u ≈ 1.94` 标定的**：Line3 的分界线
 * 公式在 `u` 偏离这个值时会逐渐失去意义，画面从「圆链」退化成一片条纹。
 * 所以 `u` 的参数区间刻意只给 1.80..2.10，默认 1.94；`v` 是真正的自由维度
 * （0 附近是左右对称的，非 0 会出现上下错位）。
 *
 * ## 两个实现选择
 *
 * - **2×2 超采样**：这个判据是布尔的，不采样就是锯齿状的一团硬边。顺带得到
 *   一个「边界覆盖率」，`glow` 拿它做辉光 —— 边界正在 `c = 0.5` 处。
 * - **判据返回带符号的深度**而不是布尔：`> 0` 属于极限集，`< 0` 不属于，
 *   绝对值是「第几步才判定出来」。`coloring = depth` 就是画这个绝对值，
 *   能看出圆链周围的层次（纯布尔只有黑白两色，信息少一半）。
 */

import { colorVec3 } from '../core/color';
import { intResParam, type AlgoUniformCtx } from './shader-lib';
import type { GeneratorDef } from './types';

export const KLEINIAN_FRAG = `
uniform vec2  u_center;
uniform float u_zoom;
uniform vec2  u_uv;        // (u, v)：群的参数
uniform int   u_iters;     // 折叠次数
uniform int   u_coloring;  // 0 = 二分 · 1 = 深度
uniform float u_glow;
uniform vec3  u_colorIn;
uniform vec3  u_colorOut;
uniform vec3  u_colorGlow;

/* 周期 w、左端 s 的折返。b(z) = z + 2 在 x 上的作用就是这个。 */
float wrapf(float x, float w, float s) {
  x -= s;
  return (x - w * floor(x / w)) + s;
}

/* 生成元 a：z → conj(z)/|z|² + (−v + iu)。 */
vec2 transA(vec2 z, vec2 t) {
  float d = dot(z, z);
  if (d < 1e-12) return z;
  return vec2(z.x, -z.y) / d + vec2(-t.y, t.x);
}

/**
 * 判定一个点是否属于极限集。
 *
 * 返回 > 0 表示属于极限集、< 0 表示不属于；绝对值是判定发生时的进度（0..1）。
 */
float kleinTest(vec2 z0, vec2 t, int iters) {
  float u = t.x;
  float v = t.y;
  vec2 z = z0;
  vec2 lz = z0 + vec2(1.0);
  vec2 llz = z0 + vec2(-1.0);

  for (int i = 0; i < 64; i++) {
    if (i >= iters) break;

    // (1) 出范围：点的 y 落在条带 [0, u] 之外就与极限集无关
    if (z.y < 0.0 || z.y > u) return -float(i + 1) / float(iters);

    // (2) 折回中央平行四边形
    float off = abs(v) / max(u, 1e-6) * z.y;
    z.x += off;
    z.x = wrapf(z.x, 2.0, -1.0);
    z.x -= off;

    // (3) 在 Line3 上方就绕中心 (−v/2, u/2) 做点对称 = 关于 c 的反射
    float L = z.x + v * 0.5;
    float sep = u * 0.5
      + sign(v) * (2.0 * u - 1.95) / 4.0 * sign(L)
      * (1.0 - exp(-(7.2 - (1.95 - u) * 15.0) * abs(L)));
    if (z.y >= sep) z = vec2(-v, u) - z;

    // (4) 施加 a
    z = transA(z, t);

    // (5) 落进最大的圆内 → 属于极限集
    if (z.y < 0.0) return float(i + 1) / float(iters);
    // (6) 2-循环 → 不属于
    if (length(z - llz) < 1e-6) return -float(i + 1) / float(iters);
    llz = lz;
    lz = z;
  }
  return -1.0;
}

void main() {
  vec2 t = u_uv;
  float u = t.x;
  // 视口映射：纵向恰好铺满条带 [0, u]，纵向比例由 u 决定 —— 换 u 时取景不跳
  vec2 base = u_center + (vUv - 0.5) * vec2(u_aspect, 1.0) * (u / u_zoom);

  // 2×2 超采样。判据是布尔的，不采样就是一团硬锯齿。
  float acc = 0.0;
  float cov = 0.0;
  for (int sy = 0; sy < 2; sy++) {
    for (int sx = 0; sx < 2; sx++) {
      vec2 jit = (vec2(float(sx), float(sy)) - 0.25) * (u / u_zoom) / u_resolution.y;
      float r = kleinTest(base + jit, t, u_iters);
      acc += abs(r);
      cov += step(0.0, r);
    }
  }
  acc *= 0.25;
  cov *= 0.25;

  vec3 col = mix(u_colorOut, u_colorIn, cov);
  if (u_coloring == 1) {
    // 深度：判定得越晚（越靠近圆链）越亮
    col = mix(u_colorOut, u_colorIn, acc);
  }
  // 边界辉光：cov 恰好在边界上是 0.5，4·cov·(1−cov) 就在那里取到 1
  col += u_colorGlow * (u_glow * 4.0 * cov * (1.0 - cov));
  outColor = vec4(col, 1.0);
}`;

const COLORINGS: Record<string, number> = { binary: 0, depth: 1 };

export const kleinianDef: GeneratorDef = {
  id: 'kleinian',
  nameKey: 'algo.kleinian',
  kind: 'realtime',
  fragment: KLEINIAN_FRAG,
  params: [
    {
      key: 'real',
      labelKey: 'algo.kleinian.real',
      type: 'range',
      // 见文件头：Line3 那串常数是按 u ≈ 1.94 标定的，区间刻意收窄
      min: 1.8,
      max: 2.1,
      step: 0.0005,
      defaultValue: 1.94,
    },
    { key: 'imag', labelKey: 'algo.kleinian.imag', type: 'range', min: -0.2, max: 0.2, step: 0.0005, defaultValue: 0.02 },
    { key: 'iters', labelKey: 'algo.kleinian.iterations', type: 'range', min: 4, max: 32, step: 1, defaultValue: 12 },
    { key: 'cx', labelKey: 'algo.kleinian.centerX', type: 'range', min: -3, max: 3, step: 0.0005, defaultValue: 0 },
    { key: 'cy', labelKey: 'algo.kleinian.centerY', type: 'range', min: -1, max: 3, step: 0.0005, defaultValue: 0.97 },
    { key: 'zoom', labelKey: 'algo.kleinian.zoom', type: 'range', min: 0, max: 8, step: 0.01, defaultValue: 0, curve: 2 },
    {
      key: 'coloring',
      labelKey: 'algo.kleinian.coloring',
      type: 'select',
      defaultValue: 'binary',
      options: [
        { labelKey: 'algo.kleinian.colorBinary', value: 'binary' },
        { labelKey: 'algo.kleinian.colorDepth', value: 'depth' },
      ],
    },
    { key: 'glow', labelKey: 'algo.kleinian.glow', type: 'range', min: 0, max: 2, step: 0.01, defaultValue: 0.35 },
    { key: 'colorIn', labelKey: 'algo.kleinian.colorInside', type: 'color', defaultValue: '#f6e7c8' },
    { key: 'colorOut', labelKey: 'algo.kleinian.colorOutside', type: 'color', defaultValue: '#07080e' },
    { key: 'colorGlow', labelKey: 'algo.kleinian.colorGlow', type: 'color', defaultValue: '#4a6cff' },
    intResParam(),
  ],
  setUniforms: (gl, l, v, _ctx: AlgoUniformCtx) => {
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

    const center = l['u_center'];
    if (center) gl.uniform2f(center, Number(v.cx ?? 0), Number(v.cy ?? 0.97));
    const uv = l['u_uv'];
    if (uv) gl.uniform2f(uv, Number(v.real ?? 1.94), Number(v.imag ?? 0.02));
    f1('u_zoom', Math.pow(2, Number(v.zoom ?? 0)));
    i1('u_iters', Math.max(2, Math.min(64, Number(v.iters ?? 12))));
    i1('u_coloring', COLORINGS[String(v.coloring)] ?? 0);
    f1('u_glow', Math.max(0, Number(v.glow ?? 0.35)));
    c3('u_colorIn', String(v.colorIn ?? '#f6e7c8'));
    c3('u_colorOut', String(v.colorOut ?? '#07080e'));
    c3('u_colorGlow', String(v.colorGlow ?? '#4a6cff'));
  },
};
