<script lang="ts">
  /**
   * QuadEditLayer — 排版舞台上图片元素的**四角透视**手柄层。
   *
   * 与时间轴那边的 `ui/QuadHandles.svelte` 是同一套语义（4 个角 + 4 个边中点、
   * 拖边中点 = 平移这条边的两个角、拖动是一笔撤销），差别只在坐标系：
   *  - 那边是「预览画布上的帧 uv」，坐标来自 `layerUvToFrameUv` + canvas rect；
   *  - 这边是**文档坐标系**：手柄位置 = `frame` 四角经 `rot` 旋转 × `zoom`。
   *
   * 三层各管一段，不要互相替代：
   *  1. `core/quad.ts` —— 单应数学与恒等判据（数据语义）；
   *  2. `typography/image-fx.ts` —— 渲染（H⁻¹ 重采样）；
   *  3. 这里 —— 只是把四角画出来、把手势换算成 `El.quad`。
   *
   * 为什么手柄相对**旋转后**的框定位：`frame.rot` 是元素外壳的 CSS 旋转，
   * 四角在层空间（未旋转的矩形里）。画在未旋转位置上的话，转 30° 的图片
   * 会看到手柄浮在画外 —— 用户拖的是「画面上的那个角」，不是数据里的 uv。
   */
  import { onDestroy } from 'svelte';
  import { appState } from '../app-state.svelte';
  import { editorState } from './editor-state.svelte';
  import { identityQuad, type QuadCorners } from '../../core/image-fx';
  import type { ImageElement } from '../../typography/document';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    el: ImageElement;
    zoom: number;
    /** client 坐标 → 文档坐标（编辑器提供；含 paper 的滚动与缩放）。 */
    toDoc: (e: PointerEvent) => { x: number; y: number };
    /** 退出四角模式（面板按钮 / Esc）。 */
    onExit: () => void;
  }
  const { el, zoom, toDoc, onExit }: Props = $props();

  type CornerKey = 'tl' | 'tr' | 'br' | 'bl';
  type EdgeKey = 'top' | 'right' | 'bottom' | 'left';

  /** 手柄是命中目标，半径按屏幕 px（不随 zoom 缩放，与 SelectionLayer 同款）。 */
  const CORNER_R = 5;
  const EDGE_R = 4;
  /** 与时间轴手柄同一组夹取范围（见 `ui/QuadHandles.svelte` 的 QUAD_MIN/MAX）。 */
  const QUAD_MIN = -3;
  const QUAD_MAX = 4;
  const EDGE_CORNERS: Record<EdgeKey, [CornerKey, CornerKey]> = {
    top: ['tl', 'tr'],
    right: ['tr', 'br'],
    bottom: ['br', 'bl'],
    left: ['bl', 'tl'],
  };
  const CORNERS: CornerKey[] = ['tl', 'tr', 'br', 'bl'];
  const EDGES: EdgeKey[] = ['top', 'right', 'bottom', 'left'];

  interface Point {
    x: number;
    y: number;
  }

  /** 文档坐标里的四角（含 rot、含 zoom）。`version` 是必须的依赖，见 AGENTS §7。 */
  const cornersDoc = $derived.by((): Record<CornerKey, Point> => {
    void appState.version;
    void zoom;
    const q = el.quad ?? identityQuad();
    const f = el.frame;
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const c = Math.cos(f.rot);
    const s = Math.sin(f.rot);
    const at = (uv: [number, number]): Point => {
      const px = f.x + uv[0] * f.w;
      const py = f.y + uv[1] * f.h;
      if (!f.rot) return { x: px, y: py };
      return { x: cx + (px - cx) * c - (py - cy) * s, y: cy + (px - cx) * s + (py - cy) * c };
    };
    return { tl: at(q.tl), tr: at(q.tr), br: at(q.br), bl: at(q.bl) };
  });

  const cornersPx = $derived.by((): Record<CornerKey, Point> => {
    const c = cornersDoc;
    return {
      tl: { x: c.tl.x * zoom, y: c.tl.y * zoom },
      tr: { x: c.tr.x * zoom, y: c.tr.y * zoom },
      br: { x: c.br.x * zoom, y: c.br.y * zoom },
      bl: { x: c.bl.x * zoom, y: c.bl.y * zoom },
    };
  });

  const edgesPx = $derived.by((): Record<EdgeKey, Point> => {
    const c = cornersPx;
    const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    return {
      top: mid(c.tl, c.tr),
      right: mid(c.tr, c.br),
      bottom: mid(c.br, c.bl),
      left: mid(c.bl, c.tl),
    };
  });

  const polygon = $derived(
    [cornersPx.tl, cornersPx.tr, cornersPx.br, cornersPx.bl]
      .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' '),
  );

  /* ------------------------------------------------------------------ 手势 */

  interface DragState {
    handle: { kind: 'corner'; key: CornerKey } | { kind: 'edge'; key: EdgeKey };
    startQuad: QuadCorners;
    /** 按下瞬间的层空间 uv。 */
    startLayer: [number, number];
    moved: boolean;
  }
  let drag: DragState | null = null;

  function cloneQuad(q: QuadCorners): QuadCorners {
    return { tl: [...q.tl], tr: [...q.tr], br: [...q.br], bl: [...q.bl] };
  }

  function clampQuad(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.min(QUAD_MAX, Math.max(QUAD_MIN, v));
  }

  /**
   * 文档坐标 → 元素层空间 uv。
   *
   * 元素本地坐标 = 文档点绕 `frame` 中心反旋转；再除以框尺寸、加回 0.5。
   * 反旋转用 `Rᵀ`：正向是 `[c,-s; s,c]`，逆向就是 `[c,s; -s,c]` —— 写反的表现
   * 是「转过的元素上手柄跟着走反方向」，只要元素转过一次就一定看得见。
   */
  function docToLayer(doc: { x: number; y: number }): [number, number] {
    const f = el.frame;
    const dx0 = doc.x - (f.x + f.w / 2);
    const dy0 = doc.y - (f.y + f.h / 2);
    const c = Math.cos(f.rot);
    const s = Math.sin(f.rot);
    const dx = dx0 * c + dy0 * s;
    const dy = -dx0 * s + dy0 * c;
    return [dx / Math.max(1, f.w) + 0.5, dy / Math.max(1, f.h) + 0.5];
  }

  function beginDrag(e: PointerEvent, handle: DragState['handle']): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const cur = el.quad;
    if (!cur) return;
    editorState.beginGesture();
    drag = {
      handle,
      startQuad: cloneQuad(cur),
      startLayer: docToLayer(toDoc(e)),
      moved: false,
    };
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('keydown', onKeyDown, true);
  }

  function moveDrag(e: PointerEvent): void {
    const d = drag;
    if (!d) return;
    e.preventDefault();
    const layer = docToLayer(toDoc(e));
    const dx = layer[0] - d.startLayer[0];
    const dy = layer[1] - d.startLayer[1];
    const next = cloneQuad(d.startQuad);
    if (d.handle.kind === 'corner') {
      const at = d.startQuad[d.handle.key];
      next[d.handle.key] = [clampQuad(at[0] + dx), clampQuad(at[1] + dy)];
    } else {
      const [a, b] = EDGE_CORNERS[d.handle.key];
      next[a] = [clampQuad(d.startQuad[a][0] + dx), clampQuad(d.startQuad[a][1] + dy)];
      next[b] = [clampQuad(d.startQuad[b][0] + dx), clampQuad(d.startQuad[b][1] + dy)];
    }
    d.moved = true;
    const id = el.id;
    editorState.live((doc) => {
      const target = doc.elements.find((x) => x.id === id);
      if (target && target.kind === 'image') target.quad = next;
    });
  }

  function detach(): void {
    drag = null;
    window.removeEventListener('pointermove', moveDrag);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', cancelDrag);
    window.removeEventListener('keydown', onKeyDown, true);
  }

  function endDrag(): void {
    if (!drag) return;
    const moved = drag.moved;
    detach();
    // 纯点击（没位移）不该留一条空撤销记录。
    if (moved) editorState.endGesture(tr('typo.undo.quad'));
    else editorState.cancelGesture();
  }

  function cancelDrag(): void {
    if (!drag) return;
    detach();
    editorState.cancelGesture();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    // 拖动中 = 取消这次拖动；不在拖动 = 退出四角模式（与时间轴手柄同一套）。
    if (drag) cancelDrag();
    else onExit();
  }

  onDestroy(() => {
    if (!drag) return;
    detach();
    // 卸载回调可能跑在 flush 里，同步写 store 有 state_unsafe_mutation 的风险。
    queueMicrotask(() => {
      if (editorState.gestureActive) editorState.cancelGesture();
    });
  });
