/**
 * mandelbrot.ts — Mandelbrot 逃逸时间分形，realtime 型。
 *
 * 逐帧实时渲染（angel-echo 的分形就是逐帧实时算，不存在跳帧缓存——
 * 那是对确定性的破坏）。性能手段是内部低分辨率 + 放大，不是缓存。
 * u_maxIter 取整在 JS 侧做，避免 shader 里 float 循环边界抖动。
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
uniform vec3 u_colorA;     // 慢逃逸
uniform vec3 u_colorB;     // 快逃逸
uniform vec3 u_interior;   // 集合内部

void main() {
  vec2 c = u_center + (vUv - 0.5) * vec2(u_aspect, 1.0) * (3.0 / u_zoom);
  vec2 z = vec2(0.0);
  int i = 0;
  float x2 = 0.0, y2 = 0.0;
  for (; i < u_maxIter; i++) {
    if (x2 + y2 > 4.0) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
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

export const mandelbrotDef: GeneratorDef = {
  id: 'mandelbrot',
  nameKey: 'algo.mandelbrot',
  kind: 'realtime',
  fragment: MANDELBROT_FRAG,
  params: [
    { key: 'cx', labelKey: 'algo.mandelbrot.centerX', type: 'range', min: -2, max: 1, step: 0.0001, defaultValue: -0.6 },
    { key: 'cy', labelKey: 'algo.mandelbrot.centerY', type: 'range', min: -1.5, max: 1.5, step: 0.0001, defaultValue: 0 },
    { key: 'zoom', labelKey: 'algo.mandelbrot.zoom', type: 'range', min: 0, max: 8, step: 0.01, defaultValue: 0, curve: 2 },
    { key: 'maxIter', labelKey: 'algo.mandelbrot.iterations', type: 'range', min: 32, max: 800, step: 16, defaultValue: 224 },
    { key: 'colorA', labelKey: 'algo.mandelbrot.colorSlow', type: 'color', defaultValue: '#0b1e3a' },
    { key: 'colorB', labelKey: 'algo.mandelbrot.colorFast', type: 'color', defaultValue: '#ffd27f' },
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
    uniform3(gl, l['u_colorA'], String(v.colorA ?? '#0b1e3a'));
    uniform3(gl, l['u_colorB'], String(v.colorB ?? '#ffd27f'));
    uniform3(gl, l['u_interior'], String(v.colorIn ?? '#000000'));
  },
};
