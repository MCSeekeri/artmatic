import { compose, floats, ints, MATH_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 镜像：沿一条线把一半画面折过去（四方向）。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `mirror`（MIT，见 CREDITS.md）。
 *
 * `side` 在 openmosh 里是 **range 0–3**（不是 select），着色器里收成 `int`
 * —— 所以走 `ints` 而不是 `selectInt`。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform int u_side;
uniform float u_position;
${MATH_GLSL}
void main() {
  vec2 uv = vUv;
  if (u_side == 0 && uv.x > u_position) uv.x = bounce(2.0 * u_position - uv.x);
  else if (u_side == 1 && uv.x < u_position) uv.x = bounce(2.0 * u_position - uv.x);
  else if (u_side == 2 && uv.y > u_position) uv.y = bounce(2.0 * u_position - uv.y);
  else if (u_side == 3 && uv.y < u_position) uv.y = bounce(2.0 * u_position - uv.y);
  outColor = mix(texture(u_texture, vUv), texture(u_texture, uv), u_amount);
}`,
  setUniforms: compose(floats('amount', 'position'), ints('side')),
};
