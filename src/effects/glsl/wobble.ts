import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 游移：域扭曲式噪声位移，两个轴各自演化。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `wobble`（MIT，见 CREDITS.md）。
 *
 * 噪声**原样保留**（hash 常数是 `127.1 / 311.7`、3 阶 fbm）。它与共享的
 * `NOISE_GLSL` 常数不同（那是 `12.9898 / 78.233`），换过去图案会变 ——
 * 这不是「统一实现」，是改画面。要换得先有视觉对照。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_frequency;
uniform float u_speed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  v += 0.5   * noise(p); p *= 2.13;
  v += 0.25  * noise(p); p *= 2.07;
  v += 0.125 * noise(p);
  return v / 0.875;
}

void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = u_time * u_speed;
  vec2 st = vUv * u_frequency;

  float ox = fbm(st + vec2(t * 0.7, t * 0.3)) - 0.5;
  float oy = fbm(st + vec2(t * -0.4, t * 0.8) + 50.0) - 0.5;

  vec2 off = vec2(ox, oy) * 2.0 * u_amount * px;
  outColor = texture(u_texture, vUv + off);
}`,
  setUniforms: floats('amount', 'frequency', 'speed'),
};
