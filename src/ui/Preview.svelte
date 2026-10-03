<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from './app-state.svelte';
  import PreviewToolbar from './PreviewToolbar.svelte';

  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;

  onMount(() => {
    appState.attachPreview(canvas, host);
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

<div class="preview" bind:this={host}>
  <canvas bind:this={canvas} id="gl"></canvas>
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
</style>
