/**
 * shader-def.ts — 特效着色器协议（移植 openmosh EffectShaderDef，MIT，见 CREDITS.md）。
 *
 * 全部字段都已实现：fragment / prePasses / linearFilter / hdrFeedback /
 * opaqueOutput / feedback。
 * 不移植：animated 标志（我们由 t 驱动）、mosh/volumeLink、文字 uniform 族。
 *
 * 「新增一个特效 = 两个文件」：defs/<id>.ts（参数面板定义）+
 * glsl/<id>.ts（本协议实现），registry 按文件名自动配对。
 */

import type { BeatGrid } from '../core/time';
import type { EffectClip } from '../core/schema';

/** hex 颜色 → [0..1] 的三分量，供 `setUniforms` 里给 vec3 uniform 用。 */
export { colorVec3 } from '../core/color';

export interface PrePassDef {
  fragment: string;
  /** 这一 pass 采样输入时临时切成 LINEAR（smooth warps 需要）。 */
  linearFilter?: boolean;
  /**
   * 这一 pass 的输出作为**私有全分辨率浮点历史**保留，下一帧以
   * `u_feedback` 交回；同时它的输出也是下一环的输入。用于「与主 pass
   * 自己的反馈分离」的状态，例如背景估计、被保持的关键帧。
   */
  feedback?: boolean;
}

export interface EffectShaderDef {
  /** 主 fragment（EFFECT_HEAD 之后的部分）。 */
  fragment: string;
  /**
   * 主 pass 之前的全屏 pass 链。第一环读本特效的输入，最后一环的输出
   * 就是主 pass 的 `u_texture`。非 feedback 的 pre-pass 渲染在**半分辨率
   * 浮点草稿**上，且 `u_resolution` 仍传全分辨率（降采样只改 tap 密度，
   * 不改模糊半径）。
   */
  prePasses?: PrePassDef[];
  /** 主 pass 采样输入时临时切成 LINEAR（smooth warps 需要）。 */
  linearFilter?: boolean;
  /**
   * 把本实例的 `u_feedback` 历史分配成 RGBA16F 而不是 RGBA8。
   * 有状态模拟的逐帧增量会低于 8bit 量化步长，用 8bit 会 stall 成色块。
   * 设备不支持 `EXT_color_buffer_float` 时安静回落 RGBA8。
   */
  hdrFeedback?: boolean;
  /** 本着色器自己铺整帧背景（不保留输入 alpha）。协议语义，runner 无需特殊处理。 */
  opaqueOutput?: boolean;
  /** 主 pass 需要 u_feedback（实例的跨帧历史，ping-pong）。 */
  feedback?: boolean;
  setUniforms: (
    gl: WebGL2RenderingContext,
    locs: Record<string, WebGLUniformLocation | null>,
    values: Record<string, number | string>,
    ctx: EffectUniformCtx,
  ) => void;
}

export interface EffectUniformCtx {
  t: number;
  frame: number;
  /** hashSeed(project.seed, instanceId, frame) / 2^32 ∈ [0,1)。 */
  seed: number;
  w: number;
  h: number;
  /** 名义帧间隔的倒数来源：`u_delta` = 1/fps。 */
  fps: number;
  grid: BeatGrid;
  clip: EffectClip;
}

/**
 * 所有特效 fragment 共享的头部（uniform 约定都在这里）。
 *
 * ## 时间与「累积相位」的移植约定
 *
 * `u_time` 是**秒**。openmosh 里带 `speed` 参数的特效拿到的是「累积相位」
 * （`phase += dt * speed`，有状态）。那是 dt 驱动的累加器，与硬约束 1.1
 * （唯一时钟是 t）冲突，而且 seek 不可复现 —— **不要照搬**。
 *
 * Artmatic 的等价写法是**把相位算成闭式**：常速时 `float phase = u_time * u_speed;`
 * 就在 fragment 里。需要按拍同步（openmosh 的 `sync === 'beat'`）时，在
 * `setUniforms` 里用 `beatAtTime(ctx.t, ctx.grid) * division` 算好，当普通
 * uniform 传进去 —— 那里拿得到 `BeatGrid`。
 *
 * 因此**不存在逐实例相位表**：相位是 t 的函数，不是历史。
 */
