/**
 * bars.ts — 彩条（竖条色块 + 底部灰阶斜坡），`realtime` 型。
 *
 * 来自 `lab/patterns.ts` 的 `lab:bars`：试炼场拿它当「通道位移 / 色块边界」
 * 的放大镜。产品化时补了参数（条数 / 相位 / 灰阶高度 / 扫描速度），因为
 * 真实用法不止是审特效 —— 彩条本身就是常用的测试画面与视觉元素。
 *
 * 颜色用 HSV 环上的等分色相而不是硬编码 7 个颜色：条数可调，硬编码表无法
 * 跟着变。默认 7 条正好落在红橙黄绿青蓝紫的近似位置。
 *
 * fragment **不含头**（`ALGO_HEAD` 由运行时拼）。
 */

import { floats } from '../effects/shader-def';
import { intResParam, type AlgoUniformCtx } from './shader-lib';
import type { GeneratorDef } from './types';

const FRAG = `
uniform float u_count;       // 竖条数（取整）
uniform float u_phase;       // 色相相位（0..1 转一圈）
uniform float u_ramp;        // 底部灰阶带高度（0..0.5）
uniform float u_scroll;      // 横向滚动（条/秒）
uniform float u_saturation;  // 饱和度
uniform float u_gain;        // 亮度

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
  // 底部 20%（默认）是 0→1 的 16 级灰阶：读色带 / 量化问题用
  if (vUv.y < u_ramp) {
    float step16 = floor(vUv.x * 16.0) / 15.0;
    outColor = vec4(vec3(step16), 1.0);
    return;
  }

  float n = max(2.0, floor(u_count + 0.5));
  // 滚动量乘 0.08：滑杆拉满时约 0.8 条/秒，够看出运动又不至于晃眼
  float x = fract(vUv.x + u_time * u_scroll * 0.08);
  float i = floor(x * n);
  float hue = fract(i / n + u_phase);
  vec3 col = hsv2rgb(vec3(hue, clamp(u_saturation, 0.0, 1.0), 1.0)) * u_gain;
  outColor = vec4(col, 1.0);
}`;

export const barsDef: GeneratorDef = {
  id: 'bars',
  nameKey: 'algo.bars',
  kind: 'realtime',
  fragment: FRAG,
  params: [
    { key: 'count', labelKey: 'algo.bars.count', type: 'range', min: 2, max: 16, step: 1, defaultValue: 7 },
    { key: 'phase', labelKey: 'algo.bars.phase', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
    { key: 'ramp', labelKey: 'algo.bars.ramp', type: 'range', min: 0, max: 0.5, step: 0.01, defaultValue: 0.2 },
    { key: 'scroll', labelKey: 'algo.bars.scroll', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
    { key: 'saturation', labelKey: 'algo.bars.saturation', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 1 },
    { key: 'gain', labelKey: 'algo.bars.gain', type: 'range', min: 0, max: 2, step: 0.01, defaultValue: 1 },
    intResParam(),
  ],
  setUniforms: (gl, l, v, ctx) => {
    floats<AlgoUniformCtx>('count', 'phase', 'ramp', 'scroll', 'saturation', 'gain')(gl, l, v, ctx);
  },
};
