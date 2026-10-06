<script lang="ts">
  /**
   * ExportModal — 导出面板。
   *
   * 版式的两条约束（都是「点之前要看清」的落实）：
   *  1. 文件名 / 时长 / 分辨率是**只读事实**，排成对齐的三行；
   *  2. MP4 与 PNG 两个入口**同一行、水平居中**，各自的体积提示挂在按钮下方 ——
   *     体积是「这个按钮会花掉多少磁盘」的注解，放在按钮里会把标签挤成一句话，
   *     排成上下两行又会变成「哪个提示对应哪个按钮」的猜谜。
   *
   * 从 Rail.svelte 抽出来，因为设置面板与排版编辑器都在往 Rail 里塞东西了，
   * 那个文件已经很长。
   */
  import Modal from './controls/Modal.svelte';
  import Button from './controls/Button.svelte';
  import Select from './controls/Select.svelte';
  import NumberInput from './controls/NumberInput.svelte';
  import type { SelectOption } from './controls/select-model';
  import { appState } from './app-state.svelte';
  import {
    GIF_DEFAULT_FPS,
    GIF_DEFAULT_WIDTH,
    GIF_FPS_CHOICES,
    GIF_WIDTH_CHOICES,
    cancelExport,
    estimateMp4Bytes,
    exportGif,
    exportMp4,
    exportPngSequence,
    fmtSize,
    gifPlan,
    mp4Supported,
    totalFrames,
  } from './export';
  import { tr } from '../i18n/index.svelte';

  interface Props {
    onclose: () => void;
  }
  const { onclose }: Props = $props();

  /**
   * 文件名草稿。默认取工程名。
   *
   * 用 `$state` 初值（组件在面板打开时才挂载），所以每次打开都是当前的工程名。
   */
  let name = $state(appState.store.project.name || 'artmatic');

  /**
   * GIF 的帧率 / 宽度草稿。
   *
   * 与文件名不同，这两个**刻意不落 UiPrefs**：导出参数取决于「这次要发到哪儿」
   * （聊天窗口 480 够看、当封面要 640），是一次性决策而不是稳定偏好。
   * 组件在面板打开时才挂载，所以每次打开都回到默认档。
   */
  let gifFps = $state<number>(GIF_DEFAULT_FPS);
  let gifWidth = $state<number>(GIF_DEFAULT_WIDTH);
  /**
   * 导出区间（秒）。
   *
   * 初值取当前工程时长 —— 组件在面板打开时才挂载，所以每次打开都是「整段」。
   * 留两位小数：再细的位数在这个输入框里只是噪声（`planGif` 本来就会把区间
   * 对齐到帧网格）。
   *
   * 这是 GIF 最实用的一个旋钮：体积与「时长 × 面积」成正比，而一段 24 秒的
   * 片子往往只有几秒值得发出去。
   */
  let gifStart = $state(0);
  let gifEnd = $state(Number(appState.store.project.duration.toFixed(2)));

  /** 区间输入框的步长：0.1 秒。GIF 不需要帧级精度，但拖动得跟手。 */
  const GIF_RANGE_STEP = 0.1;

  /** 下拉项的 label 是纯 ASCII（数字 + 单位），不涉及本地化。 */
  const fpsOptions: SelectOption<number>[] = GIF_FPS_CHOICES.map((v) => ({
    value: v,
    label: `${v} fps`,
  }));
  const widthOptions: SelectOption<number>[] = GIF_WIDTH_CHOICES.map((v) => ({
    value: v,
    label: `${v}px`,
  }));

  const frames = $derived.by(() => {
    void appState.version;
    return totalFrames();
  });
  const res = $derived.by(() => {
    void appState.version;
    return appState.project.resolution;
  });
  const seconds = $derived.by(() => {
    void appState.version;
    return Number(appState.project.duration.toFixed(2));
  });
  const pct = $derived(Math.round((appState.exportProgress ?? 0) * 100));
  const exporting = $derived(appState.exportProgress !== null);
  const canMp4 = $derived(mp4Supported());
  const mp4Size = $derived.by(() => {
    void appState.version;
    return fmtSize(estimateMp4Bytes());
  });
  /**
   * PNG 序列体积的**上界**：每帧 RGBA 原始大小 × 帧数。
   *
   * 刻意不装成「预计体积」——PNG 的压缩率完全取决于画面内容（纯色能压到百分之几，
   * 噪点几乎压不动），给一个"预计值"就是在编数字。而"未压缩上界"是确定的、
   * 可复核的，正好用来判断磁盘够不够。
   */
  const pngRawSize = $derived.by(() => {
    void appState.version;
    return fmtSize(frames * res.w * res.h * 4);
  });
  /**
   * GIF 导出计划。面板上显示的尺寸 / 帧数 / 体积，与真正导出时用的，是**同一个**
   * `gifPlan` 调用 —— 各算一份的 bug 形态是「提示说 300 帧，导出来是别的数」。
   */
  const gifInfo = $derived.by(() => {
    void appState.version;
    return gifPlan({
      fps: gifFps,
      width: gifWidth,
      range: { start: gifStart, end: gifEnd },
    });
  });
