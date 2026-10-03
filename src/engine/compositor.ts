/**
 * compositor.ts — ping-pong 合成调度。
 *
 *   acc（透明黑起步）
 *     → 每个 SourceOp：placement（源 → placed）→ blend（placed over acc）
 *     → 每个 TransitionOp：两侧各 placement（→ placedA / placedB）→
 *       transition（两张贴图 + progress → trTmp）→ blend（trTmp over acc）
 *     → 每个 EffectOp：chain 逐个 effect runEffect(acc → buf)，swap
 *     → 最后 passthrough 到屏幕
 *
 * acc 在 ping/pong 两个 Target 之间倒手，所以 EffectClip 拿到的永远是
 * 「z 序在它之下所有 source 的合成结果」——adjustment layer 语义是
 * 调度的天然产物。
 *
 * 反馈池：feedback 类特效（echo）需要跨帧历史，每个特效实例一对 Target，
 * seek 时由 Renderer 调 clearFeedback() 清空（预览 seek 后的暖帧差异是
 * 可接受瞬态；导出是顺序渲染，天然确定）。
 *
 * ## 转场为什么走「两张全帧层 + 一个混合 pass」
 *
 * `buildStack` 在窗口内只产出一个 transition op（而不是两个 source op），
 * 因为 gl-transitions 的着色器签名是 `vec4 transition(vec2 uv)`，它同时要
 * 两张贴图。两侧各自先做自己的 placement（各自的 transform / fit / opacity
 * 烘进各自的 alpha），再交给转场着色器混合，最后**作为一整层**用入画片段的
 * 混合模式贴到 acc 上。这样每侧的 transform 都不会被另一侧影响。
 */

import { frameOf } from './clock';
import { BLEND_FRAG, BLEND_MODE_INDEX } from './blend.frag';
import { drawSizeFor, PLACEMENT_FRAG } from './placement.frag';
import { buildStack, type ResolvedSource, type TransitionOp } from './stack';
import type { Kit, Program, Target } from './kit';
import type { BeatGrid } from '../core/time';
import type { EffectClip, EffectInstance, Project, SourceClip } from '../core/schema';

export interface SourceTexture {
  tex: WebGLTexture;
  w: number;
  h: number;
}

/** 源解析器：由 renderer 装配（solid / image / algo 各自一路）。null = 这帧没准备好，跳过。 */
export type SourceResolver = (clip: SourceClip, t: number, frame: number) => SourceTexture | null;

export interface EffectCtx {
  t: number;
  frame: number;
  w: number;
  h: number;
  /** 工程帧率：`u_delta` = 1/fps（名义帧间隔）。 */
  fps: number;
  compositor: Compositor;
  /** 特效片段本体（曲线的宿主）：曲线键 `${instanceId}.${paramKey}`。 */
  clip: EffectClip;
  grid: BeatGrid;
}

/** 特效执行器：B8 由 effects/registry 装配；之前特效片段是 no-op。 */
export type EffectRunner = (
  inst: EffectInstance,
  src: Target,
  dst: Target,
  ctx: EffectCtx,
) => void;

/**
 * 转场执行器：由 `effects/transitions/runner.ts` 装配。
 * `from` / `to` 是已经 placement 过的**全帧层**（透明度已烘进 alpha），
 * `ratio` 是 GL Transition Spec 的 `ratio = width / height`（float）。
 */
export type TransitionRunner = (
  defId: string,
  values: Record<string, number>,
  from: Target,
  to: Target,
  progress: number,
  ratio: number,
  dst: Target,
) => void;

