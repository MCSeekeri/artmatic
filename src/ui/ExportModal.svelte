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
  import { appState } from './app-state.svelte';
  import {
    cancelExport,
    estimateMp4Bytes,
    exportMp4,
    exportPngSequence,
    fmtSize,
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
