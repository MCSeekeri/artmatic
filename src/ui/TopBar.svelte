<script lang="ts">
  /**
   * TopBar — 顶栏，页面选项卡宿主。
   *
   * 两级结构：常驻的「时间轴」页 + 临时的「排版编辑」页（跟着片段走）。
   * 数据源是 appState.shellTabs —— 这里是纯渲染，不持有页面状态，
   * 所以「哪个页面是当前页」只有一个地方说了算。
   *
   * 时间轴页的标题跟着工程名走（M5 接入多工程后这里会自然变成多开）。
   */
  import Icon from './Icon.svelte';
  import Brand from './Brand.svelte';
  import { appState } from './app-state.svelte';
  import { tip } from './tip';

  const tabs = $derived.by(() => {
    void appState.version;
    const name = appState.store.project.name || '未命名工程';
    return appState.shellTabs.map((t) => (t.kind === 'timeline' ? { ...t, title: name } : t));
  });
</script>

<header class="topbar" data-testid="topbar">
  <span class="app-mark">
    <Brand variant="word" size={15} />
  </span>

  <div class="tabs" role="tablist" aria-label="页面">
    {#each tabs as tab (tab.id)}
      <div
        class="tab"
        role="tab"
        aria-selected={tab.id === appState.activeTabId}
        data-active={tab.id === appState.activeTabId ? 'true' : undefined}
      >
        <button
          type="button"
          class="tab-main"
          data-testid={tab.kind === 'timeline' ? 'shell-tab-timeline' : `shell-tab-${tab.clipId}`}
          onclick={() => appState.activateTab(tab.id)}
        >
          {#if tab.kind === 'typography'}<Icon name="type" size={11} />{/if}
          <span class="tab-name">{tab.title}</span>
        </button>

        {#if tab.closable}
          <!-- 关闭是独立的 button（不嵌套在 tab-main 里，避免 button 套 button）。 -->
          <button
            type="button"
            class="tab-close"
            aria-label={`关闭 ${tab.title}`}
            data-testid={`shell-tab-close-${tab.clipId}`}
            onclick={() => appState.closeTab(tab.id)}
          >
            <Icon name="x" size={11} />
          </button>
        {/if}
      </div>
    {/each}

    <button
      type="button"
      class="ic-btn sm"
      aria-label="新建项目"
      disabled
      use:tip={{ text: '项目系统未实现（M5）', disabled: false }}
    >
      <Icon name="plus" size={12} />
    </button>
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
    height: var(--topbar-h);
    padding: 0 var(--sp-3);
    background: var(--bar-bg);
    border-bottom: 1px solid var(--bar-border);
  }
  .app-mark {
    display: inline-flex;
    align-items: center;
    padding-right: var(--sp-4);
    /* 字标是品牌标记，用正文色读得清；紫色部分由 SVG 内的 var(--accent) 决定。 */
    color: var(--text-primary);
  }
  .tabs {
    display: flex;
    align-items: stretch;
    gap: var(--sp-1);
    height: 100%;
    min-width: 0;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    max-width: 200px;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
  }
  /* 当前选项卡是「选中的东西」——主题色在此处出现是合规的少数场景之一。 */
  .tab[data-active='true'] {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
  }
  .tab:hover {
    color: var(--text-primary);
  }
  .tab-main {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
    height: 100%;
    padding: 0 var(--sp-3) 0 var(--sp-4);
    background: transparent;
    border: none;
    border-radius: 0;
    color: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .tab-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    margin-right: var(--sp-2);
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
  }
  /* 纯图标按钮：hover 只变图标色，不改底色 */
  .tab-close:hover {
    color: var(--text-primary);
  }
  .tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
