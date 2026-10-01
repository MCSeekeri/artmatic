<script lang="ts">
  /**
   * StatusBar — 底栏（高 22px）。
   *
   * 四段：项目名 · 工具提示 · 快捷键 · FPS。
   * 「工具提示」这一段就是自研 tooltip 取代原生 title 的第二个理由：原生
   * 气泡只能悬浮在指针旁，鼠标一移开就没了；底栏能在指针停在任何控件上时
   * 持续显示「这是什么、按什么键」，与 Photoshop / Blender 的状态栏同构。
   */
  import Icon from './Icon.svelte';
  import { appState } from './app-state.svelte';
  import { tooltip } from './tooltip.svelte';

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
    {project.name || '未命名工程'}
  </span>

  {#if appState.notice}
    <!-- 一次性提示（如 Alt+↑↓ 被策略挡住）：优先级最高，压过工具提示 -->
    <span class="seg notice" data-testid="notice">
      <Icon name="info" size={11} />
      {appState.notice}
    </span>
  {:else if exporting}
    <span class="seg accent" data-testid="statusbar-export">
      <Icon name="download" size={11} />
      导出中 {pct}%
    </span>
  {:else if tooltip.text}
    <span class="seg hint" data-testid="statusbar-hint">{tooltip.text}</span>
    {#if tooltip.shortcut}
      <span class="seg keys" data-testid="statusbar-keys"><kbd class="kbd">{tooltip.shortcut}</kbd></span>
    {/if}
  {:else}
    <span class="seg hint muted">悬停任意控件看说明</span>
  {/if}

  <span class="seg spacer"></span>

  <span class="seg mono" title="预览帧率（仅统计，不参与渲染求值）">
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
  .notice {
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
