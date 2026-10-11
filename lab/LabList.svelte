<script lang="ts">
  /**
   * LabList — 左栏：源 / 特效两张清单。
   *
   * 「源」与「特效」并列展示而不是做成 tab：试炼场的核心动作就是
   * "换一个源、换一个特效、看结果"，两者是同一句话的两个空。
   * 拆成 tab 会让每次对比多一次点击。
   */
  import { labState, NO_EFFECT_ID } from './lab-state.svelte';
  import { tr } from '../src/i18n/index.svelte';
  import { resolveLabel } from '../src/i18n/label';

  const effectRow = $derived(labState.effectRowId());
  const groups = $derived(labState.visibleGroups());
  const failed = $derived(labState.failedIds());

  function isActive(scope: 'source' | 'effect', id: string): boolean {
    return scope === 'source' ? labState.sourceId === id : effectRow === id;
  }
</script>

<aside class="lab-panel" data-testid="lab-list">
  <header class="lab-head">
    <!-- 原生 input：项目里"文本输入"没有自研控件（控件族只管参数类控件）。 -->
    <input
      class="lab-search"
      type="search"
      placeholder={tr('lab.searchPlaceholder')}
      bind:value={labState.search}
      data-testid="lab-search"
    />
  </header>

  <div class="lab-scroll">
    {#each groups as g (g.id)}
      <h4 class="lab-group">{tr(g.labelKey)}</h4>
      {#each g.items as it (it.id)}
        {@const active = isActive(g.id, it.id)}
        <button
          type="button"
          class="lab-item"
          class:lab-item-active={active}
          class:lab-item-bad={failed.has(it.id)}
          class:lab-item-none={it.id === NO_EFFECT_ID}
          data-testid={`lab-item-${it.id}`}
          aria-pressed={active}
          onclick={() => (g.id === 'source' ? labState.selectSource(it.id) : labState.selectEffect(it.id))}
        >
          <span class="lab-item-name">{resolveLabel(it.nameKey, tr)}</span>
          {#if it.badgeKey}<span class="lab-item-badge">{tr(it.badgeKey)}</span>{/if}
        </button>
      {/each}
    {/each}
    {#if groups.length === 0}
      <p class="lab-empty">{tr('lab.noSource')}</p>
    {/if}
  </div>

  <footer class="lab-foot">{tr('lab.hint')}</footer>
</aside>

<style>
  .lab-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    background: var(--surface-1);
    border-right: 1px solid var(--border);
    min-height: 0;
  }
  .lab-head {
    padding: var(--sp-2) var(--sp-3);
    border-bottom: 1px solid var(--border);
  }
  .lab-search {
    width: 100%;
    height: 24px;
    padding: 0 var(--sp-2);
    font: inherit;
    font-size: var(--fs-sm);
    color: var(--text-primary);
    background: var(--input-bg, var(--surface-0));
    border: 1px solid var(--input-border, var(--border));
    border-radius: var(--radius-sm);
  }
  .lab-scroll {
    overflow-y: auto;
    padding-bottom: var(--sp-4);
  }
  .lab-group {
    margin: var(--sp-3) var(--sp-3) var(--sp-1);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    text-transform: uppercase;
  }
  .lab-item {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    width: 100%;
    padding: 0 var(--sp-3);
    height: 22px;
    font: inherit;
    font-size: var(--fs-sm);
    color: var(--text-primary);
    text-align: left;
    background: none;
    border: 0;
    cursor: pointer;
  }
  .lab-item:hover {
    background: var(--surface-2);
  }
  /* 主题色只出现在「选中」这一处（视觉纪律：选中/激活/焦点三处才用强调色）。 */
  .lab-item-active {
    background: var(--accent-weak);
    color: var(--accent-strong, var(--text-primary));
  }
  .lab-item-bad .lab-item-name {
    color: var(--danger);
  }
  .lab-item-none .lab-item-name {
    color: var(--text-muted);
  }
  .lab-item-name {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .lab-item-badge {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .lab-empty {
    margin: var(--sp-4) var(--sp-3);
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .lab-foot {
    padding: var(--sp-2) var(--sp-3);
    font-size: var(--fs-xs);
    line-height: 1.5;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
  }
</style>
