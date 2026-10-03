import { compose, floats, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 融帧故障：把逐帧差分画到一个分块的「关键帧」上，关键帧还能被冻住 ——
 * 这就是 datamosh 那个味道，不用编解码器。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `fast-mosh`，
 * 二级来源 Vidvox/ISF-Files（MIT，见 CREDITS.md）。
 *
 * **这是唯一一个同时用两种反馈的特效**，两条历史是分开的：
 * - pre-pass 的 `feedback: true` → 它**自己的**全分辨率历史，即那个关键帧。
 *   `hold` 打开时它原样保持上一帧，于是画面被冻在关键帧上。
 * - 主 pass 的 `feedback: true`（shader 级）→ 主 pass 自己的历史，就是 `prev`。
 *   差分是「当前链输入 − 上一帧输出」。
 *
 * `u_original` 在主 pass 里指的是**链输入**（不是 pre-pass 的输出），
 * 而 `u_texture` 才是 pre-pass 交出来的关键帧 —— 两者在这里是不同的东西。
 */
export const shader: EffectShaderDef = {
  prePasses: [
    {
      fragment: `
uniform float u_hold;
void main() {
  outColor = u_hold > 0.5 ? texture(u_feedback, vUv) : texture(u_texture, vUv);
}`,
      feedback: true,
    },
  ],
  fragment: `
uniform float u_rate;
uniform float u_sharpen;
uniform float u_blur;
uniform float u_posterize;
uniform float u_block;
uniform int u_mode;
// 关键帧按 1/block 大小的缓冲读回来再双线性放大：点采样格子、在格心之间混。
vec4 keyAt(vec2 uv) {
  vec2 cells = max(u_resolution / u_block, vec2(1.0));
  vec2 g = uv * cells - 0.5;
  vec2 i = floor(g);
  vec2 f = fract(g);
  vec4 a = texture(u_texture, (i + 0.5) / cells);
  vec4 b = texture(u_texture, (i + vec2(1.5, 0.5)) / cells);
  vec4 c = texture(u_texture, (i + vec2(0.5, 1.5)) / cells);
  vec4 d = texture(u_texture, (i + 1.5) / cells);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec2 px = 1.0 / u_resolution;
  vec4 color = texture(u_original, vUv);
  vec4 cl = texture(u_original, vUv + vec2(-px.x, 0.0));
  vec4 cr = texture(u_original, vUv + vec2(px.x, 0.0));
  vec4 ca = texture(u_original, vUv + vec2(0.0, px.y));
  vec4 cb = texture(u_original, vUv + vec2(0.0, -px.y));
  vec4 cla = texture(u_original, vUv + vec2(-px.x, px.y));
  vec4 cra = texture(u_original, vUv + px);
  vec4 clb = texture(u_original, vUv - px);
  vec4 crb = texture(u_original, vUv + vec2(px.x, -px.y));
  vec4 ring = cl + cr + ca + cb + cla + cra + clb + crb;
  vec4 key = keyAt(vUv);
  vec4 prev = texture(u_feedback, vUv);
  vec4 diff = color - prev;
  if (u_blur > 0.0) diff = diff * (1.0 - u_blur) + ring * (u_blur / 8.0);
  vec4 fin;
  if (u_mode == 0) fin = mix(prev, diff + key, u_rate);
  else if (u_mode == 1) fin = mix(prev, abs(diff) + key, u_rate);
  else fin = mix(prev, abs(diff + prev) * key, u_rate);
  if (u_posterize > 0.0) {
    float q = 128.0 - u_posterize * 126.0;
    fin = floor(fin * q) / q;
  }
  if (u_sharpen > 0.0) fin += u_sharpen * (8.0 * color - ring);
  outColor = vec4(clamp(fin.rgb, 0.0, 1.0), color.a);
}`,
  feedback: true,
  setUniforms: compose(
    floats('hold', 'rate', 'sharpen', 'blur', 'posterize', 'block'),
    selectInt('mode', { relative: 0, absolute: 1, difference: 2 }),
  ),
};
