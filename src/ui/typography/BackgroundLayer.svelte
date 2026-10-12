<script lang="ts">
  /**
   * BackgroundLayer — 排版舞台的「背景帧」层：把**当前帧的画面截图**半透明地
   * 铺在画幅框里、被编辑内容之下。
   *
   * 存在理由：排版片段通常是**叠加层**，用户需要边排版边看它压到画面上是什么样。
   * 舞台本身只有排版元素（透明底），没有它就没法对齐版式。
   *
   * ## 取帧纪律（照 `ui/export.ts::samplePngFrameBytes`，AGENTS §5.9）
   *
   * 必须**用同一个 renderer** 且走**同一套顺序**：`setExportSize` → `onSeek()`
   * → `enterExportMode()` → `await prepareFrame` → `renderFrame` → `canvas.toBlob`，
   * 最后 `finally` 里 `exitExportMode` + `clearExportSize` + `refreshPreview()`。
   * 少了任何一步的后果都很隐蔽：
   *   · 不还原 `setExportSize`：`syncSize` 会直接 return，预览**永久停在拍摄尺寸**上；
   *   · 不在钉尺寸的**内层** toBlob：还原时的 `syncSize` 会改画布尺寸并清空帧缓冲，
   *     再截只会拿到黑图；
   *   · 不 `onSeek` + `prepareFrame`：反馈类特效跨帧有历史、排版位图是异步光栅化的，
   *     截到的就不是「此刻这一帧」。
   *
   * ## 取的是「下面的内容」
   *
   * 求值用的是 `backgroundProject`（把正在编辑的片段置为不可见）—— 否则会把该片段
   * 自己的文字也烘进底图，预览时看到「文字叠文字」。调色 / 特效等其它轨道照常保留。
   *
   * ## 性能
   *
   * 小尺寸（480 宽）渲染，且**节流**（播放中按 `BG_PLAY_HZ` 降频，暂停/拖动立即）。
   * 取帧可合并：一次还没回来时来的新请求只记住**最新**的那个时间。
   */
  import { onDestroy } from 'svelte';
  import { appState } from '../app-state.svelte';
  import { editorState } from './editor-state.svelte';
  import { bgPreview } from './background-preview.svelte';
  import { BG_PLAY_HZ, backgroundProject, bgFrameSize } from './background-preview';

  const clip = $derived.by(() => {
    void appState.version;
    return editorState.clip;
  });

  /** 要取的那一帧的绝对时间：局部预览时用局部时间，否则跟随播放头。 */
  const captureT = $derived.by(() => {
    void appState.playT;
    void bgPreview.at;
    return bgPreview.at ?? appState.playT;
  });

  /* ------------------------------------------------ 取帧调度（合并 + 节流） */

  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 待取的最新时间。null = 没有待办。 */
  let wantT: number | null = null;
  let busy = false;
  let lastMs = 0;
  /** 组件已卸载：在途的取帧回来时不要再挂 URL（否则刚 revoke 又泄漏一张）。 */
  let destroyed = false;

  function minGapMs(): number {
    // 局部播放与**时间轴播放**都算「在播」：后者 playT 每 rAF 都变，
    // 不降频的话会以 60fps 反复重渲一张半透明底图。
    return bgPreview.playing || appState.playing ? 1000 / BG_PLAY_HZ : 0;
  }

  function schedule(): void {
    if (timer !== null) return;
    const wait = Math.max(0, minGapMs() - (performance.now() - lastMs));
    timer = setTimeout(() => {
      timer = null;
      void pump();
    }, wait);
  }

  function request(t: number): void {
    wantT = t;
    if (!busy) schedule();
  }

  async function pump(): Promise<void> {
    if (busy || wantT === null) return;
    const t = wantT;
    wantT = null;
    busy = true;
    try {
      await capture(t);
    } finally {
      busy = false;
      lastMs = performance.now();
    }
    // 取帧期间又来了新的时间 → 再取一次（只取最新的那个）。
    if (wantT !== null && !destroyed) schedule();
  }

  async function capture(t: number): Promise<void> {
    const renderer = appState.renderer;
    const project = appState.store.project;
    const c = clip;
    if (!renderer || !project || !c) return;
    // 导出进行中绝不动 renderer：导出循环正用它渲权威帧，插进去会污染产物。
    if (appState.exportProgress !== null) return;

    const size = bgFrameSize(project.resolution);
    const bg = backgroundProject(project, c.id);
    try {
      renderer.setExportSize(size.w, size.h);
      renderer.onSeek();
      renderer.enterExportMode();
      await renderer.prepareFrame(bg, t);
      renderer.renderFrame(bg, t);
      const blob = await new Promise<Blob | null>((resolve) =>
        renderer.kit.canvas.toBlob(resolve, 'image/png'),
      );
      if (blob) {
        if (destroyed) {
          // 卸载后才回来的一张：直接丢弃，不挂到已清空的状态上。
          return;
        }
        const next = URL.createObjectURL(blob);
        const prev = bgPreview.url;
        bgPreview.url = next; // 先挂新的再回收旧的，避免 <img> 短暂指向已释放的 URL
        if (prev) URL.revokeObjectURL(prev);
      }
    } catch {
      // 底图取帧失败不该影响编辑：保留上一张，静默降级。
    } finally {
      renderer.exitExportMode();
      renderer.clearExportSize();
      appState.refreshPreview();
    }
  }

  // 开关打开 / 时间（含局部时间）变化 → 请求取帧。
  // 这里同步读到的 `bgPreview.playing` 也进依赖：暂停的那一刻会立刻补一帧。
  $effect(() => {
    if (!bgPreview.enabled) return;
    if (!clip) return;
    request(captureT);
  });

  onDestroy(() => {
    destroyed = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    wantT = null;
    bgPreview.dispose();
  });
</script>

{#if bgPreview.enabled && bgPreview.url}
  <img
    class="typo-bg-frame"
    src={bgPreview.url}
    alt=""
    draggable="false"
    data-testid="typo-bg-frame"
    style:opacity={bgPreview.opacity}
  />
{/if}

<style>
  /*
   * 铺满 paper-wrap（= 画幅框，随 zoom 同尺寸），正好占满。
   * 用 `object-fit: fill` 而不是 contain：底图与画幅同宽高比，fill 才能「正好占满」；
   * 若工程分辨率与文档尺寸的比例有细微出入，也是拉平一两个像素，不是留黑边。
   */
  .typo-bg-frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    display: block;
    pointer-events: none;
  }
</style>
