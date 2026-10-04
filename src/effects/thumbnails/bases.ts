/**
 * bases.ts — 选择器缩略图的**底图**。
 *
 * 每个特效拿什么底图，取决于「它的变化发生在什么上」。用错底图的表现是
 * 缩略图**看起来没变化**，等于这张图白做：
 *
 * | 底图 | 变化发生在 | 给谁 |
 * |---|---|---|
 * | `bars` | 颜色 | 去饱和度 / 通道换色 / 二分色 |
 * | `ramp` | 阶调 | 量化 / 抖动 / 曝光 / 半调 |
 * | `grid` | 形状 | 扭曲 / 位移 / 平铺 / 3D |
 * | `photo` | 细节 | 模糊 / 锐化 / 浮雕 / 颗粒 |
 * | `rings` | 径向 | 漩涡 / 涟漪 / 径向模糊 / 隧道 |
 * | `mandel` | 硬边（纯黑白） | 通道错位 / 边缘 / 霓虹 / 频闪 |
 * | `scroll` | **运动** | 运动遮罩 / 融帧 / 数据融毁 / 流场 |
 *
 * 两条来自需求的硬要求：
 * - **去饱和度必须用彩条**，不能用灰阶图 —— 参考稿这里就是错的：一个把画面变灰的
 *   特效，配一张本来就是灰的底图，缩略图上看不出任何变化。
 * - **通道错位必须用纯黑白底图** —— 它在彩条上是一堆分不开的色块。
 *   所以 `mandel` 走**注册的** `mandelbrot` 生成器（而不是抄一份 fragment），
 *   它的默认色已按同一条要求改成「慢逃逸纯黑 / 快逃逸纯白 / 内部纯黑」。
 *
 * ## 为什么 `scroll` 是必须的
 *
 * 缩略图只渲一帧定格画面，而 `motion-mask`（按运动量抠遮罩）、`fast-mosh`
 * （只融变动的部分）、`kino-datamosh`（只重画变动的块）在**静止底图**上
 * 运动量恒为 0 —— 缩略图会是一张纯黑。给它们一张随时间平移的底图才有东西可看。
 *
 * 这些底图**不注册进 `algos/registry.ts`**：它们是选择器的展示素材，不是产品功能
 * （与 `lab/patterns.ts` 对测试图的处理同一理由）。接入方式是 `thumb:` 前缀的
 * 伪 generator id，由 `thumbnails/renderer.ts` 拦截。
 */

import { FBM6_GLSL } from '../shader-def';

export type ThumbBaseId =
  | 'bars'
  | 'ramp'
  | 'grid'
  | 'photo'
  | 'rings'
  | 'mandel'
  | 'scroll';

const HEAD = `#version 300 es
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
in vec2 vUv;
out vec4 outColor;
`;

/**
 * 彩条：7 条**全饱和**竖条 + 底部一条 16 级灰阶。
 * 饱和度拉满是有意的 —— 去色类特效的缩略图全靠它。
 */
const BARS = `${HEAD}
vec3 barColor(float i) {
  if (i < 0.5) return vec3(1.0, 1.0, 1.0);
  if (i < 1.5) return vec3(1.0, 1.0, 0.0);
  if (i < 2.5) return vec3(0.0, 1.0, 1.0);
  if (i < 3.5) return vec3(0.0, 1.0, 0.0);
  if (i < 4.5) return vec3(1.0, 0.0, 1.0);
  if (i < 5.5) return vec3(1.0, 0.0, 0.0);
  return vec3(0.0, 0.0, 1.0);
}
void main() {
  if (vUv.y < 0.22) {
    float g = floor(vUv.x * 16.0) / 15.0;
    outColor = vec4(vec3(g), 1.0);
    return;
  }
  outColor = vec4(barColor(floor(vUv.x * 7.0)), 1.0);
}`;

/** 阶调：上半是平滑灰阶斜坡，下半是暖冷两条彩色斜坡。量化/抖动在斜坡上才读得出。 */
const RAMP = `${HEAD}
void main() {
  if (vUv.y > 0.5) {
    outColor = vec4(vec3(vUv.x), 1.0);
    return;
  }
  // 下半：冷、暖两条彩色斜坡并排，各占一半
  vec3 warm = mix(vec3(0.05, 0.0, 0.15), vec3(1.0, 0.75, 0.35), fract(vUv.x * 2.0));
  vec3 cool = mix(vec3(0.02, 0.05, 0.2), vec3(0.35, 0.95, 1.0), fract(vUv.x * 2.0));
  outColor = vec4(mix(cool, warm, step(0.5, vUv.x)), 1.0);
}`;

