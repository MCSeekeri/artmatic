/**
 * shader-lib.ts — 算法生成器的着色器协议（与 `effects/shader-def.ts` 同构）。
 *
 * 为什么要单独一份头而不是复用 `EFFECT_HEAD`：算法生成器是**画面来源**，
 * 没有输入纹理（`u_texture`）、没有反馈历史（`u_feedback`）、也没有
 * 「未处理的源」（`u_original`）。共用一份会让每个生成的 shader 都声明
 * 三个永远拿不到东西的 sampler。
 *
 * `realtime` 型的 fragment 因此**不写头** —— 它由 `ALGO_HEAD` 拼在前面，
 * 与特效的「两文件纪律」同理。`bake` / `sim` 型不产 shader（走 Worker /
 * R8 纹理），只共用 `u_<key>` 的参数派发约定。
 */

import type { BeatGrid } from '../core/time';
import type { SourceClip } from '../core/schema';
import type { SelectParam } from '../effects/types';

export interface AlgoUniformCtx {
  t: number;
  frame: number;
  /** hashSeed(project.seed, clipId) —— 算法是整段恒定种子，不逐帧变。 */
  seed: number;
  /** 算法的**内部**渲染分辨率（不是输出帧尺寸）。 */
  w: number;
  h: number;
  fps: number;
  grid: BeatGrid;
  clip: SourceClip;
}

export type AlgoSetUniforms = (
  gl: WebGL2RenderingContext,
  locs: Record<string, WebGLUniformLocation | null>,
  values: Record<string, number | string>,
  ctx: AlgoUniformCtx,
) => void;

/**
 * 所有 `realtime` 生成器共享的头部。
 *
 * `u_time` **是秒**（与特效同一条口径：相位要闭式，见 shader-def.ts 的说明）。
 * `u_resolution` 是内部渲染尺寸，`u_aspect` = w/h —— 分形那类要看宽高比。
 */
export const ALGO_HEAD = `#version 300 es
precision highp float;
uniform float u_time;
uniform float u_delta;
uniform float u_seed;
uniform vec2 u_resolution;
uniform float u_aspect;
in vec2 vUv;
out vec4 outColor;
`;

/**
 * 所有 `realtime` 生成器共用的「内部渲染高度」参数。
 *
 * 单个真源：以前每个 def 各写一份 select，键名与选项会漂。内部低分辨率
 * 再放大是性能手段（AGENTS 明说不是跳帧缓存 —— 那会破坏确定性）。
 * 文案键也共用一套 `algo.intRes*`，不再一个生成器一份。
 */
export function intResParam(): SelectParam {
  return {
    key: 'intRes',
    labelKey: 'algo.intRes',
    type: 'select',
    defaultValue: '480',
    options: [
      { labelKey: 'algo.intRes.240', value: '240' },
      { labelKey: 'algo.intRes.480', value: '480' },
      { labelKey: 'algo.intRes.720', value: '720' },
    ],
  };
}

/**
 * `realtime` 生成器的 program 名 —— 预编译与运行期必须同名（同
 * `effectProgramName` 的理由：`Kit.quad` 按名缓存，不同名就会「另编一份」）。
 */
export function algoProgramName(id: string): string {
  return `algo-${id}`;
}
