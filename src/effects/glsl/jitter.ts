import { floats, HASH_PLAIN_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 逐行抖动：按行号 + tick 做哈希横/纵向错位。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `jitter`（MIT，见 CREDITS.md）。
 *
 * 两处移植决定：
 * 1. 用 `HASH_PLAIN_GLSL`（**不掺 seed**）而不是 `HASH_GLSL`。图案是 (行号, tick)
 *    的纯函数，掺了 seed 会变成逐帧乱跳 —— tick 量化（15 Hz）就白做了。
 * 2. **相位自己乘**：openmosh 里 `u_time` 是引擎累积的相位，所以它的 `floor(u_time * 15)` 
 *    实际速率由 `speed` 决定。Artmatic 传的是秒，必须自己乘 `u_speed`，
 *    否则 `speed` 参数完全失效且不报错。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_speed;
${HASH_PLAIN_GLSL}
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * u_speed * 15.0);
  vec2 off = vec2(
    hash(vec2(floor(vUv.y * 500.0), t)) - 0.5,
    hash(vec2(floor(vUv.x * 500.0), t + 1.0)) - 0.5
  ) * u_amount * px;
  outColor = texture(u_texture, vUv + off);
}`,
  setUniforms: floats('amount', 'speed'),
};
