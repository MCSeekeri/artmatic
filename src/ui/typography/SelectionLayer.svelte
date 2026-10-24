<script lang="ts">
  /**
   * SelectionLayer — 选区框 + 缩放把手 + 旋转把手（+ 小元素时的移动握柄）。
   *
   * 坐标全部是 **文档坐标 × zoom**：它挂在 .overlay 里，而 .overlay 的原点
   * 就是 paper-wrap 的原点（也就是文档的 (0,0)），所以不需要再补任何偏移。
   *
   * 把手画在**未旋转外接框**上，与几何层的吸附/对齐用同一个框 —— 如果这里
   * 按旋转后的 AABB 画，就会出现「把手看着在左边、拖起来却往右上跑」。
   */
  import Icon from '../Icon.svelte';
  import { HANDLES, type HandleId } from '../../typography/geometry';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    /** `rot` 只在单选时有意义（多选用整个选区的 AABB，角度为 0）。 */
    rect: { x: number; y: number; w: number; h: number; rot: number } | null;
    zoom: number;
    /**
     * 正在编辑这个元素的文本（单选且 `editingTextId` 指向它）。
     *
     * 此时框的**内部**必须让出指针事件：文本是 contenteditable，单击要落到
     * 文字上放光标。原来整个框都盖在上面并吞掉 pointerdown，于是「编辑开着
     * 但光标挪不动，一点就退回选中框」—— 那正是 Office 里单击**边框**才有的
     * 行为。所以编辑态只保留一圈 6px 的边框环（+ 缩放把手）可拖。
     */
    editing?: boolean;
    /**
     * 四角调整模式：**只留外框**，不画 8 个缩放把手与旋转把手。
     *
     * 四角手柄会落在框的四个角上，与缩放把手**完全重合** —— 两套同时显示时
     * 用户分不清拖的是「缩放」还是「透视」。模式切换是显式的（属性面板的
     * 「在画布上调整」），所以这里不需要再猜。
     */
    quadEdit?: boolean;
    onMove: (e: PointerEvent) => void;
    onHandle: (handle: HandleId, e: PointerEvent) => void;
    onRotate: (e: PointerEvent) => void;
  }
  const { rect, zoom, editing = false, quadEdit = false, onMove, onHandle, onRotate }: Props =
    $props();

  /** 弧度 → CSS。与 elementStyle 用同一套角度约定，绕中心转（默认 transform-origin）。 */
  const rotCss = $derived(rect?.rot ? `rotate(${(rect.rot * 180) / Math.PI}deg)` : undefined);

  /** 编辑态下的边框环：四条 6px 的带，命中即起移动手势（= 选中文本框本身）。 */
  const EDGES = ['n', 's', 'w', 'e'] as const;

  const CORNERS = new Set<HandleId>(['nw', 'ne', 'se', 'sw']);

  /**
   * 选中框在屏幕上的尺寸（px）。把手是 7px 视觉 + 4px 命中环 ≈ 15px，
   * 两个把手中心相距不到 30px 时命中区就开始互相吃 —— 那时用户既点不准把手，
   * 也抓不到框内部（整块被把手盖住了）。
   */
  const wpx = $derived((rect?.w ?? 0) * zoom);
  const hpx = $derived((rect?.h ?? 0) * zoom);
  const NARROW_PX = 30;
  /** 上下两个中点把手（n / s）横向挨太近 → 去掉，只留四角。 */
  const narrowX = $derived(wpx > 0 && wpx < NARROW_PX);
  /** 左右两个中点把手（e / w）纵向挨太近 → 去掉。 */
  const narrowY = $derived(hpx > 0 && hpx < NARROW_PX);

  /**
   * 实际画出来的把手：**四角永远在**，中点按对应轴是否够宽决定。
   * 轴各自判定而不是「小就全去掉」：细长条（200×6 的分隔线）仍需要左右中点
   * 调长度，一刀切成四角等于把它的主要操作拿掉。
   */
  const handles = $derived(
    HANDLES.filter((h) => {
      const corner = CORNERS.has(h);
      return corner || (h === 'n' || h === 's' ? !narrowX : !narrowY);
    }),
  );

  /**
   * 移动握柄：框内部小到抓不住时，在框下方给一个明确的「拖我」入口
   * （Office 的同款做法）。判据取两轴里较小的那个 —— 只要有一轴太薄，
   * 框内部就不存在一块能安心按下的区域。
   */
  const grip = $derived(Math.min(wpx, hpx) > 0 && Math.min(wpx, hpx) < 40);

  function grab(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    onMove(e);
  }
</script>

