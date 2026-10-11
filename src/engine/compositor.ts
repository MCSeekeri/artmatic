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
 * ## 影响深度的特效：作用域先单独合成，再贴回
 *
 * 设了影响深度的特效（`EffectOp.scope`，见 `stack.ts` 文件头）不是「作用于 acc
 * 目前的样子」，而是作用于**只留下那几条轨道时的那幅画面**：`runOps` 递归跑一遍
 * 作用域、从透明起合成，特效链作用在它上面，最后以 normal 贴回 acc。嵌套的组各用
 * 一对自己的目标（`groupTargets(depth)`）。没设深度时走的还是老路 —— 逐字节没变。
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
import { buildStack, type RenderOp, type ResolvedSource, type TransitionOp } from './stack';
import type { Kit, Program, Target } from './kit';
import type { SpectrumTextures } from './spectrum-texture';
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
  /**
   * 频谱纹理（`u_spectrum`）。由 `render-core` 装配。
   * `null` = 没有音频来源 —— 那时声明了 `u_spectrum` 的特效会读到一张零纹理
   * （静音），而不是未绑定的 sampler。
   */
  spectrum: SpectrumTextures | null;
}

/** 一帧求值的上下文（`runOps` 的递归参数包）：整帧不变，要原样穿过嵌套的作用域组。 */
interface FrameCtx {
  project: Project;
  t: number;
  frame: number;
  w: number;
  h: number;
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
  /** 逐实例的「上一帧链输入」（见 `delayedInputFor`）。 */
  private readonly delayedInput = new Map<string, Target>();
  /** 影响深度（作用域组）的中间目标，按下标 = 嵌套深度（见 `groupTargets`）。 */
  private readonly groups: { a: Target; b: Target }[] = [];

  /**
   * 转场执行器。默认实现只把入画层搬过去（不混合）——真正的实现在
   * `render-core.ts` 里由 `effects/transitions/runner.ts` 装进来。
   * 赋值在构造函数体内，因为默认实现要用到 `passProg`。
   */
  public runTransition: TransitionRunner;

  /**
   * 频谱纹理（`u_spectrum`）。**可变字段而不是构造参数**：它由 `render-core`
   * 在装配后注入，而 lab 给的是合成频谱、主应用给的是工程音频 —— 构造签名
   * 不该为「谁来供数」而变。
   */
  public spectrum: SpectrumTextures | null = null;

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

    const acc = this.ping!;
    acc.bind();
    this.kit.clear();
    const out = this.runOps(ops, acc, this.pong!, 0, { project, t, frame, w, h });

