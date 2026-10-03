import { clockUniforms, CLOCK_GLSL, compose, floats, type EffectShaderDef } from '../shader-def';

/**
 * RGB 爆发：四维值噪声给三个通道各自的位移，`pow(n, 8)` 让大部分时间接近零，
 * 所以读起来是「爆发」而不是持续抖动。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `rgb-burst`，
 * 二级来源 X-PostProcessing-Library（MIT，见 CREDITS.md）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amplitude;
uniform float u_sync;
uniform float u_speed;
uniform float u_division;
uniform float u_beat;
vec4 hash4(vec2 p) {
  vec4 q = vec4(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)),
                dot(p, vec2(419.2, 371.9)), dot(p, vec2(233.7, 97.3)));
  return fract(sin(q) * 43758.5453123);
}
vec4 noise4(vec2 p) {
  p *= 64.0;
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash4(i), hash4(i + vec2(1.0, 0.0)), f.x),
             mix(hash4(i + vec2(0.0, 1.0)), hash4(i + vec2(1.0, 1.0)), f.x), f.y);
}
${CLOCK_GLSL}
void main() {
  float phase = clockPhase(u_time, u_sync, u_speed, u_division, u_beat);
  vec4 n = noise4(vec2(phase, 2.0 * phase / 25.0));
  vec4 split = pow(n, vec4(8.0)) * vec4(vec3(u_amplitude), 1.0);
  split *= 2.0 * split.w - 1.0;
  float r = texture(u_texture, vUv + vec2(split.x, -split.y)).r;
  float g = texture(u_texture, vUv + vec2(split.y, -split.z)).g;
  float b = texture(u_texture, vUv + vec2(split.z, -split.x)).b;
  outColor = vec4(r, g, b, texture(u_texture, vUv).a);
}`,
  setUniforms: compose(floats('amplitude'), clockUniforms()),
};
