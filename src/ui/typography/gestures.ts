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
import { newId } from '../../core/schema';
import { cloneFragment, extractFragment } from '../../typography/groups';
import {
  boundsOf,
  docToLocal,
  resizeFramesRotated,
  rotateFrames,
  snapAngle,
  snapMove,
  toRects,
  type Guide,
  type HandleId,
  type Rect,
} from '../../typography/geometry';
import {
  moveNode,
  parsePathNodes,
  serializePathNodes,
  setHandle,
} from '../../typography/path-nodes';
import { applyShapeParam, shapeParamValue, type ShapeHandle } from '../../typography/shape-handles';
import { pathUnitScale } from '../../typography/shapes';
import type { ShapeElement } from '../../typography/document';
import { tr } from '../../i18n/index.svelte';

export interface GestureEnv {
  /** 屏幕坐标 → 文档坐标。 */
  toDoc: (e: PointerEvent) => { x: number; y: number };
  docSize: { w: number; h: number };
  setGuides: (guides: Guide[]) => void;
  /** 拖动吸附阈值（px）。移动时按住 Alt 传 0。 */
  snapThreshold: number;
  /**
   * 网格吸附的一格尺寸（文档 px）。null / 未开启 = 不吸附网格。
   * 传的是**已换算好的 px**，所以手势层不需要知道 px / 百分比这两种模式。
   */
  gridSpacing?: { x: number; y: number } | null;
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

export interface MoveGestureOptions {
  /**
   * 按下了但**没有拖动**（一次真正的「单击」）时回调。
   *
   * 存在的理由：选择框会吞掉 pointerdown（拖动整块选区靠它），于是
   * 「再单击一次进入组合」这件事在 `.viewport` 的 pointerdown 里根本收不到。
   * 而这件事又**只能在没拖动时发生** —— 按下去就进组的话，想拖整组的人
   * 会发现自己拖走的是组里的一个子元素。
   */
  onClick?: () => void;
}

export function startMoveGesture(
  env: GestureEnv,
  start: { x: number; y: number },
  opts: MoveGestureOptions = {},
): void {
  let ids = new Set(editorState.selectedIds);
  let moving = unlockedRects();
  if (!moving.length) return;

  let others = editorState.selectableRects.filter((r) => !ids.has(r.id));
  editorState.beginGesture();
  let moved = false;
  /** 位移的零点。Ctrl 拖副本时会重置到当前指针位置（副本从原处出发）。 */
  let origin = { x: start.x, y: start.y };
  let cloned = false;
  let detach = (): void => {};

  const onMove = (ev: PointerEvent): void => {
    const p = env.toDoc(ev);
    let dx = p.x - origin.x;
    let dy = p.y - origin.y;
    if (!moved && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

    /*
     * Ctrl 拖曳 = 在**原位**留一份、拖走副本。
     *
     * 在「第一次真的移动」时才克隆，而不是 pointerdown 时：Ctrl+单击在多数
     * 设计工具里是「加入/移出选择集」的语义，一按下就克隆会让那次单击平白
     * 多出一个副本。克隆后把位移零点重置到当前指针，于是副本先出现在原处，
     * 再跟着指针走 —— 与「从原位生成副本并拖曳」完全一致。
     */
    if (ev.ctrlKey && !cloned) {
      const fresh = cloneSelectionInPlace();
      if (fresh) {
        moving = fresh.rects;
        ids = new Set(fresh.ids);
        others = editorState.selectableRects.filter((r) => !ids.has(r.id));
        origin = { x: p.x, y: p.y };
        dx = 0;
        dy = 0;
        cloned = true;
      }
    }
    moved = true;

    // Shift = 单轴。按**位移的主轴**判定（横向走得多就锁横向），
    // 每次移动重判 —— 允许中途改主意换轴，这是设计工具的通行手感。
    if (ev.shiftKey && !ev.altKey) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }

    // Alt 临时关吸附 —— 设计工具的通用约定。
    const threshold = ev.altKey ? 0 : env.snapThreshold;
    const snapped = snapMove(moving, dx, dy, others, env.docSize, threshold, env.gridSpacing ?? null);
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
    if (moved) editorState.endGesture(tr(cloned ? 'typo.undo.duplicateDrag' : 'typo.undo.move'));
    else {
      editorState.cancelGesture();
      opts.onClick?.();
    }
  };

  detach = attach(onMove, onUp);
}

/**
 * 在文档里就地复制当前选择集（不偏移），并把它设为新选择。
 *
 * 与 `actions.duplicateSelection` 的差别只有两点：**不偏移**（副本要跟着
 * 指针走，偏移是手势的职责），以及**不自己开事务**（它在 beginTx 里面跑，
 * 整次拖曳要结算成一笔撤销）。
 *
 * 走 `extractFragment` / `cloneFragment` 这条统一路径，于是**组合也会被一起
 * 复制**（新的 groupId + 新的组定义）。自己 structuredClone 一遍的话，
 * 副本会共用原来的 groupId，被并进原组里 —— 动一下组样式原件跟着变。
 */
function cloneSelectionInPlace(): { ids: string[]; rects: Rect[] } | null {
  const doc = editorState.doc;
  if (!doc) return null;
  const frag = extractFragment(doc, editorState.groupAwareIds);
  if (!frag.elements.length) return null;
  const clone = cloneFragment(frag, 0, newId);
  editorState.live((d) => {
    d.elements = [...d.elements, ...clone.elements];
    if (clone.groups.length) d.groups = [...(d.groups ?? []), ...clone.groups];
  });
  editorState.setSelection(clone.elements.map((e) => e.id));
  return { ids: clone.elements.map((e) => e.id), rects: toRects(clone.elements) };
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
      // 缩放也要吃网格吸附（原先只有移动吃）。Alt 关吸附时一并关掉。
      grid: ev.altKey ? null : (env.gridSpacing ?? null),
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
    if (moved) editorState.endGesture(tr('typo.undo.resize'));
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
    if (moved) editorState.endGesture(tr('typo.undo.rotate'));
    else editorState.cancelGesture();
  };

