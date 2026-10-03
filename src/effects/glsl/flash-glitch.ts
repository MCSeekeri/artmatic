import { compose, floats, HSV_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 闪频故障：按阈值切出斜切/位移的亮度块，逐格随机上色。
 *
 * 移植自 openmosh `lab/shaders/keijiro/Flash Glitch.fs`，
 * 上游是 keijiro 的 `FlashGlitch` 的 ISF 端口（Unlicense，见 CREDITS.md）。
 * 原作是**手动触发**的，这里换成自动重触发（`rate` + `release`），
 * 于是它不需要外部事件也能放进效果链。
 *
 * 两处口径：
 * - ISF 的 `TIME` 就是秒，Artmatic 的 `u_time` 也是秒 → **直接映射**。
 *   这个特效没有 `speed` 参数，所以**不需要**任何相位折算
 *   （openmosh 那批 shader 的 `u_time` 是累积相位，ISF 这批不是）。
 * - 色相转换用共享的 `HSV_GLSL`（与上游本地的 `RgbToHsv`/`HsvToRgb` **逐字相同**，
 *   只是名字不同），删掉本地副本。
 *
 * alpha 按项目惯例保留链输入的覆盖（不透明素材上与上游一致）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_strength;
uniform float u_rate;
uniform float u_release;
uniform float u_hue;

float Hash(uint s) {
  s = s * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return float((w >> 22u) ^ w) / 4294967295.0;
}
vec4 Hash4(uint seed) {
  seed *= 4u;
  return vec4(Hash(seed), Hash(seed + 1u), Hash(seed + 2u), Hash(seed + 3u));
}

// 2D simplex（Ashima，keijiro/NoiseShader 用的就是这一份）
vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute3(vec3 x) { return mod289v3(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289v2(i);
  vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

${HSV_GLSL}

vec4 FG_GridRandom(vec2 uv, uint seed) {
  const float cells = 32.0;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 grid = floor(uv * vec2(aspect, 1.0) * cells) / cells;
  vec2 npos = grid * vec2(0.075, 2.0) + float(seed & 0xffu);
  uint offs = uint((snoise(npos) + 2.0) * 4.0);
  return Hash4(seed + offs);
}
vec2 FG_SkewUV(vec2 uv, float rand) {
  float skew = (rand - 0.5) * 2.0;
  float skew7 = skew * skew * skew * skew * skew * skew * skew;
  return vec2(uv.y * skew7 * 8.0, 0.0);
}
vec2 FG_Displace(vec2 uv, uint seed) {
  float d = Hash(uint(uv.y * 6.0) + seed) * 2.0 - 1.0;
  float d5 = d * d * d * d * d;
  return vec2(uv.x + d5 * 0.5, uv.y);
}
vec3 FG_ApplyHue(vec3 color, float shift) {
  vec3 hsv = rgb2hsv(clamp(color, 0.0, 1.0));
  hsv.x = fract(hsv.x + shift);
  return hsv2rgb(hsv);
}
float FG_SampleGlitch(vec2 uv, float threshold, vec4 rand) {
  vec2 skew = FG_SkewUV(uv, rand.z);
  vec2 uv2 = fract(uv + rand.xy + skew);
  vec3 src = texture(u_texture, uv2).rgb;
  float l = dot(src, vec3(0.2126, 0.7152, 0.0722));
  return step(threshold + rand.w, l);
}

void main() {
  uint seed = uint(floor(u_time * u_rate)) * 7919u + 1u;

  // 两个触发通道按 rate 重新开火，各自按 release 衰减
  float curve = 0.15 + (1.0 - (1.0 - u_strength) * (1.0 - u_strength));
  float r = max(u_rate, 1e-4);
  float age1 = u_rate < 0.01 ? 0.0 : fract(u_time * u_rate) / r;
  float age2 = u_rate < 0.01 ? 0.0 : fract(u_time * u_rate + 0.5) / r;
  float p1 = max(0.0, curve - age1 / u_release);
  float p2 = max(0.0, curve - age2 / u_release);

  float threshold1 = 1.0 - max(p1, p2);
  float threshold2 = 1.0 - p2;

  vec2 uv2 = FG_Displace(vUv, seed ^ 0x38f7cu);
  vec4 rand1 = FG_GridRandom(vUv, seed ^ 0x1beefu);
  vec4 rand2 = FG_GridRandom(uv2, seed ^ 0x1beefu);
  float s1 = FG_SampleGlitch(vUv, threshold1, rand1);
  float s2 = FG_SampleGlitch(uv2, threshold2, rand2);

  float alpha = max(s1, s2);
  vec3 color = FG_ApplyHue(vec3(s1, s2, s2), u_hue);
  vec4 src = texture(u_texture, vUv);
  outColor = vec4(mix(src.rgb, color, alpha), src.a);
}`,
  setUniforms: compose(floats('strength', 'rate', 'release', 'hue')),
};
