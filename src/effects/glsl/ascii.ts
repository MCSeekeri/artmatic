import { colors, compose, floats, HASH_FAST_GLSL, type EffectShaderDef } from '../shader-def';
import { asciiCharsetText } from '../ascii-charsets';

/**
 * ASCII 字符画：把画面重排成一张字符网格。
 *
 * ## 字形从哪来
 *
 * GLSL 里没有字体，所以字形是一张**图集纹理**（`u_atlas`）：CPU 侧把字符序列
 * 栅格化进 `engine/glyph-atlas.ts`，并按**实测覆盖率升序**摆好。于是这里
 * 只有一件事要做 —— 用格子亮度选索引：
 *
 *     index = 亮度 × 字形数
 *
 * 暗处挑到稀字符、亮处挑到密字符。若图集按输入顺序摆放（不排序），
 * `@` 与 `.` 的面积差会让画面出现明暗断层 —— 那正是「自定义字符集容易变乱」
 * 的来源，不是用户的问题。
 *
 * ## 分辨率为什么是「每行字符数」
 *
 * 预览是 ≈960 宽、导出是工程分辨率（1920…）。若用「字符多少像素」当参数，
 * 两边数出的字符数会差一倍（预览 72 列、导出 36 列）—— 同一工程在两处
 * 不是同一幅画。用列数则字形数量恒定，只有像素密度随分辨率变。
 *
 * ## 抖动
 *
 * 抖的是**采样点**（逐格随机偏移，按频率重掷），不是字形框：挪框会让字形
 * 溢出格子、被邻格裁掉一个角，看起来像 bug。挪采样点则是「字符在邻近
 * 位置之间跳」，且不产生任何裁剪。随机量全部是 cellId 与 tick 的纯函数，
 * 同一 t 两渲逐字节相同（不含跨帧状态）。
 */
export const shader: EffectShaderDef = {
  fragment:
    HASH_FAST_GLSL +
    `
uniform sampler2D u_atlas;
uniform float u_glyphCount;
uniform float u_glyphCols;

uniform float u_columns;
uniform float u_spacing;
uniform float u_lineHeight;
uniform float u_invert;
uniform float u_edges;
uniform float u_keepOriginal;
uniform float u_cellBgOn;
uniform float u_cellBgInvert;
uniform float u_jitter;
uniform float u_jitterFreq;
uniform vec3 u_charColor;
uniform vec3 u_bgColor;
uniform vec3 u_cellBgColor;

float lumaOf(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float lumAt(vec2 uv) {
  return lumaOf(texture(u_texture, clamp(uv, vec2(0.0), vec2(1.0))).rgb);
}

void main() {
  vec2 res = max(u_resolution, vec2(1.0));
  float cols = max(u_columns, 1.0);
  float cellW = res.x / cols;
  // 行数取整：否则底部会出现半行字符
  float rows = max(1.0, floor(res.y / max(cellW * u_lineHeight, 1e-3) + 0.5));
  float cellH = res.y / rows;
  vec2 cellPx = vec2(cellW, cellH);
  vec2 uvStep = cellPx / res;

  vec2 cells = vUv * res / cellPx;
  vec2 cellId = floor(cells);
  vec2 local = fract(cells);

  vec2 center = (cellId + 0.5) * uvStep;
  if (u_jitter > 0.0) {
    float tick = floor(u_time * u_jitterFreq + hash21(cellId + 3.7) * 11.0);
    vec2 r = vec2(hash21(cellId + vec2(1.3, 7.1) + tick * 0.37),
                  hash21(cellId * 0.71 + tick * 0.91 + 19.3));
    center += (r - 0.5) * 2.0 * u_jitter * uvStep;
  }

  // 格子亮度：中心 + 四向 1/4 格。单点采样在缩小时会让细纹整片闪。
  float lum = lumAt(center) * 0.4
    + lumAt(center + vec2(uvStep.x * 0.25, 0.0)) * 0.15
    + lumAt(center - vec2(uvStep.x * 0.25, 0.0)) * 0.15
    + lumAt(center + vec2(0.0, uvStep.y * 0.25)) * 0.15
    + lumAt(center - vec2(0.0, uvStep.y * 0.25)) * 0.15;

  // 边缘模式：把密度信号换成梯度强度，轮廓用密字符、平地留空。
  float edge = 0.0;
  if (u_edges > 0.5) {
    vec2 dx = vec2(uvStep.x, 0.0);
    vec2 dy = vec2(0.0, uvStep.y);
    float l00 = lumAt(center - dx - dy);
    float l10 = lumAt(center - dy);
    float l20 = lumAt(center + dx - dy);
    float l01 = lumAt(center - dx);
    float l21 = lumAt(center + dx);
    float l02 = lumAt(center - dx + dy);
    float l12 = lumAt(center + dy);
    float l22 = lumAt(center + dx + dy);
    float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    edge = clamp(length(vec2(gx, gy)) * 1.6, 0.0, 1.0);
  }

  float signal = mix(lum, edge, u_edges);
  signal = mix(signal, 1.0 - signal, u_invert);

  float count = max(u_glyphCount, 1.0);
  float idx = min(floor(clamp(signal, 0.0, 1.0) * count), count - 1.0);

  // 字形框：格子内的正方形（保持字形比例）。字符间距 = 框按比例缩小。
  float side = max(cellW * (1.0 - clamp(u_spacing, 0.0, 0.9)), 1.0);
  vec2 boxPx = vec2(side);
  vec2 offset = (cellPx - boxPx) * 0.5;
  vec2 gp = (local * cellPx - offset) / boxPx;
  // 图集上传时**没有**翻 Y（见 engine/glyph-atlas.ts）：v=0 是画布第一行，
  // 而这里 local.y 随屏幕向上增大，所以字形内部要自己翻一次。
  gp.y = 1.0 - gp.y;
  float inside = step(0.0, gp.x) * step(gp.x, 1.0) * step(0.0, gp.y) * step(gp.y, 1.0);

  float gcols = max(u_glyphCols, 1.0);
  float grows = ceil(count / gcols);
  vec2 gcell = vec2(mod(idx, gcols), floor(idx / gcols));
  // 内缩半个纹素（图集每格 64px，见 glyph-atlas.ts 的 CELL）：不内缩时
  // LINEAR 会在格边把邻格的字形混进来。**改 CELL 要一起改这个常数。**
  float ink = texture(u_atlas, (gcell + clamp(gp, 0.0078125, 0.9921875)) / vec2(gcols, grows)).a * inside;

  vec4 src = texture(u_texture, vUv);
  // 逐字背景只在开了开关时参与；亮度（或反相后的亮度）决定它有多亮。
  float bgf = mix(lum, 1.0 - lum, u_cellBgInvert) * u_cellBgOn;
  vec3 bg = mix(u_bgColor, u_cellBgColor, bgf);
  if (u_keepOriginal > 0.5) bg = src.rgb;
  outColor = vec4(mix(bg, u_charColor, ink), src.a);
}`,
  glyphs: (values) => ({ text: asciiCharsetText(values), font: String(values.font ?? 'pixel') }),
  setUniforms: compose(
    floats(
      'columns',
      'spacing',
      'lineHeight',
      'invert',
      'edges',
      'keepOriginal',
      'cellBgOn',
      'cellBgInvert',
      'jitter',
      'jitterFreq',
    ),
    colors('charColor', 'bgColor', 'cellBgColor'),
  ),
};
