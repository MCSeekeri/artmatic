import { colors, compose, floats, HSV_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 视频反馈：把合成后的画面经旋转/缩放/偏移再注回去，逐帧叠出拖尾。
 * 老式视频反馈的那个味道。
 *
 * 移植自 openmosh `lab/shaders/keijiro/Kino Feedback.fs`，
 * 上游是 keijiro 的 `KinoFeedback` 的 ISF 端口（Unlicense，见 CREDITS.md）。
 *
 * **三个 pass 被精确折叠成了一个 pass + `u_feedback`**（不是近似，是可推导的等价变换）：
 *
 *   原作： ghost[t] = T(scene[t−1])        // pass0，按名字读上一帧的 scene
 *          scene[t] = input[t] + amount·ghost[t]   // pass1
 *          输出 = scene[t]                  // pass2
 *
 * 代入得 `scene[t] = input[t] + amount·T(scene[t−1])` —— 只有一个状态，
 * 而 `u_feedback` 装的就是本实例上一帧的输出（= scene[t−1]）✓。
 *
 * 顺带这解决了一个原作没有的问题：ISF 的 `TARGET` 是**全屏共享**的命名缓冲，
 * 而 Artmatic 的历史是**逐实例**的（两个实例不会互相踩）。
 *
 * 口径：`TIMEDELTA` → `u_delta`（旋转是「每秒多少度」，乘帧差才与帧率无关）；
 * `scale` **不乘**帧差（原作就是逐帧复合的缩放，那正是拖尾的来源）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_rotation;
uniform float u_scale;
uniform float u_offsetX;
uniform float u_offsetY;
uniform float u_hue;
uniform vec3 u_tint;
uniform float u_amount;
${HSV_GLSL}
void main() {
  // 注入：把上一帧的输出变换一下取回来
  vec2 c = (vUv - 0.5) * u_scale;
  float a = radians(u_rotation) * u_delta;
  float s = sin(a);
  float co = cos(a);
  c = mat2(co, -s, s, co) * c;
  vec2 sampleUv = clamp(c + 0.5 + vec2(u_offsetX, u_offsetY), vec2(0.0), vec2(1.0));
  vec3 rgb = clamp(texture(u_feedback, sampleUv).rgb, 0.0, 1.0);
  vec3 hsv = rgb2hsv(rgb);
  hsv.x = fract(hsv.x + u_hue);
  vec3 ghost = clamp(hsv2rgb(hsv) * u_tint, vec3(0.0), vec3(1.0));

  vec4 src = texture(u_texture, vUv);
  outColor = vec4(clamp(src.rgb + ghost * u_amount, 0.0, 1.0), src.a);
}`,
  feedback: true,
  setUniforms: compose(
    floats('rotation', 'scale', 'offsetX', 'offsetY', 'hue', 'amount'),
    colors('tint'),
  ),
};
