import { colors, compose, floats, type EffectShaderDef } from '../shader-def';

/**
 * 霓虹描边：Sobel 梯度**保留颜色**（不像 `edges` 那样取亮度）。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `sobel-neon`，
 * 二级来源 X-PostProcessing-Library（MIT，见 CREDITS.md）。
 *
 * **移植期的坑（第二个）**：源文件在自己的 fragment 里又声明了一次
 * `uniform vec2 u_resolution;`，与 `EFFECT_HEAD` 重复 → 照抄直接编译失败。
 * 这里删掉了那一行（`circle-warp` 是同一个坑的第一次）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_width;
uniform float u_neon;
uniform float u_brightness;
uniform float u_bgFade;
uniform vec3 u_bgColor;
vec3 sobel(vec2 st, vec2 c) {
  vec3 tl = texture(u_texture, c + vec2(-st.x, st.y)).rgb;
  vec3 ml = texture(u_texture, c + vec2(-st.x, 0.0)).rgb;
  vec3 bl = texture(u_texture, c + vec2(-st.x, -st.y)).rgb;
  vec3 mt = texture(u_texture, c + vec2(0.0, st.y)).rgb;
  vec3 mb = texture(u_texture, c + vec2(0.0, -st.y)).rgb;
  vec3 tr = texture(u_texture, c + vec2(st.x, st.y)).rgb;
  vec3 mr = texture(u_texture, c + vec2(st.x, 0.0)).rgb;
  vec3 br = texture(u_texture, c + vec2(st.x, -st.y)).rgb;
  vec3 gx = tl + 2.0 * ml + bl - tr - 2.0 * mr - br;
  vec3 gy = -tl - 2.0 * mt - tr + bl + 2.0 * mb + br;
  return sqrt(gx * gx + gy * gy);
}
void main() {
  vec4 scene = texture(u_texture, vUv);
  vec3 grad = sobel(u_width / u_resolution, vUv);
  vec3 bg = mix(u_bgColor, scene.rgb, u_bgFade);
  vec3 col = mix(bg, grad, u_neon) * u_brightness;
  outColor = vec4(clamp(col, 0.0, 1.0), scene.a);
}`,
  setUniforms: compose(
    floats('width', 'neon', 'brightness', 'bgFade'),
    colors('bgColor'),
  ),
};
