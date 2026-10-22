import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 抽帧：把画面按固定帧率冻住，冻结期内新进来的帧按快门比例混进去（动态模糊）。
 *
 * 三条实现约束，改这个 shader 之前必须知道：
 *
 * 1. **「冻住的那一帧」只能存在自己的历史里。** 链里拿不到任意过去时刻的输入：
 *    `u_texture` 是当前帧、`u_original` 也是当前帧，只有 `u_feedback` 是**本实例
 *    上一帧的输出**。所以「保持」= 这一步原样输出历史，「换帧」= 整体换成本帧。
 * 2. **窗口边界从 `u_time` 闭式算出来，不记状态。** 记住「上次换帧是第几帧」会
 *    变成 dt 驱动的有状态量（违反硬约束 1.1，seek 不可复现）。`u_delta` 是
 *    `1/工程帧率`（runner 直接给，非 clock 特效的口径就是秒），于是
 *    「距窗口起点过了几帧」＝ `(t − tick/rate) × fps`。
 * 3. **窗口第 0 帧的权重必须是 1**（`n = 0 ⇒ box = 1`，见 `mix`），否则第一帧
 *    也是用上一窗口的残影混出来的，整条时间轴会一直差一窗。
 *
 * 权重：`box = 1/(n+1)` 是**箱式平均**的正确递推 —— 前 n 帧的均值与本帧的均值
 * 就是 n+1 帧的均值。`u_shutter` 在「只吃窗口第一帧」（0，纯抽帧）与「整窗
 * 平均」（1，最长拖影）之间过渡，所以两个端点是 `snap` 与 `box`：
 *
 *     snap = 1（n = 0）/ 0（其余）    ← 冻结
 *     box  = 1/(n+1)                  ← 箱式平均
 *
 * **不能写成 `mix(1.0, box, u_shutter)`**：那样 shutter = 0 时权重恒为 1，
 * 参数看起来「关掉模糊」，实际是「一帧都不冻」。`snap` 那一项必须真的随 n 掉到 0。
 *
 * 已知瞬态：seek 会清空反馈历史，所以**跳到窗口中途**时那半个窗口是黑的，
 * 到下一个整窗才恢复。与 echo / ghosting 同一类，导出顺序渲染不受影响。
 */
export const shader: EffectShaderDef = {
  feedback: true,
  // 逐帧求平均会一直叠加小于 8bit 量化步长的增量，8bit 历史会 stall 成色块。
  hdrFeedback: true,
  fragment: `
uniform float u_rate;
uniform float u_shutter;
void main() {
  vec4 cur = texture(u_texture, vUv);
  vec4 prev = texture(u_feedback, vUv);

  float fps = 1.0 / max(u_delta, 1e-5);
  float rate = max(u_rate, 0.1);
  float tick = floor(u_time * rate);
  float t0 = tick / rate;
  // +0.001 是浮点余量：t 本来就是 i/fps，不修正会把整帧算到上一个窗口去。
  float n = floor(max(u_time - t0, 0.0) * fps + 0.001);

  float snap = step(n, 0.5);
  float box = 1.0 / (n + 1.0);
  float w = mix(snap, box, clamp(u_shutter, 0.0, 1.0));
  outColor = mix(prev, cur, clamp(w, 0.0, 1.0));
}`,
  setUniforms: floats('rate', 'shutter'),
};
