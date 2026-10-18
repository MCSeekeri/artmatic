/**
 * gradient.ts — 渐变（线性 / 径向 / 锥形），`realtime` 型。
 *
 * 来自 `lab/patterns.ts` 的 `lab:gradient`：试炼场拿它审色带（banding）与
 * 拖尾（echo）。产品化时把「缓慢旋转的锥形」拆成三种模式 + 可调参数 ——
 * 渐变是最常用的底色 / 转场素材之一，固定形态不够用。
 *
 * `u_bands` 不是纯装饰：把连续渐变量化成 N 级，正好是「色带」本身的常见
 * 用法（海报底色 / 复古 UI）。它也让这张图能反过来当 banding 的对照。
 *
 * fragment **不含头**（`ALGO_HEAD` 由运行时拼）。
 */

import { colors, floats, selectInt } from '../effects/shader-def';
import { intResParam, type AlgoUniformCtx } from './shader-lib';
import type { GeneratorDef } from './types';

const FRAG = `
uniform int u_mode;       // 0 线性 · 1 径向 · 2 锥形
uniform float u_angle;    // 方向 / 起始角（0..1 转）
uniform float u_softness; // 过渡宽度（0 = 硬边，1 = 整幅渐变）
uniform float u_bands;    // 量化级数（0/1 = 连续）
uniform float u_speed;    // 锥形旋转（转/秒）
uniform vec3 u_colorA;
uniform vec3 u_colorB;

void main() {
  vec2 c = vUv - 0.5;
  float a = u_angle * 6.2831853;
  float t;

  if (u_mode == 1) {
    // 径向：中心 → 边缘。乘 2 让四角接得上 1.0
    t = clamp(length(c) * 2.0, 0.0, 1.0);
  } else if (u_mode == 2) {
    // 锥形：角度轴。减 angle 只是旋转起始线，加 time*speed 才是动画
    t = fract((atan(c.y, c.x) - a) / 6.2831853 + u_time * u_speed);
  } else {
    // 线性：沿 direction 的投影。c 的模最大约 0.707，+0.5 后两端落在 0/1 附近
    vec2 dir = vec2(cos(a), sin(a));
    t = clamp(dot(c, dir) + 0.5, 0.0, 1.0);
  }

  /*
   * softness：0 时过渡带收成 0.001（近似硬边），1 时铺满整幅。
   * 这里刻意不做「中心对齐」的 smoothstep —— 那会把线性渐变的暗端也抬起来，
   * 与「两端色恰好是 colorA / colorB」的直觉冲突。
   */
  float w = max(u_softness, 0.001);
  t = smoothstep(0.5 - w * 0.5, 0.5 + w * 0.5, t);

  // 量化：0/1 视为关（至少两级才有「带」的意义）
  float bands = floor(u_bands + 0.5);
  if (bands >= 2.0) t = floor(t * bands) / (bands - 1.0);

  outColor = vec4(mix(u_colorA, u_colorB, t), 1.0);
}`;

const MODES: Record<string, number> = { linear: 0, radial: 1, conic: 2 };

export const gradientDef: GeneratorDef = {
  id: 'gradient',
  nameKey: 'algo.gradient',
  kind: 'realtime',
  fragment: FRAG,
  params: [
    {
      key: 'mode',
      labelKey: 'algo.gradient.mode',
      type: 'select',
      defaultValue: 'linear',
      options: [
        { labelKey: 'algo.gradient.modeLinear', value: 'linear' },
        { labelKey: 'algo.gradient.modeRadial', value: 'radial' },
        { labelKey: 'algo.gradient.modeConic', value: 'conic' },
      ],
    },
    { key: 'angle', labelKey: 'algo.gradient.angle', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
    { key: 'softness', labelKey: 'algo.gradient.softness', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    { key: 'bands', labelKey: 'algo.gradient.bands', type: 'range', min: 0, max: 32, step: 1, defaultValue: 0 },
    { key: 'speed', labelKey: 'algo.gradient.speed', type: 'range', min: 0, max: 1, step: 0.005, defaultValue: 0.05 },
    { key: 'colorA', labelKey: 'algo.gradient.colorA', type: 'color', defaultValue: '#12203a' },
    { key: 'colorB', labelKey: 'algo.gradient.colorB', type: 'color', defaultValue: '#ffb347' },
    intResParam(),
  ],
  setUniforms: (gl, l, v, ctx) => {
    selectInt<AlgoUniformCtx>('mode', MODES, 0)(gl, l, v, ctx);
    floats<AlgoUniformCtx>('angle', 'softness', 'bands', 'speed')(gl, l, v, ctx);
    colors<AlgoUniformCtx>('colorA', 'colorB')(gl, l, v, ctx);
  },
};
