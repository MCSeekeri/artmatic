import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 整帧抖动：按 tick 随机平移整个画面。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `shake`（MIT，见 CREDITS.md）。
 * 这里的 `hash(float)` 是**逐帧量化**的（`floor(u_time * u_speed)`），
 * 所以它要的是一次求值一个值，与 `HASH_PLAIN_GLSL` 的 `hash(vec2)` 不同名不同签名
 * —— 保留自带实现，别去套共享头。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_speed;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * u_speed);
  vec2 off = vec2(
    (hash(t) - 0.5) * 2.0,
    (hash(t + 7.0) - 0.5) * 2.0
  ) * u_amount * px;
  outColor = texture(u_texture, vUv + off);
}`,
  setUniforms: floats('amount', 'speed'),
};
