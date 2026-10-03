import { clockUniforms, CLOCK_GLSL, compose, floats, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 同心环：半径被一圈圈地折进折出。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `ring-warp`，
 * 二级来源 Vidvox/ISF-Files（MIT，见 CREDITS.md）。
 *
 * **源文件又声明了一次 `uniform vec2 u_resolution;` → 删掉**。
 * `xSmear`/`ySmear` 是「保留多少原坐标」的权重（1 = 完全不折）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_rings;
uniform float u_offset;
uniform float u_xSmear;
uniform float u_ySmear;
uniform float u_centerX;
uniform float u_centerY;
uniform int u_mode;
uniform float u_sync;
uniform float u_speed;
uniform float u_division;
uniform float u_beat;
const float PI = 3.14159265359;
${CLOCK_GLSL}
void main() {
  vec2 tc = vUv * u_resolution;
  vec2 c = vec2(u_centerX, u_centerY) * u_resolution;
  float R = length(u_resolution);
  float r = distance(c, tc);
  float a = atan(tc.y - c.y, tc.x - c.x);
  tc -= c;
  if (r < R) {
    float pct = r / R;
    float off = (u_offset + clockPhase(u_time, u_sync, u_speed, u_division, u_beat)) * 2.0 * PI;
    float wave = u_mode == 0
      ? sin(pct * u_rings * 2.0 * PI + off)
      : sin(pct * u_rings * 2.0 * PI * cos(off + pct * pct * u_rings * 2.0 * PI));
    float rr = r * (1.0 + wave) * 0.5;
    tc = vec2(rr * cos(a), rr * sin(a));
    tc.x = mix(vUv.x * u_resolution.x - c.x, tc.x, max(1.0 - u_xSmear, 0.001));
    tc.y = mix(vUv.y * u_resolution.y - c.y, tc.y, max(1.0 - u_ySmear, 0.001));
  }
  vec2 loc = (tc + c) / u_resolution;
  if (any(lessThan(loc, vec2(0.0))) || any(greaterThan(loc, vec2(1.0)))) {
    outColor = vec4(0.0);
  } else {
    outColor = texture(u_texture, loc);
  }
}`,
  linearFilter: true,
  setUniforms: compose(
    floats('rings', 'offset', 'xSmear', 'ySmear', 'centerX', 'centerY'),
    selectInt('mode', { single: 0, double: 1 }),
    clockUniforms(),
  ),
};
