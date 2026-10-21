<script lang="ts">
  /**
   * NodeEditor — 图形控制点与路径顶点的画布层。
   *
   * 两种形态由**图形类型**决定，不由用户选：
   *  - 参数化图形（矩形 / 星形 / 扇形 / 圆环…）⇒ 显示**形状控制点**，
   *    拖它改的是参数（圆角 / 谷半径 / 壁厚 / 张角）；
   *  - 自定义路径（`svg`，含布尔运算结果与「转为路径」之后的图形）⇒ 显示
   *    **锚点 + 控制手柄**，拖它改的是路径数据。
   *
   * 这两者是各自独立的一层，不叠加显示：一个图形要么还是公式化的，要么已经是
   * 一串点。同时画两套把手的话，用户没法知道哪一层在响应。
   *
   * ## 坐标
   *
   * 几何定义在**元素局部坐标系**里（原点 = frame 左上角、未旋转）。
   * 屏幕上要两步：`localToDoc` 转成文档坐标，再乘 `zoom`（本层挂在
   * `.paper-wrap` 里，原点就是文档原点 —— 与 `SelectionLayer` 同一套约定）。
   *
   * 路径数据还多一层：`svg` 图形的 `path` 默认按 **0..100 authored**，渲染时由
   * `<g transform="scale(w/100, h/100)">` 拉到像素盒；文本转路径出来的
   * `pathUnit: 'px'` 则已经是像素。换算统一走 `pathUnitScale` —— 漏掉这一层
   * 的后果是「元素越接近正方形越准」，非等比时锚点整片漂到框外。
   */
  import { localToDoc } from '../../typography/geometry';
  import { pathUnitScale } from '../../typography/shapes';
  import { nearestOnPath, type PathHit, type SubPath, type Vec } from '../../typography/path-nodes';
  import type { ShapeHandle } from '../../typography/shape-handles';
  import type { ShapeElement } from '../../typography/document';
  import type { NodeDragTarget } from './gestures';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    el: ShapeElement;
    zoom: number;
    /**
     * 是否进入**路径顶点**模式。
     *
     * `false` 时只画形状控制点 —— 那是不需要任何模式的：控制点改的是图形的
     * 参数，和「拖右下角把手改尺寸」是同一层级的东西，选中就该能拖
     * （Illustrator 的实时形状手柄就是这个行为）。`true` 时才画锚点、控制手柄、
     * 虚线外框，并接管双击。
     */
    paths: boolean;
    /**
     * 路径结构与形状控制点**由父组件算好传进来**。
     *
     * 不在本组件里 `$derived(shapeHandles(el))`：元素是**原地改的普通对象**
     * （不是 runes 代理），直接读它的属性建立不起依赖 —— 转成路径之后
     * `shape` 从 `rect` 变成了 `svg`，这里的控制点却会**一直留在屏幕上**。
     * 父组件用 `void appState.version` 订阅文档变化，那是本项目里唯一有效的
     * 订阅方式（与 `selectionRects` 同源）。
     */
    subs: SubPath[];
    handles: ShapeHandle[];
    /** 屏幕坐标 → 文档坐标（与手势层用的是同一个函数）。 */
    toDoc: (e: { clientX: number; clientY: number }) => { x: number; y: number };
    onShapeHandle: (handle: ShapeHandle, e: PointerEvent) => void;
    onNodeDrag: (target: NodeDragTarget, e: PointerEvent) => void;
    onAddNode: (hit: Pick<PathHit, 'sub' | 'seg' | 't'>) => void;
    onDeleteNode: (index: number) => void;
  }
  const { el, zoom, paths, subs, handles, toDoc, onShapeHandle, onNodeDrag, onAddNode, onDeleteNode }: Props =
    $props();

  /** 命中半径（屏幕 px）：锚点本身只有 10px，直接点很容易打空。 */
  const HIT_PX = 12;

  /** 元素局部像素 → 屏幕。 */
  function screen(local: Vec): Vec {
    const d = localToDoc(el.frame, local);
    return { x: d.x * zoom, y: d.y * zoom };
  }

  /** 路径坐标 → 元素局部像素（percent 是 0..100 authored，px 是原样）。 */
  const unit = $derived(pathUnitScale(el));

  const fromAuthored = (p: Vec): Vec => ({ x: p.x * unit.x, y: p.y * unit.y });

  /** 屏幕 → 路径坐标（双击加减点时用来找最近的位置）。 */
  function toAuthoredScreen(e: { clientX: number; clientY: number }): Vec {
    const d = toDoc(e);
    const w = el.frame;
    // 逆着 localToDoc 走：先减原点、反旋转，再除以 pathUnit 的比例。
    const cx = w.w / 2;
    const cy = w.h / 2;
    const rot = w.rot ?? 0;
    const lx = d.x - w.x - cx;
    const ly = d.y - w.y - cy;
    const cos = Math.cos(-rot);
    const sin = Math.sin(-rot);
    const px = lx * cos - ly * sin + cx;
    const py = lx * sin + ly * cos + cy;
    return { x: px / Math.max(1e-6, unit.x), y: py / Math.max(1e-6, unit.y) };
  }

  const isPath = $derived(paths && el.shape === 'svg');

  /** 手柄连线的几何（从锚点指向控制点）。 */
  function link(a: Vec, b: Vec): { left: number; top: number; w: number; deg: number } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return { left: a.x, top: a.y, w: Math.hypot(dx, dy), deg: (Math.atan2(dy, dx) * 180) / Math.PI };
  }

  function down(target: NodeDragTarget | null, handle: ShapeHandle | null, e: PointerEvent): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (handle) onShapeHandle(handle, e);
    else if (target) onNodeDrag(target, e);
  }

  /**
   * 层上的双击 = 在最近的段上加点。
   *
   * 容差按**屏幕像素**折算成 authored：缩放很小的时候 authored 的一个单位
   * 对应不到一个屏幕像素，写死 authored 阈值会让「放大之后反而点不中」。
   */
  function onLayerDblClick(e: MouseEvent): void {
    if (!isPath) return;
    const pt = toAuthoredScreen(e);
    // 一个屏幕像素对应多少路径单位：percent 下按短边折算（与原来的口径一致），
    // px 下就是 1/zoom。
    const perPx = 1 / Math.max(1e-6, Math.min(unit.x, unit.y) * zoom);
    const hit = nearestOnPath(subs, pt, HIT_PX * perPx);
    if (hit) onAddNode({ sub: hit.sub, seg: hit.seg, t: hit.t });
  }
