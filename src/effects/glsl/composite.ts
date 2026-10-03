import { floats, type EffectShaderDef } from '../shader-def';

/**
 * 复合视频：把帧重新编码成模拟复合信号再解回来。
 *
 * 移植自 openmosh `gl/effect-shaders.ts` 的 `composite`（MIT，见 CREDITS.md）。
 * 斑点来自**解码**过程，所以它落在细节上而放过平坦区：亮度被采样保持成一段段
 * 再做过冲，色度以四分之一的带宽、且**滞后于**产生它的那段亮度解出，
 * 副载波再逐行翻相与亮度拍频。
 *
 * 没有 `speed` 参数 → `u_time = 秒`，不需要相位处理。
 * `RUN / LINES / RING / BLOOM` 是**刻意钉住**的常量：它们只在范围顶端才读得出
 * 这个味道，做成四个滑杆只是四条通往更差画面的路（上游注释如此）。
 */
export const shader: EffectShaderDef = {
  fragment: `
uniform float u_bleed;
uniform float u_crawl;
uniform float u_crush;
uniform float u_mix;
const float RUN = 24.0;
const float LINES = 8.0;
const float RING = 5.0;
const float BLOOM = 2.0;
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 chromaOf(vec3 c) {
  return vec2(dot(c, vec3(0.5959, -0.2746, -0.3213)),
              dot(c, vec3(0.2115, -0.5227, 0.3112)));
}
vec3 yiq2rgb(float y, vec2 c) {
  return vec3(y + 0.956 * c.x + 0.619 * c.y,
              y - 0.272 * c.x - 0.647 * c.y,
              y - 1.106 * c.x + 1.703 * c.y);
}
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  vec2 pos = vUv * res;
  vec4 src = texture(u_texture, vUv);

  // 下面全部按扫描行计算，所以竖直方向对不齐 —— 相邻行之间的错位就是梳状纹理
  float row = floor(pos.y / LINES);
  float rowY = (row + 0.5) * LINES;
  float rh = hash(vec2(row, floor(u_time * 24.0)));
  float run = RUN * (0.45 + 1.1 * rh);
  float ph = fract(rh * 7.13) * run;

  float held = luma(texture(u_texture, vec2((floor((pos.x + ph) / run) + 0.5) * run - ph, rowY) / res).rgb);
  float mean = 0.0, wsum = 0.0;
  for (int k = -4; k <= 4; k++) {
    float fk = float(k);
    float w = exp(-fk * fk * 0.18);
    float sx = (floor((pos.x + fk * 1.5 + ph) / run) + 0.5) * run - ph;
    mean += luma(texture(u_texture, vec2(sx, rowY) / res).rgb) * w;
    wsum += w;
  }
  float lum = held + RING * (held - mean / wsum);

  float wide = max(0.5, u_bleed) * 0.25;
  vec2 chroma = vec2(0.0);
  float bloom = 0.0, bwsum = 0.0;
  for (int k = -4; k <= 4; k++) {
    float fk = float(k);
    vec3 s = texture(u_texture, vec2(pos.x + (fk - 1.2) * wide, rowY) / res).rgb;
    chroma += chromaOf(s);
    float bw = exp(-max(0.0, fk) * 0.55) * (fk < 0.0 ? 0.25 : 1.0);
    bloom += max(0.0, luma(s) - 0.55) * bw;
    bwsum += bw;
  }
  chroma /= 9.0;
  bloom /= bwsum;

  // 点蠕动：副载波与亮度拍频。相位逐行翻转，所以干扰读作斜向网纹而不是方格，
  // 又因为拍频从不完全锁定，它会漂。
  float beat = cos(6.2831853 * pos.x * 0.25 + 3.14159265 * row + u_time * 2.0);
  lum += u_crawl * length(chroma) * beat * 2.0;
  float a = u_crawl * beat * 1.2;
  float ca = cos(a), sa = sin(a);
  chroma = vec2(ca * chroma.x - sa * chroma.y, sa * chroma.x + ca * chroma.y);

  vec3 col = yiq2rgb(lum, chroma * (1.4 + u_bleed * 0.03));
  col = (col - u_crush) / max(0.05, 1.0 - u_crush);
  col = clamp(col + bloom * BLOOM, 0.0, 1.0);
  outColor = vec4(mix(src.rgb, col, u_mix), src.a);
}`,
  setUniforms: floats('bleed', 'crawl', 'crush', 'mix'),
};
