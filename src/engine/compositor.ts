/**
 * compositor.ts — ping-pong 合成调度。
 *
 *   acc（透明黑起步）
 *     → 每个 SourceOp：placement（源 → placed）→ blend（placed over acc）
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
 */

import { frameOf } from './clock';
import { BLEND_FRAG, BLEND_MODE_INDEX } from './blend.frag';
import { drawSizeFor, PLACEMENT_FRAG } from './placement.frag';
import { buildStack, type ResolvedSource } from './stack';
import type { Kit, Program, Target } from './kit';
import type { BeatGrid } from '../core/time';
import type {
  EffectClip,
  EffectInstance,
  Project,
  SourceClip,
} from '../core/schema';

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

const PASSTHROUGH = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(u_texture, vUv); }`;

export class Compositor {
  private ping: Target | null = null;
  private pong: Target | null = null;
  private placed: Target | null = null;
  private readonly blendProg: Program;
  private readonly placeProg: Program;
  private readonly passProg: Program;
  private readonly feedback = new Map<string, { a: Target; b: Target; flip: boolean }>();

  constructor(
    private readonly kit: Kit,
    public resolve: SourceResolver,
    public runEffect: EffectRunner,
  ) {
    this.blendProg = kit.quad(BLEND_FRAG, 'blend');
    this.placeProg = kit.quad(PLACEMENT_FRAG, 'placement');
    this.passProg = kit.quad(PASSTHROUGH, 'passthrough');
  }

  private ensure(w: number, h: number): void {
    if (!this.ping) this.ping = this.kit.target(w, h);
    if (!this.pong) this.pong = this.kit.target(w, h);
    if (!this.placed) this.placed = this.kit.target(w, h);
    this.ping.resize(w, h);
    this.pong.resize(w, h);
    this.placed.resize(w, h);
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
      } else {
        const ctx: EffectCtx = { t, frame, w, h, compositor: this, clip: op.clip, grid: project.beatGrid };
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

  private drawSource(
    source: ResolvedSource,
    acc: Target,
    buf: Target,
    frameW: number,
    frameH: number,
    t: number,
    frame: number,
  ): void {
    const src = this.resolve(source.clip, t, frame);
    const placed = this.placed!;
    if (!src) {
      // 源没准备好（如 algo 烘焙中）：这一层这帧缺席，把 acc 原样搬进 buf 保持流水。
      this.passProg.use();
      this.passProg.tex('u_texture', acc.tex);
      this.kit.pass(this.passProg, buf);
      return;
    }
    const { x, y, sx, sy, rot } = source.transform;
    const [dw, dh] = drawSizeFor(source.clip.fit, frameW, frameH, src.w, src.h, sx, sy);
    this.placeProg.use();
    this.placeProg
      .tex('u_texture', src.tex)
      .u('u_frameSize', [frameW, frameH])
      .u('u_drawSize', [dw, dh])
      .u('u_center', [x, y])
      .u('u_rot', rot);
    this.kit.pass(this.placeProg, placed);

    this.blendProg.use();
    this.blendProg
      .tex('u_texture', acc.tex)
      .tex('u_texture2', placed.tex)
      .u1i('u_blendMode', BLEND_MODE_INDEX[source.blend])
      .u('u_opacity', source.opacity);
    this.kit.pass(this.blendProg, buf);
  }

  /* ------------------------------------------------------- 反馈池 */

  /** 取特效实例的反馈对（尺寸跟随渲染尺寸，变了就重建——历史随之失效）。 */
  feedbackFor(instanceId: string, w: number, h: number): { read: Target; write: Target } {
    let e = this.feedback.get(instanceId);
    if (!e) {
      e = { a: this.kit.target(w, h), b: this.kit.target(w, h), flip: false };
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

  /** seek / 跳帧后清掉所有历史。 */
  clearFeedback(): void {
    for (const e of this.feedback.values()) {
      e.a.bind();
      this.kit.clear();
      e.b.bind();
      this.kit.clear();
    }
  }
}
