/**
 * transitions/thumbnails.ts — 转场选择器缩略图用的**两张底图**。
 *
 * 与 `effects/thumbnails/bases.ts` 是同一件事的两个面：那个是「一张底图 + 特效」，
 * 这个是「**两张**底图 + 转场」。转场着色器的签名是 `vec4 transition(vec2 uv)`，
 * 它同时要 `from` / `to` 两张贴图与 `progress`，所以预览必须把两张图都摆出来。
 *
 * ## 为什么是刻意的两张图，而不是随手拿同一张
 *
 * 缩略图的唯一职责是**让人一眼分辨出这条转场在怎么切**。两张图之间至少要有
 * 三个可辨识的差异，否则不同转场会长得一样、这张图就白做了：
 *
 * | 差异 | 用途 |
 * |---|---|
 * | **冷 / 暖两极的色相** | dissolve / 亮度 / 颜色类转场靠它读出来 |
 * | **强结构（圆环 / 栅格）+ 一条亮边框** | 擦除 / 滑移 / 位移类转场看的是形的错位与边框的位移 |
 * | **大形体（太阳盘 / 大圆环）** | 缩放 / 旋转 / 径向类转场看得出绕哪个中心在动 |
 *
 * 两张图都**自带一条亮边框**：滑移（slide）与擦除（wipe）类转场在纯色画面上
 * 只看得出「颜色变了」，有边框才看得出「整张图移了」。这是从「缩略图看不出变化
 * = 这张图白做」那个老问题里长出来的一条要求。
 *
 * ## 接入方式与特效底图一致：伪 generator id
 *
 * 这两个底图**不注册进 `algos/registry.ts`**，也不改 `schema.ts`。渲染器用
 * `trthumb:` 前缀的伪 generator id 在自己的 resolver 里拦截（见
 * `render/transition-thumb-renderer.ts`）。它们是选择器的展示素材，不是产品功能。
 */

/** 底图的伪 generator id 前缀。由转场缩略图渲染器的 resolver 拦截。 */
export const TRANSITION_THUMB_PREFIX = 'trthumb:';

export type TransitionThumbBaseId = 'from' | 'to';

const HEAD = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
in vec2 vUv;
out vec4 outColor;
`;

/**
 * 出画图（`from`）：**暖色**黄昏 —— 深红→橙的天空 + 左上偏心的太阳 + 同心环 + 底部山脊。
 *
 * 暖色是这条的半个职责（另一半在 `to`）：颜色类转场靠「暖 → 冷」这个对立读出来。
 * 太阳偏心而不是居中，是为了让**旋转**类转场（绕画面中心转）产生可见的位移差。
 */
const FROM_FRAGMENT = `${HEAD}
void main() {
  vec2 uv = vUv;
  float aspect = u_resolution.x / u_resolution.y;
  // 暖色天空：深红 → 橙 → 亮黄
  vec3 col = mix(vec3(0.16, 0.02, 0.06), vec3(1.0, 0.62, 0.16), uv.y);
  // 左上偏心的太阳（偏心 = 旋转类转场才有位移差）
  vec2 sc = (uv - vec2(0.30, 0.64)) * vec2(aspect, 1.0);
  float sd = length(sc);
  col = mix(col, vec3(1.0, 0.94, 0.62), 1.0 - smoothstep(0.195, 0.205, sd));
  // 从太阳发出的同心环
  col += vec3(1.0, 0.80, 0.42) * 0.14 * pow(max(sin(sd * 30.0), 0.0), 10.0);
  // 底部深色山脊
  float ridge = uv.y - (0.30 + 0.20 * sin(uv.x * 6.2831853));
  col = mix(col, vec3(0.09, 0.02, 0.05), smoothstep(0.0, 0.010, ridge));
  // 亮边框：滑移 / 擦除类转场的位移一眼可见
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  col = mix(vec3(1.0, 0.86, 0.45), col, smoothstep(0.0, 0.012, edge));
  outColor = vec4(col, 1.0);
}`;

/**
 * 入画图（`to`）：**冷色**夜空 —— 深蓝→青的天空 + 栅格 + 右侧偏心的大圆环。
 *
 * 栅格给的是「高频的形」，位移 / 平铺 / 像素类转场在它上面读得出格子错位；
 * 大圆环给的是「低频的形」，缩放 / 径向类转场看的是它张开还是收拢。
 */
const TO_FRAGMENT = `${HEAD}
void main() {
  vec2 uv = vUv;
  float aspect = u_resolution.x / u_resolution.y;
  // 冷色夜空：深蓝 → 青
  vec3 col = mix(vec3(0.02, 0.05, 0.18), vec3(0.10, 0.72, 0.86), uv.y);
  // 栅格阵列（高频的形）
  vec2 g = fract(uv * vec2(11.0, 6.0));
  float sq = step(0.20, g.x) * step(g.x, 0.80) * step(0.20, g.y) * step(g.y, 0.80);
  col = mix(col, vec3(0.86, 0.97, 1.0), sq * 0.45);
  // 右侧偏心的大圆环（低频的形）
  vec2 rc = (uv - vec2(0.68, 0.42)) * vec2(aspect, 1.0);
  float rd = length(rc);
  col = mix(col, vec3(1.0, 1.0, 0.40), 1.0 - smoothstep(0.0, 0.015, abs(rd - 0.24)));
  // 亮边框（同上，冷色版）
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  col = mix(vec3(0.45, 0.95, 1.0), col, smoothstep(0.0, 0.012, edge));
  outColor = vec4(col, 1.0);
}`;

export interface TransitionThumbBase {
  id: TransitionThumbBaseId;
  fragment: string;
}

export const TRANSITION_THUMB_BASES: TransitionThumbBase[] = [
  { id: 'from', fragment: FROM_FRAGMENT },
  { id: 'to', fragment: TO_FRAGMENT },
];

export function transitionThumbBase(id: string): TransitionThumbBase | null {
  return TRANSITION_THUMB_BASES.find((b) => b.id === id) ?? null;
}

/** 伪 generator id（`trthumb:from` / `trthumb:to`）。 */
export function transitionThumbGeneratorId(id: TransitionThumbBaseId): string {
  return `${TRANSITION_THUMB_PREFIX}${id}`;
}

export function isTransitionThumbGeneratorId(id: string): boolean {
  return id.startsWith(TRANSITION_THUMB_PREFIX);
}
