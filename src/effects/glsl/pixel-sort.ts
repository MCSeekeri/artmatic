import { compose, floats, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 像素排序：按亮度映射成位移量（**近似**像素排序，不是真的排序）。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `pixel-sort`（MIT，见 CREDITS.md）。
 * 它只把 `[threshold, ceiling]` 区间内的亮度归一化成沿轴位移，所以得到的是
 * 「拉丝」而不是排序后那种有序块 —— 名字是历史包袱，行为照抄。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_threshold;
uniform float u_ceiling;
uniform float u_range;
uniform int u_direction;
uniform float u_reverse;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec4 c = texture(u_texture, vUv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float lo = min(u_threshold, u_ceiling);
  float hi = max(u_threshold, u_ceiling);
  float span = hi - lo;
  float norm = span > 0.001 ? (clamp(luma, lo, hi) - lo) / span : 0.0;
  float sign = (u_reverse > 0.5) ? -1.0 : 1.0;
  float disp = norm * u_range * sign;
  vec2 offset = u_direction == 0 ? vec2(disp * px.x, 0.0) : vec2(0.0, disp * px.y);
  outColor = texture(u_texture, vUv + offset);
}`,
  setUniforms: compose(
    // `reverse` 是 checkbox，着色器读作 float（> 0.5 判真）。
    floats('threshold', 'ceiling', 'range', 'reverse'),
    selectInt('direction', { horizontal: 0, vertical: 1 }),
  ),
};
