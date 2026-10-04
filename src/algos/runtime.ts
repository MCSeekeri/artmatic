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
import {
  ALGO_HEAD,
  FIT_GLSL,
  TINT_FRAG,
  TINT_HEAD,
  algoProgramName,
  algoTintProgramName,
  type AlgoAuxTexture,
  type AlgoUniformCtx,
} from './shader-lib';
import { getGenerator } from './registry';
import { BakeClient } from './bake-client';
import { REVEAL_MODE, type AlgoAuxRef, type SimHandle } from './types';
import { emptyFeatures, zeroFeatures, type AudioFeatureSource } from './feature-source';
import { buildGlyphAtlas } from './glyph-atlas';
import { glyphLayout } from './glyph-layout';
import type { ParamDef } from '../effects/types';


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

interface SimEntry {
  handle: SimHandle;
  hash: string;
  tex: WebGLTexture;
  /** 创建时定下，不可变 —— 换通道数意味着换纹理，走的是「hash 变了重建」那条路。 */
  channels: 1 | 2 | 4;
}

export class AlgoRuntime {
  private readonly revealProg: Program;
  private readonly tintProg: Program;
  private readonly outPool = new Map<string, Target>();
  private readonly sims = new Map<string, SimEntry>();
  /**
   * 上传 / 创建纹理前的安全纹理单元。
   *
   * `bindTexture` / `texImage2D` / `texSubImage2D` 都作用在**当前激活单元**上，
   * 而 `Program.tex()` 会把采样本依次绑到 0..n 并留下最后一个为激活态；
   * 采样器没被编译器保留时 `tex()` 还会提前返回**且不递增单元号**。
   * 于是任何不经切换的创建/上传都可能把某个 sampler 指到错的纹理上
   * （事故形态：整片发红 / 采到上一层的图，见 AGENTS §5.5）。
   * 取 `MAX_COMBINED_TEXTURE_IMAGE_UNITS - 1` 而不是写死 31：WebGL2 只保证 ≥32。
   */
  private readonly scratchUnit: number;
  /** 运行时创建的内部纹理（字形图集等），按 kind 缓存。 */
  private readonly aux = new Map<string, AlgoAuxTexture>();
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
    const gl = kit.gl;
    const maxUnits = (gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number) || 16;
    this.scratchUnit = Math.max(0, maxUnits - 1);
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
      // `volatile` 里的键（配色 / 揭示速度）不进哈希：它们只在 reveal pass 里读，
      // 改它们不该把一张 1024×512 的 L-system 重烘一遍。
      const bakeParams = this.evalParams(clip, def.params, clip.start, grid);
      const hash = cacheHash(def.id, bakeParams, def.volatile, seed);
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
      // 构造哈希**排除 volatile 键**：配色/调色板/显示开关改了不重建模拟。
      // JSON.stringify 保持插入顺序（= def.params 顺序），所以哈希仍然稳定。
      //
      // 通道数**刻意不进哈希**：`handle.channels` 是 def 级常量；万一将来某个
      // def 让通道数随参数变，那个参数本身就在哈希里 —— 于是自动覆盖，加个
      // 后缀只是多余的字符串拼接。
      const hash = cacheHash(def.id, createParams, def.volatile, seed);
      let entry = this.sims.get(clip.id);
      if (!entry || entry.hash !== hash) {
        const handle = def.create(createParams, seed);
        const channels = normalizeChannels(handle.channels);
        entry = { handle, hash, tex: this.createSimTex(handle.gridW, handle.gridH, channels), channels };
        this.sims.set(clip.id, entry);
      }
      // 速度每帧从**当前**参数读（不是 handle 上创建时那份快照）——
      // 这正是 `rate` 能被排除出构造哈希的前提。
      const stepsPerSec = liveRate(params, entry.handle.stepsPerSec);
      const simFrame = Math.floor(Math.max(0, t - clip.start) * stepsPerSec);
      entry.handle.seek(simFrame);
      this.uploadSim(entry.tex, entry.handle.gridW, entry.handle.gridH, entry.channels, entry.handle.current());
      const out = this.outFor(renderW, renderH);
      // 自定义着色按 def.id 走 `kit.quad` 的具名缓存 —— 每帧重新拼串会让它
      // 每帧都按新名字查一次缓存（名字一样，所以是命中，但拼串本身是浪费）；
      // 更要紧的是名字必须与预编译一致，所以统一由 algoTintProgramName 生成。
      const prog =
        def.tintFragment !== undefined
          ? this.kit.quad(TINT_HEAD + def.tintFragment, algoTintProgramName(def.id))
          : this.tintProg;
      prog.use();
      prog
        .tex('u_tex', entry.tex)
        .u('u_colorBg', colorVec3(String(params.colorBg ?? '#000000')))
        .u('u_colorLive', colorVec3(String(params.colorLive ?? '#ffffff')))
        .u('u_srcAspect', entry.handle.gridW / entry.handle.gridH)
        .u('u_outAspect', renderW / renderH);
      if (def.setTintUniforms) {
        def.setTintUniforms(
          this.kit.gl,
          prog.uniforms,
          params,
          this.makeCtx(t, frame, seed, entry.handle.gridW, entry.handle.gridH, fps, grid, clip),
        );
      }
      this.kit.pass(prog, out);
      return { tex: out.tex, w: renderW, h: renderH };
    }

    // realtime：逐帧实时 shader（不做跳帧缓存——那是对确定性的破坏）
    const res = Number(params.intRes) || 480;
    const w = Math.round((res * 16) / 9);
    const h = res;
    const out = this.outFor(w, h);
    const prog = this.kit.quad(ALGO_HEAD + def.fragment, algoProgramName(def.id));
    // aux 纹理必须在 `prog.use()` **之前**建好：创建纹理要 bindTexture，
    // 而它作用在当前激活单元上（见 scratchUnit 的注释）。
    const auxMap = def.auxTextures ? this.bindAux(def.auxTextures) : undefined;
    prog.use();
    prog
      .u('u_time', t)
      .u('u_delta', fps > 0 ? 1 / fps : 0)
      .u('u_seed', seed / 4294967296)
      .u('u_resolution', [w, h])
      .u('u_aspect', w / h);
    if (auxMap) {
      for (const a of def.auxTextures!) {
        const tex = auxMap.get(a.uniform);
        if (tex) prog.tex(a.uniform, tex.tex);
      }
    }
    // 参数派发交给 def —— 通用化了才可能「场景 = realtime 生成器」。
    // 写死 uniform 名的年代，新 shader 拿不到参数**且不报错**，只是恒用默认值。
    //
    // 音频特征在同一处读：`at(t)` 是纯函数（离线轨查表），所以 seek 得到的
    // 特征与顺序播放一致 —— 这正是硬约束 1.1 要的（逐帧累加器做不到）。
    const uctx = this.makeCtx(t, frame, seed, w, h, fps, grid, clip, auxMap);
    def.setUniforms(this.kit.gl, prog.uniforms, params, uctx);
    this.kit.pass(prog, out);
    return { tex: out.tex, w, h };
  };

  /** 组装 uniform 上下文；特征对象在这里填充（它是复用的，不能分配）。 */
  private makeCtx(
    t: number,
    frame: number,
    seed: number,
    w: number,
    h: number,
    fps: number,
    grid: BeatGrid,
    clip: SourceClip,
    aux?: ReadonlyMap<string, AlgoAuxTexture>,
  ): AlgoUniformCtx {
    if (this.featureSource) this.featureSource.at(t, this.features);
    else zeroFeatures(this.features);
    return { t, frame, seed, w, h, fps, grid, clip, features: this.features, aux };
  }

  /**
   * 取（必要时创建）`def.auxTextures` 声明的内部纹理。
   *
   * 每帧都返回同一份 map —— 它只在本次 resolve 内被读，所以复用是安全的；
   * 纹理本身按 kind 长期缓存（字形图集与帧无关，重建一次是几百微秒的浪费）。
   */
  private bindAux(refs: readonly AlgoAuxRef[]): Map<string, AlgoAuxTexture> {
    const map = new Map<string, AlgoAuxTexture>();
    for (const ref of refs) {
      map.set(ref.uniform, this.auxFor(ref.kind));
    }
    return map;
  }

  private auxFor(kind: AlgoAuxRef['kind']): AlgoAuxTexture {
    const cached = this.aux.get(kind);
    if (cached) return cached;
    const gl = this.kit.gl;
    // 创建纹理要 bindTexture —— 先切到 scratch，别踩采样器正在用的单元。
    gl.activeTexture(gl.TEXTURE0 + this.scratchUnit);
    let built: AlgoAuxTexture;
    const layout = glyphLayout();
    const atlas = buildGlyphAtlas(gl, layout);
    built = { tex: atlas.tex, w: atlas.w, h: atlas.h, cols: atlas.cols, rows: atlas.rows, cell: atlas.cell };
    this.aux.set(kind, built);
    return built;
  }

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

  /**
   * 按通道数造状态纹理。`channels` 为 1 时与改动前**逐字节相同**
   * （R8 / NEAREST / CLAMP）—— 这是 `algos.spec.ts` 的 seek 确定性用例
   * 继续成立的前提，也是「生命游戏逐像素不变」的前提。
   */
  private createSimTex(w: number, h: number, channels: 1 | 2 | 4): WebGLTexture {
    const gl = this.kit.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (channels === 2) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w, h, 0, gl.RG, gl.UNSIGNED_BYTE, null);
    } else if (channels === 4) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private uploadSim(
    tex: WebGLTexture,
    w: number,
    h: number,
    channels: 1 | 2 | 4,
    data: Uint8Array,
  ): void {
    const gl = this.kit.gl;
    const fmt = channels === 2 ? gl.RG : channels === 4 ? gl.RGBA : gl.RED;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, fmt, gl.UNSIGNED_BYTE, data);
  }
}

