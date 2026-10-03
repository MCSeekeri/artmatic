/**
 * stack.ts — buildStack(project, t)：把工程在时刻 t 的渲染操作排成 z 序。
 *
 * AGENTS.md §5 合成求值：
 *   1. 收集所有命中 t 的 SourceClip，轨道序 → 轨道内序决定 z
 *   2. 按 z 序合成（blend / opacity / transform / 曲线求值）
 *   3. 命中的 EffectClip 的 chain 依 z 序插入（adjustment layer 语义：
 *      它只消费「z 序在它之下所有 source 的合成结果」——ping-pong
 *      调度的天然产物，不需要额外机制）
 *
 * 曲线求值集中在这里做（每个 op 附求值好的值），GLSL 只收标量 uniform；
 * fadeSec 在这里折算进 opacity——GLSL 不需要知道 fade 的存在。
 *
 * ## 转场：一个 op 顶两个 op
 *
 * 窗口命中的时候（见 core/transitions.ts）**不产出两个 source op，只产出一个
 * transition op**——转场着色器要同时看两张贴图，拆成两个 op 就凑不到一起了。
 * op 里两个 ResolvedSource 都是**超范围求值**的：入画片段在 `t < its.start`
 * 时被求值（`algos/runtime.ts` 的 `Math.max(0, …)` 让它停在首帧），出画片段在
 * `t >= its.end` 时继续走。
 *
 * ⚠️ **转场判断必须在 span 过滤之前**：窗口后半段的 t 已经越过出画片段的
 * `end`，先过滤就会整段漏掉，表现是「转场只在前半段生效」。
 */

import { evalCurve } from '../core/curve';
import { fadeWeight } from '../core/clips';
import { transitionAt } from '../core/transitions';
import type { BeatGrid } from '../core/time';
import type {
  BlendMode,
  EffectClip,
  Project,
  SourceClip,
  VisualTrack,
} from '../core/schema';

export interface ResolvedSource {
  clip: SourceClip;
  /** 已含 fadeSec 斜坡与 opacity 曲线。 */
  opacity: number;
  transform: { x: number; y: number; sx: number; sy: number; rot: number };
  blend: BlendMode;
}

/**
 * 转场 op。
 *
 * `blend` 取**入画片段**的混合模式：窗口结束后的下一帧画的就是入画片段，
 * 用它的 blend 才不会有跳变。已知代价是出画片段的 blend ≠ normal 时，
 * 窗口开始处有一次混合模式跳变（blend 是离散枚举，插值没有定义）。
 */
export interface TransitionOp {
  type: 'transition';
  z: number;
  from: ResolvedSource;
  to: ResolvedSource;
  defId: string;
  values: Record<string, number>;
  /** 窗口内进度 ∈ [0,1)。 */
  progress: number;
  blend: BlendMode;
}

export type RenderOp =
  | { type: 'source'; z: number; source: ResolvedSource }
  | { type: 'effect'; z: number; clip: EffectClip }
  | TransitionOp;

/** 片段参数：有曲线求曲线，无曲线取基值。clipStart/grid 双上下文都由这里喂。 */
export function paramWithCurve(
  clip: { start: number; curves: SourceClip['curves'] },
  name: string,
  base: number,
  t: number,
  grid: BeatGrid,
): number {
  const c = clip.curves[name];
  return c ? evalCurve(c, t, { grid, clipStart: clip.start }) : base;
}

/**
 * 把一个 SourceClip 在 t 求值成 ResolvedSource。
 *
 * 转场两侧都用它——注意**两侧各自的 fadeSec 斜坡照常生效**（窗口内也一样）。
 * 出画片段的 fade-out 恰好在剪切点归零，再叠上转场就是「二次淡出」，
 * 检查器对同时设了两者的情况给提示，机制上不做特判。
 */
