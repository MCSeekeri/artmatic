import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 暗角：径向 smoothstep 压暗。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `vignette`（MIT，见 CREDITS.md）。
 * `transparent`（checkbox）走的是**同一个衰减**，只是把它花在 alpha 上而不是
 * 颜色上 —— 于是下层会从边缘透出来，而不是被涂黑。这个分支是「半透明遮罩」
 * 与「压暗画面」的区别所在。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_size;
uniform float u_amount;
uniform float u_transparent;
void main() {
  vec4 c = texture(u_texture, vUv);
  float dist = length(vUv - 0.5);
  float radius = 1.0 - u_size;
  float vig = smoothstep(radius, radius - 0.45, dist);
  float fade = mix(1.0, vig, u_amount);
  outColor = u_transparent > 0.5 ? vec4(c.rgb, c.a * fade) : vec4(c.rgb * fade, c.a);
}`,
  setUniforms: floats('size', 'amount', 'transparent'),
};
