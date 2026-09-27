import { floats, type EffectShaderDef } from '../shader-def';

/** 扫描线：按屏幕行做正弦暗化。 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_intensity;
uniform float u_spacing;
void main() {
  vec4 c = texture(u_texture, vUv);
  float s = 1.0 - u_intensity * (0.5 + 0.5 * sin(vUv.y * u_resolution.y * 3.14159265 / u_spacing));
  outColor = vec4(c.rgb * s, c.a);
}`,
  setUniforms: floats('intensity', 'spacing'),
};
