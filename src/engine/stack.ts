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
  project.tracks.forEach((track, z) => {
    if (!track.enabled || track.kind !== 'visual') return;
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
  // 轨道序即 z 序；同轨不重叠，轨道内相对顺序无所谓，保持稳定即可。
  return ops.sort((a, b) => a.z - b.z);
}
