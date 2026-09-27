import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 回声拖尾（ping-pong 反馈）：max(scene, 衰减后的历史)。
 *
 * 移植 angel-echo post.js ECHO_FS 的简化版（去掉 camera 段），
 * 两条注释是它最有价值的部分，一起带走：
 *   1. 先减 floor 再乘 decay，否则拖尾永远到不了黑；
 *   2. 用 max 不用 screen——screen 在反馈环里收敛到 ~0.8 的固定点，
 *      整帧变成平雾。
 * seek 时渲染器会 clearFeedback()（预览 seek 后的暖帧差异是可接受瞬态；
 * 导出顺序渲染所以天然确定）。
 */
export const shader: EffectShaderDef = {
  feedback: true,
  fragment: `
uniform float u_decay;
uniform float u_floor;
uniform float u_weight;
uniform float u_zoom;
uniform float u_spin;
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * p; }
void main() {
  vec4 scene = texture(u_texture, vUv);
  vec2 c = vUv - 0.5;
  c = rot(c, u_spin);
  c *= (1.0 - u_zoom);
  vec3 h = texture(u_feedback, c + 0.5).rgb;
  h = max(h - u_floor, 0.0) * u_decay;
  outColor = vec4(max(scene.rgb, h * u_weight), scene.a);
}`,
  setUniforms: floats('decay', 'floor', 'weight', 'zoom', 'spin'),
};
