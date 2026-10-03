import { BLUR_V_PASS, floats, type EffectShaderDef } from '../shader-def';

/**
 * 辉光：阈值提取 → 横向高斯 → 纵向高斯 → 与原图相加。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `glow`（MIT，见 CREDITS.md）。
 *
 * 这是**第一次真正用到 `prePasses` 与 `u_original`**：
 * - 两环 pre-pass 都跑在半分辨率草稿上，但 `u_resolution` 仍传**全分辨率**，
 *   所以降采样只降低采样密度、不会让模糊半径变小。
 * - 主 pass 读 `u_original`（= pre-pass **之前**的链输入），否则就会把
 *   已经糊过的 bloom 当原图叠上去。
 * - 每个 pre-pass 都能拿到特效参数（`u_cutoff` / `u_radius`）—— 上游的
 *   `drawPass` 对每个 pass 都派发一遍，runner 现在也是。
 * - 主 pass 的 alpha 取「原图 alpha」与「光晕覆盖」的较大者：光晕带自己的覆盖，
 *   所以它能漫出文字层的边缘而不被字形裁掉（不透明图像上是 no-op）。
 */
export const shader: EffectShaderDef = {
  prePasses: [
    {
      // Pass 1：阈值提取 + 横向高斯
      fragment: `
uniform float u_cutoff;
uniform float u_radius;
void main() {
  vec2 px = 1.0 / u_resolution;
  float spread = u_radius * 3.0;
  float sigma = spread * 0.4;
  float invSigma2 = 1.0 / max(sigma * sigma, 0.001);
  vec3 bloom = vec3(0.0);
  float totalW = 0.0;
  const int R = 16;
  float step = spread / float(R);
  for (int i = -R; i <= R; i++) {
    float fi = float(i) * step;
    float w = exp(-fi * fi * invSigma2);
    vec2 off = vec2(fi * px.x, 0.0);
    vec3 s = texture(u_texture, vUv + off).rgb;
    float luma = dot(s, vec3(0.299, 0.587, 0.114));
    float contrib = max(0.0, luma - u_cutoff);
    bloom += s * contrib * contrib * w;
    totalW += w;
  }
  bloom /= totalW;
  outColor = vec4(bloom, 1.0);
}`,
      linearFilter: true,
    },
    {
      // Pass 2：纵向高斯
      fragment: BLUR_V_PASS,
      linearFilter: true,
    },
  ],
  // 末环：把糊好的 bloom 与原图相加
  fragment: `
uniform float u_amount;
void main() {
  vec4 orig = texture(u_original, vUv);
  vec3 bloom = texture(u_texture, vUv).rgb;
  float halo = dot(bloom * u_amount, vec3(0.299, 0.587, 0.114));
  outColor = vec4(orig.rgb + bloom * u_amount, clamp(max(orig.a, halo), 0.0, 1.0));
}`,
  setUniforms: floats('amount', 'cutoff', 'radius'),
};
