import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 凸起畸变：把半径按 `pow(pct, 1 + amount)` 重映射。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `bulge`（MIT，见 CREDITS.md）。
 *
 * **上游的指数是 `1 - amount`，正负语义是反的** —— 这是反查采样：
 * 输出像素在半径 `dist` 处去读半径 `distortion` 处的内容，
 * 所以 `distortion > dist`（采样点更靠外）读到的效果是画面被**压向中心**即凹陷。
 * 指数取 `1 - a` 时 `a > 0` 会让 `distortion > dist` → 正值凹陷、负值凸起，
 * 与直觉相反。改成 `1 + a` 后正值才是凸起。`a = 0` 两种情况都是恒等。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_radius;
void main() {
  vec2 center = vec2(0.5);
  vec2 uv = vUv - center;
  float dist = length(uv);
  if (dist > 0.0 && dist < u_radius) {
    float pct = dist / u_radius;
    float distortion = pow(pct, 1.0 + u_amount) * u_radius;
    uv = uv / dist * distortion;
  }
  outColor = texture(u_texture, uv + center);
}`,
  setUniforms: floats('amount', 'radius'),
};
