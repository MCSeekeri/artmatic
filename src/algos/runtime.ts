/**
 * runtime.ts — 算法生成器的渲染期运行时。
 *
 * 三型各自的每帧行为：
 *   bake    缓存命中 → reveal pass（生长前沿 u_front 由 t 驱动）
 *   sim     seek 到当前步 → 状态上传 R8（NEAREST）→ tint pass
 *   realtime 参数（含关键帧求值）→ 内部分辨率 shader pass
 *
 * 输出目标按尺寸入池复用：compositor 对每个源「resolve → placement
 * → blend」是顺序消费，同一个输出目标不会同时被两帧/两层引用。
 * shader 内部做 contain 适配（u_srcAspect / u_outAspect），
 * placement 层看到的是已经适配好的整帧画面。
 */

import { evalCurve } from '../core/curve';
import { hashSeed } from '../core/prng';
import { colorVec3 } from '../core/color';
import type { BeatGrid } from '../core/time';
import type { SourceClip } from '../core/schema';
import type { Kit, Program, Target } from '../engine/kit';
import type { SourceTexture } from '../engine/compositor';
import { ALGO_HEAD, algoProgramName, type AlgoUniformCtx } from './shader-lib';
import { getGenerator } from './registry';
import { BakeClient } from './bake-client';
import { REVEAL_MODE, type SimHandle } from './types';
import { emptyFeatures, zeroFeatures, type AudioFeatureSource } from './feature-source';
import type { ParamDef } from '../effects/types';

const FIT_GLSL = `
uniform float u_srcAspect;
uniform float u_outAspect;
vec2 containUv(vec2 uv) {
  vec2 p = uv - 0.5;
  if (u_outAspect > u_srcAspect) p.x *= u_outAspect / u_srcAspect;
  else p.y *= u_srcAspect / u_outAspect;
  return p + 0.5;
}
float insideUv(vec2 uv) {
  vec2 e = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return e.x * e.y;
}
`;

/**
 * bake 型：R8 图 + 生长前沿揭示。
 *
 * `u_reveal` 决定前沿沿哪个量推进（见 types.ts 的 `BakeReveal`）：
 *   0 = 输出纵坐标（v=0 是第 0 代，在屏幕底部，向上长）
 *   1 = 输出横坐标（从左往右，分岔图逐列算出来）
 *   2 = 像素值本身（离根距离场：值小的先长出来）
 * 三者都乘 `cell`，所以值为 0 的背景在任何模式下都不会被点亮。
 */
const REVEAL_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_front;
uniform int u_reveal;
uniform vec3 u_colorBg;
uniform vec3 u_colorLive;
${FIT_GLSL}
void main() {
  vec2 uv = containUv(vUv);
  float cell = texture(u_tex, clamp(uv, 0.0, 1.0)).r;
  float revealed;
  if (u_reveal == 2) revealed = step(cell, u_front);
  else if (u_reveal == 1) revealed = step(uv.x, u_front);
  else revealed = step(uv.y, u_front);
  vec3 c = mix(u_colorBg, u_colorLive, cell * revealed * insideUv(uv));
  outColor = vec4(c, 1.0);
}`;

/** sim 型：R8 状态 + 双色调。 */
const TINT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec3 u_colorBg;
uniform vec3 u_colorLive;
${FIT_GLSL}
void main() {
  vec2 uv = containUv(vUv);
  float cell = texture(u_tex, clamp(uv, 0.0, 1.0)).r;
  vec3 c = mix(u_colorBg, u_colorLive, cell * insideUv(uv));
  outColor = vec4(c, 1.0);
}`;

interface SimEntry {
  handle: SimHandle;
  hash: string;
  tex: WebGLTexture;
}

export class AlgoRuntime {
  private readonly revealProg: Program;
  private readonly tintProg: Program;
  private readonly outPool = new Map<string, Target>();
  private readonly sims = new Map<string, SimEntry>();
  /**
   * 音频特征来源（`render-core` 注入）。**没有源时读静音特征**而不是跳过 ——
   * 场景的 uniform 照常派发，只是值全 0，画面偏暗，而不是 sampler / 参数缺失。
   */
  private featureSource: AudioFeatureSource | null = null;
  /** `at()` 的复用出参（每帧每源都读，不能分配）。 */
  private readonly features = emptyFeatures();

  constructor(
    private readonly kit: Kit,
    private readonly bake: BakeClient,
  ) {
    this.revealProg = kit.quad(REVEAL_FRAG, 'algo-reveal');
    this.tintProg = kit.quad(TINT_FRAG, 'algo-tint');
  }

  setFeatureSource(source: AudioFeatureSource | null): void {
    this.featureSource = source;
  }

