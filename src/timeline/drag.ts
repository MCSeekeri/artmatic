/**
 * drag.ts — 片段拖拽 / 边缘缩放手势。
 *
 * 手势 = 一个撤销事务：pointerdown 时 beginTx，pointermove 直接改
 * （coalesce），pointerup 时结算策略再 endTx 落成一条撤销记录。
 *
 * 【两段式：实时预览 ≠ 策略结算】2026-09-27 用户反馈后重做。
 *   - pointermove：只做「自由移动」——被拖片段跟着鼠标走，允许与邻居视觉重叠，
 *     跨轨拖拽也在这里实时生效。策略一律不动。
 *   - pointerup：调 store.settlePlacement / settleResize 结算一次：
 *       reject  落点非法 → 整次手势作废（cancelTx 回起点），拖动期间红框预告
 *       push    挤开邻居
 *       trim    吃掉邻居
 *   这样 trim 不再「拖过去就吃掉」，push 不再「拖过去就把整轨推走」。
 *   例外是 resize + reject：单边钳制、非破坏性，仍然实时生效。
 *
 * 【监听器挂在 window 上，不用 setPointerCapture】
 * 跨轨拖拽会让片段在两个 `{#each}` 块之间搬家，DOM 元素被重建、指针捕获随之失效。
 * 挂在 window 上就不依赖元素存活。
 */

import { snapTime, beatDur, type BeatGrid, type SnapMode } from '../core/time';
import type { ProjectStore } from '../core/project-store';
import type { AnyClip, Track } from '../core/schema';

export type DragMode = 'move' | 'resize-l' | 'resize-r';

export interface DragOptions {
  track: Track;
  clip: AnyClip;
  mode: DragMode;
  pxPerBeat: number;
  snapMode: SnapMode;
  /**
   * 屏幕坐标 → 轨道 id。默认按 DOM 上的 data-track-id 找（Timeline 的行与
   * 侧栏行都带这个属性）；返回 null 表示鼠标不在任何轨道上（保持当前轨）。
   */
  trackIdAt?: (clientX: number, clientY: number) => string | null;
  /** 当前落点是否「不可落」——用于给被拖片段加提示样式。 */
  onHint?: (illegal: boolean) => void;
}

/** 默认的坐标 → 轨道映射：靠行元素上的 data-track-id，不依赖硬编码行高。 */
function trackIdAtPoint(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  return el?.closest('[data-track-id]')?.getAttribute('data-track-id') ?? null;
}

export function startClipDrag(e: PointerEvent, store: ProjectStore, opts: DragOptions): void {
  e.preventDefault();
  e.stopPropagation();

  const { clip, mode, pxPerBeat } = opts;
  const trackIdAt = opts.trackIdAt ?? trackIdAtPoint;
  const pointerId = e.pointerId;
  const startX = e.clientX;
  const origStart = clip.start;
  const origEnd = clip.end;
  const gridAtStart = store.project.beatGrid;

  /** 当前所在轨道——跨轨实时移动会改它，后续计算必须跟着走。 */
  let curTrackId = opts.track.id;

  store.beginTx();
  opts.onHint?.(false);

  /** 水平位移换算成秒；pxPerBeat 是按下那一刻的缩放（拖动中不缩放）。 */
  const dtSec = (clientX: number): number =>
    (clientX - startX) / (pxPerBeat / beatDur(gridAtStart));

  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    const p = store.project;
    const g: BeatGrid = p.beatGrid;

    if (mode === 'move') {
      const cand = Math.max(0, snapTime(origStart + dtSec(ev.clientX), opts.snapMode, g));
      const over = trackIdAt(ev.clientX, ev.clientY);
      const targetId = over ?? curTrackId;
      store.liveMoveClip(targetId, clip.id, cand);
      curTrackId = store.findClip(clip.id)?.track.id ?? curTrackId;
      // 探针用鼠标下的轨道（可能是装不下的轨道），落点非法时给视觉预告
      opts.onHint?.(!store.placementAccepted(targetId, clip.id, cand));
      store.touch();
      return;
    }

    const edge = mode === 'resize-l' ? 'start' : 'end';
    const raw = edge === 'start' ? origStart + dtSec(ev.clientX) : origEnd + dtSec(ev.clientX);
    const cand = snapTime(raw, opts.snapMode, g);
    // 缩放不换轨；reject 实时钳制（非破坏性），其余策略先自由移动、松手才结算
    if (p.overlapBehavior === 'reject') store.settleResize(curTrackId, clip.id, edge, cand);
    else store.liveResizeClip(curTrackId, clip.id, edge, cand);
    store.touch();
  };

  const cleanup = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
    opts.onHint?.(false);
  };

  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    cleanup();
    if (mode === 'move') {
      const start = store.findClip(clip.id)?.clip.start ?? origStart;
      if (!store.settlePlacement(curTrackId, clip.id, start)) {
        // reject：落点非法就整次不动（AGENTS.md §5 的语义）
        store.cancelTx();
        store.touch();
        return;
      }
    } else {
      const edge = mode === 'resize-l' ? 'start' : 'end';
      const found = store.findClip(clip.id);
      if (found) store.settleResize(curTrackId, clip.id, edge, edge === 'start' ? found.clip.start : found.clip.end);
    }
    // touch 不能省：结算可能把状态改回事务起点（例如 reject 被钳回原位），
    // 此时 endTx 判定「无变化」不会 bump，UI 就会停在被作废的实时预览上。
    store.touch();
    store.endTx(mode === 'move' ? '移动片段' : '调整片段长度');
  };

  const onCancel = (): void => {
    cleanup();
    store.cancelTx();
    store.touch();
  };

  /** Esc 中止本次拖拽（撤销栈里的手势事务本来就是为这个准备的）。 */
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    cleanup();
    store.cancelTx();
    store.touch();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey);
}
