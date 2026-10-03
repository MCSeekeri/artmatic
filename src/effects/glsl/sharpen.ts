import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 锐化：3×3 高斯模糊做反锐化掩模，带阈值（低于阈值的细节不放大，避免噪点）。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `sharpen`（MIT，见 CREDITS.md）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_radius;
uniform float u_threshold;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0)) * u_radius;
  vec4 c = texture(u_texture, vUv);

  // 3x3 高斯（sigma ~0.85）：中心 4/16，边 2/16，角 1/16
  vec3 blur =
    texture(u_texture, vUv + vec2(-px.x, -px.y)).rgb * 1.0 +
    texture(u_texture, vUv + vec2(   0., -px.y)).rgb * 2.0 +
    texture(u_texture, vUv + vec2( px.x, -px.y)).rgb * 1.0 +
    texture(u_texture, vUv + vec2(-px.x,    0.)).rgb * 2.0 +
    c.rgb * 4.0 +
    texture(u_texture, vUv + vec2( px.x,    0.)).rgb * 2.0 +
    texture(u_texture, vUv + vec2(-px.x,  px.y)).rgb * 1.0 +
    texture(u_texture, vUv + vec2(   0.,  px.y)).rgb * 2.0 +
    texture(u_texture, vUv + vec2( px.x,  px.y)).rgb * 1.0;
  blur /= 16.0;

  vec3 detail = c.rgb - blur;
  vec3 mask = step(vec3(u_threshold), abs(detail));
  outColor = vec4(clamp(c.rgb + detail * u_amount * mask, 0.0, 1.0), c.a);
}`,
  setUniforms: floats('amount', 'radius', 'threshold'),
};
