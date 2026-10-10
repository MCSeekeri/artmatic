/**
 * marquee.ts — 框选：在时间轴空白处拖出矩形，选中与它相交的片段。
 *
 * 【与 drag.ts 的差别：没有撤销事务】
 * 框选**不改文档**，改的是选中态（`appState` 上的 UI 状态，不进 store）。
 * 所以这里没有 beginTx / settle 那一套 —— 松手也没有策略要结算。
 *
 * 【监听器挂在 window 上，不用 setPointerCapture】
 * 与 drag.ts 同款理由：拖动期间片段会在 `{#each}` 块里重建，指针捕获随之失效。
 * 挂在 window 上就不依赖任何元素存活。
 *
 * 【命中判定走 DOM 矩形，不自己算几何】
 * `getBoundingClientRect` 已经包含滚动位置、横向缩放（pxPerBeat）与行高
 * （ROW_HEIGHT）三件事。自己从 `t` 反算像素是**第四份**会漂移的真源，
 * 而且它只在「框选结果不对」时才暴露出来。
 *
 * 【点空白 = 取消选择，拖动空白 = 框选】
 * 两者用 4px 阈值区分（与侧栏拖曳排序同值）：以内算单击。单击的「取消选择」
 * 在 pointerdown 就生效（按下去就要有响应，等松手才清是另一种手感），
 * 框选只是把同一件事继续做下去 —— 差别只在有没有画出那个框。
 */

export interface MarqueeBox {
  /** 相对容器的局部坐标（时间轴的内容坐标）。 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MarqueeOptions {
  /** 起点（client 坐标）。 */
  start: { x: number; y: number };
  /** 按下瞬间的选中集。加选的底、Esc / pointercancel 的恢复点。 */
  selection: readonly string[];
  /** client 坐标 → 框选框所在容器的局部坐标。 */
  toLocal: (clientX: number, clientY: number) => { x: number; y: number };
  /** 选中集变化。调用方通常直接写 `appState.setClipSelection`。 */
  onSelect: (ids: string[]) => void;
  /** 框选框几何变化（null = 结束）。超过阈值之前不会出现。 */
  onBox: (box: MarqueeBox | null) => void;
}

/** 起手到判定为「拖动」的距离（px）：以内都算单击。 */
const DRAG_THRESHOLD = 4;

/** 矩形求交（相切也算相交 —— 框住半像素不算命中会让人困惑）。 */
function intersects(
  a: { l: number; t: number; r: number; b: number },
  b: { l: number; t: number; r: number; b: number },
): boolean {
  return a.r >= b.l && a.l <= b.r && a.b >= b.t && a.t <= b.b;
}

/** 与框选矩形相交的片段 id（按 DOM 顺序，即轨道序 → 轨道内序）。 */
function hitsIn(box: { l: number; t: number; r: number; b: number }): string[] {
  const out: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('[data-clip-id]')) {
    const r = el.getBoundingClientRect();
    const id = el.dataset.clipId;
    if (id && intersects({ l: r.left, t: r.top, r: r.right, b: r.bottom }, box)) out.push(id);
  }
  return out;
}

export function startMarquee(e: PointerEvent, opts: MarqueeOptions): void {
  e.preventDefault();
  const pointerId = e.pointerId;
  const start = { x: opts.start.x, y: opts.start.y };
  /** Shift / Ctrl / Cmd = 在已有选择上**加**选，而不是替换。 */
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  const orig = [...opts.selection];
  const base = additive ? orig : [];
  let moved = false;

  // 按下即应用一次 base：无修饰键时这就是「点空白取消选择」，
  // 有修饰键时它与当前值相同（调用方判重直接跳过）。
  opts.onSelect(base);

  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
    moved = true;

    const box = {
      l: Math.min(start.x, ev.clientX),
      t: Math.min(start.y, ev.clientY),
      r: Math.max(start.x, ev.clientX),
      b: Math.max(start.y, ev.clientY),
    };
    const a = opts.toLocal(start.x, start.y);
    const b = opts.toLocal(ev.clientX, ev.clientY);
    opts.onBox({
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    });
    opts.onSelect([...new Set([...base, ...hitsIn(box)])]);
  };

  const cleanup = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
    opts.onBox(null);
  };

  /*
   * 松手不需要再结算什么：选择在每次 pointermove 里已经写到最新，
   * 而「点空白取消选择」在按下时就生效了（见开头注释）。
   */
  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    cleanup();
  };

  const onCancel = (): void => {
    cleanup();
    opts.onSelect(orig);
  };

  /** Esc 中止这次框选，恢复到按下的那一刻（与片段拖拽的 Esc 同一约定）。 */
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    cleanup();
    opts.onSelect(orig);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey);
}
