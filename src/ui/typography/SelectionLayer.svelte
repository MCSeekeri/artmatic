<script lang="ts">
  /**
   * SelectionLayer — 选区框 + 8 个缩放把手 + 1 个旋转把手。
   *
   * 坐标全部是 **文档坐标 × zoom**：它挂在 .overlay 里，而 .overlay 的原点
   * 就是 paper-wrap 的原点（也就是文档的 (0,0)），所以不需要再补任何偏移。
   *
   * 把手画在**未旋转外接框**上，与几何层的吸附/对齐用同一个框 —— 如果这里
   * 按旋转后的 AABB 画，就会出现「把手看着在左边、拖起来却往右上跑」。
   */
  import { HANDLES, type HandleId } from '../../typography/geometry';

  interface Props {
    /** `rot` 只在单选时有意义（多选用整个选区的 AABB，角度为 0）。 */
    rect: { x: number; y: number; w: number; h: number; rot: number } | null;
    zoom: number;
    onMove: (e: PointerEvent) => void;
    onHandle: (handle: HandleId, e: PointerEvent) => void;
    onRotate: (e: PointerEvent) => void;
  }
  const { rect, zoom, onMove, onHandle, onRotate }: Props = $props();

  /** 弧度 → CSS。与 elementStyle 用同一套角度约定，绕中心转（默认 transform-origin）。 */
  const rotCss = $derived(rect?.rot ? `rotate(${(rect.rot * 180) / Math.PI}deg)` : undefined);
</script>

{#if rect}
  <div
    class="box"
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
    {#each HANDLES as h (h)}
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
      title="旋转（Shift 吸附 15°）"
      onpointerdown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onRotate(e);
      }}
    ></i>
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
</style>