const PASSTHROUGH = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(u_texture, vUv); }`;

export class Compositor {
  private ping: Target | null = null;
  private pong: Target | null = null;
  /** 普通通路的 layer；转场通路的出画层。 */
  private placedA: Target | null = null;
  /** 转场通路的入画层。 */
  private placedB: Target | null = null;
  /** 转场着色器的输出，随后作为一整层 blend 到 acc 上。 */
  private trTmp: Target | null = null;
  private readonly blendProg: Program;
  private readonly placeProg: Program;
  private readonly passProg: Program;
  private readonly feedback = new Map<
    string,
    { a: Target; b: Target; flip: boolean; hdr: boolean }
  >();
  /** 非 feedback 的 pre-pass 草稿（半分辨率 HDR，按尺寸复用一对）。 */
  private preScratch: { w: number; h: number; a: Target; b: Target } | null = null;
  /** 带 feedback 的 pre-pass 的全分辨率历史，键 `${instanceId}:${index}`。 */
  private readonly preFeedback = new Map<string, { a: Target; b: Target; flip: boolean }>();

  /**
   * 转场执行器。默认实现只把入画层搬过去（不混合）——真正的实现在
   * `render-core.ts` 里由 `effects/transitions/runner.ts` 装进来。
   * 赋值在构造函数体内，因为默认实现要用到 `passProg`。
   */
  public runTransition: TransitionRunner;

  constructor(
    private readonly kit: Kit,
    public resolve: SourceResolver,
    public runEffect: EffectRunner,
    runTransition?: TransitionRunner,
  ) {
    this.blendProg = kit.quad(BLEND_FRAG, 'blend');
    this.placeProg = kit.quad(PLACEMENT_FRAG, 'placement');
    this.passProg = kit.quad(PASSTHROUGH, 'passthrough');
    this.runTransition =
      runTransition ??
      ((_defId, _values, _from, to, _progress, _ratio, dst) => {
        this.passProg.use();
        this.passProg.tex('u_texture', to.tex);
        this.kit.pass(this.passProg, dst);
      });
  }

  private ensure(w: number, h: number): void {
    if (!this.ping) this.ping = this.kit.target(w, h);
    if (!this.pong) this.pong = this.kit.target(w, h);
    if (!this.placedA) this.placedA = this.kit.target(w, h);
    if (!this.placedB) this.placedB = this.kit.target(w, h);
    if (!this.trTmp) this.trTmp = this.kit.target(w, h);
    this.ping.resize(w, h);
    this.pong.resize(w, h);
    this.placedA.resize(w, h);
    this.placedB.resize(w, h);
    this.trTmp.resize(w, h);
  }

  /** 渲染一帧到屏幕（默认帧缓冲）。预览与导出都走这一个入口。 */
  render(project: Project, t: number): void {
    const w = this.kit.w;
    const h = this.kit.h;
    this.ensure(w, h);
    const frame = frameOf(t, project.fps);
    const ops = buildStack(project, t);

    let acc = this.ping!;
    let buf = this.pong!;
    acc.bind();
    this.kit.clear();

    for (const op of ops) {
      if (op.type === 'source') {
        this.drawSource(op.source, acc, buf, w, h, t, frame);
        // 每个 op 都把结果写进了 buf：交换，让 buf 成为新的 acc。
        const tmp = acc;
        acc = buf;
        buf = tmp;
      } else if (op.type === 'transition') {
        this.drawTransition(op, acc, buf, w, h, t, frame);
        const tmp = acc;
        acc = buf;
        buf = tmp;
      } else {
        const ctx: EffectCtx = {
          t,
          frame,
          w,
          h,
          fps: project.fps,
          compositor: this,
          clip: op.clip,
          grid: project.beatGrid,
        };
        for (const inst of op.clip.chain) {
          if (!inst.enabled) continue;
          this.runEffect(inst, acc, buf, ctx);
          // 链内每个特效都要交换——下一个特效读的是上一个的输出。
          const tmp = acc;
          acc = buf;
          buf = tmp;
        }
      }
    }

    // 呈现到屏幕。ops 为空时 acc 是刚清过的透明黑。
    this.passProg.use();
    this.passProg.tex('u_texture', acc.tex);
    this.kit.pass(this.passProg, null);
  }

  /**
   * 把一个超范围求值的片段画成**全帧层**：清成透明 → placement。
   *
   * `opacityForLayer` 只有转场通路才非 1（理由见 placement.frag.ts）。
   * 返回 false 表示源这帧没准备好（algo 烘焙中 / 图片未登记）——
   * 调用方决定这一层怎么缺席，这里不替它决定。
   */
  private placeLayer(
    source: ResolvedSource,
    dst: Target,
    frameW: number,
    frameH: number,
    t: number,
    frame: number,
    opacityForLayer: number,
  ): boolean {
    const src = this.resolve(source.clip, t, frame);
    dst.bind();
    this.kit.clear(); // 层外必须是透明，否则 blender 会以为整帧都被覆盖
    if (!src) return false;

    const { x, y, sx, sy, rot } = source.transform;
    const [dw, dh] = drawSizeFor(source.clip.fit, frameW, frameH, src.w, src.h, sx, sy);
    this.placeProg.use();
    this.placeProg
      .tex('u_texture', src.tex)
      .u('u_frameSize', [frameW, frameH])
      .u('u_drawSize', [dw, dh])
      .u('u_center', [x, y])
      .u('u_rot', rot)
      .u('u_opacity', opacityForLayer);
    this.kit.pass(this.placeProg, dst);
    return true;
  }

  /** `acc` 原样搬进 `dst`：某一层这帧缺席时保持 ping-pong 流水不中断。 */
  private copyAcc(acc: Target, dst: Target): void {
    this.passProg.use();
    this.passProg.tex('u_texture', acc.tex);
    this.kit.pass(this.passProg, dst);
  }

  private drawSource(
    source: ResolvedSource,
    acc: Target,
    buf: Target,
    frameW: number,
    frameH: number,
    t: number,
    frame: number,
  ): void {
    // 普通通路：opacity 交给 blend pass（u_opacity = 1 → 与历史逐位相同）
    const ok = this.placeLayer(source, this.placedA!, frameW, frameH, t, frame, 1);
    if (!ok) {
      this.copyAcc(acc, buf);
      return;
    }
    this.blendProg.use();
    this.blendProg
      .tex('u_texture', acc.tex)
      .tex('u_texture2', this.placedA!.tex)
      .u1i('u_blendMode', BLEND_MODE_INDEX[source.blend])
      .u('u_opacity', source.opacity);
    this.kit.pass(this.blendProg, buf);
  }

  /**
   * 转场通路。
   *
   * 两侧各自烘 opacity 进 alpha → 转场着色器混合 → 结果作为一整层用
   * **入画片段**的混合模式贴到 acc 上（窗口结束后的下一帧就是入画片段，
   * 用它的 blend 才不会有跳变；已知代价见 AGENTS 的转场一节）。
   *
   * 单侧缺席（algo 烘焙未就绪）时退化成该侧单独一层，而不是整层消失 ——
   * 预览允许「这一帧少一半」，但不该变成整帧黑。
   */
  private drawTransition(
    op: TransitionOp,
    acc: Target,
    buf: Target,
    frameW: number,
    frameH: number,
    t: number,
    frame: number,
  ): void {
    const placedA = this.placedA!;
    const placedB = this.placedB!;
    const hasFrom = this.placeLayer(op.from, placedA, frameW, frameH, t, frame, op.from.opacity);
    const hasTo = this.placeLayer(op.to, placedB, frameW, frameH, t, frame, op.to.opacity);

    let layer: Target;
    if (hasFrom && hasTo) {
      this.runTransition(op.defId, op.values, placedA, placedB, op.progress, frameW / frameH, this.trTmp!);
      layer = this.trTmp!;
    } else if (hasFrom) {
      layer = placedA;
    } else if (hasTo) {
      layer = placedB;
    } else {
      this.copyAcc(acc, buf);
      return;
    }

    this.blendProg.use();
    this.blendProg
      .tex('u_texture', acc.tex)
      .tex('u_texture2', layer.tex)
      .u1i('u_blendMode', BLEND_MODE_INDEX[op.blend])
      // 两侧的 opacity 已经烘进各自 alpha（转场通路），这里不能再乘一次。
      .u('u_opacity', 1);
    this.kit.pass(this.blendProg, buf);
  }

  /* ------------------------------------------------------- 反馈池 */

  /**
   * 取特效实例的反馈对（尺寸跟随渲染尺寸，变了就重建——历史随之失效）。
   *
   * `hdr` 对应协议里的 `hdrFeedback`：有状态模拟的逐帧增量会低于 RGBA8 的
   * 量化步长，用 8bit 历史会 stall 成色块。标志变化时重建目标（旧历史的
   * 精度不够，留着不如丢掉）。
   */
  feedbackFor(
    instanceId: string,
    w: number,
    h: number,
    hdr = false,
  ): { read: Target; write: Target } {
    let e = this.feedback.get(instanceId);
    if (e && e.hdr !== hdr) {
      e.a.dispose();
      e.b.dispose();
      this.feedback.delete(instanceId);
      e = undefined;
    }
    if (!e) {
      e = {
        a: this.kit.target(w, h, { float: hdr }),
        b: this.kit.target(w, h, { float: hdr }),
        flip: false,
        hdr,
      };
      this.feedback.set(instanceId, e);
    }
    e.a.resize(w, h);
    e.b.resize(w, h);
    return e.flip ? { read: e.b, write: e.a } : { read: e.a, write: e.b };
  }

  /** 本帧的 write 成为下一帧的 read。 */
  feedbackCommit(instanceId: string): void {
    const e = this.feedback.get(instanceId);
    if (e) e.flip = !e.flip;
  }

  /* ------------------------------------------------- 特效的 pre-pass 池 */

  /**
   * 非 feedback 的 pre-pass 草稿对，**半分辨率 HDR**。
   *
   * 降采样只改 tap 密度、不改模糊半径 —— `u_resolution` 仍由 runner 传
   * 全分辨率尺寸，所以 `1/u_resolution` 算出来的偏移不会被减半。
   * 结果随后被主 pass 线性采样放大，视觉上等价。
   */
  preScratchFor(w: number, h: number): { a: Target; b: Target } {
    const hw = Math.max(1, Math.round(w / 2));
    const hh = Math.max(1, Math.round(h / 2));
    let s = this.preScratch;
    if (!s) {
      s = {
        w: hw,
        h: hh,
        a: this.kit.target(hw, hh, { float: true }),
        b: this.kit.target(hw, hh, { float: true }),
      };
      this.preScratch = s;
    } else if (s.w !== hw || s.h !== hh) {
      s.w = hw;
      s.h = hh;
      s.a.resize(hw, hh);
      s.b.resize(hw, hh);
    }
    return s;
  }

  /**
   * 带 `feedback` 的 pre-pass 的持久历史，键 `${instanceId}:${index}`。
   *
   * **全分辨率、浮点** —— 它是状态而不是中间结果：8bit 会把逐帧低于
   * 量化步长的增量抹平（背景估计、保持的关键帧都会因此冻结）。
   */
  preFeedbackFor(key: string, w: number, h: number): { read: Target; write: Target } {
    let e = this.preFeedback.get(key);
    if (!e) {
      e = {
        a: this.kit.target(w, h, { float: true }),
        b: this.kit.target(w, h, { float: true }),
        flip: false,
      };
      this.preFeedback.set(key, e);
    }
    e.a.resize(w, h);
    e.b.resize(w, h);
    return e.flip ? { read: e.b, write: e.a } : { read: e.a, write: e.b };
  }

  preFeedbackCommit(key: string): void {
    const e = this.preFeedback.get(key);
    if (e) e.flip = !e.flip;
  }

  /** seek / 跳帧后清掉所有历史。 */
  clearFeedback(): void {
    for (const e of this.feedback.values()) {
      e.a.bind();
      this.kit.clear();
      e.b.bind();
      this.kit.clear();
    }
    for (const e of this.preFeedback.values()) {
      e.a.bind();
      this.kit.clear();
      e.b.bind();
      this.kit.clear();
    }
  }
}
