import { colors, compose, floats, type EffectShaderDef } from '../shader-def';

/**
 * 三段色阶：按亮度分三档，档内插值到对应颜色。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `trio-tone`，
 * 二级来源 Vidvox/ISF-Files（MIT，见 CREDITS.md）。
 * 注意它用的亮度权重是 Rec.709（0.2126/0.7152/0.0722），
 * 与同批多数特效的 Rec.601 不同 —— 照抄，别「统一」。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform vec3 u_darkColor;
uniform vec3 u_midColor;
uniform vec3 u_brightColor;
uniform float u_intensity;
void main() {
  vec4 c = texture(u_texture, vUv);
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 lo = vec3(0.0);
  vec3 hi = u_darkColor;
  float ix = 0.0;
  if (lum > 0.66) {
    lo = u_midColor;
    hi = u_brightColor;
    ix = 2.0;
  } else if (lum > 0.33) {
    lo = u_darkColor;
    hi = u_midColor;
    ix = 1.0;
  }
  vec3 tone = mix(lo, hi, clamp((lum - ix * 0.33) / 0.33, 0.0, 1.0));
  outColor = vec4(mix(c.rgb, tone, u_intensity), c.a);
}`,
  setUniforms: compose(colors('darkColor', 'midColor', 'brightColor'), floats('intensity')),
};
