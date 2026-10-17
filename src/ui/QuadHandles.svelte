<script lang="ts">
  /**
   * QuadHandles — 预览画面上的「四角调整」手柄层（4 个角 + 4 个边中点 + 四边形描边）。
   *
   * ## 坐标只算一次、只共一份
   *
   * 手柄位置 = `core/quad.ts` 的 `layerUvToFrameUv`（层空间 → 画面 uv）+
   * canvas 的 `getBoundingClientRect()`；图层默认矩形尺寸用
   * `engine/placement.frag.ts::drawSizeFor`（与合成同源），源尺寸取
   * `Project.assets[assetId].size`。**不在 UI 里另写一套 fit / transform 数学** ——
   * 与渲染差半像素的形态是「手柄看着对、拖出来画面偏」，而且没有任何报错。
   *
   * ## 坐标约定（所有 uv 都是**左上原点、v 向下**）
   *
   * `QuadCorners` 的层空间、帧 uv、层 uv 三者统一为左上原点。UI **不感知** GL 的
   * v 向上空间 —— 那层桥接在 `core/quad.ts` 与 `placement.frag.ts` 内部完成。
   * 所以下面的 `toLocal(u, v)` 直接把 v 当屏幕向下用，`clientToLayer` 的
   * `(clientY - top) / height` 也直接当 v；**不要自己再加 1 − v**。
   *
   * ## 手势纪律（见 src/ui/AGENTS.md「预览画面上的叠加控件」）
   *
   * - pointerdown 必须 `preventDefault()` + `stopPropagation()`：Preview 的
   *   「横向拖 = 两帧并排」会抢走这个手势。
   * - 拖动是**一笔撤销**：`beginTx()` → pointermove 里原地改 `clip.quad` +
   *   `store.touch()` → pointerup `endTx()`。pointercancel / Esc / 卸载一律
   *   `cancelTx()` + `registerGestureCancel(null)` —— 绝不能留下悬空的 beginTx
   *   （切工程时 `pendingGestureCancel` 会兜底，但那是事故路径）。
   * - 覆盖层本体 `pointer-events: none`，只有手柄本身 `auto`。
   *
   * ## 为什么是覆盖层而不是改 canvas
   *
   * `<canvas>` 一旦卸载会丢 WebGL 上下文（不可恢复），所以手柄叠加在它上面，
   * 不碰画布本身。也因此这里**不能用 transform / filter**：它们会让祖先成为
   * `position: fixed` 后代的包含块（见 src/ui/AGENTS.md 的浮层坑）。
   */
  import { onDestroy } from 'svelte';
  import { appState } from './app-state.svelte';
  import { drawSizeFor } from '../engine/placement.frag';
  import { frameUvToLayerUv, layerUvToFrameUv, type PlacementAffine } from '../core/quad';
  import type { QuadCorners } from '../core/schema';
  import { tr } from '../i18n/index.svelte';

  interface Props {
    /**
     * 预览 GL 画布与包住它的相对定位容器。
     *
     * 允许 null：`bind:this` 的类型上要能表达「还没挂上」那一瞬间（实际由模板
     * 创建顺序保证子组件挂载时两者都已在）。
     */
    canvas: HTMLCanvasElement | null;
    stage: HTMLElement | null;
  }
  const { canvas, stage }: Props = $props();

  type CornerKey = 'tl' | 'tr' | 'br' | 'bl';
  type EdgeKey = 'top' | 'right' | 'bottom' | 'left';
  /** 手柄是命中目标，不参与布局；半径用 stage 局部 CSS px（SVG 用户单位 = px）。 */
  const CORNER_R = 5;
  const EDGE_R = 4;
  /** 四角坐标的合法范围。拖出去太远就找不回来了，所以夹住（契约值 -3..4）。 */
  const QUAD_MIN = -3;
  const QUAD_MAX = 4;
  /** 边中点手柄拖动时「平移这条边的两个角」。 */
  const EDGE_CORNERS: Record<EdgeKey, [CornerKey, CornerKey]> = {
    top: ['tl', 'tr'],
    right: ['tr', 'br'],
    bottom: ['br', 'bl'],
    left: ['bl', 'tl'],
  };

  interface Point {
    x: number;
    y: number;
  }

  /**
   * 一次测量出来的手柄几何（stage 局部 CSS px）。
   *
   * `affine` / `canvasRect` 是拖动换算要用的同一次测量快照：拖动期间 transform
   * 不会被别处改（那是另一套手势），所以按下时缓存一份即可；每秒重测只会让
   * 「按下的那一刻」与「中途窗口缩放」之间产生半像素级偏差，不值得为此每帧重算。
   */
  interface Geometry {
    corners: Record<CornerKey, Point>;
    edges: Record<EdgeKey, Point>;
    polygon: string;
    affine: PlacementAffine;
    canvasRect: DOMRect;
  }

  /**
   * 尺寸 / 位置变化的计数（RO / window resize / 全屏时 +1，驱动下面的派生重测）。
   *
   * ⚠️ **必须是「普通 let 计数 + 赋值」而不是 `geomTick += 1`**：下面那个 `$effect`
   * 会在体内调 `bump()`，而 `geomTick += 1` 会**读**同一个 `$state` —— effect 由此
   * 依赖自己写的状态，进入无限自触发（Svelte 每轮跑满 1000 次才抛
   * `effect_update_depth_exceeded`），整页掉到 1~2 FPS。
   * 因此计数放在非响应式的 `geomSeq` 上，`geomTick` 只被**赋值**、不被读。
   */
  let geomSeq = 0;
  let geomTick = $state(0);

  /**
   * 预览 resize、全屏、窗口缩放都要重算手柄位置。
   *
   * 观察 canvas 与 stage 两个元素：canvas 的显示盒由 renderer 在 RO 里重设，
   * stage 只在窗口/抽屉变化时变；两者少看一个都会让手柄「慢半拍」。
   */
  $effect(() => {
    const c = canvas;
    const s = stage;
    if (!c || !s) return;
    const bump = (): void => {
      // 先在外层普通变量上自增，再赋给 $state —— 这里**不许**出现 `geomTick += 1`
      // （读自己写的状态 = 无限自触发，见字段注释）。
      geomSeq += 1;
      geomTick = geomSeq;
    };
    // 首次测量：derive 里已经能读到 canvas/stage，但尺寸要等布局稳定；
    // 这个 effect 在 DOM 更新后运行，正好是能量 rect 的时刻。
    bump();
    const ro = new ResizeObserver(bump);
    ro.observe(c);
    ro.observe(s);
    window.addEventListener('resize', bump);
    document.addEventListener('fullscreenchange', bump);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', bump);
      document.removeEventListener('fullscreenchange', bump);
    };
  });

  /**
   * 当前要显示的手柄几何。`null` = 不显示：
   * 没选中 / 选中不是 image|video 的 source 片段 / 没开四角 / 正在两帧并排预览。
   *
   * ⚠️ 这里的 `void appState.version` 与 `void geomTick` 都是**必须的**：
   * `clip` 是 store 里的普通对象、原地改（拖动时每 move 改一次引用不变），
   * 而 `findClip` 读的是 `ProjectStore` 实例字段 —— 类实例的字段读取不产生
   * 响应式依赖。没有这两个 `void`，手柄会在拖动时纹丝不动且不报任何错
   * （见 src/ui/AGENTS.md「界面实时性」）。
   */
  const geom = $derived.by((): Geometry | null => {
    void appState.version;
    void geomTick;
    const c = canvas;
    const s = stage;
    if (!c || !s) return null;
    if (!appState.hasProject || appState.splitVisible) return null;
    const clipId = appState.selectedClipId;
    if (!clipId) return null;
    const found = appState.store.findClip(clipId);
    if (!found || found.clip.kind !== 'source') return null;
    const clip = found.clip;
    /*
     * 引擎对任意源生效（placement pass 不分源类型），但 UI 只对图片 / 视频开放：
     * 算法 / 纯色 / 文本源的「默认图层矩形」含义不直观，TODO 的需求也只是图片。
     */
    if (clip.source.type !== 'image' && clip.source.type !== 'video') return null;
    const quad = clip.quad;
    if (!quad) return null;

    const project = appState.project;
    const frameW = project.resolution.w;
    const frameH = project.resolution.h;
    const asset = project.assets[clip.source.assetId];
    /*
     * 源尺寸取素材台账。**没有 size 时退化成帧尺寸**：这是「素材刚登记、台账
     * 还没写尺寸」那一瞬间的事（画面上本来也还没有这张图），此时让手柄按帧
     * 尺寸出现（可拖）比整块消失好；尺寸一落库，派生会因为 version 变化重算。
     */
    const srcW = asset?.size?.w ?? frameW;
    const srcH = asset?.size?.h ?? frameH;
    /*
     * sx / sy 取 transform 的**基值**（不采样曲线）：四角手柄是编辑辅助，
     * 曲线驱动的动画在画面上每帧都在动，手柄跟着飞反而没法拖。契约如此。
     */
    const [drawW, drawH] = drawSizeFor(
      clip.fit,
      frameW,
      frameH,
      srcW,
      srcH,
      clip.transform.sx,
      clip.transform.sy,
    );
    const affine: PlacementAffine = {
      frameW,
      frameH,
      drawW,
      drawH,
      cx: clip.transform.x,
      cy: clip.transform.y,
      rot: clip.transform.rot,
    };

    const canvasRect = c.getBoundingClientRect();
    const stageRect = s.getBoundingClientRect();
    // 画面被隐藏（零尺寸）时不显示：否则所有手柄会叠在 (0,0) 上。
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;

    /** 帧 uv → stage 局部像素：canvas 的显示盒相对 stage 的偏移 + 归一化坐标 × 显示尺寸。
     *  uv 是左上原点、v 向下，与屏幕坐标同向，所以 v 直接乘高度、不加 1 − v。 */
    const toLocal = (u: number, v: number): Point => ({
      x: canvasRect.left - stageRect.left + u * canvasRect.width,
      y: canvasRect.top - stageRect.top + v * canvasRect.height,
    });
    /** 层空间点 → stage 局部像素（与渲染同一份数学：layerUvToFrameUv）。 */
    const at = (lu: number, lv: number): Point => {
      const [u, v] = layerUvToFrameUv(affine, lu, lv);
      return toLocal(u, v);
    };

    const corners: Record<CornerKey, Point> = {
      tl: at(quad.tl[0], quad.tl[1]),
      tr: at(quad.tr[0], quad.tr[1]),
      br: at(quad.br[0], quad.br[1]),
      bl: at(quad.bl[0], quad.bl[1]),
    };
    const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const edges: Record<EdgeKey, Point> = {
      top: mid(corners.tl, corners.tr),
      right: mid(corners.tr, corners.br),
      bottom: mid(corners.br, corners.bl),
      left: mid(corners.bl, corners.tl),
    };
    // 四边形描边 = 四角按 tl → tr → br → bl 连起来（与渲染的角对应关系一致）。
    const polygon = [corners.tl, corners.tr, corners.br, corners.bl]
      .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ');

    return { corners, edges, polygon, affine, canvasRect };
  });

  /* ------------------------------------------------------------------ 手势 */

  interface DragState {
    clipId: string;
    handle: { kind: 'corner'; key: CornerKey } | { kind: 'edge'; key: EdgeKey };
    /** 按下瞬间的四角（深拷）：拖动是「相对起点」的，不回读中途被改过的值。 */
    startQuad: QuadCorners;
    /** 按下瞬间的层空间 uv。 */
    startLayer: [number, number];
    /** 按下瞬间的仿射参数（见 Geometry.affine 的注释）。 */
    affine: PlacementAffine;
    /** 是否已经真的移动过（没动过的一次点击不该入撤销栈 —— endTx 自己也会判）。 */
    moved: boolean;
  }

  /** 普通 let：只在事件处理里读写，不需要驱动模板。 */
  let drag: DragState | null = null;

  function cloneQuad(q: QuadCorners): QuadCorners {
    return { tl: [...q.tl], tr: [...q.tr], br: [...q.br], bl: [...q.bl] };
  }

  function clampQuad(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.min(QUAD_MAX, Math.max(QUAD_MIN, v));
  }

  /** client 坐标 → 层空间 uv。canvas 的显示盒才是用户看到的那块画面。
   *  帧 uv 是左上原点、v 向下，与 `(clientY - top)/height` 同向 —— 直接传，不翻 v。 */
  function clientToLayer(
    c: HTMLCanvasElement,
    affine: PlacementAffine,
    clientX: number,
    clientY: number,
  ): [number, number] | null {
    const r = c.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return frameUvToLayerUv(affine, (clientX - r.left) / r.width, (clientY - r.top) / r.height);
  }

  function beginDrag(
    e: PointerEvent,
    handle: DragState['handle'],
  ): void {
    if (e.button !== 0) return;
    const g = geom;
    const c = canvas;
    if (!g || !c) return;
    // 先吞掉事件：否则 Preview 的「横向拖 = 两帧并排」会同时开一个手势。
    e.preventDefault();
    e.stopPropagation();

    const clipId = appState.selectedClipId;
    if (!clipId) return;
    const found = appState.store.findClip(clipId);
    if (!found || found.clip.kind !== 'source' || !found.clip.quad) return;
    const layer = clientToLayer(c, g.affine, e.clientX, e.clientY);
    if (!layer) return;

    appState.store.beginTx();
    drag = {
      clipId,
      handle,
      startQuad: cloneQuad(found.clip.quad),
      startLayer: layer,
      affine: g.affine,
      moved: false,
    };
    // 切工程 / 关排版页时由 appState 统一兜底取消（绝不能让 beginTx 悬空）。
    appState.registerGestureCancel(cancelDrag);
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('keydown', onKeyDown, true);
  }

  function moveDrag(e: PointerEvent): void {
    const d = drag;
    const c = canvas;
    if (!d || !c) return;
    e.preventDefault();
    const layer = clientToLayer(c, d.affine, e.clientX, e.clientY);
    if (!layer) return;
    const found = appState.store.findClip(d.clipId);
    if (!found || found.clip.kind !== 'source' || !found.clip.quad) return;
    const quad = found.clip.quad;

    const dx = layer[0] - d.startLayer[0];
    const dy = layer[1] - d.startLayer[1];
    if (d.handle.kind === 'corner') {
      const start = d.startQuad[d.handle.key];
      quad[d.handle.key] = [clampQuad(start[0] + dx), clampQuad(start[1] + dy)];
    } else {
      // 边中点：**平移这条边的两个角**（层空间加同一个 delta）。
      const [a, b] = EDGE_CORNERS[d.handle.key];
      quad[a] = [clampQuad(d.startQuad[a][0] + dx), clampQuad(d.startQuad[a][1] + dy)];
      quad[b] = [clampQuad(d.startQuad[b][0] + dx), clampQuad(d.startQuad[b][1] + dy)];
    }
    d.moved = true;
    // 手势内的实时重绘：version++ 但不产生撤销记录（整段手势最后只有一条）。
    appState.store.touch();
  }

  function detach(): void {
    drag = null;
    window.removeEventListener('pointermove', moveDrag);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', cancelDrag);
    window.removeEventListener('keydown', onKeyDown, true);
    appState.registerGestureCancel(null);
  }

  function endDrag(): void {
    if (!drag) return;
    const moved = drag.moved;
    detach();
    // 没有真的移动过（一次纯点击）：丢弃事务，免得撤销栈多一条空记录。
    if (moved) appState.store.endTx(tr('insp.quadAdjust'));
    else appState.store.cancelTx();
  }

  /** Esc / pointercancel / 切工程：回滚到手势起点。 */
  function cancelDrag(): void {
    if (!drag) return;
    detach();
    appState.store.cancelTx();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !drag) return;
    // 拖动中 Esc = 取消这次拖动；别让 Esc 顺带做别的（如取消取色）。
    e.preventDefault();
    e.stopPropagation();
    cancelDrag();
  }

  onDestroy(() => {
    if (!drag) return;
    detach();
    /*
     * 组件在拖动中被卸载（切视图 / 热更新）时也必须收尾。卸载回调可能跑在
     * Svelte 的 flush 里，同步写 rune 有 state_unsafe_mutation 的风险，所以
     * 挪到微任务；用户手势不可能插在两个微任务之间，不会误伤下一个事务。
     */
    queueMicrotask(() => appState.store.cancelTx());
  });