export const EFFECT_HEAD = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform sampler2D u_feedback;
uniform sampler2D u_original;
uniform float u_time;
uniform float u_delta;
uniform float u_seed;
uniform vec2 u_resolution;
in vec2 vUv;
out vec4 outColor;
`;

/** openmosh 的 hash 噪声（移植）。随机必须掺 u_seed——见 slices。 */
export const HASH_GLSL = `float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + u_seed * 937.0) * 43758.5453);
}
`;

/**
 * Dave Hoskins 的无 sin hash（angel-echo 的 LIB，公有领域惯例，见 CREDITS.md）。
 * 与上者的差别：不用 sin，**在很大的像素坐标下依然稳定**（grain / composite 需要）。
 * 不带 u_seed —— 它是坐标的纯函数；需要逐帧变化时配合 tick 量化
 * （`floor(u_time * N)`）而不是掺种子。
 */
export const HASH_FAST_GLSL = `float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash31(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/** openmosh 的 value noise + fbm（3 阶）。基于 HASH_GLSL，因此继承 u_seed。 */
export const NOISE_GLSL =
  HASH_GLSL +
  `float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.13 + 5.0) * 0.3
       + vnoise(p * 4.41 + 9.0) * 0.15;
}
`;

/**
 * angel-echo 的 6 阶 fbm + ridge + rot。基于 HASH_FAST_GLSL（无 sin）。
 * 比 NOISE_GLSL 贵，但层次更细；`ridge` 是「离零距离」的脊线函数，
 * `rot` 是标准 2D 旋转矩阵。
 */
export const FBM6_GLSL =
  HASH_FAST_GLSL +
  `float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm6(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) {
    s += a * vnoise2(p);
    p = m * p;
    a *= 0.5;
  }
  return s;
}
float ridge(float v, float w) {
  return 1.0 - smoothstep(0.0, w, abs(v));
}
`;

/** 小几何工具：三角波与 2D 旋转。 */
export const MATH_GLSL = `float bounce(float v) {
  v = mod(abs(v), 2.0);
  return v > 1.0 ? 2.0 - v : v;
}
vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c) * p;
}
`;

/** HSV 互转（openmosh / angel-echo 同源写法）。 */
export const HSV_GLSL = `vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;

/** 罗德里格色相旋转，angle 单位是**度**。 */
export const HUE_ROTATE_GLSL = `vec3 hueRotate(vec3 c, float angle) {
  float rad = angle * 3.14159265 / 180.0;
  float cosA = cos(rad);
  float sinA = sin(rad);
  vec3 k = vec3(0.57735026919);
  return c * cosA + cross(k, c) * sinA + k * dot(k, c) * (1.0 - cosA);
}
`;

/**
 * 黄金角 8 tap 圆盘采样（angel-echo 的 `disc()`）。r 以**像素**为单位。
 * 读 u_texture、用 u_resolution —— 两者都由 EFFECT_HEAD 提供。
 */
export const DISC_GLSL = `vec3 disc(vec2 uv, float r) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 2.399963;
    float rr = r * sqrt((float(i) + 0.5) / 8.0);
    sum += texture(u_texture, clamp(uv + vec2(cos(a), sin(a)) * rr / u_resolution, 0.0, 1.0)).rgb;
  }
  return sum * 0.125;
}
`;

/** 紧凑有序抖动（Bayer 2/4/8）。Bayer8 配 N 级量化做单色印刷质感。 */
export const BAYER_GLSL = `float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x * 0.5 + a.y * a.y * 0.75);
}
float bayer4(vec2 a) {
  return bayer2(0.5 * a) * 0.25 + bayer2(a);
}
float bayer8(vec2 a) {
  return bayer4(0.5 * a) * 0.25 + bayer2(a);
}
`;

/**
 * 便捷 setUniforms：把 values 里的数值参数映射到 u_<key>。
 *
 * ctx 是泛型：特效与算法生成器共用同一份实现（两者的 ctx 形状不同但
 * 这里用不到），避免各抄一遍。
 */
export function floats<Ctx = EffectUniformCtx>(
  ...keys: string[]
): (
  gl: WebGL2RenderingContext,
  locs: Record<string, WebGLUniformLocation | null>,
  values: Record<string, number | string>,
  ctx: Ctx,
) => void {
  return (gl, l, v) => {
    for (const key of keys) {
      const loc = l[`u_${key}`];
      if (loc) gl.uniform1f(loc, Number(v[key]) || 0);
    }
  };
}

/**
 * 特效 program 的命名 —— **预编译与运行期必须同名**，否则 `Kit.quad` 的
 * 按名缓存会「另编一份」，预编译就白做了（`compile-all.ts` 的整个机制
 * 建立在这条约定上）。所以名字只有一个来源，这里是它。
 */
export function effectProgramName(defId: string, preIndex?: number): string {
  return preIndex === undefined ? `fx-${defId}` : `fx-${defId}:pre${preIndex}`;
}
