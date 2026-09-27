import { floats, type EffectShaderDef } from '../shader-def';

/** 像素化：采样点量化到 size 网格中心（单次采样，linearFilter 不设）。 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_size;
void main() {
  vec2 px = u_size / u_resolution;
  vec2 uv = (floor(vUv / px) + 0.5) * px;
  outColor = texture(u_texture, uv);
}`,
  setUniforms: floats('size'),
};
