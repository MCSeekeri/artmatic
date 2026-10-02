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
  MIN_CLIP_LENGTH,
  freeRangeAt,
  placeSpan,
  replaceSpan,
  resizeSpan,
  sortSpans,
  spanAt,
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

  /**
   * 手势事务内的实时变更通知：version++ 但不产生撤销记录。
   * 拖拽中每帧调用，让 UI 跟上鼠标的实时位置。
   */
  touch(): void {
    this.bump();
  }

  endTx(label: string): boolean {
    return this.stack.endTx(label);
  }

  /** 手势中止：回滚到事务起点。 */
  cancelTx(): void {
    this.stack.cancelTx();
    this.bump();
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

  /**
   * 该轨道能不能装这个片段：音频片段只进音频轨，画面/特效片段只进视觉轨。
   * 跨轨拖拽与 Alt+↑↓ 共用这一条判据。
   */
  canHost(track: Track, clip: AnyClip): boolean {
    return track.kind === 'audio' ? clip.kind === 'audio' : clip.kind !== 'audio';
  }

  /** 轨道在工程里的下标（跨轨拖动判方向用）。 */
  trackIndex(id: string): number {
    return this.project.tracks.findIndex((t) => t.id === id);
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

  /* ------------------------------------------------------- 轨道属性写入
   *
   * 这三个方法存在的原因是一个真 bug：轨道行的开关原来在组件里写
   * `track.enabled = …`，而那个 `track` 是 `$derived` 里 `.map(t => ({...t}))`
   * 出来的**浅拷贝**。commit 对比真实 project 的快照判定「无变化」，
   * 于是既不 bump version 也不入撤销栈——开关看着能点，其实从未落库。
   * 写库必须改 `commit(p => …)` 里的真实对象，这是唯一的正道。
   */

  setTrackEnabled(id: string, enabled: boolean): void {
    this.commit(enabled ? '启用轨道' : '禁用轨道', (p) => {
      const t = p.tracks.find((x) => x.id === id);
      if (t) t.enabled = enabled;
    });
  }

  toggleTrackEnabled(id: string): void {
    const t = this.track(id);
    if (t) this.setTrackEnabled(id, !t.enabled);
  }

  /** 改名。空名字不写库（否则轨道会变成一个点不到的空行）。 */
  renameTrack(id: string, name: string): void {
    const next = name.trim();
    if (!next) return;
    this.commit('重命名轨道', (p) => {
      const t = p.tracks.find((x) => x.id === id);
      if (t) t.name = next;
    });
  }

  /* ------------------------------------------------------------ 片段 */

  addClip(trackId: string, clip: AnyClip): void {
    this.commit('新建片段', (p) => {
      const track = p.tracks.find((t) => t.id === trackId);
      if (!track) return;
      // 落点被占时先尝试裁进所在空档；起点本身压在片段上时顺延到它的
      // 末尾再找空档（否则「新建」在占用区静默失败，用户会以为按钮坏了）。
      // 注意上界传 Infinity：工程时长不是片段的天花板（见 setDuration 注释），
      // 新片段超出当前时长就把工程撑长。
      let start = clip.start;
      let free = freeRangeAt(track.clips as Span[], start, Number.POSITIVE_INFINITY);
      if (!free) {
        const covering = spanAt(track.clips as Span[], start);
        if (covering) {
          start = covering.end + 1e-6;
          free = freeRangeAt(track.clips, start, Number.POSITIVE_INFINITY);
        }
      }
      if (!free) return;
      const s = Math.max(start, free.start);
      const e = Math.min(clip.end + (s - clip.start), free.end);
      if (e - s < MIN_CLIP_LENGTH) return;
      (track.clips as AnyClip[]).push({ ...clip, start: s, end: e });
      track.clips.sort((a, b) => a.start - b.start);
      if (e > p.duration) p.duration = e;
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

  /* ------------------------------------------------ 手势：实时 vs 结算 */

  /**
   * 拖拽期间的实时移动：**不套用重叠策略**，允许视觉重叠。
   *
   * 为什么分两段（见 core/clips.ts 的时序约定）：trim/push 在 pointermove 里
   * 就生效的话，拖过去的瞬间邻居就被吃掉了，拖回来也恢复不了。
   * 策略统一由 settlePlacement 在松手时结算。
   *
   * 跨轨也走这里：目标轨不兼容（音频片段拖到视觉轨等）时原地不动。
   * 拖出工程末尾会把时长撑长——时长只增不减，缩短走 setDuration。
   */
  liveMoveClip(toTrackId: string, clipId: string, newStart: number): void {
    const found = this.findClip(clipId);
    const target = this.track(toTrackId);
    if (!found || !target || !this.canHost(target, found.clip)) return;
    const len = found.clip.end - found.clip.start;
    const start = Math.max(0, newStart);
    const end = start + len;
    if (end > this.project.duration) this.project.duration = end;
    const moved = { ...found.clip, start, end };
    if (found.track.id === target.id) {
      target.clips = replaceSpan(target.clips as AnyClip[], moved) as typeof target.clips;
      return;
    }
    found.track.clips = (found.track.clips as AnyClip[]).filter((c) => c.id !== clipId) as typeof found.track.clips;
    target.clips = sortSpans([...(target.clips as AnyClip[]), moved]) as typeof target.clips;
  }

  /** 拖拽期间的实时缩放：只在 0 / 末尾 / MIN_CLIP_LENGTH 上钳，不碰邻居。 */
  liveResizeClip(trackId: string, clipId: string, edge: 'start' | 'end', time: number): void {
    const track = this.track(trackId);
    if (!track) return;
    const clip = (track.clips as AnyClip[]).find((c) => c.id === clipId);
    if (!clip) return;
    if (edge === 'start') {
      clip.start = Math.max(0, Math.min(time, clip.end - MIN_CLIP_LENGTH));
      return;
    }
    const end = Math.max(time, clip.start + MIN_CLIP_LENGTH);
    if (end > this.project.duration) this.project.duration = end;
    clip.end = end;
  }

  /**
   * 松手结算：把片段按重叠策略落到 targetTrack 的 newStart。
   * 返回 false 表示落点被策略拒绝（调用方此时应整次手势作废）。
   */
  settlePlacement(targetTrackId: string, clipId: string, newStart: number): boolean {
    const found = this.findClip(clipId);
    const target = this.track(targetTrackId);
    if (!found || !target || !this.canHost(target, found.clip)) return false;
    const len = found.clip.end - found.clip.start;
    const start = Math.max(0, Math.min(newStart, Math.max(0, this.project.duration - len)));
    const cand = { ...found.clip, start, end: start + len };
    // placeSpan 自己会剔掉同 id 的旧几何，所以实时预览造成的重叠不影响结算
    const lane = placeSpan(target.clips as Span[], cand as Span, this.project.duration, this.project.overlapBehavior);
    if (!lane) return false;
    this.writeLane(target, lane as AnyClip[]);
    if (found.track.id !== target.id) {
      found.track.clips = (found.track.clips as AnyClip[]).filter((c) => c.id !== clipId) as typeof found.track.clips;
    }
    return true;
  }

  /** 松手结算：按重叠策略定下这条边。缩放没有「拒绝」，最差也是钳制。 */
  settleResize(trackId: string, clipId: string, edge: 'start' | 'end', time: number): boolean {
    const track = this.track(trackId);
    if (!track) return false;
    if (!(track.clips as AnyClip[]).some((c) => c.id === clipId)) return false;
    const lane = resizeSpan(
      track.clips as Span[],
      clipId,
      edge,
      time,
      this.project.duration,
      this.project.overlapBehavior,
    ) as AnyClip[];
    this.writeLane(track, lane);
    return true;
  }

  /**
   * 实时预览的落点合法性：给被拖片段加「不可落」样式用。
   * 只对 reject 有信息量——push/trim 总能把落点解决掉。
   */
  placementAccepted(targetTrackId: string, clipId: string, newStart: number): boolean {
    const found = this.findClip(clipId);
    const target = this.track(targetTrackId);
    if (!found || !target || !this.canHost(target, found.clip)) return false;
    const len = found.clip.end - found.clip.start;
    const start = Math.max(0, Math.min(newStart, Math.max(0, this.project.duration - len)));
    const cand = { ...found.clip, start, end: start + len };
    return placeSpan(target.clips as Span[], cand as Span, this.project.duration, this.project.overlapBehavior) !== null;
  }

  /**
   * 把几何层产出的 lane 写回轨道：`#r` 后缀是 trim 裂段的临时 id（见 clips.ts），
   * 在这里换成真正的 id，免得同一个片段被拆出两半后 id 撞车。
   */
  private writeLane(track: Track, lane: AnyClip[]): void {
    track.clips = lane.map((c) => (c.id.endsWith('#r') ? { ...c, id: newId() } : c)) as typeof track.clips;
  }

  /* ------------------------------------------------------------ 跨轨 */

  /**
   * 上/下移一轨（Alt+↑↓）：跳过装不下的轨道，起点保持不变。
   * 与拖拽共用 canHost 判据——两处都不能各写一套兼容规则。
   *
   * 返回值刻意区分「没轨可去」与「目标轨被占」，因为这两件事对用户
   * 意味完全不同的下一步动作（前者无解，后者改策略或先挪开邻居）。
   */
  shiftClipTrack(clipId: string, dir: -1 | 1): 'ok' | 'no-track' | 'blocked' {
    const found = this.findClip(clipId);
    if (!found) return 'no-track';
    const from = this.project.tracks.indexOf(found.track);
    let j = from + dir;
    while (j >= 0 && j < this.project.tracks.length) {
      if (this.canHost(this.project.tracks[j]!, found.clip)) break;
      j += dir;
    }
    if (j < 0 || j >= this.project.tracks.length) return 'no-track';
    const target = this.project.tracks[j]!;
    const start = found.clip.start;
    let moved = false;
    this.commit(dir < 0 ? '上移一轨' : '下移一轨', () => {
      // settlePlacement 被拒时不会改动任何状态，片段留在原轨
      moved = this.settlePlacement(target.id, clipId, start);
    });
    return moved ? 'ok' : 'blocked';
  }

  /* ------------------------------------------------------------ 时长 */

  /**
   * 工程时长（秒）**不是**由素材长度决定的：它只约束画布导出的帧数范围，
   * 片段可以把它撑长（addClip / liveMoveClip / liveResizeClip），
   * 也可以由用户直接改小（setDuration）。音频长度只是新片段的默认长度。
   */
  setDuration(sec: number): void {
    this.commit('修改时长', (p) => {
      p.duration = Math.max(0.1, sec);
    });
  }

  /** 时长收齐到内容末尾（只收不放：内容为空时保留 1 秒）。 */
  fitDurationToContent(): void {
    this.commit('时长贴合内容', (p) => {
      let end = 0;
      for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.end);
      p.duration = Math.max(0.1, end);
    });
  }

  /**
   * 改工程分辨率。
   *
   * 同时约束到偶数：H.264 的 4:2:0 色度需要宽高都是偶数，
   * 奇数尺寸在编码器侧会静默报错或被悄悄裁掉一列 —— 前者在
   * `runExport` 里抛，后者更难查。UI 上没有改分辨率的入口
   * （不在范围内），但导出 E2E 需要小分辨率来控制产物体积。
   */
  setResolution(w: number, h: number): void {
    const W = Math.max(16, Math.round(w / 2) * 2);
    const H = Math.max(16, Math.round(h / 2) * 2);
    this.commit('修改分辨率', (p) => {
      p.resolution = { w: W, h: H };
    });
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

  /* ------------------------------------------------------------ 序列化 */

  serialize(): string {
    return JSON.stringify(this.project, null, 2);
  }

  loadFrom(project: Project): void {
    this.commit('载入工程', (p) => {
      Object.assign(p, cloneProject(project));
    });
  }

  /**
   * 换掉整份工程（打开工程 / 新建工程）。
   *
   * 与 `loadFrom` 的区别只有一条，但是关键的：**清空撤销栈**。
   * `loadFrom` 是「在当前工程里换内容」的语义（可撤销），
   * 而打开另一份工程之后撤销回上一份是错的 —— 那会让两份工程的片段混在
   * 一起，而且栈里的快照与 `savedVersion` 对不上，脏标记开始撒谎。
   */
  replaceProject(project: Project): void {
    this.project = cloneProject(project);
    this.stack.reset();
    this.bump();
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
