import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 运动遮罩：只有与「缓慢沉降的背景估计」不同的部分才透出来。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `motion-mask`，
 * 二级来源 Vidvox/ISF-Files（MIT，见 CREDITS.md）。
 *
 * **6 环 pre-pass，是本项目里最长的一条链**：
 * 0. 背景估计 —— `feedback: true`，用它**自己的**历史。`persistence` 越大越"黏"。
 * 1. 与 `u_original`（链输入）做三通道绝对差 → 运动量
 * 2. 横向腐蚀、3. 纵向腐蚀（可分离，`erode` 控制半径）
 * 4. 横向模糊、5. 纵向模糊（可分离，`blur` 控制半径）
 *
 * 中间几环没有 `feedback`，所以走 compositor 的**半分辨率浮点草稿**乒乓。
 * 它们用自己的 `textureSize(u_texture, 0)` 算像素步长（不是 `u_resolution`），
 * 所以腐蚀/模糊的半径是**草稿分辨率**下的像素数 —— 与上游一致。
 *
 * 主 pass 用 `u_original` 取源（不是被糊过的遮罩），再用遮罩在
 * 「静止区亮度 `still`」与「运动的源」之间混。
 */
export const shader: EffectShaderDef = {
  prePasses: [
    {
      // 0：背景估计（有自己的历史）
      fragment: `
uniform float u_persistence;
void main() {
  outColor = mix(texture(u_texture, vUv), texture(u_feedback, vUv), u_persistence);
}`,
      feedback: true,
    },
    {
      // 1：与链输入求运动量
      fragment: `
void main() {
  vec3 s = texture(u_original, vUv).rgb;
  vec3 b = texture(u_texture, vUv).rgb;
  outColor = vec4(abs(s.r - b.r) + abs(s.g - b.g) + abs(s.b - b.b));
}`,
    },
    {
      // 2：横向腐蚀
      fragment: `
uniform float u_erode;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float m = 1e9;
  for (int i = -6; i <= 6; i++) {
    if (abs(float(i)) > u_erode) continue;
    m = min(m, texture(u_texture, vUv + vec2(float(i) * px.x, 0.0)).r);
  }
  outColor = vec4(m);
}`,
    },
    {
      // 3：纵向腐蚀
      fragment: `
uniform float u_erode;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float m = 1e9;
  for (int i = -6; i <= 6; i++) {
    if (abs(float(i)) > u_erode) continue;
    m = min(m, texture(u_texture, vUv + vec2(0.0, float(i) * px.y)).r);
  }
  outColor = vec4(m);
}`,
    },
    {
      // 4：横向模糊
      fragment: `
uniform float u_blur;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float r = floor(u_blur);
  float sum = 0.0;
  for (int i = -6; i <= 6; i++) {
    if (abs(float(i)) > r) continue;
    sum += texture(u_texture, vUv + vec2(float(i) * px.x, 0.0)).r;
  }
  outColor = vec4(sum / (2.0 * r + 1.0));
}`,
    },
    {
      // 5：纵向模糊
      fragment: `
uniform float u_blur;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float r = floor(u_blur);
  float sum = 0.0;
  for (int i = -6; i <= 6; i++) {
    if (abs(float(i)) > r) continue;
    sum += texture(u_texture, vUv + vec2(0.0, float(i) * px.y)).r;
  }
  outColor = vec4(sum / (2.0 * r + 1.0));
}`,
    },
  ],
  fragment: `
uniform float u_threshold;
uniform float u_still;
uniform float u_showMask;
uniform float u_hardCutoff;
void main() {
  vec4 src = texture(u_original, vUv);
  float m = texture(u_texture, vUv).r;
  // 不动的部分按 u_still 透出；0 就完全不透。
  vec4 base = src * u_still;
  if (m <= u_threshold) {
    outColor = base;
    return;
  }
  vec4 moving = u_showMask > 0.5 ? vec4(1.0) : src;
  float w = u_hardCutoff > 0.5 ? 1.0 : clamp(m, 0.0, 1.0);
  outColor = mix(base, moving, w);
}`,
  setUniforms: floats('threshold', 'persistence', 'erode', 'blur', 'still', 'showMask', 'hardCutoff'),
};
