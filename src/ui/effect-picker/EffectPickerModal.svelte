<script lang="ts">
  /**
   * EffectPickerModal — 「添加特效」选择器。
   *
   * 换掉的是一个 `<select>`：特效到七十多个之后，下拉列表既不能搜、也不能筛，
   * 还看不见每个特效长什么样。这里给的是「搜索 + 分类/标签筛选 + 两种视图 +
   * 缩略图」的挑法。
   *
   * 三个设计点：
   *  1. **支持多选**，底部「保存并应用（N）」，按**点击顺序**追加到链上 ——
   *     一次要加三四个特效是常态（比如去色 + 故障 + 暗角）。
   *  2. **筛选面板内联展开**，不做浮层。浮层要定位、要处理贴边翻转、要处理点外面
   *     关闭，而这四行 chip 放得下 —— 不值得为它引一套 popover 的复杂度。
   *  3. **缩略图是预先导出的静态资源**（`thumb-assets.ts`），只贴 `<img loading="lazy">`。
   *     第一版是现渲：开面板要临时编七十多个着色器，实测帧数 240 → 190。
   */
  import Modal from '../controls/Modal.svelte';
  import Button from '../controls/Button.svelte';
  import Icon from '../Icon.svelte';
  import Select from '../controls/Select.svelte';
  import EffectCard from './EffectCard.svelte';
  import { thumbUrl } from './thumb-assets';
  import {
    EMPTY_FILTER,
    PICKER_SORTS,
    activeFilterCount,
    buildItems,
    categoryChips,
    filterItems,
    sortItems,
    tagChips,
    toggleIn,
    type FilterState,
    type PickerSort,
    type PickerView,
  } from './picker-model';
  import type { EffectCategory, EffectTag } from '../../effects/catalog';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    /** 确认：按选择顺序给出特效 id。 */
    onapply: (ids: string[]) => void;
    onclose: () => void;
  }
  const { onapply, onclose }: Props = $props();

  let query = $state('');
  let view = $state<PickerView>('grid');
  let sort = $state<PickerSort>('default');
  let showFilters = $state(false);
  let categories = $state<EffectCategory[]>([]);
  let tags = $state<EffectTag[]>([]);
  /** 已选，**按点击顺序**（不是列表顺序）—— 它就是要追加到链上的顺序。 */
  let selected = $state<string[]>([]);

  const items = $derived(buildItems(tr));
  const filter = $derived<FilterState>({ query, categories, tags });
  const visible = $derived.by(() => sortItems(filterItems(items, filter), sort));
  const cards = $derived(visible.map((it) => ({ item: it, thumb: thumbUrl(it.id) })));
  const filterCount = $derived(activeFilterCount(filter));
  const sortOptions = $derived(
    PICKER_SORTS.map((s) => ({
      value: s,
      label:
        s === 'name'
          ? tr('insp.pickerSortName')
          : s === 'category'
            ? tr('insp.pickerSortCategory')
            : tr('insp.pickerSortDefault'),
    })),
  );

  function toggleSelect(id: string): void {
    selected = toggleIn(selected, id);
  }

  function clearFilters(): void {
    query = '';
    categories = [];
    tags = [];
    void EMPTY_FILTER;
  }

  function apply(): void {
    if (selected.length === 0) return;
    onapply(selected);
  }
</script>

