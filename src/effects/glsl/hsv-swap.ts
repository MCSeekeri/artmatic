import { compose, floats, HSV_GLSL, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 通道换色：把 RGB 的三个分量**当作** HSV 读，或反过来。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `hsv-swap`，
 * 二级来源 Vidvox/ISF-Files（MIT，见 CREDITS.md）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform int u_mode;
uniform float u_amount;
${HSV_GLSL}
void main() {
  vec4 c = texture(u_texture, vUv);
  vec3 o = u_mode == 0 ? hsv2rgb(c.rgb) : rgb2hsv(c.rgb);
  outColor = vec4(mix(c.rgb, o, u_amount), c.a);
}`,
  setUniforms: compose(
    selectInt('mode', { 'rgb-as-hsv': 0, 'hsv-as-rgb': 1 }),
    floats('amount'),
  ),
};
