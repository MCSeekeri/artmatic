<script lang="ts">
  /**
   * SidePanel — 右侧面板的选项卡壳（图层 / 元素属性 / 脚本）。
   *
   * 三者**共用同一个位置**、用选项卡切换，而不是并排：
   * 它们回答的是同一类问题（「这个元素现在是什么状态」），而右侧的宽度
   * 是稀缺的 —— 并排会把舞台挤到只剩一半。
   *
   * **动画不在这里**：它需要一条与时间对齐的横轴，塞进两百多像素宽的侧栏
   * 只能退回「一根 0.6 秒的条」。关键帧面板在预览下方（`KeyframePanel`）。
   *
   * 选项卡状态放在这里而不是 editorState：它只是「我眼下看哪一栏」，
   * 既不该进撤销栈，也不该进工程文件。
   */
  import LayersPanel from './LayersPanel.svelte';
  import PropertiesPanel from './PropertiesPanel.svelte';
  import ScriptPanel from './ScriptPanel.svelte';
  import { tr } from '../../i18n/index.svelte';

  type TabId = 'layers' | 'props' | 'script';

  let tab = $state<TabId>('layers');

  const TABS: { id: TabId; label: string; testid: string }[] = [
    { id: 'layers', label: tr('typo.layers'), testid: 'typo-tab-layers' },
    { id: 'props', label: tr('typo.props'), testid: 'typo-tab-props' },
    { id: 'script', label: tr('typo.scriptPane'), testid: 'typo-tab-script' },
  ];
</script>

<aside class="side" data-testid="typo-side">
  <div class="tabs" role="tablist">
    {#each TABS as t (t.id)}
      <button
        type="button"
        class="tab"
        class:on={tab === t.id}
        role="tab"
        aria-selected={tab === t.id}
        data-testid={t.testid}
        onclick={() => (tab = t.id)}
      >
        {t.label}
      </button>
    {/each}
  </div>

  <div class="body">
    {#if tab === 'layers'}
      <LayersPanel />
    {:else if tab === 'props'}
      <PropertiesPanel />
    {:else}
      <ScriptPanel />
    {/if}
  </div>
</aside>

<style>
  .side {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
    background: var(--surface-1);
    border-left: 1px solid var(--border);
  }
  .tabs {
    display: flex;
    align-items: stretch;
    height: 22px;
    border-bottom: 1px solid var(--border);
  }
  .tab {
    flex: 1;
    min-width: 0;
    padding: 0 var(--sp-3);
    background: transparent;
    border: none;
    /* 只有下边框，圆角会让它看起来像「缺了三边的框」—— 显式抹平。 */
    border-radius: 0;
    border-bottom: 2px solid transparent;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* 兜底表（app.css 的 button）刻意不写 hover 背景，这里补上。 */
  .tab:hover:not(.on) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .tab.on {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .body {
    min-height: 0;
    min-width: 0;
    display: grid;
  }
</style>
