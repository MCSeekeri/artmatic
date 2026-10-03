import { clockUniforms, CLOCK_GLSL, compose, floats, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 画面滚卷：整帧沿某一轴回绕滚动（垂直保持失效的那种）。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `screen-jump`（MIT，见 CREDITS.md）。
 *
 * **这里必须用 `clockPhase()`**：openmosh 侧它的 `u_time` 是累积相位
 * （def 里有 `sync`/`speed`/`division`），shader 直接拿去做 `fract(uv + u_time)`。
 * 照抄成「u_time = 秒」会让 `speed` 与按拍同步**双双失效且不报错**。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_intensity;
uniform int u_direction;
uniform float u_sync;
uniform float u_speed;
uniform float u_division;
uniform float u_beat;
${CLOCK_GLSL}
void main() {
  float phase = clockPhase(u_time, u_sync, u_speed, u_division, u_beat);
  vec2 uv = vUv;
  // 屏幕上是向上滚（vUv.y 从上往下），像真的垂直保持失灵。
  if (u_direction == 0) {
    uv.x = mix(uv.x, fract(uv.x + phase), u_intensity);
  } else {
    uv.y = mix(uv.y, fract(uv.y - phase), u_intensity);
  }
  outColor = texture(u_texture, fract(uv));
}`,
  setUniforms: compose(
    floats('intensity'),
    selectInt('direction', { vertical: 0, horizontal: 1 }),
    clockUniforms(),
  ),
};