function resolveSource(clip: SourceClip, t: number, grid: BeatGrid): ResolvedSource {
  const opacity =
    paramWithCurve(clip, 'opacity', clip.opacity, t, grid) * fadeWeight(clip, clip.fadeSec, t);
  return {
    clip,
    opacity,
    transform: {
      x: paramWithCurve(clip, 'transform.x', clip.transform.x, t, grid),
      y: paramWithCurve(clip, 'transform.y', clip.transform.y, t, grid),
      sx: paramWithCurve(clip, 'transform.sx', clip.transform.sx, t, grid),
      sy: paramWithCurve(clip, 'transform.sy', clip.transform.sy, t, grid),
      rot: paramWithCurve(clip, 'transform.rot', clip.transform.rot, t, grid),
    },
    blend: clip.blend,
  };
}

export function buildStack(project: Project, t: number): RenderOp[] {
  const ops: RenderOp[] = [];
  const grid = project.beatGrid;

  /**
   * 轨道序 → z 序。
   *
   * `tracks[0]` 渲染在**轨道列表最顶部**，而列表顶部按 NLE 惯例就是「最前景」，
   * 所以它的 z 必须最大：`z = last - 视觉轨下标`。
   *
   * 这里曾经是 `z = index`（z 直接等于数组下标），后果是「列表越靠下的轨道
   * 画面越靠上」——与 Premiere / AE / DaVinci 的直觉完全相反，用户实测报上来
   * 说「z 轴好像是轨道越往下越大，不符合直觉」。
   *
   * 编号只数**视觉轨**：音频轨不参与合成，若把它们也算进下标，z 就会出现
   * 空洞（4 条视觉轨 + 1 条音频会得到 1..4 而不是 0..3）。现在 op.z 只用于排序，
   * 空洞不会出错，但让「z 就是栈的层号」这件事成立，后来人才不会误解。
   * 改这里时必须同步把 demo 工程的 tracks 顺序一起倒过来，否则原本的叠加关系
   * 会被整个翻掉。
   */
  let visualCount = 0;
  const visualIndex = new Map<string, number>();
  for (const track of project.tracks) {
    if (track.kind === 'visual') visualIndex.set(track.id, visualCount++);
  }
  const last = visualCount - 1;

  project.tracks.forEach((track) => {
    if (!track.enabled || track.kind !== 'visual') return;
    const z = last - visualIndex.get(track.id)!;
    // 带下标的 for：转场要跳过一个片段，forEach 做不到。
    const clips: VisualTrack['clips'] = track.clips;
    for (let i = 0; i < clips.length; i += 1) {
      const clip = clips[i]!;

      /*
       * ⚠️ 顺序要紧：转场判断放在 span 过滤**之前**。
       * 窗口后半段的 t 已经 `>= from.end`，先过滤掉就永远出不了 transition op。
       */
      if (clip.kind === 'source') {
        const win = transitionAt(track, i, t);
        const tr = clip.transitionOut;
        if (win && tr) {
          ops.push({
            type: 'transition',
            z,
            from: resolveSource(win.from, t, grid),
            to: resolveSource(win.to, t, grid),
            defId: tr.defId,
            values: tr.values,
            progress: win.progress,
            blend: win.to.blend,
          });
          // 入画片段这一帧由转场全权负责；不跳就会把它再单独画一遍。
          i += 1;
          continue;
        }
      }

      if (t < clip.start || t >= clip.end) continue;

      if (clip.kind === 'effect') {
        if (clip.chain.some((i2) => i2.enabled)) ops.push({ type: 'effect', z, clip });
        continue;
      }
      ops.push({ type: 'source', z, source: resolveSource(clip, t, grid) });
    }
  });
  // z 升序输出，compositor 顺序合成 → z 大者盖在上，与「列表顶部 = 前景」一致。
  // 同轨不重叠，轨道内相对顺序无所谓，保持稳定即可。
  return ops.sort((a, b) => a.z - b.z);
}
