import { clockUniforms, CLOCK_GLSL, compose, floats, HASH_PLAIN_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 缩放故障：按概率在某个中心附近重新缩放整帧。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `resize-glitch`，
 * 二级来源 Vidvox/ISF-Files（MIT，见 CREDITS.md）。
 *
 * hash 用 `HASH_PLAIN_GLSL`：图案是 tick 的纯函数，必须**逐 tick 稳定**
 * （掺 seed 会变成逐帧乱跳，`rate` 就白设了）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_chance;
uniform float u_levelX;
uniform float u_levelY;
uniform float u_centerX;
uniform float u_centerY;
uniform float u_randomWidth;
uniform float u_randomHeight;
uniform float u_randomCenter;
uniform float u_sync;
uniform float u_speed;
uniform float u_division;
uniform float u_beat;
${HASH_PLAIN_GLSL}
${CLOCK_GLSL}
void main() {
  float tick = floor(clockPhase(u_time, u_sync, u_speed, u_division, u_beat));
  vec2 c = u_randomCenter > 0.5
    ? vec2(hash(vec2(tick * 1.24, 0.234)), hash(vec2(tick * 2.93, 1.234)))
    : vec2(u_centerX, u_centerY);
  vec2 scale = vec2(1.0);
  if (u_chance >= 1.0 || hash(vec2(tick, 0.2321)) <= u_chance) {
    scale.x = u_randomWidth > 0.5 ? u_levelX * hash(vec2(tick + 0.315, 32.0)) : u_levelX;
    scale.y = u_randomHeight > 0.5 ? u_levelY * hash(vec2(tick + 0.942, 43.0)) : u_levelY;
  }
  vec2 loc = (vUv - c) / max(scale, vec2(0.01)) + c;
  if (any(lessThan(loc, vec2(0.0))) || any(greaterThan(loc, vec2(1.0)))) {
    outColor = vec4(0.0);
  } else {
    outColor = texture(u_texture, loc);
  }
}`,
  setUniforms: compose(
    floats(
      'chance',
      'levelX',
      'levelY',
      'centerX',
      'centerY',
      'randomWidth',
      'randomHeight',
      'randomCenter',
    ),
    clockUniforms(),
  ),
};