</script>

{#if geom}
  {@const g = geom}
  <!--
    覆盖层本体不吃指针（画面点击照常穿过去），只有手柄本身 pointer-events: auto。
    不用 transform / filter：它们会让祖先成为 fixed 后代的包含块（浮层坑）。
  -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <svg class="quad-overlay" data-testid="quad-overlay" aria-hidden="true">
    <polygon class="quad-shape" points={g.polygon} />
    <circle
      class="quad-handle quad-handle-corner"
      cx={g.corners.tl.x}
      cy={g.corners.tl.y}
      r={CORNER_R}
      data-testid="quad-handle-tl"
      onpointerdown={(e) => beginDrag(e, { kind: 'corner', key: 'tl' })} />
    <circle
      class="quad-handle quad-handle-corner"
      cx={g.corners.tr.x}
      cy={g.corners.tr.y}
      r={CORNER_R}
      data-testid="quad-handle-tr"
      onpointerdown={(e) => beginDrag(e, { kind: 'corner', key: 'tr' })} />
    <circle
      class="quad-handle quad-handle-corner"
      cx={g.corners.br.x}
      cy={g.corners.br.y}
      r={CORNER_R}
      data-testid="quad-handle-br"
      onpointerdown={(e) => beginDrag(e, { kind: 'corner', key: 'br' })} />
    <circle
      class="quad-handle quad-handle-corner"
      cx={g.corners.bl.x}
      cy={g.corners.bl.y}
      r={CORNER_R}
      data-testid="quad-handle-bl"
      onpointerdown={(e) => beginDrag(e, { kind: 'corner', key: 'bl' })} />
    <circle
      class="quad-handle quad-handle-edge"
      cx={g.edges.top.x}
      cy={g.edges.top.y}
      r={EDGE_R}
      data-testid="quad-handle-edge-top"
      onpointerdown={(e) => beginDrag(e, { kind: 'edge', key: 'top' })} />
    <circle
      class="quad-handle quad-handle-edge"
      cx={g.edges.right.x}
      cy={g.edges.right.y}
      r={EDGE_R}
      data-testid="quad-handle-edge-right"
      onpointerdown={(e) => beginDrag(e, { kind: 'edge', key: 'right' })} />
    <circle
      class="quad-handle quad-handle-edge"
      cx={g.edges.bottom.x}
      cy={g.edges.bottom.y}
      r={EDGE_R}
      data-testid="quad-handle-edge-bottom"
      onpointerdown={(e) => beginDrag(e, { kind: 'edge', key: 'bottom' })} />
    <circle
      class="quad-handle quad-handle-edge"
      cx={g.edges.left.x}
      cy={g.edges.left.y}
      r={EDGE_R}
      data-testid="quad-handle-edge-left"
      onpointerdown={(e) => beginDrag(e, { kind: 'edge', key: 'left' })} />
  </svg>
{/if}

<style>
  /* 覆盖层铺满 stage：`inset: 0` + 100% 保证 SVG 用户单位 = stage 的 CSS px。
     位置全部由 cx / cy 表达，不给任何祖先加 transform / filter。 */
  .quad-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .quad-shape {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .quad-handle {
    fill: var(--surface-0);
    stroke: var(--accent);
    stroke-width: 1.5;
    pointer-events: auto;
    cursor: move;
    /* 触屏上按住手柄拖动时不要滚动页面 */
    touch-action: none;
  }
  .quad-handle:hover {
    fill: var(--accent);
  }
  .quad-handle-edge {
    stroke-width: 1.2;
  }
</style>