    // 呈现到屏幕。ops 为空时 acc 是刚清过的透明黑。
    this.passProg.use();
    this.passProg.tex('u_texture', out.tex);
    this.kit.pass(this.passProg, null);
  }

  /**
   * 跑一段 op 把它合成进 `acc`，返回**结果所在的**那个 Target。
   *
   * 递归的唯一原因是有影响深度的特效（`op.scope`，见 `stack.ts` 文件头）：作用域要
   * 从透明起独立合成，特效链作用在它上面，再以 normal 贴回下层。嵌套的组各用一对
   * 自己的目标（`groupTargets(depth)`），外层的中间结果因此不会被内层覆盖。
   * 没有 `scope` 时走的就是原来那条直路 —— 逐字节没变。
   */
  private runOps(
    ops: readonly RenderOp[],
    acc0: Target,
    buf0: Target,
    depth: number,
    c: FrameCtx,
  ): Target {
    let acc = acc0;
    let buf = buf0;
    for (const op of ops) {
      if (op.type === 'source') {
        this.drawSource(op.source, acc, buf, c.w, c.h, c.t, c.frame);
        // 每个 op 都把结果写进了 buf：交换，让 buf 成为新的 acc。
        const tmp = acc;
        acc = buf;
        buf = tmp;
        continue;
      }
      if (op.type === 'transition') {
        this.drawTransition(op, acc, buf, c.w, c.h, c.t, c.frame);
        const tmp = acc;
        acc = buf;
        buf = tmp;
        continue;
      }

      const ctx: EffectCtx = {
        t: c.t,
        frame: c.frame,
        w: c.w,
        h: c.h,
        fps: c.project.fps,
        compositor: this,
        clip: op.clip,
        grid: c.project.beatGrid,
        spectrum: this.spectrum,
      };
      let src = acc;
      let dst = buf;
      if (op.scope) {
        // 作用域：从透明起独立合成一整段，再把特效链作用在它上面。
        const g = this.groupTargets(depth, c.w, c.h);
        g.a.bind();
        this.kit.clear();
        src = this.runOps(op.scope, g.a, g.b, depth + 1, c);
        dst = src === g.a ? g.b : g.a;
      }
      for (const inst of op.clip.chain) {
        if (!inst.enabled) continue;
        this.runEffect(inst, src, dst, ctx);
        // 链内每个特效都要交换——下一个特效读的是上一个的输出。
        const tmp = src;
        src = dst;
        dst = tmp;
      }

      if (!op.scope) {
        // 无作用域：链的输入输出本来就是 acc/buf，交换回来接着走。
        acc = src;
        buf = dst;
        continue;
      }
      // 有作用域：特效的输出是「只留下这些轨道」的一整层，以 normal 贴回下层。
      this.blendProg.use();
      this.blendProg
        .tex('u_texture', acc.tex)
        .tex('u_texture2', src.tex)
        .u1i('u_blendMode', BLEND_MODE_INDEX.normal)
        .u('u_opacity', 1);
      this.kit.pass(this.blendProg, buf);
      const tmp = acc;
      acc = buf;
      buf = tmp;
    }
    return acc;
  }

  /**
   * 作用域组的中间目标，**按嵌套深度取**：外层的组还在攒内容时内层的组也要一对，
   * 共用一对会让内层把外层的中间结果覆盖掉（表现是「嵌套一次，画面就少一层」）。
   * 深度上界 = 实际发生的嵌套层数，所以这里按需生长、从不清扫。
   */
  private groupTargets(depth: number, w: number, h: number): { a: Target; b: Target } {
    let g = this.groups[depth];
    if (!g) {
      g = { a: this.kit.target(w, h), b: this.kit.target(w, h) };
      this.groups[depth] = g;
    }
    g.a.resize(w, h);
    g.b.resize(w, h);
    return g;
  }

  /**
   * 把一个超范围求值的片段画成**全帧层**：清成透明 → placement。
   *
   * `opacityForLayer` 只有转场通路才非 1（理由见 placement.frag.ts）。
   * 返回 false 表示源这帧没准备好（algo 烘焙中 / 图片未登记）——
   * 调用方决定这一层怎么缺席，这里不替它决定。
   *
   * ## ⚠️ 源尺寸与帧尺寸成**非整数比**时，采样结果会有一对稳定态（2026-10-10）
   *
   * 这里的缩放采样（`u_drawSize` ≠ `u_frameSize`）在**非整数倍**下会读到纹素之间，
   * 而 GPU 的过滤采样在启动窗口内会给出两个不同的稳定结果。实测（lab，t 与参数
   * 全固定，逐帧读回哈希）：
   *
   * | 源尺寸 → 帧尺寸 | 倍数 | 结果 |
   * |---|---|---|
   * | 853×480 → 640×360（mandelbrot 默认 intRes） | 1.333… | 两个状态来回跳 |
   * | 640×360 → 640×360 | 1 | 跳一次后稳定 |
   * | 1280×720 → 640×360 | 2（精确） | 稳定 |
   *
   * 差异很小（177 个像素、单通道差 ≤5）且预热几十帧后消失，**视觉上不可见**，
   * 但「同一 t 两渲逐像素相等」这类断言会被它打成偶发失败（`lab.spec.ts` 的
   * 「非反馈特效同帧可复现」就是这么翻的）。换 `NEAREST` 采样、改 `sin` 相位
   * 都试过，无效 —— 这不是应用层能根治的（GPU 采样的低位行为），
   * 别在这里加补救代码。要断言确定性，就在测量前多渲一帧丢弃。
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

  /**
   * **上一帧的链输入**，逐实例一张，供声明了 `delayedInput` 的 pre-pass 读。
   *
   * 存在的理由：有些原作（KinoDatamosh 的运动估计）要做「当前帧 vs 上一帧输入」
   * 的帧间差分，而链里拿不到它 —— `u_texture` 是上一环的输出、`u_feedback` 是
   * 自身上一帧的输出、`u_original` 是当前帧的链输入。让 pre-pass 自己用
   * `feedback` 存一帧输入也不行：那存的会是「上一帧它自己的输出」，永远差一帧。
   *
   * 由 runner 在整条链跑完之后写入本帧的链输入（见 `effects/runner.ts`）。
   */
  delayedInputFor(instanceId: string, w: number, h: number): Target {
    let t = this.delayedInput.get(instanceId);
    if (!t) {
      t = this.kit.target(w, h);
      this.delayedInput.set(instanceId, t);
    }
    t.resize(w, h);
    return t;
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
    // 延迟输入也是跨帧状态：不清的话 seek 之后第一帧会拿跳变前的画面做差分。
    for (const t of this.delayedInput.values()) {
      t.bind();
      this.kit.clear();
    }
  }
}