</script>

<!--
  手柄层本体不吃指针（画面上的点选照常穿过去）；只有手柄本身 `pointer-events: auto`。
  SVG 不设 viewBox ⇒ 用户单位 = 覆盖层的 CSS px（= 文档坐标 × zoom）。
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<svg class="typo-quad-layer" data-testid="typo-quad-layer" aria-hidden="true">
  <polygon class="typo-quad-shape" points={polygon} />
  {#each CORNERS as key (key)}
    <circle
      class="typo-quad-handle typo-quad-corner"
      cx={cornersPx[key].x}
      cy={cornersPx[key].y}
      r={CORNER_R}
      data-testid={`typo-quad-corner-${key}`}
      onpointerdown={(e) => beginDrag(e, { kind: 'corner', key })} />
  {/each}
  {#each EDGES as key (key)}
    <circle
      class="typo-quad-handle typo-quad-edge"
      cx={edgesPx[key].x}
      cy={edgesPx[key].y}
      r={EDGE_R}
      data-testid={`typo-quad-edge-${key}`}
      onpointerdown={(e) => beginDrag(e, { kind: 'edge', key })} />
  {/each}
</svg>

<style>
  .typo-quad-layer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .typo-quad-shape {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .typo-quad-handle {
    fill: var(--surface-0);
    stroke: var(--accent);
    stroke-width: 1.5;
    pointer-events: auto;
    cursor: move;
    touch-action: none;
  }
  .typo-quad-handle:hover {
    fill: var(--accent);
  }
  .typo-quad-edge {
    stroke-width: 1.2;
  }
</style>
