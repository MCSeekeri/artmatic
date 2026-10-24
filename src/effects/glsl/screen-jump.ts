import { clockUniforms, CLOCK_GLSL, compose, floats, selectInt, type EffectShaderDef, type EffectUniformCtx } from '../shader-def';
import { jerkOffset } from '../jerk';

/**
 * 画面滚卷：整帧沿某一轴回绕滚动（垂直保持失效的那种）。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `screen-jump`（MIT，见 CREDITS.md）。
 *
 * **这里必须用 `clockPhase()`**：openmosh 侧它的 `u_time` 是累积相位
 * （def 里有 `sync`/`speed`/`division`），shader 直接拿去做 `fract(uv + u_time)`。
 * 照抄成「u_time = 秒」会让 `speed` 与按拍同步**双双失效且不报错**。
 *
 * ## 抽动（`jerk` / `jerkRate`）
 *
 * 相位上再叠一个**分段常量** `u_jump`：刻度之内它不动（画面照常平滑滚动），
 * 跨刻度时整帧突然跳到另一个位置。位移由 `jerkOffset()` 在 JS 侧算好
 * （`effects/jerk.ts` 记了为什么不能写进 fragment：`u_seed` 逐帧变，拿它做
 * 「刻度内恒定」的量会把抽动变成逐帧噪声）。
 *
 * 它落在 `fract()` 里面 ⇒ 幅度天生有界，画面不会越滚越远：`jerk` 小的时候
 * 只是「卡了一格」，调到大仍然围着平滑滚动的那个位置晃。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_intensity;
uniform int u_direction;
uniform float u_sync;
uniform float u_speed;
uniform float u_division;
uniform float u_beat;
uniform float u_jump;
${CLOCK_GLSL}
void main() {
  // u_jump 是抽动的位移（单位：整幅）。刻度内恒定，跨刻度突变 —— 见 effects/jerk.ts。
  float phase = clockPhase(u_time, u_sync, u_speed, u_division, u_beat) + u_jump;
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
    jumpUniform,
  ),
};

/**
 * 抽动位移 → `u_jump`。**每帧都要重算**：它同时依赖 `t`（刻度）与片段 id（序列）。
 *
 * 种子里掺**片段 id** 而不是 `u_seed`：后者逐帧变，见文件头。代价是同一片段里
 * 的多个实例同步抽搐 —— 这是有意的，叠层一起跳才读得出「同一处故障」。
 */
function jumpUniform(
  gl: WebGL2RenderingContext,
  locs: Record<string, WebGLUniformLocation | null>,
  values: Record<string, number | string>,
  ctx: EffectUniformCtx,
): void {
  const loc = locs['u_jump'];
  if (!loc) return;
  const seed = ctx.clip?.id ?? 'screen-jump';
  gl.uniform1f(loc, jerkOffset(ctx.t, Number(values.jerkRate), Number(values.jerk), seed));
}
