/**
 * gestures.ts — 画布上的三种手势：移动 / 缩放 / 旋转。
 *
 * 都遵守项目统一的两段式约定（见 AGENTS §5 与 timeline/drag.ts 的同款注释）：
 *   pointermove —— 只做实时变更（editorState.live，走 store.touch，不入撤销栈）
 *   pointerup   —— settle 一次（endGesture 结算成一笔撤销）
 *
 * 一上来就 commit 是不行的：一次拖拽会往撤销栈里塞几十条记录，用户按一次
 * Ctrl+Z 只挪回 0.3px，观感上就是「撤销坏了」。
 *
 * 指针监听挂 window 而不是 setPointerCapture：元素会在 {#each} 重建时被换掉，
 * 捕获随之失效（这是 Timeline 那条注释的同一个坑）。
 */

import { editorState } from './editor-state.svelte';
import {
  boundsOf,
  resizeFramesRotated,
  rotateFrames,
  snapAngle,
  snapMove,
  toRects,
  type Guide,
  type HandleId,
  type Rect,
} from '../../typography/geometry';

export interface GestureEnv {
  /** 屏幕坐标 → 文档坐标。 */
  toDoc: (e: PointerEvent) => { x: number; y: number };
  docSize: { w: number; h: number };
  setGuides: (guides: Guide[]) => void;
  /** 拖动吸附阈值（px）。移动时按住 Alt 传 0。 */
  snapThreshold: number;
}

function attach(onMove: (e: PointerEvent) => void, onUp: () => void): () => void {
  const up = (): void => onUp();
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', up, { once: true });
  window.addEventListener('pointercancel', up, { once: true });
  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
}

function unlockedRects(): Rect[] {
  return toRects(editorState.selected.filter((e) => !e.locked));
}

/* ------------------------------------------------------------ 移动 */

export function startMoveGesture(env: GestureEnv, start: { x: number; y: number }): void {
  const ids = new Set(editorState.selectedIds);
  const moving = unlockedRects();
  if (!moving.length) return;

  const others = editorState.selectableRects.filter((r) => !ids.has(r.id));
  editorState.beginGesture();
  let moved = false;
  let detach = (): void => {};

  const onMove = (ev: PointerEvent): void => {
    const p = env.toDoc(ev);
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (!moved && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    moved = true;

    // Alt 临时关吸附 —— 设计工具的通用约定。
    const threshold = ev.altKey ? 0 : env.snapThreshold;
    const snapped = snapMove(moving, dx, dy, others, env.docSize, threshold);
    env.setGuides(snapped.guides);
    editorState.live((doc) => {
      for (const el of doc.elements) {
        const f = snapped.frames.get(el.id);
        if (!f || el.locked) continue;
        el.frame.x = f.x;
        el.frame.y = f.y;
      }
    });
  };

  const onUp = (): void => {
    detach();
    env.setGuides([]);
    // 没动过就撤销事务，不留一条「什么也没做」的撤销记录。
    if (moved) editorState.endGesture('移动元素');
    else editorState.cancelGesture();
  };

  detach = attach(onMove, onUp);
}

/* ------------------------------------------------------------ 缩放 */

export function startResizeGesture(
  env: GestureEnv,
  handle: HandleId,
  start: { x: number; y: number },
): void {
  const sel = editorState.selected.filter((e) => !e.locked);
  const orig = toRects(sel);
  if (!orig.length) return;

  // 单选且带旋转时，缩放必须在**元素自身的坐标系**里做。否则把手在屏幕上
  // 指着的方向与世界坐标轴不一致，「拖右边却往斜上方长」。
  // 多选时用 0：整个选区的外接框本来就没有统一的角度可言。
  const rot = sel.length === 1 ? (sel[0]!.frame.rot ?? 0) : 0;
  const origRot = new Map(sel.map((e) => [e.id, e.frame.rot]));

  editorState.beginGesture();
  let moved = false;
  let detach = (): void => {};

  const onMove = (ev: PointerEvent): void => {
    const p = env.toDoc(ev);
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (!moved && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    moved = true;

    const frames = resizeFramesRotated(orig, handle, dx, dy, rot, {
      keepRatio: ev.shiftKey,
      fromCenter: ev.altKey,
    });
    editorState.live((doc) => {
      for (const el of doc.elements) {
        const f = frames.get(el.id);
        if (!f || el.locked) continue;
        el.frame.x = f.x;
        el.frame.y = f.y;
        el.frame.w = f.w;
        el.frame.h = f.h;
        // 旋转角不参与缩放，保持原样（否则缩放手势会顺带把元素拧一下）。
        el.frame.rot = origRot.get(el.id) ?? el.frame.rot;
      }
    });
  };

  const onUp = (): void => {
    detach();
    if (moved) editorState.endGesture('缩放元素');
    else editorState.cancelGesture();
  };

  detach = attach(onMove, onUp);
}

/* ------------------------------------------------------------ 旋转 */

export function startRotateGesture(env: GestureEnv, start: { x: number; y: number }): void {
  const orig = unlockedRects();
  if (!orig.length) return;

  const box = boundsOf(orig);
  const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const origRot = new Map(editorState.selected.map((e) => [e.id, e.frame.rot]));

  editorState.beginGesture();
  let moved = false;
  let detach = (): void => {};

  const onMove = (ev: PointerEvent): void => {
    const p = env.toDoc(ev);
    const angle = Math.atan2(p.y - center.y, p.x - center.x);
    let delta = angle - startAngle;
    // Shift 吸附到 15° 的整数倍。
    if (ev.shiftKey) delta = snapAngle(delta, true);
    if (!moved && Math.abs(delta) < 0.01) return;
    moved = true;

    const positions = rotateFrames(orig, center, delta);
    editorState.live((doc) => {
      for (const el of doc.elements) {
        const pos = positions.get(el.id);
        if (!pos || el.locked) continue;
        el.frame.x = pos.x;
        el.frame.y = pos.y;
        // 位置转了，自身角度也必须跟着转 —— 只改位置会得到
        // 「框绕着中心转、内容却不转」的错误结果。
        el.frame.rot = (origRot.get(el.id) ?? 0) + delta;
      }
    });
  };

  const onUp = (): void => {
    detach();
    if (moved) editorState.endGesture('旋转元素');
    else editorState.cancelGesture();
  };

  detach = attach(onMove, onUp);
}
