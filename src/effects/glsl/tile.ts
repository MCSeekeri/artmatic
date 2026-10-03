import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 平铺：旋转 + 滚动 + 逐格镜像。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `tile`（MIT，见 CREDITS.md）。
 *
 * **相位自己乘**：shader 里原本是 `u_time * 0.2`，而 openmosh 的 `u_time` 已是
 * 累积相位（速率由 `speed` 定）。Artmatic 传秒，所以补上 `u_speed`
 * （`speed` 默认 0 = 静止，符合上游默认）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_size;
uniform float u_offset;
uniform float u_angle;
uniform float u_speed;
void main() {
  float rad = u_angle * 3.14159265 / 180.0;
  float c = cos(rad), s = sin(rad);
  vec2 centered = vUv - 0.5;
  vec2 rotated = vec2(c * centered.x + s * centered.y, -s * centered.x + c * centered.y) + 0.5;
  vec2 uv = rotated * u_size + u_offset + vec2(u_time * u_speed * 0.2, 0.0);
  vec2 cell = floor(uv);
  vec2 local = fract(uv);
  vec2 mirrored = mix(local, 1.0 - local, mod(cell, 2.0));
  outColor = texture(u_texture, mirrored);
}`,
  setUniforms: floats('size', 'offset', 'angle', 'speed'),
};