/** 网格：细线 + 中心圆。扭曲 / 位移 / 平铺 / 3D 的形变一眼可见。 */
const GRID = `${HEAD}
void main() {
  vec2 p = vUv * u_resolution;
  vec2 g = abs(fract(p / 26.0) - 0.5);
  float line = 1.0 - smoothstep(0.0, 1.0, min(g.x, g.y) * 26.0);
  vec2 c = (vUv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
  float ring = 1.0 - smoothstep(0.0, 1.6, abs(length(c) - 0.26) * 26.0);
  float cross_ = (1.0 - smoothstep(0.0, 1.2, min(abs(c.x), abs(c.y)) * 40.0)) * 0.7;
  vec3 col = vec3(0.07) + vec3(0.85) * line;
  col = mix(col, vec3(0.45, 0.85, 1.0), clamp(ring + cross_, 0.0, 1.0));
  outColor = vec4(col, 1.0);
}`;

/** 细节：一层 fbm 的「自然影像」。模糊 / 锐化 / 浮雕 / 颗粒要看**细节**，不看形状。 */
const PHOTO = `${HEAD}
${FBM6_GLSL}
void main() {
  vec2 p = vUv * vec2(u_resolution.x / u_resolution.y, 1.0) * 3.2;
  float n = fbm6(p);
  float n2 = fbm6(p * 2.9 + 11.0);
  float v = n * 0.7 + n2 * 0.45;
  // 压成有明暗层次的中低对比影像，两种色调各占一半 —— 锐化与浮雕都要有边可抓
  vec3 warm = vec3(0.95, 0.72, 0.45);
  vec3 cool = vec3(0.35, 0.62, 0.95);
  vec3 col = mix(cool, warm, v) * (0.35 + 0.75 * n);
  col += 0.06 * (fbm6(p * 9.0) - 0.5);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** 径向：同心环 + 放射线。漩涡 / 涟漪 / 万花筒 / 径向模糊的形状感靠它。 */
const RINGS = `${HEAD}
void main() {
  vec2 c = (vUv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
  float r = length(c);
  float a = atan(c.y, c.x);
  float rings = pow(max(sin(r * 42.0), 0.0), 6.0);
  float spokes = pow(max(sin(a * 12.0), 0.0), 10.0);
  vec3 col = vec3(0.04, 0.05, 0.09);
  col += rings * vec3(0.55, 0.85, 1.0);
  col += spokes * 0.45 * vec3(1.0, 0.8, 0.5);
  // 中心一块亮核，径向类特效的「原点」才有参照
  col += exp(-r * 30.0) * 1.2;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/**
 * 滚动：随时间水平平移的网格 + 斜条纹。
 *
 * 唯一一张**动**的底图。运动类特效（按运动量抠遮罩 / 只融变动的块）在静止图上
 * 运动量恒为 0，缩略图会是纯黑 —— 必须给它一个真的在动的东西。
 * 同时渲染器会连渲若干帧再取图，反馈类特效的拖尾也是这样才有。
 */
const SCROLL = `${HEAD}
void main() {
  vec2 uv = vUv;
  // 整体向左平移：第二层更慢，形成视差，运动估计才有分层
  uv.x += u_time * 0.22;
  vec2 p = uv * u_resolution;
  vec2 g = abs(fract(p / vec2(30.0, 22.0)) - 0.5);
  float line = 1.0 - smoothstep(0.0, 1.0, min(g.x, g.y) * 30.0);
  vec2 q = vUv * vec2(u_resolution.x / u_resolution.y, 1.0) * 2.0;
  q.x += u_time * 0.09;
  float stripes = pow(max(sin((q.x + q.y) * 9.0), 0.0), 3.0);
  vec3 col = vec3(0.05) + vec3(0.9) * line;
  col += stripes * vec3(0.9, 0.55, 0.2) * 0.55;
  col += exp(-abs(vUv.y - 0.5) * 9.0) * 0.25;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

export interface ThumbBase {
  id: ThumbBaseId;
  /** 一份内联 fragment；`generator` 存在时用它代替。 */
  fragment?: string;
  /**
   * 走**注册的**生成器（`algos/registry.ts`）而不是内联 fragment。
   * 这样底图自动跟随该生成器的默认值 —— `mandel` 就是这么拿到「纯黑白」的。
   */
  generator?: string;
  params?: Record<string, number | string>;
}

/** 底图的伪 generator id 前缀。由 `thumbnails/renderer.ts` 的 resolver 拦截。 */
export const THUMB_PREFIX = 'thumb:';

export const THUMB_BASES: ThumbBase[] = [
  { id: 'bars', fragment: BARS },
  { id: 'ramp', fragment: RAMP },
  { id: 'grid', fragment: GRID },
  { id: 'photo', fragment: PHOTO },
  { id: 'rings', fragment: RINGS },
  { id: 'mandel', generator: 'mandelbrot' },
  { id: 'scroll', fragment: SCROLL },
];

export function thumbBase(id: ThumbBaseId): ThumbBase | null {
  return THUMB_BASES.find((b) => b.id === id) ?? null;
}

/** 伪 generator id（`thumb:bars`）。 */
export function thumbGeneratorId(id: ThumbBaseId): string {
  return `${THUMB_PREFIX}${id}`;
}

export function isThumbGeneratorId(id: string): boolean {
  return id.startsWith(THUMB_PREFIX);
}