  readonly resolve = (
    clip: SourceClip,
    t: number,
    frame: number,
    grid: BeatGrid,
    projectSeed: number,
    fps: number,
    renderW: number,
    renderH: number,
  ): SourceTexture | null => {
    if (clip.source.type !== 'algo') return null;
    const def = getGenerator(clip.source.generator);
    if (!def) return null;
    const params = this.evalParams(clip, def.params, t, grid);
    const seed = hashSeed(projectSeed, clip.id);

    if (def.kind === 'bake') {
      // 烘焙入参只求 clip.start 处的值——烘焙参数打关键帧 = 每帧重烘，禁止。
      const bakeParams = this.evalParams(clip, def.params, clip.start, grid);
      const hash = `${def.id}|${JSON.stringify(bakeParams)}|${seed}`;
      const baked = this.bake.request(hash, def.id, bakeParams, seed);
      if (!baked) return null; // 烘焙中：这层这帧缺席
      const front =
        (Math.max(0, t - clip.start) * Number(params.speed ?? 96)) / Math.max(1, baked.frontMax);
      const out = this.outFor(renderW, renderH);
      this.revealProg.use();
      this.revealProg
        .tex('u_tex', baked.tex)
        .u('u_front', Math.min(1, front))
        .u1i('u_reveal', REVEAL_MODE[def.reveal ?? 'front-y'] ?? 0)
        .u('u_colorBg', colorVec3(String(params.colorBg ?? '#000000')))
        .u('u_colorLive', colorVec3(String(params.colorLive ?? '#ffffff')))
        .u('u_srcAspect', baked.w / baked.h)
        .u('u_outAspect', renderW / renderH);
      this.kit.pass(this.revealProg, out);
      return { tex: out.tex, w: renderW, h: renderH };
    }

    if (def.kind === 'sim') {
      const createParams = this.evalParams(clip, def.params, clip.start, grid);
      const hash = `${def.id}|${JSON.stringify(createParams)}|${seed}`;
      let entry = this.sims.get(clip.id);
      if (!entry || entry.hash !== hash) {
        const handle = def.create(createParams, seed);
        entry = { handle, hash, tex: this.createR8(handle.gridW, handle.gridH) };
        this.sims.set(clip.id, entry);
      }
      const simFrame = Math.floor(Math.max(0, t - clip.start) * entry.handle.stepsPerSec);
      entry.handle.seek(simFrame);
      this.uploadR8(entry.tex, entry.handle.gridW, entry.handle.gridH, entry.handle.current());
      const out = this.outFor(renderW, renderH);
      this.tintProg.use();
      this.tintProg
        .tex('u_tex', entry.tex)
        .u('u_colorBg', colorVec3(String(params.colorBg ?? '#000000')))
        .u('u_colorLive', colorVec3(String(params.colorLive ?? '#ffffff')))
        .u('u_srcAspect', entry.handle.gridW / entry.handle.gridH)
        .u('u_outAspect', renderW / renderH);
      this.kit.pass(this.tintProg, out);
      return { tex: out.tex, w: renderW, h: renderH };
    }

    // realtime：逐帧实时 shader（不做跳帧缓存——那是对确定性的破坏）
    const res = Number(params.intRes) || 480;
    const w = Math.round((res * 16) / 9);
    const h = res;
    const out = this.outFor(w, h);
    const prog = this.kit.quad(ALGO_HEAD + def.fragment, algoProgramName(def.id));
    prog.use();
    prog
      .u('u_time', t)
      .u('u_delta', fps > 0 ? 1 / fps : 0)
      .u('u_seed', seed / 4294967296)
      .u('u_resolution', [w, h])
      .u('u_aspect', w / h);
    // 参数派发交给 def —— 通用化了才可能「场景 = realtime 生成器」。
    // 写死 uniform 名的年代，新 shader 拿不到参数**且不报错**，只是恒用默认值。
    //
    // 音频特征在同一处读：`at(t)` 是纯函数（离线轨查表），所以 seek 得到的
    // 特征与顺序播放一致 —— 这正是硬约束 1.1 要的（逐帧累加器做不到）。
    if (this.featureSource) this.featureSource.at(t, this.features);
    else zeroFeatures(this.features);
    const uctx: AlgoUniformCtx = { t, frame, seed, w, h, fps, grid, clip, features: this.features };
    def.setUniforms(this.kit.gl, prog.uniforms, params, uctx);
    this.kit.pass(prog, out);
    return { tex: out.tex, w, h };
  };

  /** 参数求值：range 型参数有曲线走曲线（beatAnchor/clipStart 双上下文都在）。 */
  private evalParams(
    clip: SourceClip,
    defs: ParamDef[],
    t: number,
    grid: BeatGrid,
  ): Record<string, number | string> {
    const raw = clip.source.type === 'algo' ? clip.source.params : {};
    const out: Record<string, number | string> = {};
    for (const p of defs) {
      const curve = clip.curves[p.key];
      if (curve && p.type === 'range') {
        out[p.key] = evalCurve(curve, t, { grid, clipStart: clip.start });
      } else {
        out[p.key] = raw[p.key] ?? p.defaultValue;
      }
    }
    return out;
  }

  private outFor(w: number, h: number): Target {
    const key = `${w}x${h}`;
    let target = this.outPool.get(key);
    if (!target) {
      target = this.kit.target(w, h);
      this.outPool.set(key, target);
    }
    return target;
  }

  private createR8(w: number, h: number): WebGLTexture {
    const gl = this.kit.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private uploadR8(tex: WebGLTexture, w: number, h: number, data: Uint8Array): void {
    const gl = this.kit.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, data);
  }
}
