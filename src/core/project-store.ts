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
  type TransitionRef,
  type VisualTrack,
} from './schema';
import {
  MIN_CLIP_LENGTH,
  applyTrimIn,
  earliestTrimStart,
  freeRangeAt,
  placeSpan,
  replaceSpan,
  resizeSpan,
  setTrimIn,
  sortSpans,
  spanAt,
  splitSpan,
  trimInOf,
  withTrimIn,
  type Span,
} from './clips';
import { clampTransitionDuration, transitionMaxDuration } from './transitions';
import { evalCurve, type Curve } from './curve';
import type { BeatGrid } from './time';
import { CommandStack } from './commands';
import { tr } from '../i18n/index.svelte';

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
    const kindLabel = kind === 'visual' ? tr('tl.trackKindVisual') : tr('tl.trackKindAudio');
    this.commit(tr('tl.newTrack', { kind: kindLabel }), (p) => {
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
    this.commit(tr('tl.removeTrack'), (p) => {
      p.tracks = p.tracks.filter((t) => t.id !== id);
    });
  }

  /**
   * 把第 from 条轨道挪到第 to 位（拖曳排序）。
   *
   * 轨道顺序是**有语义**的：`buildStack` 里 `tracks[0]` 是最前景，
   * 时间轴也从第 0 条往下画。所以这不是纯展示排序，而是一次真的画面改动 ——
   * 因此走 `commit`（一笔撤销），不走 touch。
   */
  moveTrack(from: number, to: number): void {
    const n = this.project.tracks.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
    this.commit(tr('tl.moveTrack'), (p) => {
      const [moved] = p.tracks.splice(from, 1);
      if (moved) p.tracks.splice(to, 0, moved);
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
    this.commit(enabled ? tr('tl.enableTrack') : tr('tl.disableTrack'), (p) => {
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
    this.commit(tr('tl.renameTrack'), (p) => {
      const t = p.tracks.find((x) => x.id === id);
      if (t) t.name = next;
    });
  }

  /* ------------------------------------------------------------ 片段 */

  addClip(trackId: string, clip: AnyClip): void {
    this.commit(tr('tl.addClip'), (p) => {
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
    this.commit(tr('tl.removeClip'), (p) => {
      for (const t of p.tracks) {
        const before = t.clips.length;
        t.clips = t.clips.filter((c) => c.id !== clipId) as typeof t.clips;
        if (t.clips.length !== before) return;
      }
    });
  }

  /**
   * 一次删掉多个片段（框选之后的 Delete）：**一笔撤销**，不是 N 笔。
   *
   * 逐个调 `removeClip` 也能删对，但撤销栈里会多出 N 条记录 ——
   * 用户按一次 Ctrl+Z 只回来一个，看起来就是「撤销坏了」。
   */
  removeClips(clipIds: readonly string[]): void {
    if (!clipIds.length) return;
    if (clipIds.length === 1) {
      this.removeClip(clipIds[0]!);
      return;
    }
    const set = new Set(clipIds);
    this.commit(tr('tl.removeClips', { n: clipIds.length }), (p) => {
      for (const t of p.tracks) {
        t.clips = t.clips.filter((c) => !set.has(c.id)) as typeof t.clips;
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
      /*
       * trim-in：拖左边界改的是**长度 + 源内偏移**，不是整体平移。
       *
       * 下界是 `earliestTrimStart`（= start − srcIn/speed）：素材头部没有更多
       * 内容了，srcIn 不能为负。这条下界正是「裁掉 1 秒之后拖不回来」的正确
       * 含义，同时让裁剪可逆 —— 往右裁多少，往回就能拖多少。
       *
       * 增量式累加（每次 pointermove 挪一点）而不是按基准重算：拖动过程中
       * 会结算很多次，每次只知道自己这一次挪了多少。
       */
      const next = Math.max(earliestTrimStart(clip), Math.min(time, clip.end - MIN_CLIP_LENGTH));
      const delta = next - clip.start;
      if (delta === 0) return;
      const ti = trimInOf(clip);
      if (ti) setTrimIn(clip, ti.srcIn + delta * ti.speed);
      clip.start = next;
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
    const clip = (track.clips as AnyClip[]).find((c) => c.id === clipId);
    if (!clip) return false;
    /*
     * 左边界要**再钳一次** trim-in 下界。
     *
     * 实时拖动已经钳过一次，但松手传进来的是**指针的原始时间**，可能比下界
     * 更靠左；不再钳的话 resizeSpan 会把 start 拖到素材头部之外，而 srcIn
     * 早已停在 0 —— 于是几何与内容对不上（表现是「松手后画面从第 1 秒重放」）。
     */
    const t = edge === 'start' ? Math.max(time, earliestTrimStart(clip)) : time;
    /*
     * 结算会让别的片段也动：trim 吃掉邻居头部（起点动、终点不动）需要同步
     * 推进它的 srcIn，push 挤开邻居（两端一起动）则**不能**动。判据在
     * `applyTrimIn` 里，这里只负责把「结算前」的 lane 留一份。
     */
    const before = (track.clips as AnyClip[]).map((c) => ({ ...c }));
    const lane = resizeSpan(
      track.clips as Span[],
      clipId,
      edge,
      t,
      this.project.duration,
      this.project.overlapBehavior,
    ) as AnyClip[];
    this.writeLane(track, applyTrimIn(before, lane));
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
    this.commit(dir < 0 ? tr('tl.moveTrackUp') : tr('tl.moveTrackDown'), () => {
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
    this.commit(tr('tl.setDuration'), (p) => {
      p.duration = Math.max(0.1, sec);
    });
  }

  /** 时长收齐到内容末尾（只收不放：内容为空时保留 1 秒）。 */
  fitDurationToContent(): void {
    this.commit(tr('tl.fitDuration'), (p) => {
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
    this.commit(tr('tl.setResolution'), (p) => {
      p.resolution = { w: W, h: H };
    });
  }

  /**
   * 改工程帧率。
   *
   * 允许小数（23.976 / 29.97 这类是真实存在的），但保留两位就够 ——
   * 再多位在 `frameOf` 的 Math.round 里也没有意义。
   *
   * ⚠️ 改帧率会改变 `frameOf(t, fps)`，而 `seedFor(seed, id, frame)` 用的就是
   * 帧号 —— 于是所有掺了逐帧随机的特效/生成器（slices 的切片位移、噪声类）
   * 画面会跟着变。这是**预期行为**（帧号是随机的定义域），UI 上有说明。
   */
  setFps(fps: number): void {
    const v = Math.max(1, Math.min(240, Math.round(fps * 100) / 100));
    if (!Number.isFinite(v) || v <= 0) return;
    this.commit(tr('tl.setFps'), (p) => {
      p.fps = v;
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
    /*
     * 右半段的源内偏移必须前进 atRel × speed。
     *
     * 漏掉这一步的症状很具体：把一段音频从中间切开，右半段会**从头重放**
     * （它继承了原来的 srcIn），于是后半段与前半段内容重叠、整段对不上拍。
     * 视频同理。这是与「拖左边界要改 srcIn」同一个道理的两处落点。
     */
    const ti = trimInOf(clip);
    return this.commit(tr('tl.splitClip'), () => {
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
        if (c.start === at) {
          const right = { ...c, curves: rightCurves };
          return ti ? withTrimIn(right as AnyClip, ti.srcIn + atRel * ti.speed) : right;
        }
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
    this.commit(tr('tl.setOverlapBehavior'), (p) => {
      p.overlapBehavior = b;
    });
  }

  /* ------------------------------------------------------------ 转场 */

  /**
   * 转场只可能挂在**视觉轨的 SourceClip** 上（EffectClip 没有画面可以当 from）。
   * 返回数组下标是为了让调用方拿到轨道级上下文 —— `transitionMaxDuration`
   * 需要看邻居的转场，光有片段本身算不出来。
   */
  private transitionHost(clipId: string): { track: VisualTrack; index: number } | null {
    for (const track of this.project.tracks) {
      if (track.kind !== 'visual') continue;
      const index = track.clips.findIndex((c) => c.id === clipId);
      if (index < 0) continue;
      if (track.clips[index]!.kind !== 'source') return null;
      return { track, index };
    }
    return null;
  }

  /**
   * 设 / 改出画转场。`defId` 为空串 = 删除。
   *
   * `values` 由调用方给（core 不认识 effects/transitions 的注册表，
   * 默认参数得由 UI 侧先 `defaultTransitionValues(defId)` 取好）。
   */
  setTransitionOut(
    clipId: string,
    defId: string,
    duration: number,
    values: Record<string, number>,
  ): void {
    const host = this.transitionHost(clipId);
    if (!host) return;
    this.commit(tr('insp.setTransition'), () => {
      const clip = host.track.clips[host.index] as SourceClip;
      if (!defId) {
        delete clip.transitionOut;
        return;
      }
      const max = transitionMaxDuration(host.track, host.index);
      clip.transitionOut = {
        defId,
        duration: clampTransitionDuration(duration, max),
        values: { ...values },
      };
    });
  }

  clearTransitionOut(clipId: string): void {
    this.setTransitionOut(clipId, '', 0, {});
  }

  /** 改时长。钳制走同一个函数，UI 与这里不许各写一套。 */
  setTransitionDuration(clipId: string, seconds: number): void {
    const host = this.transitionHost(clipId);
    if (!host) return;
    this.commit(tr('insp.changeTransitionDuration'), () => {
      const clip = host.track.clips[host.index] as SourceClip;
      if (!clip.transitionOut) return;
      const max = transitionMaxDuration(host.track, host.index);
      clip.transitionOut.duration = clampTransitionDuration(seconds, max);
    });
  }

  /** 改转场参数。 */
  updateTransition(clipId: string, label: string, fn: (t: TransitionRef) => void): void {
    const host = this.transitionHost(clipId);
    if (!host) return;
    this.commit(label, () => {
      const clip = host.track.clips[host.index] as SourceClip;
      if (clip.transitionOut) fn(clip.transitionOut);
    });
  }

  setBeatGrid(grid: Partial<BeatGrid>): void {
    this.commit(tr('tl.setBeatGrid'), (p) => {
      Object.assign(p.beatGrid, grid);
    });
  }

  /* ------------------------------------------------------------ 序列化 */

  serialize(): string {
    return JSON.stringify(this.project, null, 2);
  }

  loadFrom(project: Project): void {
    this.commit(tr('tl.loadProject'), (p) => {
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
