import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 数据融毁（Datamosh）：块位移由逐帧运动驱动，配 DCT 味的噪声块与拖抹，
 * 整条经过一个反馈缓冲 —— 不用编解码器的 datamosh 味道。
 *
 * 移植自 openmosh `lab/shaders/keijiro/Kino Datamosh.fs`，
 * 上游是 keijiro 的 `KinoDatamosh` 的 ISF 端口（**Unlicense**，见 CREDITS.md）。
 * 原作用摄像机运动矢量；这里替换成对上一帧的**一步 Lucas-Kanade** 估计。
 *
 * ## 原作的 4 个 pass 折叠成 2 个
 *
 * 原作： `pass0 disp`（持久 + 浮点）→ `pass1 prev`（持久）→ `pass2 work`（持久，自指）
 *        → `pass3`（输出 `work`）；其中 pass2 **同时读 `disp` 与 `work`**。
 *
 * 这里：
 * - `prev`（上一帧的**输入**）不用单独存 —— 这个 pre-pass 声明 `delayedInput: true`，
 *   于是它的 `u_texture` 直接就是上一帧的链输入 ✓
 * - `pass1` 那一步「把输入拷进 prev」**整个消失**了（正是 `delayedInput` 干的事）
 * - `pass3` 那一步「输出 `work`」也消失（主 pass 的输出本来就是 `work`）
 *
 * 三个数据来源各自对应得上：
 * | 原作 | 这里 |
 * |---|---|
 * | `inputImage`（当前帧） | `u_original` |
 * | `prev`（上一帧输入） | pre-pass 的 `u_texture`（`delayedInput`） |
 * | `disp`（自己的持久状态） | pre-pass 的 `u_feedback` |
 * | `work`（自己的持久状态） | 主 pass 的 `u_feedback` |
 *
 * 两个历史都是浮点：主 pass 靠 `hdrFeedback`，pre-pass 的历史**本来就是** RGBA16F
 * （`compositor.preFeedbackFor` 一律用 `{ float: true }`）—— 运动矢量是 UV 单位
 * （约 0.005），8bit 会把它们抹平。
 *
 * alpha 按项目惯例保留链输入的覆盖（上游写死 1.0）。
 */
export const shader: EffectShaderDef = {
  prePasses: [
    {
      // 原作的 frag_update：位移缓冲 + 一步 LK 运动估计
      delayedInput: true,
      feedback: true,
      fragment: `
uniform float u_blockSize;
uniform float u_quality;
uniform float u_velocity;
uniform float u_diffusion;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float UVRandom(vec2 uv) {
  float f = dot(vec2(12.9898, 78.233), uv);
  return fract(43758.5453 * sin(f));
}
void main() {
  vec2 px = 1.0 / u_resolution;

  // u_original = 当前帧链输入；u_texture = 上一帧链输入（delayedInput）
  float l0 = lum(texture(u_original, vUv).rgb);
  float lp = lum(texture(u_texture, vUv).rgb);
  float gx = lum(texture(u_texture, vUv + vec2(px.x, 0.0)).rgb)
           - lum(texture(u_texture, vUv - vec2(px.x, 0.0)).rgb);
  float gy = lum(texture(u_texture, vUv + vec2(0.0, px.y)).rgb)
           - lum(texture(u_texture, vUv - vec2(0.0, px.y)).rgb);
  vec2 mv = vec2(gx, gy) * (l0 - lp) / (gx * gx + gy * gy + 1e-3);
  mv *= u_velocity * 24.0;

  vec2 t0 = vec2(u_time, 0.0);
  vec3 rand = vec3(UVRandom(vUv + t0.xy), UVRandom(vUv + t0.yx), UVRandom(vUv.yx - t0.xx));
  mv += (rand.xy - 0.5) * u_diffusion;
  mv = round(mv);

  float acc = texture(u_feedback, vUv).w;
  float mvLen = length(mv);
  float accUpdate = acc + min(mvLen, u_blockSize) * 0.005 + rand.z * mix(-0.02, 0.02, u_quality);
  float accReset = rand.z * 0.5 + u_quality;
  acc = clamp(mvLen > u_blockSize ? accReset : accUpdate, 0.0, 1.0);
  outColor = vec4(mv * px, UVRandom(vUv + mvLen), acc);
}`,
    },
  ],
  fragment: `
uniform float u_quality;
uniform float u_contrast;
void main() {
  // u_texture 现在是 disp（上一环的输出）；源要读 u_original —— 别读错成 u_texture
  vec4 src = texture(u_original, vUv);
  vec4 d = texture(u_texture, vUv);
  vec3 w = texture(u_feedback, clamp(vUv - d.xy * 0.98, vec2(0.0), vec2(1.0))).rgb;

  vec4 rand = fract(vec4(1.0, 17.37135, 841.4272, 3305.121) * d.z);
  vec2 duv = vUv * u_resolution * (rand.x * 80.0 / u_contrast);
  float dct = cos(mix(duv.x, duv.y, step(0.5, rand.y)));
  dct *= rand.z * (1.0 - rand.x) * u_contrast;

  float cw = step(0.5, d.w) * dct;
  cw = mix(cw, 1.0, step(rand.w, mix(0.2, 1.0, u_quality) * step(0.999, d.w)));
  outColor = vec4(mix(w, src.rgb, cw), src.a);
}`,
  feedback: true,
  setUniforms: floats('blockSize', 'quality', 'contrast', 'velocity', 'diffusion'),
};
