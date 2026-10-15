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
   * 全屏预览。宿主是 `.preview` 这个容器（不是 canvas）—— 全屏时悬浮工具条
   * 与两帧并排浮层都该跟着铺满，只把 canvas 放大它们会被挤出视口。
   *
   * 退出全屏必须**关回** `setPreviewUpscale(false)`：那是「允许预览缓冲放大
   * 到显示尺寸」的开关（见 renderer.setAllowUpscale），忘了关的后果是窗口
   * 模式下预览也按屏幕尺寸分配缓冲 —— 小窗口里白烧一份全屏的显存。
   */
  let fullscreen = $state(false);

  function toggleFullscreen(): void {
    const el = host;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => {});
    } else {
      // 老浏览器没有这个 API 时静默不做（按钮根本不该出现，见 supportsFullscreen）
      void el.requestFullscreen?.().catch(() => {});
    }
  }

  /**
   * 不支持 Fullscreen API 的宿主（旧浏览器 / 被嵌进没有 allowfullscreen 的
   * iframe）不显示按钮 —— `fullscreenEnabled` 对这两种情况都是 false。
   */
  const supportsFullscreen = $derived(
    typeof document !== 'undefined' && document.fullscreenEnabled === true,
  );

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

  /*
   * 「偶发黑屏」的审查结论（2026-10-14）：
   *
   * 查过并**排除**的怀疑项：exportSize 泄漏（7 处 setExportSize 全都有配对的
   * clearExportSize）、缓冲尺寸被置 0/NaN（三条入口都把分辨率钳到 ≥16）、
   * 切排版页卸载 canvas（`.body.is-hidden` 只是 display:none，canvas 不离开 DOM）、
   * 切工程 / 开关抽屉 / 改分辨率（都只改 CSS 变量与 view，尺寸靠 syncSize + RO 重算）。
   *
   * **查实的两条**（都已修）：
   *  1. 这个 rAF 循环没有异常保护 —— `tick()` 抛出就跳过下一帧调度，循环**永久死亡**
   *     （表现：画面冻住或全黑，而播放头/底栏这些不依赖 WebGL 的东西照常动）。
   *     下面 try/catch 兜住它。
   *  2. `attachPreview` 不校验 canvas 身份，而 `Kit` 把 canvas 存死 —— 组件卸载重挂
   *     （dev 的组件级 HMR）会带来新 canvas，旧服务继续画在脱离 DOM 的那块上。
   *     修在 `app-state.svelte.ts::attachPreview`（比对身份 → 整块重建），
   *     顺带补上 `webglcontextlost / restored` 的处理。
   */
  onMount(() => {
    appState.attachPreview(canvas, host);
    appState.attachSplit(splitLeft, splitRight, host);
    // 点击预览区空白不做事；播放循环永远跑（渲染成本在预览尺寸下很低，
    // 永远渲染让「版本变化→画面更新」不需要额外订阅）。
    // 降帧率节流在 appState.tick() 里，只作用于播放中。
    let raf = 0;
    /** 累计抛错次数。同一个错误只报头一次与每 300 次一次，避免每帧刷屏。 */
    let tickErrors = 0;
    /*
     * 全屏状态同步。浏览器给的退出通道（Esc / F11）不走我们的按钮，
     * 所以必须听 `fullscreenchange`：只信按钮的那份状态会在用户按 Esc 之后
     * 一直停在「全屏中」，而预览缓冲还开着放大 —— 退出全屏画面反而更糊。
     */
    const onFullscreenChange = (): void => {
      const on = document.fullscreenElement === host;
      fullscreen = on;
      appState.setPreviewUpscale(on);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    const loop = () => {
      /*
       * 渲染失败是「这一帧没画成」，不是「预览关机」。
       *
       * `tick()` 里跑的是整条渲染链：惰性编译着色器（特效 / 生成器 / 插件的语法
       * 错误就在这一刻抛）、GL 调用（上下文丢失后必抛）、排版位图上传。
       * 不兜住的话异常会跳过下面那行调度 —— 循环死掉且**没有任何入口能重启它**
       * （唯一的重启是刷新页面），这与「偶发黑屏、刷新才好」的形态完全一致。
       */
      try {
        appState.tick();
      } catch (e) {
        tickErrors += 1;
        if (tickErrors === 1 || tickErrors % 300 === 0) {
          console.error(`[preview] 渲染循环抛错（已兜住，不会停循环；第 ${tickErrors} 次）`, e);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => appState.renderer.syncSize(appState.project.resolution);
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('fullscreenchange', onFullscreenChange);
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
  <PreviewToolbar {fullscreen} {supportsFullscreen} ontoggleFullscreen={toggleFullscreen} />
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
