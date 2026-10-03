import { colors, compose, floats, type EffectShaderDef } from '../shader-def';

/**
 * 双色调：亮度 → 双色插值。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `duotone`（MIT，见 CREDITS.md）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform vec3 u_shadowColor;
uniform vec3 u_highlightColor;
uniform float u_intensity;
void main() {
  vec4 c = texture(u_texture, vUv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 duo = mix(u_shadowColor, u_highlightColor, luma);
  outColor = vec4(mix(c.rgb, duo, u_intensity), c.a);
}`,
  setUniforms: compose(colors('shadowColor', 'highlightColor'), floats('intensity')),
};
