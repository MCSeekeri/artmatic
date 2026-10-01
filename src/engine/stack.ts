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
 */

import { evalCurve } from '../core/curve';
import { fadeWeight } from '../core/clips';
import type { BeatGrid } from '../core/time';
import type {
  BlendMode,
  EffectClip,
  Project,
  SourceClip,
} from '../core/schema';

export interface ResolvedSource {
  clip: SourceClip;
  /** 已含 fadeSec 斜坡与 opacity 曲线。 */
  opacity: number;
  transform: { x: number; y: number; sx: number; sy: number; rot: number };
  blend: BlendMode;
}

export type RenderOp =
  | { type: 'source'; z: number; source: ResolvedSource }
  | { type: 'effect'; z: number; clip: EffectClip };

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

export function buildStack(project: Project, t: number): RenderOp[] {
  const ops: RenderOp[] = [];

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
    for (const clip of track.clips) {
      if (t < clip.start || t >= clip.end) continue;
      if (clip.kind === 'effect') {
        if (clip.chain.some((i) => i.enabled)) ops.push({ type: 'effect', z, clip });
        continue;
      }
      const g = project.beatGrid;
      const opacity =
        paramWithCurve(clip, 'opacity', clip.opacity, t, g) * fadeWeight(clip, clip.fadeSec, t);
      const transform = {
        x: paramWithCurve(clip, 'transform.x', clip.transform.x, t, g),
        y: paramWithCurve(clip, 'transform.y', clip.transform.y, t, g),
        sx: paramWithCurve(clip, 'transform.sx', clip.transform.sx, t, g),
        sy: paramWithCurve(clip, 'transform.sy', clip.transform.sy, t, g),
        rot: paramWithCurve(clip, 'transform.rot', clip.transform.rot, t, g),
      };
      ops.push({ type: 'source', z, source: { clip, opacity, transform, blend: clip.blend } });
    }
  });
  // z 升序输出，compositor 顺序合成 → z 大者盖在上，与「列表顶部 = 前景」一致。
  // 同轨不重叠，轨道内相对顺序无所谓，保持稳定即可。
  return ops.sort((a, b) => a.z - b.z);
}