  detach = attach(onMove, onUp);
}

/* ------------------------------------------------------------ 图形控制点 */

function findShape(id: string): ShapeElement | null {
  const el = editorState.doc?.elements.find((e) => e.id === id);
  return el && el.kind === 'shape' ? el : null;
}

/**
 * 拖一个**形状控制点**（圆角 / 谷半径 / 壁厚 / 张角）。
 *
 * 与顶点编辑是两回事：这里改的是**参数**，图形始终是参数化的 —— 拖完圆角之后
 * 再把框拉大，圆角会按公式重算（实时形状），而不是跟着被拉成椭圆。
 *
 * 坐标要走 `docToLocal`：控制点的几何定义在**元素自身的坐标系**里（未旋转、
 * 原点在左上角）。跳过这一步的话，元素一旋转，把手和指针就开始各走各的。
 */
export function startShapeHandleDrag(
  env: GestureEnv,
  elId: string,
  handle: ShapeHandle,
  start: { x: number; y: number },
): void {
  const el = findShape(elId);
  if (!el) return;
  // 手势期间 frame 不变（只改参数），所以按下时抓一份就够 —— 也不必担心中途
  // 读到被上一次 live 改过的 frame。
  const frame = { ...el.frame };
  const origin = docToLocal(frame, start);
  const startValue = shapeParamValue(el, handle.param);

  editorState.beginGesture();
  let moved = false;
  let detach = (): void => {};

  const onMove = (ev: PointerEvent): void => {
    const local = docToLocal(frame, env.toDoc(ev));
    // 没动过就不写：手指抖一下不该留下一条撤销记录。
    if (!moved && Math.hypot(local.x - origin.x, local.y - origin.y) < 0.5) return;
    moved = true;
    const value = handle.read(local, origin, startValue);
    editorState.live((doc) => {
      const target = doc.elements.find((e) => e.id === elId);
      if (!target || target.kind !== 'shape') return;
      applyShapeParam(target, handle.param, value);
    });
  };

  const onUp = (): void => {
    detach();
    if (moved) editorState.endGesture(tr('typo.undo.shapeHandle'));
    else editorState.cancelGesture();
  };

  detach = attach(onMove, onUp);
}

