import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 浮雕：沿某个方向取亮度的前后差分。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `emboss`（MIT，见 CREDITS.md）。
 * 偏移用 `max(px.x, px.y)` 而不是逐轴 —— 保证斜角方向也有可见位移。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_strength;
uniform float u_angle;
uniform float u_mix;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(cos(rad), sin(rad));
  vec2 off = dir * max(px.x, px.y) * 2.0;
  float s1 = dot(texture(u_texture, vUv - off).rgb, vec3(0.299, 0.587, 0.114));
  float s2 = dot(texture(u_texture, vUv + off).rgb, vec3(0.299, 0.587, 0.114));
  float diff = (s2 - s1) * u_strength + 0.5;
  vec3 emboss = clamp(vec3(diff), 0.0, 1.0);
  vec4 orig = texture(u_texture, vUv);
  outColor = vec4(mix(orig.rgb, emboss, u_mix), orig.a);
}`,
  setUniforms: floats('strength', 'angle', 'mix'),
};