{#if rect}
  <div
    class="box"
    class:editing
    style:left={`${rect.x * zoom}px`}
    style:top={`${rect.y * zoom}px`}
    style:width={`${rect.w * zoom}px`}
    style:height={`${rect.h * zoom}px`}
    style:transform={rotCss}
    role="presentation"
    data-testid="typo-selection"
    onpointerdown={(e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      onMove(e);
    }}
  >
    {#if editing}
      {#each EDGES as edge (edge)}
        <i
          class="edge {edge}"
          role="presentation"
          data-testid={`typo-frame-${edge}`}
          onpointerdown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onMove(e);
          }}
        ></i>
      {/each}
    {/if}

    {#if !quadEdit}
      {#each handles as h (h)}
        <i
          class="handle {h}"
          role="presentation"
          data-testid={`typo-handle-${h}`}
          onpointerdown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onHandle(h, e);
          }}
        ></i>
      {/each}

      <i
        class="rotate"
        role="presentation"
        data-testid="typo-handle-rotate"
        title={tr('typo.rotateHandle')}
        onpointerdown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onRotate(e);
        }}
      ></i>

      {#if grip}
        <i
          class="grip"
          role="presentation"
          data-testid="typo-handle-move"
          title={tr('typo.moveHandle')}
          onpointerdown={grab}
        >
          <Icon name="move" size={11} />
        </i>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .box {
    position: absolute;
    outline: 1px solid var(--accent);
    cursor: move;
    /* 旋转绕自身中心，与 elementStyle 的元素旋转同一套原点。 */
    transform-origin: 50% 50%;
  }
  /*
   * 编辑态：框内部**不接收**指针事件，交给底下的 contenteditable 放光标。
   * 把手与边框环各自把 pointer-events 打开，所以拖拽/缩放/旋转照旧。
   */
  .box.editing {
    pointer-events: none;
  }
  .box.editing .handle,
  .box.editing .rotate,
  .box.editing .grip,
  .edge {
    pointer-events: auto;
  }
  .edge {
    position: absolute;
    cursor: move;
  }
  /* 6px 的环：与把手同宽的量级，既能点中又不会盖住文字。 */
  .edge.n {
    left: 0;
    right: 0;
    top: 0;
    height: 6px;
  }
  .edge.s {
    left: 0;
    right: 0;
    bottom: 0;
    height: 6px;
  }
  .edge.w {
    top: 0;
    bottom: 0;
    left: 0;
    width: 6px;
  }
  .edge.e {
    top: 0;
    bottom: 0;
    right: 0;
    width: 6px;
  }
  .handle {
    position: absolute;
    width: 7px;
    height: 7px;
    background: var(--surface-0);
    border: 1px solid var(--accent);
    /* 命中区比视觉大一圈：7px 的方块直接点很容易打空 */
    box-shadow: none;
  }
  .handle::after {
    content: '';
    position: absolute;
    inset: -4px;
  }
  .handle.nw {
    left: 0;
    top: 0;
    transform: translate(-50%, -50%);
    cursor: nwse-resize;
  }
  .handle.n {
    left: 50%;
    top: 0;
    transform: translate(-50%, -50%);
    cursor: ns-resize;
  }
  .handle.ne {
    left: 100%;
    top: 0;
    transform: translate(-50%, -50%);
    cursor: nesw-resize;
  }
  .handle.e {
    left: 100%;
    top: 50%;
    transform: translate(-50%, -50%);
    cursor: ew-resize;
  }
  .handle.se {
    left: 100%;
    top: 100%;
    transform: translate(-50%, -50%);
    cursor: nwse-resize;
  }
  .handle.s {
    left: 50%;
    top: 100%;
    transform: translate(-50%, -50%);
    cursor: ns-resize;
  }
  .handle.sw {
    left: 0;
    top: 100%;
    transform: translate(-50%, -50%);
    cursor: nesw-resize;
  }
  .handle.w {
    left: 0;
    top: 50%;
    transform: translate(-50%, -50%);
    cursor: ew-resize;
  }
  .rotate {
    position: absolute;
    left: 50%;
    top: -20px;
    width: 9px;
    height: 9px;
    margin-left: -4.5px;
    background: var(--surface-0);
    border: 1px solid var(--accent);
    border-radius: 50%;
    cursor: grab;
  }
  .rotate::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 100%;
    width: 1px;
    height: 10px;
    background: var(--accent);
  }
  /*
   * 移动握柄：与旋转把手对称地挂在框下方（一条 18px 引线 + 一个圆形按钮）。
   * 它只在框小到抓不住内部时出现 —— 常驻会让每个元素都长出一条尾巴。
   */
  .grip {
    position: absolute;
    left: 50%;
    top: 100%;
    width: 17px;
    height: 17px;
    margin: 18px 0 0 -8.5px;
    display: grid;
    place-items: center;
    background: var(--surface-0);
    border: 1px solid var(--accent);
    border-radius: 50%;
    color: var(--accent);
    cursor: move;
  }
  .grip::before {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 100%;
    width: 1px;
    height: 18px;
    background: var(--accent);
  }
  /* 命中区放大到 25px：这个握柄存在的理由就是「好点」。 */
  .grip::after {
    content: '';
    position: absolute;
    inset: -4px;
  }
</style>
