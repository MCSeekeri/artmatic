<script lang="ts">
  /**
   * TopBar — 顶栏，只放项目选项卡。
   *
   * 现在只有一个「当前工程」选项卡。项目系统（多工程、最近打开、未保存标记）
   * 是 M5 的事，这里先把结构留出来：tab 是数组渲染的，加数据就能多开。
   */
  import Icon from './Icon.svelte';
  import Brand from './Brand.svelte';
  import { appState } from './app-state.svelte';
  import { tip } from './tip';

  const project = $derived.by(() => {
    void appState.version;
    return appState.store.project;
  });

  /** 占位：项目系统落地后由 store 提供。 */
  const tabs = $derived([{ id: 'current', name: project.name || '未命名工程', dirty: false }]);
  let activeId = $state('current');
</script>

<header class="topbar" data-testid="topbar">
  <span class="app-mark">
    <Brand variant="word" size={15} />
  </span>

  <div class="tabs" role="tablist" aria-label="项目">
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        class="tab"
        role="tab"
        aria-selected={tab.id === activeId}
        data-active={tab.id === activeId ? 'true' : undefined}
        data-testid={`project-tab-${tab.id}`}
        onclick={() => (activeId = tab.id)}
      >
        <span class="tab-name">{tab.name}</span>
        {#if tab.dirty}<span class="tab-dot" title="有未保存的改动"></span>{/if}
      </button>
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
    gap: var(--sp-2);
    max-width: 200px;
    padding: 0 var(--sp-4);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: var(--text-muted);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .tab:hover {
    color: var(--text-primary);
  }
  /* 当前选项卡是「选中的东西」——主题色在此处出现是合规的少数场景之一。 */
  .tab[data-active='true'] {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
  }
  .tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }
</style>
