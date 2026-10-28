/**
 * grid.ts — 网格（方格纸 / 制图网格），`realtime` 型。
 *
 * 来自 `lab/patterns.ts` 的 `lab:grid`：试炼场拿它审「量化 / 周期性」类特效
 * （pixelate / scanlines 会在细网格上打摩尔纹）。产品化时**没有**沿用
 * 「32 设备像素一格」的写法 —— 那会让内部分辨率（`intRes`，纯性能档位）
 * 改变网格密度，用户调性能时画面跟着变是错的。
 *
 * 现在的口径是**纵向格数**（`cells`）：格子在画面里等宽等高（用 `u_aspect`
 * 校正横轴），与内部分辨率无关。
 *
 * fragment **不含头**（`ALGO_HEAD` 由运行时拼）。
 */

import { colors, floats } from '../effects/shader-def';
import { bgColorVisible, bgModeParam, intResParam, type AlgoUniformCtx } from './shader-lib';
import type { GeneratorDef } from './types';

const FRAG = `
uniform float u_cells;      // 纵向格数
uniform float u_thickness;  // 线宽（占格宽的比例）
uniform float u_major;      // 每 N 格一条粗线（0/1 = 关）
uniform float u_scroll;     // 平移（格/秒）
uniform vec3 u_colorBg;
uniform vec3 u_colorLine;
uniform int u_bgMode;       // 0 = 纯色底 · 1 = 透明底（见 bgModeParam）

void main() {
  // 以「格」为单位的坐标：纵向 cells 格、横向按宽高比展开 ⇒ 格子是正方形
  vec2 q = vUv * vec2(u_aspect, 1.0) * u_cells + vec2(u_time * u_scroll);

  // 到最近一条格线的距离（0 = 线上，0.5 = 格心）
  vec2 f = abs(fract(q) - 0.5);
  float d = min(f.x, f.y);

  // ⚠️ 不要叫 half —— 它是 GLSL ES 的保留字，编译直接失败（实测踩过）
  float hw = max(u_thickness, 0.005) * 0.5;
  // +0.02 是抗锯齿过渡带（单位是格）：按像素算的话低分辨率下会闪
  float line = 1.0 - smoothstep(hw, hw + 0.02, d);

  // 粗线：每 major 格一条。0/1 视为关闭（step 让分支不产生任何墨）
  float n = max(2.0, floor(u_major + 0.5));
  float on = step(2.0, n);
  vec2 mq = q / n;
  vec2 mf = abs(mq - floor(mq + 0.5));
  float md = min(mf.x, mf.y) * n;
  float majorLine = (1.0 - smoothstep(hw * 1.7, hw * 1.7 + 0.02, md)) * on;

  float ink = max(line, majorLine);
  if (u_bgMode == 1) outColor = vec4(u_colorLine, ink);
  else outColor = vec4(mix(u_colorBg, u_colorLine, ink), 1.0);
}`;

export const gridDef: GeneratorDef = {
  id: 'grid',
  nameKey: 'algo.grid',
  kind: 'realtime',
  fragment: FRAG,
  params: [
    { key: 'cells', labelKey: 'algo.grid.cells', type: 'range', min: 2, max: 64, step: 1, defaultValue: 16 },
    { key: 'thickness', labelKey: 'algo.grid.thickness', type: 'range', min: 0.01, max: 0.4, step: 0.01, defaultValue: 0.08 },
    { key: 'major', labelKey: 'algo.grid.major', type: 'range', min: 0, max: 8, step: 1, defaultValue: 4 },
    { key: 'scroll', labelKey: 'algo.grid.scroll', type: 'range', min: -2, max: 2, step: 0.01, defaultValue: 0 },
    {
      key: 'colorBg',
      labelKey: 'algo.grid.colorBg',
      type: 'color',
      defaultValue: '#0c0d10',
      visibleWhen: bgColorVisible,
    },
    { key: 'colorLine', labelKey: 'algo.grid.colorLine', type: 'color', defaultValue: '#cfd6e4' },
    bgModeParam(),
    intResParam(),
  ],
  setUniforms: (gl, l, v, ctx) => {
    floats<AlgoUniformCtx>('cells', 'thickness', 'major', 'scroll')(gl, l, v, ctx);
    colors<AlgoUniformCtx>('colorBg', 'colorLine')(gl, l, v, ctx);
  },
};
