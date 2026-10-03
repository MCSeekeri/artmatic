import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 边缘检测：9 tap Sobel（对 RGB 三通道各做一遍）
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `edges`（MIT，见 CREDITS.md）。
 *
 * `textureSize(u_texture, 0)` 拿的是**真实纹理尺寸**，比 `u_resolution` 更准 ——
 * 链中间环节的贴图尺寸与 `u_resolution` 一致，但直接问贴图不会出错。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_strength;
uniform float u_mix;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec4 tl = texture(u_texture, vUv + vec2(-px.x, -px.y));
  vec4 tm = texture(u_texture, vUv + vec2( 0.0,  -px.y));
  vec4 tr = texture(u_texture, vUv + vec2( px.x, -px.y));
  vec4 ml = texture(u_texture, vUv + vec2(-px.x,  0.0));
  vec4 mr = texture(u_texture, vUv + vec2( px.x,  0.0));
  vec4 bl = texture(u_texture, vUv + vec2(-px.x,  px.y));
  vec4 bm = texture(u_texture, vUv + vec2( 0.0,   px.y));
  vec4 br = texture(u_texture, vUv + vec2( px.x,  px.y));
  vec4 gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  vec4 gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
  vec4 edge = sqrt(gx*gx + gy*gy) * u_strength;
  vec4 orig = texture(u_texture, vUv);
  outColor = vec4(mix(orig.rgb, edge.rgb, u_mix), orig.a);
}`,
  setUniforms: floats('strength', 'mix'),
};
