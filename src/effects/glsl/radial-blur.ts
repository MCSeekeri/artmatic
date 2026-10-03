import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 径向模糊：12 tap，权重随距离线性递减（越远越淡，中心保持清晰）。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `radial-blur`（MIT，见 CREDITS.md）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_strength;
void main() {
  vec2 c = vUv - 0.5;
  vec4 col = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < 12; i++) {
    float t = float(i) / 11.0;
    float w = 1.0 - 0.5 * t;
    col += texture(u_texture, vUv - c * t * u_strength * 0.25) * w;
    total += w;
  }
  outColor = col / total;
}`,
  setUniforms: floats('strength'),
};
