import { floats, MATH_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 极坐标：笛卡尔 ↔ 极坐标互换（`bounce` 让半径越界时折返而不是裁掉）。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `polar`（MIT，见 CREDITS.md）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_angle;
${MATH_GLSL}
void main() {
  vec2 uv = vUv - 0.5;
  float r = length(uv) * 2.0;
  float a = atan(uv.y, uv.x) / 6.28318530 + 0.5 + u_angle / 360.0;
  vec2 polarUV = vec2(fract(a), bounce(r));
  outColor = mix(texture(u_texture, vUv), texture(u_texture, polarUV), u_amount);
}`,
  setUniforms: floats('amount', 'angle'),
};
