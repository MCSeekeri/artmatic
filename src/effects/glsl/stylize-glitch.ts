import {
  clockUniforms,
  CLOCK_GLSL,
  compose,
  floats,
  HASH_PLAIN_GLSL,
  HSV_GLSL,
  selectInt,
  type EffectShaderDef,
} from '../shader-def';

/**
 * 风格化故障：随机矩形被反相 / 8×8 Bayer 抖动 / 色相偏移。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `stylize-glitch`，
 * 二级来源 Vidvox/ISF-Files（MIT，见 CREDITS.md）。
 *
 * 两处照抄会错的：
 * 1. 源文件又声明了一次 `uniform vec2 u_resolution;`（`EFFECT_HEAD` 已有）→ 删掉。
 * 2. 它的 `bayer8` 是**自己算的位运算版**，与共享 `BAYER_GLSL` 的 2/4/8 递归版
 *    不是一套，所以保留自带实现、不引 `BAYER_GLSL`（引了还会重名）。
 * hash 用 `HASH_PLAIN_GLSL`（逐 tick 稳定）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_level;
uniform float u_count;
uniform int u_mode;
uniform float u_sync;
uniform float u_speed;
uniform float u_division;
uniform float u_beat;
${HASH_PLAIN_GLSL}
${HSV_GLSL}
${CLOCK_GLSL}
vec4 rand4(vec4 co) {
  return vec4(hash(co.rg), hash(co.gb), hash(co.ba), hash(co.rb));
}
float bayer8(vec2 p) {
  ivec2 ip = ivec2(mod(p, 8.0));
  int a = ip.x ^ ip.y;
  int b = ip.y;
  int r = ((a & 1) << 5) | ((b & 1) << 4) | ((a & 2) << 2) | ((b & 2) << 1)
        | ((a & 4) >> 1) | ((b & 4) >> 2);
  return (float(r) + 1.0) / 64.0;
}
vec4 stylize(vec4 col, int style) {
  if (style == 0) return vec4(1.0 - col.rgb, col.a);
  if (style == 1) {
    float luma = (col.r + col.g + col.b) / 3.0;
    return vec4(col.rgb * step(bayer8(vUv * u_resolution), luma), col.a);
  }
  vec3 hsv = rgb2hsv(col.rgb);
  hsv.x = mod(hsv.x + 0.333, 1.0);
  return vec4(hsv2rgb(hsv), col.a);
}
void main() {
  vec4 col = texture(u_texture, vUv);
  if (u_level > 0.0) {
    // 一个相位单位重掷一次，所以分频到拍上就是每拍一换。
    float tick = floor(clockPhase(u_time, u_sync, u_speed, u_division, u_beat));
    for (int i = 0; i < 10; i++) {
      if (float(i) >= u_count) break;
      vec4 rc = rand4((float(i) + tick) * vec4(0.2123, 0.34517, 0.53428, 0.7431));
      rc.zw *= u_level;
      rc.zw = min(rc.zw, 1.0 - rc.xy);
      if (all(greaterThanEqual(vUv, rc.xy)) && all(lessThanEqual(vUv, rc.xy + rc.zw))) {
        int style = u_mode == 0
          ? int(min(3.0 * hash(vec2(2.7413 + float(i), 1.325821 * tick)), 2.0))
          : u_mode - 1;
        col = stylize(col, style);
      }
    }
  }
  outColor = col;
}`,
  setUniforms: compose(
    floats('level', 'count'),
    selectInt('mode', { random: 0, invert: 1, dither: 2, hue: 3 }),
    clockUniforms(),
  ),
};
