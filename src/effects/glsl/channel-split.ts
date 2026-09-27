import { floats, type EffectShaderDef } from '../shader-def';

/** 通道错位：RGB 三通道沿同一方向各取一次（故障艺术的入门词汇）。 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_angle;
void main() {
  vec2 dir = vec2(cos(u_angle), sin(u_angle)) * u_amount / u_resolution;
  vec4 cr = texture(u_texture, vUv + dir);
  vec4 cg = texture(u_texture, vUv);
  vec4 cb = texture(u_texture, vUv - dir);
  outColor = vec4(cr.r, cg.g, cb.b, max(max(cr.a, cg.a), cb.a));
}`,
  setUniforms: floats('amount', 'angle'),
};
