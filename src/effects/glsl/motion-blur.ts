import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 动态模糊：把本帧与历史逐帧混合，运动的部分在时间上摊开成拖影。
 *
 * 与 `echo` / `ghosting` 的取法不同（这两个是叠加型的「拖尾」）：
 * - **不能用 `max`**：那是「留亮的残影」，静止画面不会被模糊，只是变亮。
 * - **不能乘 `decay`**：mix 已经收敛到本帧，再乘衰减会把静态画面越拉越黑。
 *
 * 窗口长度是**指数式的**，不是箱式：单缓冲反馈只拿得到「上一帧的输出」，
 * 「最近 N 帧的滑动窗口平均」需要 N 张历史，没有。所以 `length` 是时间常数
 * 而不是精确快门 —— 想要精确的箱式平均就用「抽帧」那个特效（它按窗口起点
 * 闭式算 `1/(n+1)`，因为窗口起点是 t 的函数）。
 *
 * `length = 0` 时权重为 1，输出与本帧逐字节相同（等于关掉）。
 */
export const shader: EffectShaderDef = {
  feedback: true,
  // 混合会一直叠加小于 8bit 量化步长的增量：8bit 历史会把拖影糊成色块。
  hdrFeedback: true,
  fragment: `
uniform float u_length;
void main() {
  vec4 cur = texture(u_texture, vUv);
  vec4 prev = texture(u_feedback, vUv);
  float k = 1.0 / (1.0 + max(u_length, 0.0));
  outColor = mix(prev, cur, k);
}`,
  setUniforms: floats('length'),
};
