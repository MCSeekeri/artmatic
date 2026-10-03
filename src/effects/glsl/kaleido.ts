import { floats, MATH_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 万花筒：极坐标扇区折叠后按 `bounce` 折回画面。
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `kaleido`（MIT，见 CREDITS.md）。
 * 是**静态**特效（不读 u_time）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_sides;
uniform float u_angle;
${MATH_GLSL}
void main() {
  vec2 uv = vUv - 0.5;
  float r = length(uv);
  float a = atan(uv.y, uv.x) + u_angle * 0.01745329;
  float seg = 6.28318530 / u_sides;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 kUV = vec2(cos(a), sin(a)) * r + 0.5;
  kUV = vec2(bounce(kUV.x), bounce(kUV.y));
  outColor = mix(texture(u_texture, vUv), texture(u_texture, kUV), u_amount);
}`,
  setUniforms: floats('amount', 'sides', 'angle'),
};
