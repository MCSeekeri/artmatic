import { colors, compose, floats, type EffectShaderDef } from '../shader-def';

/**
 * 镜头鬼影：把画面阈值化后朝一点铺开、着色，像镜头对着亮光源甩出的鬼影。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `ghosting`，
 * 二级来源 Vidvox/ISF-Files（MIT，见 CREDITS.md）。
 *
 * 阈值化那一环是 pre-pass（`u_bias` / `u_scale`），主 pass 读它的输出做鬼影叠加，
 * 最后再与 `u_original`（链输入）合成。参数分在两个 pass 里，所以两个 pass
 * 都要拿到参数。
 */
export const shader: EffectShaderDef = {
  prePasses: [
    {
      fragment: `
uniform float u_bias;
uniform float u_scale;
void main() {
  outColor = max(vec4(0.0), texture(u_texture, vUv) + u_bias) * u_scale;
}`,
      linearFilter: true,
    },
  ],
  fragment: `
uniform float u_ghosts;
uniform float u_dispersal;
uniform float u_additive;
uniform float u_dirX;
uniform float u_dirY;
uniform vec3 u_lensColor;
void main() {
  vec2 dir = vec2(1.0) - vec2(u_dirX, u_dirY);
  vec2 ghostVec = (dir - vUv) * u_dispersal;
  vec3 ghosts = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    if (float(i) >= u_ghosts) break;
    vec2 off = fract(vUv + ghostVec * float(i));
    ghosts += texture(u_texture, off).rgb * u_lensColor;
  }
  vec4 orig = texture(u_original, vUv);
  vec3 col = u_additive > 0.5 ? orig.rgb + ghosts : orig.rgb * ghosts;
  outColor = vec4(clamp(col, 0.0, 1.0), orig.a);
}`,
  setUniforms: compose(
    floats('bias', 'scale', 'ghosts', 'dispersal', 'additive', 'dirX', 'dirY'),
    colors('lensColor'),
  ),
};
