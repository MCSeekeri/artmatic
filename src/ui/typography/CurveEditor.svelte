<script lang="ts">
  /**
   * CurveEditor — RGB 曲线的折线编辑器（色彩校正浮层里的一块画布）。
   *
   * 为什么是 canvas 而不是 SVG / DOM 点：控制点要能**随时增删**，SVG 的节点
   * 增删在拖动中途会打断 pointer capture。canvas 上一个 pointerdown 就能接管
   * 整段手势，松手才回到文档。
   *
   * 三条约定：
   *  - 坐标一律 **0..1**，y 向上（屏幕 y 要翻转）。存进文档的就是这个口径。
   *  - 曲线是**分段线性**插值（与 `image-effects.ts::curveLut` 逐字一致）：
   *    所见即所得，不会像样条那样在两点之间自己鼓出去。
   *  - 抬手才落撤销栈。拖动途中走 `onlive`（不入栈），否则拖一次曲线就是几十条记录。
   */
  import type { CurvePoint } from '../../typography/image-effects';

  interface Props {
    points: CurvePoint[];
    /** 曲线颜色（accent / 各通道本色）。 */
    color: string;
    /** 拖动中：连续写、不入撤销栈。 */
    onlive: (points: CurvePoint[]) => void;
    /** 拖动结束（把手势结算成一笔）。拖动途中已经 live 写过，这里不再写值。 */
    onend: () => void;
    /** 一次离散改动（点一下加点 / 右键删点）。 */
    oncommit: (points: CurvePoint[]) => void;
  }
  const { points, color, onlive, onend, oncommit }: Props = $props();

  const W = 236;
  const H = 132;
  const PAD = 6;

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  /** 手势期间的本地值：props 是**上一次提交**的结果，拖动途中不能依赖它。 */
  let dragPts = $state<CurvePoint[] | null>(null);
  /** 正在拖的是哪一个点（-1 = 没有）。 */
  let dragIndex = -1;
  let moved = false;

  /** 画布上的值：拖动中用本地，否则用 props（外部改动因此立刻可见）。 */
  const shown = $derived(dragPts ?? points);

  function cssVar(el: HTMLElement, name: string, fallback: string): string {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  }

  /** 0..1 → 画布像素（y 翻转）。 */
  function toPx(p: CurvePoint): { x: number; y: number } {
    return { x: PAD + p.x * (W - PAD * 2), y: PAD + (1 - p.y) * (H - PAD * 2) };
  }

  function toUnit(clientX: number, clientY: number): { x: number; y: number } {
    const cv = canvasEl;
    if (!cv) return { x: 0, y: 0 };
    const r = cv.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    // 先把**整个画布**映射到 0..1，再按内边距夹回绘图区。
    const px = PAD / W + (x * (W - PAD * 2)) / W;
    const py = PAD / H + (y * (H - PAD * 2)) / H;
    return {
      x: Math.max(0, Math.min(1, (px * W - PAD) / (W - PAD * 2))),
      y: Math.max(0, Math.min(1, 1 - (py * H - PAD) / (H - PAD * 2))),
    };
  }

  /** 采样 64 段画折线：与 curveLut 同一套线性插值，但没有 256 项的开销。 */
  function sampleY(list: CurvePoint[], x: number): number {
    if (!list.length) return x;
    const first = list[0]!;
    if (x <= first.x) return first.x > 0 ? (first.y * x) / first.x : first.y;
    const last = list[list.length - 1]!;
    if (x >= last.x) {
      return last.x < 1 ? last.y + ((1 - last.y) * (x - last.x)) / (1 - last.x) : last.y;
    }
    let i = 0;
    while (i < list.length - 2 && x > list[i + 1]!.x) i++;
    const a = list[i]!;
    const b = list[i + 1]!;
    const span = b.x - a.x;
    return span > 1e-6 ? a.y + ((b.y - a.y) * (x - a.x)) / span : a.y;
  }

  function draw(): void {
    const cv = canvasEl;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const grid = cssVar(cv, '--border', 'rgba(255,255,255,0.12)');
    const faint = cssVar(cv, '--border-strong', 'rgba(255,255,255,0.22)');
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = PAD + ((W - PAD * 2) * i) / 4;
      const y = PAD + ((H - PAD * 2) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(x, PAD);
      ctx.lineTo(x, H - PAD);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(W - PAD, y);
      ctx.stroke();
    }
    // 45° 参考线（= 不做任何调整）。
    ctx.strokeStyle = faint;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(PAD, H - PAD);
    ctx.lineTo(W - PAD, PAD);
    ctx.stroke();
    ctx.setLineDash([]);

    const list = shown;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      const p = toPx({ x, y: sampleY(list, x) });
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    const bg = cssVar(cv, '--surface-0', '#12131a');
    for (const pt of list) {
      const p = toPx(pt);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  $effect(() => {
    // 依赖：显示值 / 颜色 / 画布节点。
    void shown;
    void color;
    if (!canvasEl) return;
    draw();
  });

  function hitIndex(unit: { x: number; y: number }): number {
    const list = shown;
    // 用像素距离判定，避免 x/y 在画布上比例不同时手感不一致。
    const target = toPx(unit);
    let best = -1;
    let bestD = 9;
    for (let i = 0; i < list.length; i++) {
      const p = toPx(list[i]!);
      const d = Math.hypot(p.x - target.x, p.y - target.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function sorted(list: CurvePoint[]): CurvePoint[] {
    return [...list].sort((a, b) => a.x - b.x);
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const unit = toUnit(e.clientX, e.clientY);
    const hit = hitIndex(unit);
    moved = false;
    if (hit >= 0) {
      dragIndex = hit;
      dragPts = shown.map((p) => ({ ...p }));
    } else {
      // 空白处按下 = 加一个点，并立刻开始拖它。
      const added = { x: unit.x, y: unit.y };
      const next = sorted([...shown.map((p) => ({ ...p })), added]);
      dragIndex = next.indexOf(added);
      dragPts = next;
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (dragIndex < 0 || !dragPts) return;
    const unit = toUnit(e.clientX, e.clientY);
    const next = dragPts.map((p) => ({ ...p }));
    if (!next[dragIndex]) return;
    const moved0 = { x: unit.x, y: unit.y };
    next[dragIndex] = moved0;
    const ordered = sorted(next);
    dragIndex = ordered.indexOf(moved0);
    dragPts = ordered;
    moved = true;
    onlive(ordered);
  }

  function onPointerUp(e: PointerEvent): void {
    (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
    const list = dragPts;
    const wasMoved = moved;
    dragIndex = -1;
    dragPts = null;
    moved = false;
    if (!list) return;
    /*
     * 拖动过 ⇒ 途中已经 `onlive` 写过，这里只**结算手势**（`onend`）；
     * 纯点击 ⇒ 只写这一次（加点）。
     *
     * 拖动结束时**不能再 commit**：`editorState` 的约定是手势中途不许 commit
     * （每一步都会拍一次快照，一次拖曲线会塞满撤销栈）。
     */
    if (wasMoved) onend();
    else oncommit(list);
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const unit = toUnit(e.clientX, e.clientY);
    const hit = hitIndex(unit);
    if (hit < 0) return;
    oncommit(shown.filter((_, i) => i !== hit));
  }
</script>

<canvas
  bind:this={canvasEl}
  class="curve"
  width={W}
  height={H}
  data-testid="img-curve-canvas"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  oncontextmenu={onContextMenu}
></canvas>

<style>
  .curve {
    display: block;
    width: 236px;
    height: 132px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: crosshair;
    touch-action: none;
  }
</style>