/**
 * 「算一次、缓存起来」那段的哈希（`bake` 的烘焙入参 / `sim` 的构造参数）。
 *
 * 抽成纯函数是为了**它能被单测钉住**：`stripVolatile` 本身好测，但真正要守的是
 * 「运行期确实用了它」。只测 helper 的话，把调用点改回 `JSON.stringify(params)`
 * 不会有任何测试变红 —— 而那正是这个机制唯一会坏的方式。
 */
export function cacheHash(
  id: string,
  params: Record<string, number | string>,
  volatileKeys: readonly string[] | undefined,
  seed: number,
): string {
  return `${id}|${JSON.stringify(stripVolatile(params, volatileKeys))}|${seed}`;
}

/** 把句柄上的 `channels` 收敛到支持的取值（缺省 = 单通道 = 旧行为）。 */
function normalizeChannels(ch: SimHandle['channels']): 1 | 2 | 4 {
  return ch === 2 || ch === 4 ? ch : 1;
}

/**
 * sim 的速度参数键 —— 家族约定，一律叫 `rate`。
 *
 * 它从构造哈希里排除（见 `SimDef.volatile`），所以必须每帧从**当前**参数读。
 * 非有限值（缺键 / 手改坏的工程文件）时退回句柄上那份，不退回 0 ——
 * 退成 0 会让模拟永远停在第一帧，看起来像「生成器坏了」。
 */
export function liveRate(params: Record<string, number | string>, fallback: number): number {
  const v = Number(params['rate']);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** 从构造参数里剔掉 `volatile` 列出的键（用于构造哈希）。 */
export function stripVolatile(
  params: Record<string, number | string>,
  volatileKeys: readonly string[] | undefined,
): Record<string, number | string> {
  if (!volatileKeys || volatileKeys.length === 0) return params;
  const out: Record<string, number | string> = {};
  for (const k of Object.keys(params)) {
    if (!volatileKeys.includes(k)) out[k] = params[k]!;
  }
  return out;
}
