/**
 * drag.ts — 片段拖拽 / 边缘缩放手势。
 *
 * 手势 = 一个撤销事务：pointerdown 时 beginTx，pointermove 直接改
 * （coalesce），pointerup 时 endTx 落成一条撤销记录。
 *
 * reject 策略下的拖拽体验：候选位置被占时保持上一个合法位置
 * （在这里先自查空档再决定动不动），而不是让片段跳回拖拽原点。
 * 吸附走 snapTime——与网格同源（core/time.ts 一张表）。
 */

import { snapTime, type BeatGrid, type SnapMode } from '../core/time';
import { beatDur } from '../core/time';
import type { ProjectStore } from '../core/project-store';
import type { AnyClip, Track } from '../core/schema';

export type DragMode = 'move' | 'resize-l' | 'resize-r';

export interface DragOptions {
  track: Track;
  clip: AnyClip;
  mode: DragMode;
  pxPerBeat: number;
  snapMode: SnapMode;
}

export function startClipDrag(e: PointerEvent, store: ProjectStore, opts: DragOptions): void {
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);

  const { track, clip, mode, pxPerBeat } = opts;
  const startX = e.clientX;
  const origStart = clip.start;
  const origEnd = clip.end;

  store.beginTx();

  const onMove = (ev: PointerEvent): void => {
    const p = store.project;
    const g: BeatGrid = p.beatGrid;
    const dt = (ev.clientX - startX) / (pxPerBeat / beatDur(g));
    if (mode === 'move') {
      const cand = snapTime(origStart + dt, opts.snapMode, g);
      if (p.overlapBehavior === 'reject') {
        const len = origEnd - origStart;
        const s = Math.max(0, Math.min(cand, p.duration - len));
        const blocked = (track.clips as AnyClip[]).some(
          (o) => o.id !== clip.id && o.start < s + len - 1e-9 && o.end > s + 1e-9,
        );
        if (blocked) return; // 保持上一个合法位置
      }
      store.moveClip(track.id, clip.id, cand);
    } else {
      const edge = mode === 'resize-l' ? 'start' : 'end';
      const cand = snapTime((edge === 'start' ? origStart : origEnd) + dt, opts.snapMode, g);
      store.resizeClip(track.id, clip.id, edge, cand);
    }
    store.touch();
  };

  const cleanup = (): void => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
  const onUp = (): void => {
    cleanup();
    store.endTx(mode === 'move' ? '移动片段' : '调整片段长度');
  };
  const onCancel = (): void => {
    cleanup();
    store.cancelTx();
  };

  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
}