</script>

<Modal title={tr('app.export')} testid="modal-export" {onclose}>
  <div class="exp-rows">
    <label class="exp-lbl" for="exp-name">{tr('app.exportFileName')}</label>
    <input
      id="exp-name"
      class="exp-name"
      data-testid="export-name"
      bind:value={name}
      disabled={exporting}
    />

    <span class="exp-lbl">{tr('app.duration')}</span>
    <span class="exp-val mono" data-testid="export-duration">
      {tr('app.framesSeconds', { n: frames, sec: seconds })}
    </span>

    <span class="exp-lbl">{tr('app.resolution')}</span>
    <span class="exp-val mono">{res.w}×{res.h}</span>
  </div>

  {#if exporting}
    <div class="exp-progress">
      <div class="exp-track"><div class="exp-fill" style:width={`${pct}%`}></div></div>
      <span class="mono">{pct}%</span>
      <Button label={tr('common.cancel')} variant="outline" testid="export-cancel" onclick={cancelExport} />
    </div>
  {:else}
    <!--
      GIF params get their own row: they only apply to GIF, and folding them into
      the read-only facts table above would blur facts and choices together.
      Kept ASCII: the i18n guard strips // and /* */ comments, but not markup ones.
    -->
    <div class="exp-gif">
      <span class="exp-gif-title">{tr('app.exportGif')}</span>

      <div class="exp-gif-rows">
        <div class="exp-gif-row">
          <span class="exp-lbl">{tr('app.gifFps')}</span>
          <div class="exp-gif-sel">
            <Select
              value={gifFps}
              options={fpsOptions}
              ariaLabel={tr('app.gifFps')}
              testid="gif-fps"
              optionTestidPrefix="gif-fps-opt"
              onchange={(v) => (gifFps = v)}
            />
          </div>

          <span class="exp-lbl">{tr('app.gifWidth')}</span>
          <div class="exp-gif-sel">
            <Select
              value={gifWidth}
              options={widthOptions}
              ariaLabel={tr('app.gifWidth')}
              testid="gif-width"
              optionTestidPrefix="gif-width-opt"
              onchange={(v) => (gifWidth = v)}
            />
          </div>

          <!-- The derived output size, so changing the width shows its effect at once. -->
          <span class="exp-val mono" data-testid="gif-size">
            {gifInfo.size.w}×{gifInfo.size.h}
          </span>
        </div>

        <div class="exp-gif-row">
          <span class="exp-lbl">{tr('app.gifRange')}</span>
          <div class="exp-gif-num">
            <NumberInput
              value={gifStart}
              min={0}
              max={gifEnd}
              step={GIF_RANGE_STEP}
              precision={2}
              width={78}
              suffix="s"
              ariaLabel={tr('app.gifRangeStart')}
              testid="gif-start"
              onchange={(v) => (gifStart = v)}
            />
          </div>
          <span class="exp-gif-dash">–</span>
          <div class="exp-gif-num">
            <NumberInput
              value={gifEnd}
              min={gifStart}
              max={seconds}
              step={GIF_RANGE_STEP}
              precision={2}
              width={78}
              suffix="s"
              ariaLabel={tr('app.gifRangeEnd')}
              testid="gif-end"
              onchange={(v) => (gifEnd = v)}
            />
          </div>

          <!-- Frame count after decimation -- the range's immediate feedback. -->
          <span class="exp-val mono" data-testid="gif-frames">
            {tr('app.gifFrames', { n: gifInfo.frameCount })}
          </span>
        </div>
      </div>
    </div>

    <div class="exp-actions">
      <div class="exp-action">
        <Button
          label={tr('app.exportPng')}
          icon="download"
          variant="outline"
          size="lg"
          testid="export-png"
          onclick={() => void exportPngSequence(name)}
        />
        <p class="exp-hint" data-testid="export-png-hint">
          {tr('app.exportPngHint', { size: pngRawSize })}
        </p>
      </div>

      <div class="exp-action">
        <Button
          label={tr('app.exportGif')}
          icon="download"
          variant="outline"
          size="lg"
          testid="export-gif"
          onclick={() =>
            void exportGif(name, {
              fps: gifFps,
              width: gifWidth,
              range: { start: gifStart, end: gifEnd },
            })}
        />
        <p class="exp-hint" data-testid="export-gif-hint">
          {tr('app.exportGifHint', { size: fmtSize(gifInfo.rawBytes) })}
        </p>
      </div>

      <div class="exp-action">
        <Button
          label={tr('app.exportMp4')}
          icon="download"
          variant="accent"
          size="lg"
          testid="export-mp4"
          disabled={!canMp4}
          onclick={() => void exportMp4(name)}
        />
        <p class="exp-hint" data-testid="export-mp4-hint">
          {#if canMp4}
            {tr('app.exportMp4Hint', { size: mp4Size })}
          {:else}
            {tr('app.exportMp4Unsupported')}
          {/if}
        </p>
      </div>
    </div>
  {/if}
</Modal>

<style>
  .exp-rows {
    display: grid;
    /* 标签列定宽：三行的值左边缘必须对齐，否则读起来是散的。 */
    grid-template-columns: 84px minmax(0, 1fr);
    align-items: center;
    gap: var(--sp-3) var(--sp-4);
    margin-bottom: var(--sp-6);
  }
  .exp-lbl {
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }
  .exp-name {
    /* 不要占满整行：文件名不长，一个横贯面板的输入框反而显得空。 */
    max-width: 260px;
    height: var(--control-h);
  }
  /*
   * GIF 参数行。与下面三个导出按钮之间划一条线：上面是「选参数」，
   * 下面是「点哪个」，混成一片会让人以为参数对三种格式都生效。
   */
  .exp-gif {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-3);
    margin-bottom: var(--sp-5);
    padding-bottom: var(--sp-5);
    border-bottom: 1px solid var(--border);
  }
  .exp-gif-title {
    /* 定宽 84px = 上面那张事实表的标签列宽，两块内容的左边缘才对得齐。 */
    width: 84px;
    flex-shrink: 0;
    color: var(--text-primary);
    font-size: var(--fs-sm);
    font-weight: 600;
    /* 与右侧第一行的文字基线对齐（行高由行内的 .exp-lbl 决定）。 */
    line-height: var(--control-h);
  }
  /*
   * 参数分两行：第一行是「多大、多快」，第二行是「哪一段」。
   * 挤成一行在 760px 的面板里会溢出去，而且这三类参数本来就不是一回事。
   */
  .exp-gif-rows {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    min-width: 0;
  }
  .exp-gif-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .exp-gif .exp-lbl {
    flex-shrink: 0;
  }
  .exp-gif-sel {
    width: 104px;
    flex-shrink: 0;
  }
  .exp-gif-sel :global(.sel) {
    width: 100%;
  }
  .exp-gif-num {
    flex-shrink: 0;
  }
  .exp-gif-dash {
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  .exp-val {
    color: var(--text-primary);
    font-size: var(--fs-sm);
  }
  .mono {
    font-family: 'Cascadia Code', Consolas, monospace;
  }
  .exp-actions {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: var(--sp-6);
  }
  .exp-action {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
    /* 两个按钮同宽：一宽一窄会让"主操作"这件事看起来像排版事故。 */
    width: 150px;
  }
  .exp-action :global(.btn) {
    width: 100%;
  }
  .exp-hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-xs);
    line-height: 1.4;
    text-align: center;
  }
  .exp-progress {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
  }
  .exp-track {
    flex: 1;
    height: 6px;
    background: var(--surface-active);
    border-radius: 3px;
    overflow: hidden;
  }
  .exp-fill {
    height: 100%;
    background: var(--accent);
  }
</style>
