import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 凸起畸变：把半径按 `pow(pct, 1 - amount)` 重映射（负值内凹）。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `bulge`（MIT，见 CREDITS.md）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_radius;
void main() {
  vec2 center = vec2(0.5);
  vec2 uv = vUv - center;
  float dist = length(uv);
  if (dist > 0.0 && dist < u_radius) {
    float pct = dist / u_radius;
    float distortion = pow(pct, 1.0 - u_amount) * u_radius;
    uv = uv / dist * distortion;
  }
  outColor = texture(u_texture, uv + center);
}`,
  setUniforms: floats('amount', 'radius'),
};