</script>

<!--
  `pointerdown` 上停掉冒泡：这一层铺在元素与选择框之上，点空白处若放任冒泡，
  viewport 会把它当成「点了空白」而清空选择 —— 而清空选择会顺手退出顶点编辑，
  表现就是「随便点一下画布，编辑态就没了」。退出交给 Escape。
-->
<div
  class="node-layer"
  class:capture={paths}
  data-testid="typo-node-layer"
  role="presentation"
  onpointerdown={(e) => e.stopPropagation()}
  ondblclick={onLayerDblClick}
>
  <!--
    虚线外框：顶点编辑态下**不显示**选择层（它的缩放把手会和锚点撞在一起 ——
    椭圆的四个锚点正好落在框边中点上，与 n / e / s / w 把手重合）。但没有框
    用户会失去「这个元素有多大」的参照，所以画一个不可交互的虚线轮廓补上。
  -->
  {#if paths}
    <i
      class="frame"
      style:left={`${el.frame.x * zoom}px`}
      style:top={`${el.frame.y * zoom}px`}
      style:width={`${el.frame.w * zoom}px`}
      style:height={`${el.frame.h * zoom}px`}
      style:transform={el.frame.rot ? `rotate(${(el.frame.rot * 180) / Math.PI}deg)` : undefined}
    ></i>
  {/if}

  {#if isPath}
    {#each subs as sp, si (si)}
      {#each sp.nodes as n, ni (ni)}
        {@const at = screen(fromAuthored(n))}
        {@const inPt = n.in ? screen(fromAuthored(n.in)) : null}
        {@const outPt = n.out ? screen(fromAuthored(n.out)) : null}

        {#if inPt}
          {@const l = link(at, inPt)}
          <i class="link" style:left={`${l.left}px`} style:top={`${l.top}px`} style:width={`${l.w}px`} style:transform={`rotate(${l.deg}deg)`}></i>
          <i
            class="knob"
            style:left={`${inPt.x}px`}
            style:top={`${inPt.y}px`}
            role="presentation"
            data-testid="typo-node-knob"
            data-side="in"
            onpointerdown={(e) => down({ kind: 'handle', sub: si, index: ni, side: 'in' }, null, e)}
          ></i>
        {/if}
        {#if outPt}
          {@const l = link(at, outPt)}
          <i class="link" style:left={`${l.left}px`} style:top={`${l.top}px`} style:width={`${l.w}px`} style:transform={`rotate(${l.deg}deg)`}></i>
          <i
            class="knob"
            style:left={`${outPt.x}px`}
            style:top={`${outPt.y}px`}
            role="presentation"
            data-testid="typo-node-knob"
            data-side="out"
            onpointerdown={(e) => down({ kind: 'handle', sub: si, index: ni, side: 'out' }, null, e)}
          ></i>
        {/if}

        <i
          class="node"
          style:left={`${at.x}px`}
          style:top={`${at.y}px`}
          role="presentation"
          data-testid="typo-node"
          title={tr('typo.nodeHint')}
          onpointerdown={(e) => down({ kind: 'anchor', sub: si, index: ni }, null, e)}
          ondblclick={(e) => {
            e.stopPropagation();
            onDeleteNode(ni);
          }}
        ></i>
      {/each}
    {/each}
  {/if}

  {#each handles as h (h.id)}
    {@const at = screen({ x: h.x, y: h.y })}
    <i
      class="grip"
      style:left={`${at.x}px`}
      style:top={`${at.y}px`}
      role="presentation"
      data-testid="typo-shape-handle"
      data-param={h.param}
      title={tr(h.labelKey)}
      onpointerdown={(e) => down(null, h, e)}
    ></i>
  {/each}
</div>

<style>
  /*
   * 容器本身**不吃**指针事件：只有锚点/手柄/控制点自己打开。否则顶点编辑态下
   * 整个画布都会被这层挡住，连缩放把手都点不到。
   */
  .node-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  /*
   * 顶点编辑态下整片接管指针：`pointer-events: none` 的容器**收不到**
   * dblclick —— 事件会穿透到它下面，「双击线段加点」于是完全没反应。
   * 这里本来也没有别的东西需要点（选择层在这个模式下不渲染）。
   */
  .node-layer.capture {
    pointer-events: auto;
  }
  .node,
  .knob,
  .grip {
    position: absolute;
    pointer-events: auto;
    transform: translate(-50%, -50%);
  }
  .frame {
    position: absolute;
    border: 1px dashed var(--accent);
    opacity: 0.45;
    pointer-events: none;
    /* 与 `elementStyle` 的元素旋转同一套原点。 */
    transform-origin: 50% 50%;
  }
  /* 锚点：方块。与选择把手（同样是方块）区分开的是它的填充色。 */
  .node {
    width: 9px;
    height: 9px;
    background: var(--accent);
    border: 1px solid var(--surface-0);
    cursor: move;
  }
  .node::after {
    content: '';
    position: absolute;
    inset: -4px;
  }
  /* 控制手柄：圆点。形状上就不一样，一眼能分出「这是手柄不是锚点」。 */
  .knob {
    width: 7px;
    height: 7px;
    background: var(--surface-0);
    border: 1px solid var(--accent);
    border-radius: 50%;
    cursor: grab;
  }
  .knob::after {
    content: '';
    position: absolute;
    inset: -5px;
  }
  .link {
    position: absolute;
    height: 1px;
    background: var(--accent);
    transform-origin: 0 50%;
    pointer-events: none;
    opacity: 0.7;
  }
  /* 形状控制点：菱形。与「锚点 / 手柄」都不同的第三种形态 —— 它改的是参数，
     而前两者改的是路径数据，视觉上必须分得开。 */
  .grip {
    width: 9px;
    height: 9px;
    background: var(--surface-0);
    border: 1px solid var(--accent);
    transform: translate(-50%, -50%) rotate(45deg);
    cursor: grab;
  }
  .grip::after {
    content: '';
    position: absolute;
    inset: -4px;
  }
</style>
