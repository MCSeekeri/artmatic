import { floats, HSV_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 萨巴蒂尔效应（暗房曝光反折）。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `solarize`（MIT，见 CREDITS.md）。
 * 关键在**饱和度跟着「原亮度」而不是「反折后的值」走**：否则读起来只是一个
 * 偏色的负片，而不是暗房感。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_pivot;
uniform float u_curve;
uniform float u_colorize;
${HSV_GLSL}
void main() {
  vec4 c = texture(u_texture, vUv);
  vec3 hsv = rgb2hsv(c.rgb);

  // 反折点处落到零 —— 中间调那道暗带就是全部效果所在。
  float v = pow(hsv.z, u_curve);
  float folded = v < u_pivot
    ? 1.0 - v / max(u_pivot, 1e-4)
    : (v - u_pivot) / max(u_pivot, 1e-4);

  float sat = hsv.y * hsv.z * u_colorize;

  outColor = vec4(clamp(hsv2rgb(vec3(hsv.x, sat, folded)), 0.0, 1.0), c.a);
}`,
  setUniforms: floats('pivot', 'curve', 'colorize'),
};
