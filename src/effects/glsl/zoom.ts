import { floats, MATH_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 缩放：`pow(2, amount)` 缩放 + `bounce` 折返（所以缩小时画面边缘会被镜像补上
 * 而不是出现黑边）。移植自 openmosh `gl/effect-shaders.ts` 的 `zoom`（MIT，见 CREDITS.md）。
 *
 * `amount` 默认 0 = `pow(2,0)` = 1 → **恒等**。目视验收时先把参数推出去再看。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
${MATH_GLSL}
void main() {
  float scale = pow(2.0, u_amount);
  vec2 uv = (vUv - 0.5) / scale + 0.5;
  uv = vec2(bounce(uv.x), bounce(uv.y));
  outColor = texture(u_texture, uv);
}`,
  setUniforms: floats('amount'),
};
