/**
 * project-store.ts — 工程的唯一事实源。
 *
 * 所有对 Project 的修改都必须经过 store.commit / 手势事务，
 * 这样撤销栈才完整、version 计数才可信。version 是渲染与 UI 重绘的
 * 唯一订阅源（每次变化 +1）；选中态等 UI 状态不在这里——
 * splitter 的教训：select 触发全量重建会在拖拽中换掉 DOM。
 */

import {
  cloneProject,
  newId,
  type AnyClip,
  type AudioClip,
  type EffectClip,
  type OverlapBehavior,
  type Project,
  type SourceClip,
  type Track,
  type VisualTrack,
} from './schema';
import {
  moveSpan,
  resizeSpan,
  splitSpan,
  type Span,
} from './clips';
import { evalCurve, type Curve } from './curve';
import type { BeatGrid } from './time';
import { CommandStack } from './commands';

export class ProjectStore {
  project: Project;
  version = 0;

  private stack: CommandStack;
  private listeners = new Set<() => void>();

  constructor(project: Project) {
    this.project = project;
    this.stack = new CommandStack(
      () => JSON.stringify(this.project),
      (json) => {
        this.project = JSON.parse(json) as Project;
      },
      () => this.bump(),
    );
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private bump(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /* ------------------------------------------------------------ 原语 */

  commit(label: string, fn: (p: Project) => void): boolean {
    return this.stack.commit(label, () => fn(this.project));
  }

  beginTx(): void {
    this.stack.beginTx();
  }

  endTx(label: string): boolean {
    return this.stack.endTx(label);
  }

  undo(): boolean {
    return this.stack.undo();
  }

  redo(): boolean {
    return this.stack.redo();
  }

  canUndo(): boolean {
    return this.stack.canUndo();
  }

  canRedo(): boolean {
    return this.stack.canRedo();
  }

  /* ------------------------------------------------------------ 查询 */

  track(id: string): Track | null {
    return this.project.tracks.find((t) => t.id === id) ?? null;
  }

  findClip(clipId: string): { track: Track; clip: AnyClip } | null {
    for (const track of this.project.tracks) {
      const clip = (track.clips as AnyClip[]).find((c) => c.id === clipId);
      if (clip) return { track, clip };
    }
    return null;
  }

  /* ------------------------------------------------------------ 轨道 */

  addTrack(kind: Track['kind'], name?: string): string {
    const id = newId();
    this.commit(`新建${kind === 'visual' ? '视觉' : '音频'}轨`, (p) => {
      const n = p.tracks.filter((t) => t.kind === kind).length + 1;
      if (kind === 'visual') {
        p.tracks.push({ kind, id, name: name ?? `V${n}`, enabled: true, clips: [] } as VisualTrack);
      } else {
        p.tracks.push({ kind, id, name: name ?? `A${n}`, enabled: true, clips: [], bus: 'master' });
      }
    });
    return id;
  }

  removeTrack(id: string): void {
    this.commit('删除轨道', (p) => {
      p.tracks = p.tracks.filter((t) => t.id !== id);
    });
  }

  /* ------------------------------------------------------------ 片段 */

  addClip(trackId: string, clip: AnyClip): void {
    this.commit('新建片段', (p) => {
      const track = p.tracks.find((t) => t.id === trackId);
      if (!track) return;
      (track.clips as AnyClip[]).push(clip);
      track.clips.sort((a, b) => a.start - b.start);
    });
  }

  removeClip(clipId: string): void {
    this.commit('删除片段', (p) => {
      for (const t of p.tracks) {
        const before = t.clips.length;
        t.clips = t.clips.filter((c) => c.id !== clipId) as typeof t.clips;
        if (t.clips.length !== before) return;
      }
    });
  }

  /**
   * 移动片段（通常在手势事务里反复调用）。
   * trim 策略可能让邻居裂出 `#r` 后缀的临时 id——这里统一换成真正的 newId。
   */
  moveClip(trackId: string, clipId: string, newStart: number): void {
    const track = this.track(trackId);
    if (!track) return;
    const moved = moveSpan(
      track.clips as Span[],
      clipId,
      newStart,
      this.project.duration,
      this.project.overlapBehavior,
    ) as AnyClip[];
    for (const c of moved) {
      if (c.id.endsWith('#r')) c.id = newId();
    }
    track.clips = moved as typeof track.clips;
  }

  resizeClip(trackId: string, clipId: string, edge: 'start' | 'end', time: number): void {
    const track = this.track(trackId);
    if (!track) return;
    track.clips = resizeSpan(
      track.clips as Span[],
      clipId,
      edge,
      time,
      this.project.duration,
    ) as typeof track.clips;
  }

  /**
   * 在 at（秒）处切分片段。曲线的处理：
   *   beatAnchor 曲线 —— 原样复制给两半（锚是绝对的，两半各自正确）；
   *   相对曲线 —— 左半保留 t ≤ 切点的 keys，右半 keys 平移 -切点，
   *               并在 0 处补一个边界 key 保住切点处的值。
   */
  splitClipAt(trackId: string, clipId: string, at: number): boolean {
    const track = this.track(trackId);
    if (!track) return false;
    const clip = (track.clips as AnyClip[]).find((c) => c.id === clipId);
    if (!clip) return false;
    const atRel = at - clip.start;
    return this.commit('切分片段', () => {
      const curvesFor = (c: AnyClip, side: 'left' | 'right'): Record<string, Curve> => {
        const curves: Record<string, Curve> = {};
        for (const [k, curve] of Object.entries(c.curves)) {
          if (curve.beatAnchor) {
            curves[k] = structuredClone(curve);
            continue;
          }
          if (side === 'left') {
            curves[k] = { ...curve, keys: curve.keys.filter((key) => key.t <= atRel + 1e-9) };
          } else {
            const boundary = evalCurve(curve, atRel, {});
            const shifted = curve.keys
              .filter((key) => key.t > atRel + 1e-9)
              .map((key) => ({ ...key, t: key.t - atRel }));
            curves[k] = {
              ...curve,
              keys: [{ t: 0, v: boundary, interp: 'step' as const }, ...shifted],
            };
          }
        }
        return curves;
      };
      const leftCurves = curvesFor(clip, 'left');
      const rightCurves = curvesFor(clip, 'right');
      const split = splitSpan(track.clips as Span[], clipId, at, newId);
      if (!split) return;
      track.clips = split.map((c) => {
        if (c.id === clipId) return { ...c, curves: leftCurves };
        if (c.start === at) return { ...c, curves: rightCurves };
        return c;
      }) as typeof track.clips;
      track.clips.sort((a, b) => a.start - b.start);
    });
  }

  /* ------------------------------------------------------------ 属性 */

  updateClip(clipId: string, label: string, fn: (clip: AnyClip) => void): void {
    this.commit(label, () => {
      const found = this.findClip(clipId);
      if (found) fn(found.clip);
    });
  }

  setOverlapBehavior(b: OverlapBehavior): void {
    this.commit('切换重叠策略', (p) => {
      p.overlapBehavior = b;
    });
  }

  setBeatGrid(grid: Partial<BeatGrid>): void {
    this.commit('修改拍网格', (p) => {
      Object.assign(p.beatGrid, grid);
    });
  }

  setDuration(sec: number): void {
    this.commit('修改时长', (p) => {
      p.duration = Math.max(1, sec);
    });
  }

  /* ------------------------------------------------------------ 序列化 */

  serialize(): string {
    return JSON.stringify(this.project, null, 2);
  }

  loadFrom(project: Project): void {
    this.commit('载入工程', (p) => {
      Object.assign(p, cloneProject(project));
    });
  }
}

/* ---------------------------------------------------------- 类型收窄 */

export function isSourceClip(c: AnyClip): c is SourceClip {
  return c.kind === 'source';
}

export function isEffectClip(c: AnyClip): c is EffectClip {
  return c.kind === 'effect';
}

export function isAudioClip(c: AnyClip): c is AudioClip {
  return c.kind === 'audio';
}
