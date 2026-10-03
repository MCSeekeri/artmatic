import { floats, HSV_GLSL, type EffectShaderDef } from '../shader-def';

/**
 * 霓虹边缘：预模糊亮度 Sobel + 全饱和霓虹色 + 5×5 辉光晕 + 压暗背景。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `neon-edges`（MIT，见 CREDITS.md）。
 *
 * 两个移植期的坑：
 * 1. 它是**单 pass 内**自己做的预模糊（每个 tap 取 2×2 平均），**不是 prePass**
 *    —— 别顺手改成 `prePasses`，那会改变边缘的尺度。
 * 2. 源文件里的 `#define SLUM(o) dot( \\` 是 GLSL 预处理器的**续行反斜杠**。
 *    在 TS 模板字符串里单个 `\\` 会被当成 JS 转义（吃掉换行），必须写成 `\\\\`，
 *    否则产出的 GLSL 缺了反斜杠、`#define` 直接断行。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_strength;
uniform float u_glow;
uniform float u_bg;
${HSV_GLSL}
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec4 orig = texture(u_texture, vUv);

  // 在预模糊的亮度上做 Sobel —— 每个 tap 取 2x2 平均，压掉像素级噪声，
  // 边缘才是平滑有机的而不是逐像素毛刺。
  vec3 luma = vec3(0.299, 0.587, 0.114);
  vec2 h = px * 0.5;
  #define SLUM(o) dot( \\
    texture(u_texture, vUv+(o)+vec2(-h.x,-h.y)).rgb + \\
    texture(u_texture, vUv+(o)+vec2( h.x,-h.y)).rgb + \\
    texture(u_texture, vUv+(o)+vec2(-h.x, h.y)).rgb + \\
    texture(u_texture, vUv+(o)+vec2( h.x, h.y)).rgb, luma) * 0.25
  vec2 S = px * 1.5;
  float tl = SLUM(vec2(-S.x,-S.y));
  float tm = SLUM(vec2( 0.0,-S.y));
  float tr = SLUM(vec2( S.x,-S.y));
  float ml = SLUM(vec2(-S.x, 0.0));
  float mr = SLUM(vec2( S.x, 0.0));
  float bl = SLUM(vec2(-S.x, S.y));
  float bm = SLUM(vec2( 0.0, S.y));
  float br = SLUM(vec2( S.x, S.y));
  #undef SLUM
  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
  float edge = clamp(sqrt(gx*gx + gy*gy) * u_strength, 0.0, 1.0);

  // 霓虹：取原图色相，硬顶到全饱和全亮
  vec3 hsv = rgb2hsv(orig.rgb);
  vec3 neon = hsv2rgb(vec3(hsv.x, 1.0, 1.0));

  // 辉光：邻域 5x5 的霓虹信号
  vec3 glowAccum = vec3(0.0);
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      vec2 off = vec2(float(x), float(y)) * px * 3.0;
      vec3 s = texture(u_texture, vUv + off).rgb;
      vec3 sh = rgb2hsv(s);
      glowAccum += hsv2rgb(vec3(sh.x, 1.0, 1.0));
    }
  }
  glowAccum /= 25.0;

  vec3 bg = orig.rgb * u_bg * (1.0 - edge);

  vec3 result = neon * edge + glowAccum * sqrt(edge) * u_glow * 0.4 + bg;
  outColor = vec4(clamp(result, 0.0, 1.0), orig.a);
}`,
  setUniforms: floats('strength', 'glow', 'bg'),
};
