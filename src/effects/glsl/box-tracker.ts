import { compose, floats, HSV_GLSL, selectInt, type EffectShaderDef } from '../shader-def';

/**
 * 方框跟踪：YOLO 风格的检测 HUD。
 *
 * ## 谁做了什么
 *
 * 这个 fragment **不追踪任何东西**。方框位置、大小、标签、置信率、连线都是
 * `engine/box-tracker.ts` 在 CPU 侧算好并用 Canvas2D 画进 `u_overlay` 的
 * （文字只能靠 Canvas2D）。这里只做两件 GPU 擅长的事：
 *
 * 1. **框内效果**：按 `u_boxA` 的矩形算一个带羽化的掩码，把选中的单 pass 观感
 *    混进掩码区域。这是「反色/黑白/撕裂」这类需求唯一可行的位置 ——
 *    见文件末尾「为什么不支持任意特效」。
 * 2. **合成**：把叠层纹理按 alpha 混上去。
 *
 * ## `u_boxA` 的语义
 *
 * `xy` = 中心（0..1，**GL 空间：v 向上，与 `vUv` 同一套**）、`zw` = 半宽/半高
 * （0..1）。归一化到各自轴上，所以宽高比不等于 1 时「方框」在 UV 空间里不是
 * 正方形，但掩码逐轴比较，画出来仍是屏幕上的矩形。
 *
 * **这两个数与画在叠层上的矩形是同一份**（`engine/box-tracker.ts` 的
 * `Entry.views`：含出场/消失的缩放与不透明度），装配时把 Canvas2D 的左上原点
 * `cy` 翻成 `1 - cy`。写错这一条不会报错，症状是「框内效果整块上下镜像」——
 * 与「检测框错位」长得一模一样；漏乘缩放则是「框在动、反色块不动」。
 *
 * ## 为什么不支持「任意特效」
 *
 * 现有特效是整帧多 pass 管线（`prePasses` + 私有 `u_feedback` 历史 +
 * 半分辨率浮点草稿），协议里没有「按子区域求值」这个概念。按框调用任意特效
 * 需要每个框一组目标、N 倍 pass、以及把每个特效的历史缓冲乘以框数 ——
 * 代价与不确定性都不在这场特效的量级内。这里给 9 种单 pass 观感，
 * 覆盖「反色 / 黑白 / 阈值 / 色偏 / 像素化 / 撕裂」这几类实际需求。
 */
export const shader: EffectShaderDef = {
  // 追踪器持有跨帧状态（目标列表 / ID / 平滑）：单帧渲染只有「刚出生的框」。
  // 缩略图渲染器据此连渲若干帧（见 `EffectThumbRenderer.needsHistory`）。
  stateful: true,
  fragment: `${HSV_GLSL}
uniform sampler2D u_overlay;
uniform int u_boxCount;
uniform vec4 u_boxA[12];
uniform float u_boxFade[12];
uniform int u_interior;
uniform float u_interiorStrength;
uniform float u_interiorScale;

float luma719(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 interiorFx(vec3 c, vec2 uv) {
  if (u_interior == 1) return 1.0 - c;                                  // 反色
  if (u_interior == 2) return vec3(luma719(c));                         // 黑白
  if (u_interior == 3) return vec3(step(0.5, luma719(c)));              // 二值
  if (u_interior == 4) {                                                // 色阶量化
    float n = 4.0;
    return floor(c * n + 0.5) / n;
  }
  if (u_interior == 5) {                                                // 色相偏移
    vec3 h = rgb2hsv(c);
    h.x = fract(h.x + 0.35);
    return hsv2rgb(h);
  }
  if (u_interior == 6) {                                                // 像素化
    vec2 px = vec2(max(u_interiorScale, 1.0)) / u_resolution;
    return texture(u_texture, (floor(uv / px) + 0.5) * px).rgb;
  }
  if (u_interior == 7) {                                                // RGB 错位（撕裂感）
    vec2 px = 3.0 / u_resolution;
    float r = texture(u_texture, uv + vec2(px.x, 0.0)).r;
    float b = texture(u_texture, uv - vec2(px.x, 0.0)).b;
    return vec3(r, c.g, b);
  }
  if (u_interior == 8) {                                                // 扫描线
    float band = 0.5 + 0.5 * sin(uv.y * u_resolution.y * 1.6);
    return c * mix(0.45, 1.0, band);
  }
  if (u_interior == 9) {                                                // 轮廓
    vec2 px = 1.0 / u_resolution;
    float l = luma719(c);
    float lx = luma719(texture(u_texture, uv + vec2(px.x, 0.0)).rgb);
    float ly = luma719(texture(u_texture, uv + vec2(0.0, px.y)).rgb);
    float e = clamp((abs(l - lx) + abs(l - ly)) * 6.0, 0.0, 1.0);
    return vec3(e);
  }
  return c;
}

/**
 * 所有方框内部的掩码（取并集）。带 1.5 像素羽化，避免非整数缩放下出现硬锯齿。
 *
 * 每框再乘 u_boxFade（叠层上那一框的不透明度）：出场/消失时框在淡入淡出，
 * 框内效果必须一起淡 —— 否则「框没了、反色块还在」。
 */
float boxMask(vec2 uv) {
  float feather = 1.5 / max(u_resolution.y, 1.0);
  float m = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= u_boxCount) break;
    vec4 a = u_boxA[i];
    vec2 d = abs(uv - a.xy) - a.zw;
    float edge = max(d.x, d.y);
    m = max(m, (1.0 - smoothstep(0.0, feather, edge)) * u_boxFade[i]);
  }
  return m;
}

void main() {
  vec4 src = texture(u_texture, vUv);
  float m = boxMask(vUv) * u_interiorStrength * (u_interior == 0 ? 0.0 : 1.0);
  vec3 rgb = src.rgb;
  if (m > 0.001) rgb = mix(rgb, interiorFx(src.rgb, vUv), m);

  // 叠层是 straight alpha（canvas 上传时没有预乘）。用最朴素的 over：
  // 底图通常是不透明的，这一条在透明源上也不会把叠层吃掉。
  vec4 ov = texture(u_overlay, vUv);
  rgb = mix(rgb, ov.rgb, ov.a);
  outColor = vec4(rgb, max(src.a, ov.a));
}`,
  setUniforms: compose(
    selectInt('interior', {
      none: 0,
      invert: 1,
      mono: 2,
      threshold: 3,
      posterize: 4,
      hue: 5,
      pixelate: 6,
      rgbsplit: 7,
      scanline: 8,
      edges: 9,
    }),
    floats('interiorStrength', 'interiorScale'),
  ),
};
