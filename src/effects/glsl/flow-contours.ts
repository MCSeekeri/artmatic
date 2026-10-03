import { floats, HUE_ROTATE_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 流线等高：按亮度分层，相邻层沿地形梯度**反向**滑动，层间互相剪切。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `flow-contours`（MIT，见 CREDITS.md）。
 *
 * - **源文件又声明了一次 `uniform vec2 u_resolution;` → 删掉**（第 8 次）。
 * - 高光用的是 screen 混合**在 feedback mix 之前** —— 放在之后会被写进反馈缓冲、
 *   逐帧复利，最后整幅拍平成白。上游注释专门写了这一条。
 * - 等高线宽度从 `fwidth(terrain)` 来，所以层数怎么调线都保持两三个像素，
 *   不会胀成一圈吞掉画面的光晕。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_bands;
uniform float u_flow;
uniform float u_cycle;
uniform float u_sheen;
${HUE_ROTATE_GLSL}
void main() {
  vec2 px = 1.0 / u_resolution;
  vec3 lumW = vec3(0.299, 0.587, 0.114);
  vec3 src = texture(u_texture, vUv).rgb;
  float l = dot(src, lumW);

  // 亮度梯度：等高线垂直于它走。
  float lx = dot(texture(u_texture, clamp(vUv + vec2(px.x, 0.0), vec2(0.0), vec2(1.0))).rgb, lumW);
  float ly = dot(texture(u_texture, clamp(vUv + vec2(0.0, px.y), vec2(0.0), vec2(1.0))).rgb, lumW);
  vec2 grad = vec2(lx - l, ly - l);
  float slope = length(grad);

  float bands = max(2.0, floor(u_bands));
  float band = floor(l * bands);

  // 相邻层沿地形梯度反向滑动，所以等高线是互相剪切而不是整张平移。
  float dirSign = mod(band, 2.0) * 2.0 - 1.0;
  vec2 flow = (grad / max(slope, 1e-4)) * dirSign * u_flow * u_delta * 0.2;
  vec4 prevS = texture(u_feedback, clamp(vUv - flow, vec2(0.0), vec2(1.0)));
  vec3 prev = prevS.rgb;

  // 量化亮度但保住源色相，再按层循环色相，读起来是「液化了的」热力图。
  vec3 quant = src * ((band + 0.5) / bands) / max(l, 0.02);
  float q = band / bands;
  quant = clamp(hueRotate(clamp(quant, 0.0, 1.0), (q * 360.0 + u_time * 50.0) * u_cycle), 0.0, 1.0);

  float terrain = l * bands;
  float w = max(fwidth(terrain), 1e-4);
  float edge = fract(terrain);
  float seam = 1.0 - smoothstep(w, w * 2.5, min(edge, 1.0 - edge));
  seam *= smoothstep(0.0, 0.6, slope * bands * 6.0);

  // 从一个固定方向打光，朝光的脊才吃得到 —— 均匀的缝看起来只是白油漆。
  vec2 n = grad / max(slope, 1e-4);
  float lambert = 0.25 + 0.75 * clamp(dot(n, vec2(-0.6, 0.8)), 0.0, 1.0);

  vec3 spec = mix(quant, vec3(1.0), 0.45);
  float s = clamp(seam * lambert * u_sheen, 0.0, 1.0);
  vec3 lit = 1.0 - (1.0 - quant) * (1.0 - spec * s);

  float blend = 1.0 - exp(-mix(9.0, 1.5, u_flow) * u_delta);
  vec3 col = mix(prev, lit, blend);
  float colA = mix(prevS.a, texture(u_texture, vUv).a, blend);

  outColor = vec4(clamp(col, 0.0, 1.0), clamp(colA, 0.0, 1.0));
}`,
  feedback: true,
  setUniforms: floats('bands', 'flow', 'cycle', 'sheen'),
};
