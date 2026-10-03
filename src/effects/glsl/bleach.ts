import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 漂白：亮度对比拉伸后按 amount 混合。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `bleach`（MIT，见 CREDITS.md）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
void main() {
  vec4 c = texture(u_texture, vUv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 b = (vec3(luma) - 0.5) * 1.5 + 0.5;
  outColor = vec4(mix(c.rgb, clamp(b, 0.0, 1.0), u_amount), c.a);
}`,
  setUniforms: floats('amount'),
};