/* ------------------------------------------------------------ 路径顶点 */

/**
 * 元素局部**像素** → 路径坐标。
 *
 * `svg` 图形的 `path` 默认按 0..100 authored 存（渲染时由 `<g scale(w/100,h/100)>`
 * 拉到像素盒）；文本转路径的 `pathUnit: 'px'` 已经是像素。手势这一路拿到的是
 * 「文档坐标 → 局部像素」，**必须再过这一趟**才能写进路径。
 *
 * 漏掉的后果非常隐蔽：写进去的是像素值，在 324 宽的框里差 3.24 倍 —— 拖一下
 * 锚点它就飞到框外，而**那一次拖动的 DOM 更新看起来是正常的**（路径确实变了），
 * 只有下一次想再拖它时才发现点不到了。各轴比例不同，所以 x / y 要分别换算。
 */
function toAuthored(
  p: { x: number; y: number },
  unit: { x: number; y: number },
): { x: number; y: number } {
  return { x: p.x / Math.max(1e-6, unit.x), y: p.y / Math.max(1e-6, unit.y) };
}

export type NodeDragTarget =
  | { kind: 'anchor'; sub: number; index: number }
  | { kind: 'handle'; sub: number; index: number; side: 'in' | 'out' };

/**
 * 拖一个**路径锚点或它的控制手柄**（顶点编辑）。
 *
 * 每次都从**按下时**的结构重算，而不是在上一次的结果上继续改：`moveNode` /
 * `setHandle` 内部存的是绝对坐标，逐帧累积会让「拖出去再拖回来」回不到原位
 * （浮点误差每帧攒一点）。反正路径只有几十个点，重算的代价可以忽略。
 *
 * Alt = **断开镜像**（把平滑点变成角点）。这个键在顶点编辑态里没有别的用途
 * （这里不做吸附），所以可以放心占用。
 */
export function startNodeDrag(
  env: GestureEnv,
  elId: string,
  target: NodeDragTarget,
  start: { x: number; y: number },
): void {
  const el = findShape(elId);
  if (!el || el.shape !== 'svg') return;
  const frame = { ...el.frame };
  const unit = pathUnitScale(el);
  const origin = docToLocal(frame, start);
  const base = parsePathNodes(el.path ?? '');
  if (!base[target.sub]) return;

  editorState.beginGesture();
  let moved = false;
  let detach = (): void => {};

  const onMove = (ev: PointerEvent): void => {
    // 阈值判断在**局部像素**里做（与 origin 同一坐标系），写进路径时再换算成
    // authored —— 两件事用两个坐标系，混起来就会写出错位的值。
    const local = docToLocal(frame, env.toDoc(ev));
    if (!moved && Math.hypot(local.x - origin.x, local.y - origin.y) < 0.5) return;
    const at = toAuthored(local, unit);
    const sp = base[target.sub]!;
    const next =
      target.kind === 'anchor'
        ? moveNode(sp, target.index, at)
        : setHandle(sp, target.index, target.side, at, !ev.altKey);
    if (next === sp) return;
    moved = true;
    const subs = base.slice();
    subs[target.sub] = next;
    const path = serializePathNodes(subs);
    editorState.live((doc) => {
      const t = doc.elements.find((e) => e.id === elId);
      if (t && t.kind === 'shape') t.path = path;
    });
  };

  const onUp = (): void => {
    detach();
    if (moved) editorState.endGesture(tr('typo.undo.editPath'));
    else editorState.cancelGesture();
  };

  detach = attach(onMove, onUp);
}
