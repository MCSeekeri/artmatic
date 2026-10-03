import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 流场：亮度梯度的旋度当无散流场，再叠两层不成比例的正弦漂移，
 * 最后用 LIC 式流线累积（10 步**逆向**走 + 指数衰减权重）——
 * 这一步才是把普通 warp 变成「液体颜料拖出笔触」的关键。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `optical-flow`（MIT，见 CREDITS.md）。
 *
 * **相位自己乘**：上游是 `float t = u_time * 0.2;` 且 setUniforms **根本没发 speed**
 * —— 它的 `speed` 完全靠引擎折进 u_time。这里补上 `u_speed`，
 * 否则「速度」滑杆在 Artmatic 里是死的。
 * 加权平均会把色相拉向邻居而掉饱和度，所以最后要把色度重新撑开（`* 1.35`）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_amount;
uniform float u_speed;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec3 lum = vec3(0.299, 0.587, 0.114);
  float t = u_time * u_speed * 0.2;

  float r = 3.0 * max(px.x, px.y);

  // 4 阶中心差分梯度 —— 平滑、压掉逐像素噪声
  float gxN2 = dot(texture(u_texture, vUv - vec2(2.0*r, 0.0)).rgb, lum);
  float gxN1 = dot(texture(u_texture, vUv - vec2(    r, 0.0)).rgb, lum);
  float gxP1 = dot(texture(u_texture, vUv + vec2(    r, 0.0)).rgb, lum);
  float gxP2 = dot(texture(u_texture, vUv + vec2(2.0*r, 0.0)).rgb, lum);
  float gyN2 = dot(texture(u_texture, vUv - vec2(0.0, 2.0*r)).rgb, lum);
  float gyN1 = dot(texture(u_texture, vUv - vec2(0.0,     r)).rgb, lum);
  float gyP1 = dot(texture(u_texture, vUv + vec2(0.0,     r)).rgb, lum);
  float gyP2 = dot(texture(u_texture, vUv + vec2(0.0, 2.0*r)).rgb, lum);
  float gx = (-gxP2 + 8.0*gxP1 - 8.0*gxN1 + gxN2) * (1.0/12.0);
  float gy = (-gyP2 + 8.0*gyP1 - 8.0*gyN1 + gyN2) * (1.0/12.0);

  // 亮度梯度的旋度 = 无散流场（顺着颜色轮廓走）
  vec2 curl = vec2(-gy, gx);

  // 两层不成比例的正弦波 —— 动画是活的
  float d1 = sin(vUv.x * 3.1 + t) * cos(vUv.y * 2.7 - t * 0.73);
  float d2 = sin(vUv.y * 4.3 - t * 1.3 + 1.57) * cos(vUv.x * 3.7 + t * 0.91);
  vec2 drift = vec2(d1, d2) * 0.2;

  // 软归一化：强边缘区与平坦区都能产生可见流
  vec2 rawFlow = curl + drift;
  vec2 flowDir = rawFlow / max(length(rawFlow), 0.08);

  float stepLen = r * (1.0 + u_amount * 6.0);
  vec2  stepVec = flowDir * stepLen;

  vec4  color  = vec4(0.0);
  float totalW = 0.0;
  vec2  pos    = vUv;
  const int N  = 10;
  for (int i = 0; i < N; i++) {
    float w = exp(-2.2 * float(i) / float(N - 1));
    color  += texture(u_texture, pos) * w;
    totalW += w;
    pos    -= stepVec;
  }
  vec4 acc = color / totalW;
  vec3 avg = acc.rgb;

  float avgLuma = dot(avg, lum);
  avg = mix(vec3(avgLuma), avg, 1.35);

  outColor = vec4(clamp(avg, 0.0, 1.0), acc.a);
}`,
  setUniforms: floats('amount', 'speed'),
};
