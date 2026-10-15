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
   * **贴在画面的右下角**（不是顶部居中）：之前那条横贯画面顶部的居中条
   * 被用户反馈挡住构图 —— 连收起后的悬浮球浮在正中「即使缩成球也遮挡画面」。
   * 挪到角落之后，悬浮球与展开条都落在画面构图的死角上（画幅居中、四角
   * 通常是留白/信箱边），遮挡面积最小。收起状态与位置都跟着 UI 偏好走
   * （localStorage），不进工程。
   *
   * ⚠️ 用 `Select` 而不是原生 `<select>`：全局快捷键（Space = 播放）
   * 只对 `INPUT/SELECT/TEXTAREA` 放行，而自研控件靠 `data-exempt` 被识别
   * —— 原生 select 在这个位置会与「点一下就开始播放」打架。
   *
   * 曾经这里还有一个 `pv-readout`（「播放中 30fps / 已暂停」）。它被删掉了：
   * 左下角的播放/暂停按钮已经把这件事件说清楚了，同一屏里说两遍只是噪声。
   */
  import Icon from './Icon.svelte';
  import Select from './controls/Select.svelte';
  import Checkbox from './controls/Checkbox.svelte';
  import IconButton from './controls/IconButton.svelte';
  import { appState, PREVIEW_FPS_DIVS, PREVIEW_SCALES } from './app-state.svelte';
  import { tr } from '../i18n/index.svelte';

  interface Props {
    /** 是否正处于全屏（图标在 maximize / minimize 之间换）。 */
    fullscreen: boolean;
    /** 宿主不支持 Fullscreen API 时为 false —— 按钮不出现。 */
    supportsFullscreen: boolean;
    /** 切换全屏。宿主与状态同步在 Preview.svelte（它持有 `.preview`）。 */
    ontoggleFullscreen: () => void;
  }
  const { fullscreen, supportsFullscreen, ontoggleFullscreen }: Props = $props();

  const fpsOptions = PREVIEW_FPS_DIVS.map((d) => ({
    value: String(d),
    // 1 → 「全速」，2 → 「1/2 帧率」…
    label: d === 1 ? tr('app.previewFpsFull') : tr('app.previewFpsFraction', { n: d }),
  }));

  const scaleOptions = PREVIEW_SCALES.map((s) => ({
    value: String(s),
    label: `${Math.round(s * 100)}%`,
  }));
</script>

{#if appState.previewBarCollapsed}
  <button
    type="button"
    class="pv-ball"
    aria-label={tr('app.previewOptions')}
    data-testid="preview-toolbar-ball"
    onclick={() => appState.setPreviewBarCollapsed(false)}
  >
    <Icon name="sliders-horizontal" size={13} />
  </button>
{:else}
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

    <!-- 全屏：放在收起按钮左边（同一族「工具栏自身的开关」）。
         宿主不支持时整个按钮不渲染 —— 点下去只会弹一句「浏览器不行」。 -->
    {#if supportsFullscreen}
      <IconButton
        icon={fullscreen ? 'minimize' : 'maximize'}
        label={fullscreen ? tr('app.previewExitFullscreen') : tr('app.previewFullscreen')}
        tipText={tr('app.previewFullscreenTip')}
        tipPlacement="top"
        size="sm"
        testid="preview-fullscreen"
        onclick={ontoggleFullscreen}
      />
    {/if}

    <!-- 收起：留在条子最右侧，与三个开关同一行，不与它们抢注意力。 -->
    <button
      type="button"
      class="pv-collapse"
      aria-label={tr('app.previewCollapse')}
      data-testid="preview-toolbar-collapse"
      onclick={() => appState.setPreviewBarCollapsed(true)}
    >
      <Icon name="x" size={11} />
    </button>
  </div>
{/if}

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
   * 定位用 `right/bottom` 贴画面右下角（**不是**顶部居中）—— 居中那条
   * 会横贯画面顶部挡构图，悬浮球浮在正中同样挡。角落的遮挡面积最小。
   *
   * ⚠️ **这里也不能有 `z-index`。** 带非 auto 的 z-index 会自建层叠上下文，
   * 而 `Select` 的弹层是 `position: fixed` + `z-index: var(--z-menu)` —— 弹层
   * 会被困在这个上下文里，按工具栏的层级参与比较。工具栏原本在顶部居中时
   * 弹层朝下只盖到预览区，看不出来；一挪到右下角，弹层就伸进时间轴、被
   * `z-ruler`(5) 的标尺盖住（点不到）。去掉 z-index 后弹层回到根上下文、
   * 用 `--z-menu`(100) 正常压过标尺。工具栏自身靠「定位元素后绘制」就已
   * 在画布 `#gl` 之上，不需要 z-index。
   */
  .pv-bar {
    position: absolute;
    right: var(--sp-3);
    bottom: var(--sp-3);
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-1) var(--sp-2) var(--sp-1) var(--sp-3);
    background: color-mix(in srgb, var(--surface-2) 88%, transparent);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    transition: opacity 120ms ease;
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
  /* 收起按钮：纯图标、透明底、hover 只变颜色（与全局 .ic-btn 同一套纪律）。 */
  .pv-collapse {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
  }
  .pv-collapse:hover {
    color: var(--text-primary);
  }
  /* 收起后的悬浮球。同样贴右下角、同样不能带 transform（见 .pv-bar 的注释）。 */
  .pv-ball {
    position: absolute;
    right: var(--sp-3);
    bottom: var(--sp-3);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: color-mix(in srgb, var(--surface-2) 80%, transparent);
    border: 1px solid var(--border);
    border-radius: 50%;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .pv-ball:hover,
  .pv-ball:focus-visible {
    background: var(--surface-2);
    color: var(--text-primary);
  }
</style>
