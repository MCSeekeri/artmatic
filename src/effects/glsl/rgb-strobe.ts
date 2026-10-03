import { clockUniforms, CLOCK_GLSL, compose, floats, type EffectShaderDef } from '../shader-def';

/**
 * 分通道频闪：三个通道各按自己的相位反相，相位之间隔一个 `stagger`。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `rgb-strobe`，
 * 二级来源 Vidvox/ISF-Files（MIT，见 CREDITS.md）。
 *
 * 上游把「每通道不同周期」换成了「一个相位 + 错位」，这样 `rate` 是一个可扫的值。
 * `red`/`green`/`blue` 是 checkbox，着色器读作 float 当权重。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_red;
uniform float u_green;
uniform float u_blue;
uniform float u_stagger;
uniform float u_duty;
uniform float u_sync;
uniform float u_speed;
uniform float u_division;
uniform float u_beat;
${CLOCK_GLSL}
void main() {
  vec4 c = texture(u_texture, vUv);
  float base = clockPhase(u_time, u_sync, u_speed, u_division, u_beat);
  vec3 phase = fract(vec3(base) + vec3(0.0, 1.0, 2.0) * u_stagger);
  vec3 on = step(phase, vec3(u_duty)) * vec3(u_red, u_green, u_blue);
  outColor = vec4(mix(c.rgb, 1.0 - c.rgb, on), c.a);
}`,
  setUniforms: compose(
    floats('red', 'green', 'blue', 'stagger', 'duty'),
    clockUniforms(),
  ),
};
