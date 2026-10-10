import { floats, HASH_FAST_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 切片错位：行条带按行号×帧种子哈希横移。
 *
 * 这是「seeded random 注入」的样板：全部随机从 u_seed 派生
 * （u_seed = hashSeed(project.seed, instanceId, frame)），
 * 同一帧永远同一个位移图案——预览与导出是同一次随机。
 * 移植思路来自 angel-echo post.js GLITCH_FS 的横切段
 * （移少数行、移得远，而不是所有行移一点——后者读作噪声，前者读作撕裂）。
 *
 * ## 为什么这里用 `HASH_FAST_GLSL` 而不是 `HASH_GLSL`（2026-10-10）
 *
 * `HASH_GLSL` 是 `fract(sin(x) * 43758.5453)`，而它的自变量在这里是
 * `dot(p, vec2(12.9898, 78.233)) + u_seed * 937` —— 对 `p.y = 7.0` 就已经 ≈ 849
 * 起，**sin 的自变量偏大，低位被实现精度吃掉**。GPU 的 sin 是近似实现，同一份
 * 输入在不同驱动状态下会给出不同低位结果，表现是**同一个 t 的两张画面在两个
 * 状态之间跳**。
 *
 * 实测（lab 默认配置 bars + slices，暂停在 t=0）：画面以刷新率闪烁；
 * `u_amount = 0` 时消失（位移被乘掉 ⇒ 是位移量在跳，不是源）、
 * 强制 `NEAREST` 不消失（⇒ 不是过滤）、分辨率越低越稳定、
 * 预热几十帧后稳定、uniform 派发逐帧一致 —— 全部指向 hash 的数值稳定性。
 * 无 sin 的 `hash11` 在大参数下稳定，位移图案的分布等价（仍是随机撕裂）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_count;
uniform float u_amount;
uniform float u_coverage;
${HASH_FAST_GLSL}
void main() {
  float row = floor(vUv.y * u_count);
  // 两个取值的输入必须彼此独立：同一行的「是否位移」与「移多远」共用一个
  // hash 的话，on 的阈值会把位移量偏置到半个区间。
  float k = row + u_seed * 977.0;
  float on = step(1.0 - u_coverage, hash11(k));
  vec2 uv = vUv + vec2((hash11(k + 131.7) - 0.5) * 2.0 * u_amount * on, 0.0);
  outColor = texture(u_texture, clamp(uv, 0.0, 1.0));
}`,
  setUniforms: floats('count', 'amount', 'coverage'),
};
