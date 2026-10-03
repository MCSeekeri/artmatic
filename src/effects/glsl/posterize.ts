import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 色阶量化：每通道按 N 级取整。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `posterize`（MIT，见 CREDITS.md）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_levels;
void main() {
  vec4 c = texture(u_texture, vUv);
  float n = max(2.0, u_levels);
  outColor = vec4(floor(c.rgb * n + 0.5) / n, c.a);
}`,
  setUniforms: floats('levels'),
};
