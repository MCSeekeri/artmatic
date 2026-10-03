import { floats, HUE_ROTATE_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 色彩校正：亮度 / 对比 / 色相 / 饱和。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `color-correction`（MIT，见 CREDITS.md）。
 * 对比度是**非对称**的：负值线性压，正值平方放大（`1 + c²·10`）——
 * 对称写法会让「调高对比」几乎看不出变化。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_brightness;
uniform float u_contrast;
uniform float u_hue;
uniform float u_saturation;
${HUE_ROTATE_GLSL}
void main() {
  vec4 c = texture(u_texture, vUv);
  vec3 rgb = c.rgb * pow(2.0, u_brightness * 2.0);
  float ct = u_contrast < 0.0 ? 1.0 + u_contrast : 1.0 + u_contrast * u_contrast * 10.0;
  rgb = (rgb - 0.5) * ct + 0.5;
  rgb = hueRotate(rgb, u_hue);
  float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(vec3(luma), rgb, 1.0 + u_saturation);
  outColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}`,
  setUniforms: floats('brightness', 'contrast', 'hue', 'saturation'),
};
