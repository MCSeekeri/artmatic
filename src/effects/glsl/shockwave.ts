import { clockUniforms, CLOCK_GLSL, compose, floats, type EffectShaderDef } from '../shader-def';

/**
 * 冲击波：一圈位移从中心向外扩散。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `shockwave`，
 * 二级来源 Vidvox/ISF-Files（MIT，见 CREDITS.md）。
 * 上游是事件触发的，这里改成按它的时钟周期重复。
 *
 * **源文件又声明了一次 `uniform vec2 u_resolution;` → 删掉**（与 `EFFECT_HEAD` 重复）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_magnitude;
uniform float u_distortion;
uniform float u_centerX;
uniform float u_centerY;
uniform float u_sync;
uniform float u_speed;
uniform float u_division;
uniform float u_beat;
${CLOCK_GLSL}
void main() {
  vec2 c = vec2(u_centerX, u_centerY);
  // 在方形空间里量距离，宽画幅上环才是圆的。
  vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 rel = (vUv - c) * asp;
  float d = length(rel);
  float t = fract(clockPhase(u_time, u_sync, u_speed, u_division, u_beat)) * (1.0 + d);
  vec2 uv = vUv;
  if (d <= t + u_magnitude && d >= t - u_magnitude) {
    float diff = d - t;
    float powDiff = 1.0 - pow(abs(diff * u_distortion), 0.8);
    vec2 dir = rel / max(d, 1e-5) / asp;
    uv = vUv + dir * diff * powDiff;
  }
  outColor = texture(u_texture, uv);
}`,
  linearFilter: true,
  setUniforms: compose(floats('magnitude', 'distortion', 'centerX', 'centerY'), clockUniforms()),
};
