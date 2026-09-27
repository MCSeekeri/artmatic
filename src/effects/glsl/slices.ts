import { floats, HASH_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 切片错位：行条带按行号×帧种子哈希横移。
 *
 * 这是「seeded random 注入」的样板：全部随机从 u_seed 派生
 * （u_seed = hashSeed(project.seed, instanceId, frame)），
 * 同一帧永远同一个位移图案——预览与导出是同一次随机。
 * 移植思路来自 angel-echo post.js GLITCH_FS 的横切段
 * （移少数行、移得远，而不是所有行移一点——后者读作噪声，前者读作撕裂）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_count;
uniform float u_amount;
uniform float u_coverage;
${HASH_GLSL}
void main() {
  float row = floor(vUv.y * u_count);
  float h = hash(vec2(row, 1.0));
  float on = step(1.0 - u_coverage, h);
  vec2 uv = vUv + vec2((hash(vec2(row, 7.0)) - 0.5) * 2.0 * u_amount * on, 0.0);
  outColor = texture(u_texture, clamp(uv, 0.0, 1.0));
}`,
  setUniforms: floats('count', 'amount', 'coverage'),
};