{#snippet footer()}
  <span class="fxp-count" data-testid="effect-picker-count">
    {tr('insp.pickerSelCount', { n: selected.length })}
  </span>
  <div class="fxp-foot">
    <Button
      label={tr('common.cancel')}
      variant="outline"
      testid="effect-picker-cancel"
      onclick={onclose}
    />
    <Button
      label={selected.length > 0
        ? tr('insp.pickerApplyN', { n: selected.length })
        : tr('insp.pickerApply')}
      icon="check"
      variant="accent"
      disabled={selected.length === 0}
      tipText={tr('insp.pickerApplyTip')}
      testid="effect-picker-confirm"
      onclick={apply}
    />
  </div>
{/snippet}

<Modal title={tr('insp.addEffect')} testid="modal-effect-picker" width="picker" flushBody {onclose} {footer}>
  <div class="fxp">
    <!-- 工具栏 -->
    <div class="fxp-bar">
      <label class="fxp-search">
        <Icon name="search" size={14} />
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          autofocus
          data-testid="effect-picker-search"
          placeholder={tr('insp.pickerSearch')}
          bind:value={query}
        />
      </label>

      <Button
        label={view === 'grid' ? tr('insp.pickerViewGrid') : tr('insp.pickerViewList')}
        icon={view === 'grid' ? 'layout-grid' : 'list'}
        variant="outline"
        tipText={view === 'grid' ? tr('insp.pickerViewGridTip') : tr('insp.pickerViewListTip')}
        testid="effect-picker-view"
        onclick={() => (view = view === 'grid' ? 'list' : 'grid')}
      />

      <Button
        label={filterCount > 0 ? `${tr('insp.pickerFilter')} · ${filterCount}` : tr('insp.pickerFilter')}
        icon="sliders-horizontal"
        variant={filterCount > 0 ? 'accent' : 'outline'}
        testid="effect-picker-filter-toggle"
        onclick={() => (showFilters = !showFilters)}
      />

      <Select
        value={sort}
        options={sortOptions}
        minWidth={124}
        ariaLabel={tr('insp.pickerSort')}
        testid="effect-picker-sort"
        optionTestidPrefix="effect-picker-sort-opt"
        onchange={(v) => (sort = v as PickerSort)}
      />
    </div>

    <!-- 条件筛选：内联展开，不做浮层 -->
    {#if showFilters}
      <div class="fxp-filters" data-testid="effect-picker-filters">
        <div class="fxp-facet">
          <span class="fxp-facet-name">{tr('insp.pickerFilterCat')}</span>
          <div class="fxp-chips">
            {#each categoryChips(tr) as c (c.id)}
              <button
                type="button"
                class="fxp-chip"
                class:on={categories.includes(c.id)}
                data-testid={`effect-picker-cat-${c.id}`}
                onclick={() => (categories = toggleIn(categories, c.id))}
              >
                {c.label}
              </button>
            {/each}
          </div>
        </div>

        <div class="fxp-facet">
          <span class="fxp-facet-name">{tr('insp.pickerFilterTag')}</span>
          <div class="fxp-chips">
            {#each tagChips(tr) as t (t.id)}
              <button
                type="button"
                class="fxp-chip"
                class:on={tags.includes(t.id)}
                data-testid={`effect-picker-tag-${t.id}`}
                onclick={() => (tags = toggleIn(tags, t.id))}
              >
                {t.label}
              </button>
            {/each}
            {#if filterCount > 0}
              <button
                type="button"
                class="fxp-chip fxp-chip-clear"
                data-testid="effect-picker-clear"
                onclick={clearFilters}
              >
                {tr('insp.pickerClearFilters')}
              </button>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- 主体 -->
    <div class="fxp-body" class:fxp-grid={view === 'grid'} class:fxp-list={view === 'list'}>
      {#if cards.length === 0}
        <p class="fxp-none" data-testid="effect-picker-none">
          {tr('insp.pickerNone')}
          <br /><span class="fxp-none-hint">{tr('insp.pickerNoneHint')}</span>
        </p>
      {:else}
        {#each cards as c (c.item.id)}
          <div class="fxp-slot">
            <EffectCard
              item={c.item}
              {view}
              thumb={c.thumb}
              selected={selected.includes(c.item.id)}
              onpick={toggleSelect}
            />
          </div>
        {/each}
      {/if}
    </div>

    <div class="fxp-status" data-testid="effect-picker-hit">
      {tr('insp.pickerHitCount', { n: visible.length })}
    </div>
  </div>
</Modal>

<style>
  /* flex 列 + 主体自己滚动：modal 已 flushBody（见 Modal.svelte 的 width='picker'）。 */
  .fxp {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  /* -------------------------------------------------------------- 工具栏 */
  .fxp-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex-shrink: 0;
    padding: var(--sp-4) var(--sp-5);
    border-bottom: 1px solid var(--border);
  }
  .fxp-search {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex: 1;
    min-width: 0;
    height: var(--control-h);
    padding: 0 var(--sp-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--input-bg);
    color: var(--text-muted);
  }
  .fxp-search:focus-within {
    border-color: var(--accent);
  }
  .fxp-search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    outline: none;
  }

  /* ------------------------------------------------------------ 条件筛选 */
  .fxp-filters {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    flex-shrink: 0;
    padding: var(--sp-3) var(--sp-5);
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .fxp-facet {
    display: flex;
    align-items: baseline;
    gap: var(--sp-3);
  }
  .fxp-facet-name {
    flex-shrink: 0;
    width: 32px;
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }
  .fxp-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1) var(--sp-2);
  }
  .fxp-chip {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .fxp-chip:hover {
    border-color: var(--border-strong, var(--border));
  }
  .fxp-chip.on {
    border-color: var(--accent);
    background: var(--surface-active);
    color: var(--text-primary);
  }
  .fxp-chip-clear {
    color: var(--text-muted);
    text-decoration: underline;
  }

  /* ---------------------------------------------------------------- 主体 */
  .fxp-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--sp-4) var(--sp-5);
  }
  .fxp-body.fxp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: var(--sp-4);
    align-content: start;
  }
  /*
   * 列表形态：**宽度够就并两列**。
   *
   * 一排到底在一张 920px 宽的模态里只用掉左半幅、右边一片空白 —— 列表行本身
   * 只有「96px 缩略图 + 一行名称 + 一行说明」，没必要占满整行。
   * `auto-fill` + 最小 340px：模态宽度来自 `min(920px, 94vw)`，窄屏（窗口
   * < 约 720px）自然退回一列；用 `auto-fill` 而不是 `auto-fit`，条目少时
   * 不留一条被拉伸的空白列。
   */
  .fxp-body.fxp-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: var(--sp-2) var(--sp-4);
    align-content: start;
  }
  .fxp-slot {
    min-width: 0;
  }

  .fxp-none {
    margin: var(--sp-6) 0;
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: center;
  }
  .fxp-none-hint {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }

  /* 命中数：放在主体下方固定一条，滚动时它不跟着走 —— 它是「筛选器」的读数，
     不是列表的注脚。 */
  .fxp-status {
    flex-shrink: 0;
    padding: var(--sp-2) var(--sp-5);
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }

  /* -------------------------------------------------------------- 底栏 */
  /* modal-foot 是 flex-end：已选计数推到左边，两个按钮留在右边。 */
  .fxp-count {
    margin-right: auto;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }
  .fxp-foot {
    display: flex;
    gap: var(--sp-3);
  }
</style>
