/**
 * shader-def.ts — 特效着色器协议（移植 openmosh EffectShaderDef 的精简版，
 * MIT，见 CREDITS.md）。
 *
 * 保留的字段：fragment / prePasses（协议位置，MVP 特效暂未用）/
 * linearFilter / hdrFeedback（协议位置，MVP 只做 RGBA8 反馈）/
 * opaqueOutput / feedback（主 pass 读 u_feedback 历史）。
 * 不移植：animated 标志（我们由 t 驱动）、mosh/volumeLink、文字 uniform 族。
 *
 * 「新增一个特效 = 两个文件」：defs/<id>.ts（参数面板定义）+
 * glsl/<id>.ts（本协议实现），registry 按文件名自动配对。
 */

import type { BeatGrid } from '../core/time';
import type { EffectClip } from '../core/schema';

export interface PrePassDef {
  fragment: string;
  linearFilter?: boolean;
  feedback?: boolean;
}

export interface EffectShaderDef {
  /** 主 fragment（EFFECT_HEAD 之后的部分）。 */
  fragment: string;
  prePasses?: PrePassDef[];
  linearFilter?: boolean;
  /** 协议字段：RGBA16F 历史。MVP 只做 RGBA8，标 TODO。 */
  hdrFeedback?: boolean;
  /** 本着色器自己铺整帧背景（不保留输入 alpha）。 */
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
  grid: BeatGrid;
  clip: EffectClip;
}

/** 所有特效 fragment 共享的头部（uniform 约定都在这里）。 */
export const EFFECT_HEAD = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform sampler2D u_feedback;
uniform float u_time;
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

/** 便捷 setUniforms：把 values 里的数值参数映射到 u_<key>。 */
export function floats(
  ...keys: string[]
): EffectShaderDef['setUniforms'] {
  return (gl, l, v) => {
    for (const key of keys) {
      const loc = l[`u_${key}`];
      if (loc) gl.uniform1f(loc, Number(v[key]) || 0);
    }
  };
}
