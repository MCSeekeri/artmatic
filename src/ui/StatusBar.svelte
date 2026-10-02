<script lang="ts">
  /**
   * StatusBar — 底栏（高 22px）。
   *
   * 四段：工程名 · 工具提示 · 快捷键 · FPS。
   * 「工具提示」这一段就是自研 tooltip 取代原生 title 的第二个理由：原生
   * 气泡只能悬浮在指针旁，鼠标一移开就没了；底栏能在指针停在任何控件上时
   * 持续显示「这是什么、按什么键」，与 Photoshop / Blender 的状态栏同构。
   */
  import Icon from './Icon.svelte';
  import { appState } from './app-state.svelte';
  import { tooltip } from './tooltip.svelte';
  import { tr } from '../i18n/index.svelte';

  const project = $derived.by(() => {
    void appState.version;
    return appState.store.project;
  });

  const exporting = $derived(appState.exportProgress !== null);
  const pct = $derived(exporting ? Math.round((appState.exportProgress ?? 0) * 100) : 0);
</script>

<footer class="statusbar" data-testid="statusbar">
  <span class="seg project" data-testid="statusbar-project">
    <Icon name="video" size={11} />
    {project.name || tr('proj.unnamed')}
  </span>

  {#if appState.notice}
    <!-- 一次性提示（保存结果、Alt+↑↓ 被策略挡住…）：优先级最高，压过工具提示。
         三级颜色：中性 / 成功（绿）/ 失败（红）—— 见下面 .notice 的注释。 -->
    <span class="seg notice" data-testid="notice" data-level={appState.noticeLevel}>
      <Icon
        name={appState.noticeLevel === 'success'
          ? 'check'
          : appState.noticeLevel === 'error'
            ? 'triangle-alert'
            : 'info'}
        size={11}
      />
      {appState.notice}
    </span>
  {:else if exporting}
    <span class="seg accent" data-testid="statusbar-export">
      <Icon name="download" size={11} />
      {tr('app.exporting', { pct })}
    </span>
  {:else if tooltip.text}
    <span class="seg hint" data-testid="statusbar-hint">{tooltip.text}</span>
    {#if tooltip.shortcut}
      <span class="seg keys" data-testid="statusbar-keys"><kbd class="kbd">{tooltip.shortcut}</kbd></span>
    {/if}
  {:else}
    <span class="seg hint muted">{tr('app.hoverHint')}</span>
  {/if}

  <span class="seg spacer"></span>

  <span class="seg mono" title={tr('app.fpsTip')}>
    <span class="dim">fps</span>
    <span class="accent" data-testid="statusbar-fps">{appState.fps || '--'}</span>
  </span>
  <span class="seg mono dim">{appState.playT.toFixed(2)}s</span>
</footer>

<style>
  .statusbar {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
    height: var(--statusbar-h);
    padding: 0 var(--sp-4);
    background: var(--bar-bg);
    border-top: 1px solid var(--bar-border);
    color: var(--bar-fg);
    font-size: var(--fs-xs);
    user-select: none;
  }
  .seg {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .spacer {
    flex: 1;
  }
  .project {
    flex-shrink: 0;
    color: var(--bar-fg-strong);
  }
  /*
   * 提示分三级。
   *
   * 原来只有红色一种 —— 于是「已保存 · 3 个素材 · 12 ms」也是红的，
   * 用户第一眼会以为保存失败了。默认走中性色，只有真的失败了才红，
   * 成功才绿。
   */
  .notice {
    color: var(--bar-fg);
  }
  .notice[data-level='success'] {
    color: var(--success);
  }
  .notice[data-level='error'] {
    color: var(--danger);
  }
  .hint {
    color: var(--bar-fg);
  }
  .accent {
    color: var(--bar-accent);
  }
  .muted,
  .dim {
    color: var(--text-muted);
  }
  .mono {
    font-family: 'Cascadia Code', Consolas, monospace;
    font-variant-numeric: tabular-nums;
  }
  kbd.kbd {
    border-color: var(--bar-border);
  }
</style>
