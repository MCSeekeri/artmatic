/**
 * placement.frag.ts — 把一个 SourceClip 的画面放进全帧透明缓冲：
 * 居中 / 缩放 / 旋转 / fit，层外 alpha = 0，合成 pass 自然不动下层。
 *
 * LAYER_BOX 数学移植自 openmosh effect-shaders.ts（MIT，见 CREDITS.md），
 * 去掉 MVP 用不到的 chroma-key / mask / edgeFade。
 *
 * transform 的换算在 CPU 侧完成（drawSize / center / rot 作为 uniform），
 * fadeSec 在 buildStack 里折算进 opacity。
 *
 * ## `u_opacity` 为什么存在（而不是只在 blend pass 里乘）
 *
 * 普通通路仍然把 opacity 交给 blend pass（`u_opacity` 传 1，行为与从前逐位相同）。
 * 只有**转场通路**需要把两侧各自的 opacity 烘进各自的 alpha：转场着色器做的是
 * `mix(getFromColor(uv), getToColor(uv), progress)`，它只认贴图，没有地方接收
 * 「这一侧的不透明度」。烘进 alpha 后，两侧各自的淡变/不透明度就自然参与混合。
 *
 * 注意只乘 alpha、不动 rgb：本项目的 render target 是**直通（非预乘）alpha**，
 * blend.frag 也是按直通 alpha 算的，乘 rgb 会得到错误的结果。
 */

export const PLACEMENT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform vec2 u_frameSize;   // 渲染目标像素尺寸
uniform vec2 u_drawSize;    // 摆放后的像素尺寸（fit 已算进去）
uniform vec2 u_center;      // 帧内中心 uv（0..1）
uniform float u_rot;        // 弧度
uniform float u_opacity;    // 只缩放 alpha（直通 alpha）；普通通路传 1
in vec2 vUv;
out vec4 outColor;

/* 帧 uv -> 层内 uv。出 [0,1] 就是层外。 */
vec2 layerUv(vec2 uv) {
  vec2 p = (uv - u_center) * u_frameSize;
  float s = sin(u_rot);
  float c = cos(u_rot);
  vec2 r = vec2(c * p.x + s * p.y, c * p.y - s * p.x);
  return r / max(u_drawSize, vec2(1.0)) + 0.5;
}

float insideLayer(vec2 uv) {
  vec2 e = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return e.x * e.y;
}

void main() {
  vec2 uv = layerUv(vUv);
  vec4 c = texture(u_texture, clamp(uv, 0.0, 1.0));
  outColor = vec4(c.rgb, c.a * u_opacity) * insideLayer(uv);
}`;

/**
 * fit → drawSize 的 CPU 换算。
 * contain：完整装入帧内；cover：铺满帧（裁掉溢出）；stretch：拉满。
 * transform.sx/sy 是额外倍率。
 */
export function drawSizeFor(
  fit: 'contain' | 'cover' | 'stretch',
  frameW: number,
  frameH: number,
  srcW: number,
  srcH: number,
  sx: number,
  sy: number,
): [number, number] {
  if (fit === 'stretch' || srcW <= 0 || srcH <= 0) {
    return [frameW * sx, frameH * sy];
  }
  const k =
    fit === 'contain'
      ? Math.min(frameW / srcW, frameH / srcH)
      : Math.max(frameW / srcW, frameH / srcH);
  return [srcW * k * sx, srcH * k * sy];
}
