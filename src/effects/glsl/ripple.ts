import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 涟漪：从中心向外扩散的径向正弦位移，幅度随距离衰减。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `ripple`（MIT，见 CREDITS.md）。
 * 相位自己乘（`u_time * u_speed * 4.0`）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_frequency;
uniform float u_speed;
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  vec2 px = 1.0 / res;
  float aspect = res.x / res.y;
  vec2 c = vUv - 0.5;
  c.x *= aspect;
  float d = length(c);
  float wave = sin(d * u_frequency * 6.2831 - u_time * u_speed * 4.0) / (1.0 + d * 3.0);
  vec2 dir = d > 0.0001 ? c / d : vec2(0.0);
  vec2 uv = vUv + dir * wave * u_amount * px;
  outColor = texture(u_texture, uv);
}`,
  setUniforms: floats('amount', 'frequency', 'speed'),
};
