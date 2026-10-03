import { clockUniforms, CLOCK_GLSL, compose, floats, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 频闪：按占空比在四种模式间闪。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `strobe`（MIT，见 CREDITS.md）。
 *
 * 上游注释直说了它的 `u_time` 是**累积相位**（「one unit is one full flash cycle」），
 * 所以这里必须走 `clockPhase()` —— 照抄成秒的话 `sync`/`rate` 会双双失效。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_duty;
uniform float u_amount;
uniform int u_mode;
uniform float u_sync;
uniform float u_speed;
uniform float u_division;
uniform float u_beat;
${CLOCK_GLSL}
void main() {
  vec4 c = texture(u_texture, vUv);
  float phase = fract(clockPhase(u_time, u_sync, u_speed, u_division, u_beat));
  float on = step(phase, u_duty);
  vec3 flash = u_mode == 1 ? vec3(1.0)
             : u_mode == 2 ? 1.0 - c.rgb
             : u_mode == 3 ? vec3(dot(c.rgb, vec3(0.299, 0.587, 0.114)))
             : vec3(0.0);
  outColor = vec4(mix(c.rgb, flash, on * u_amount), c.a);
}`,
  setUniforms: compose(
    floats('duty', 'amount'),
    selectInt('mode', { black: 0, white: 1, invert: 2, mono: 3 }),
    clockUniforms(),
  ),
};
