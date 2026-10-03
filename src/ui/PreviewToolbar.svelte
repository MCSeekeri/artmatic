<script lang="ts">
  /**
   * PreviewToolbar.svelte — 悬浮在预览画面上的**半透明**工具栏。
   *
   * 只放「怎么看」的三个开关：帧率档、分辨率档、暂停回全质。
   * 它们**只影响预览**：导出走 `Renderer.setExportSize`，那条路完全不过
   * 这些档位（`syncSize` 在导出尺寸钉死时会直接返回）。
   *
   * 为什么悬浮而不是放侧栏：这三项是「看着画面调」的时候顺手改的东西，
   * 视线不该离开画面。半透明 + 只在 hover 时提高到不透明，避免挡住构图。
   *
   * ⚠️ 用 `Select` 而不是原生 `<select>`：全局快捷键（Space = 播放）
   * 只对 `INPUT/SELECT/TEXTAREA` 放行，而自研控件靠 `data-exempt` 被识别
   * —— 原生 select 在这个位置会与「点一下就开始播放」打架。
   */
  import Select from './controls/Select.svelte';
  import Checkbox from './controls/Checkbox.svelte';
  import { appState, PREVIEW_FPS_DIVS, PREVIEW_SCALES } from './app-state.svelte';
  import { tr } from '../i18n/index.svelte';

  const fpsOptions = PREVIEW_FPS_DIVS.map((d) => ({
    value: String(d),
    // 1 → 「全速」，2 → 「1/2 帧率」…
    label: d === 1 ? tr('app.previewFpsFull') : tr('app.previewFpsFraction', { n: d }),
  }));

  const scaleOptions = PREVIEW_SCALES.map((s) => ({
    value: String(s),
    label: `${Math.round(s * 100)}%`,
  }));

  /** 播放中实际渲染的帧率（给用户一个「降到了多少」的具体数字）。 */
  const effFps = $derived.by(() => {
    void appState.playing;
    return appState.store.project.fps / appState.previewFpsDiv;
  });
</script>

<div class="pv-bar" data-testid="preview-toolbar">
  <span class="pv-item">
    <span class="pv-lbl">{tr('app.previewFps')}</span>
    <Select
      value={String(appState.previewFpsDiv)}
      options={fpsOptions}
      testid="preview-fps"
      optionTestidPrefix="preview-fps-opt"
      minWidth={96}
      onchange={(v) => appState.setPreviewFpsDiv(Number(v))}
    />
  </span>

  <span class="pv-item">
    <span class="pv-lbl">{tr('app.previewQuality')}</span>
    <Select
      value={String(appState.previewScale)}
      options={scaleOptions}
      testid="preview-scale"
      optionTestidPrefix="preview-scale-opt"
      minWidth={80}
      onchange={(v) => appState.setPreviewScale(Number(v))}
    />
  </span>

  <span class="pv-item">
    <Checkbox
      checked={appState.previewRestoreOnPause}
      tipText={tr('app.previewRestoreTip')}
      testid="preview-restore-on-pause"
      onchange={(v) => appState.setPreviewRestoreOnPause(v)}
    />
    <span class="pv-lbl">{tr('app.previewRestore')}</span>
  </span>

  <span class="pv-readout mono" data-testid="preview-readout">
    {#if appState.playing}
      {tr('app.previewPlaying', { fps: effFps.toFixed(0) })}
    {:else}
      {tr('app.previewPaused')}
    {/if}
  </span>
</div>

<style>
  /*
   * 半透明浮层：用 surface-2 + 边框而不是阴影（本项目的层次只靠
   * surface 深度与 1px 实线，token 表里刻意没有 shadow）。
   * 默认 0.82 不透明度，hover/focus-within 抬到 1 —— 鼠标进来时
   * 说明在用，就别让它继续糊着。
   *
   * ⚠️ **这里不能出现 `transform` / `backdrop-filter` / `filter`。**
   * 它们会让本元素成为后代 `position: fixed` 的**包含块**，而 `Select` 的
   * 弹层正是 fixed 定位 + `getBoundingClientRect()` 算出的视口坐标 ——
   * 一旦被劫持，坐标就变成相对本元素，弹层会整体偏到右边去（实测踩过：
   * 选中「全速」时下拉出现在工具栏右侧、和触发器错开一整个工具栏的宽度）。
   *
   * 居中改用 `left/right: 0 + margin-inline: auto + width: fit-content`，
   * 不含 transform 的等价写法。
   */
  .pv-bar {
    position: absolute;
    top: var(--sp-3);
    left: 0;
    right: 0;
    width: fit-content;
    margin-inline: auto;
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-1) var(--sp-3);
    background: color-mix(in srgb, var(--surface-2) 88%, transparent);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    transition: opacity 120ms ease;
    z-index: 3;
  }
  .pv-bar:hover,
  .pv-bar:focus-within {
    background: var(--surface-2);
  }
  .pv-item {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    white-space: nowrap;
  }
  .pv-lbl {
    color: var(--text-secondary);
    font-size: var(--fs-xs);
  }
  .pv-readout {
    color: var(--text-muted);
    font-size: var(--fs-xs);
    min-width: 62px;
    text-align: right;
  }
</style>
