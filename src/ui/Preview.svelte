<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from './app-state.svelte';
  import PreviewToolbar from './PreviewToolbar.svelte';
  import { tr } from '../i18n/index.svelte';

  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let splitLeft: HTMLCanvasElement;
  let splitRight: HTMLCanvasElement;

  /**
   * 「跨剪切点两帧预览」的**拖拽入口**。
   *
   * 播放头停在剪切点时，在预览画面上横向轻拖（越过这个阈值、且方向不限）就临时
   * 把「切点前一帧 / 切点后一帧」并排摊出来；松手收起。真正的取帧与拼图在
   * `appState.renderSplit`（走同一个 `renderFrame`），这里只负责把「在拖」这件事告诉它。
   *
   * 阈值 6px：与拖拽排序同一套纪律（AGENTS §6.7），免得 1~2px 抖动就把浮层闪出来。
   */
  const SPLIT_DRAG_MIN_PX = 6;
  let armed = false;
  let startX = 0;

  function armDrag(e: PointerEvent): void {
    if (e.button !== 0) return;
    // 只接画面本体与信箱边的按下；工具栏（含其下拉弹层）不接管。
    const target = e.target as Element | null;
    if (target !== host && target !== canvas) return;
    armed = true;
    startX = e.clientX;
  }

  function moveDrag(e: PointerEvent): void {
    if (!armed) return;
    if (Math.abs(e.clientX - startX) >= SPLIT_DRAG_MIN_PX) appState.setSplitDrag(true);
  }

  function endDrag(): void {
    armed = false;
    appState.setSplitDrag(false);
  }

  onMount(() => {
    appState.attachPreview(canvas, host);
    appState.attachSplit(splitLeft, splitRight, host);
    // 点击预览区空白不做事；播放循环永远跑（渲染成本在预览尺寸下很低，
    // 永远渲染让「版本变化→画面更新」不需要额外订阅）。
    // 降帧率节流在 appState.tick() 里，只作用于播放中。
    let raf = 0;
    const loop = () => {
      appState.tick();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => appState.renderer.syncSize(appState.project.resolution);
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  });
</script>

<!--
  svelte-ignore a11y_no_static_element_interactions
  这里只是**拖拽热区**：画面本身由内部 `#gl` 承载，语义元素是它。给容器加 role
  反而会让屏幕阅读器多读一个空节点（与 NumberInput 同一套处理）。
-->
<div
  class="preview"
  bind:this={host}
  onpointerdown={armDrag}
  onpointermove={moveDrag}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onpointerleave={endDrag}
>
  <canvas bind:this={canvas} id="gl"></canvas>
  <!--
    两帧并排浮层。`#gl` 是 static、这是 absolute → 它盖在 GL 画布上；工具栏在它之后
    渲染且同样 absolute → 仍在它之上。`pointer-events: none` 让拖拽事件照常穿到 `#gl`。
    关闭时 `display: none`（不是透明），所以「并排 / 单幅」在 DOM 上一眼可分。
  -->
  <div
    class="pv-split"
    class:on={appState.splitVisible}
    aria-label={tr('insp.cutPreview')}
    data-testid="split-view"
  >
    <canvas class="pv-split-panel" data-testid="split-left" bind:this={splitLeft}></canvas>
    <canvas class="pv-split-panel" data-testid="split-right" bind:this={splitRight}></canvas>
  </div>
  <PreviewToolbar />
</div>

<style>
  .preview {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    min-height: 0;
    background: #000;
  }
  #gl {
    max-width: 100%;
    max-height: 100%;
  }
  /* 并排两帧：占满画面区域、居中、等宽。黑底先兜住「某侧没有片段」那种情况。 */
  .pv-split {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    gap: 1px;
    background: #000;
    pointer-events: none;
  }
  .pv-split.on {
    display: flex;
  }
  .pv-split-panel {
    display: block;
  }
</style>
