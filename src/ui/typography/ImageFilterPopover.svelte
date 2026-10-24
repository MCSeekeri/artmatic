<script lang="ts">
  /**
   * ImageFilterPopover — 17 个滤镜 + 强度。
   *
   * 为什么是浮层里的**名字网格**而不是 Ribbon 下拉：17 项一字排开的下拉滚动
   * 起来很费劲，而滤镜是按「名字」找的（不像形状要看见轮廓）。三列网格一屏
   * 放下，选中态就是当前滤镜。
   *
   * 强度只有选了滤镜才出现；「无滤镜」是网格里的第一格（不是单独的开关）。
   */
  import NumericField from '../controls/NumericField.svelte';
  import ImagePopShell from './ImagePopShell.svelte';
  import {
    IMAGE_FILTERS,
    type ImageFilterId,
    type ImageFilterState,
  } from '../../typography/image-effects';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    anchor: HTMLElement;
    onclose: () => void;
    filter: ImageFilterState | undefined;
    onchange: (filter: ImageFilterState | null) => void;
    /** 强度拖动中（连续写）。 */
    onlive: (filter: ImageFilterState) => void;
    /** 强度拖动结束。 */
    onliveend: () => void;
  }
  const { anchor, onclose, filter, onchange, onlive, onliveend }: Props = $props();

  function pick(id: ImageFilterId): void {
    // 换滤镜沿用当前强度：用户调好的力度不该被重置成默认值。
    onchange({ id, amount: filter?.amount ?? 0.6 });
  }
</script>

<ImagePopShell {anchor} {onclose} title={tr('rib.imageFilter')} testid="img-filter-pop" width={286}>
  <div class="grid" data-testid="img-filter-grid">
    <button
      type="button"
      class="cell"
      class:on={!filter}
      data-testid="img-filter-none"
      aria-pressed={!filter}
      onclick={() => onchange(null)}
    >
      {tr('rib.imgFilterNone')}
    </button>
    {#each IMAGE_FILTERS as f (f.id)}
      <button
        type="button"
        class="cell"
        class:on={filter?.id === f.id}
        data-testid={`img-filter-${f.id}`}
        aria-pressed={filter?.id === f.id}
        onclick={() => pick(f.id as ImageFilterId)}
      >
        {tr(f.labelKey)}
      </button>
    {/each}
  </div>

  {#if filter}
    <NumericField
      label={tr('rib.imgFilterAmount')}
      labelWidth={44}
      numberWidth={44}
      min={0}
      max={100}
      step={1}
      value={Math.round(filter.amount * 100)}
      sliderTestid="img-filter-amount"
      numberTestid="img-filter-amount-num"
      oninput={(v) => onlive({ id: filter.id, amount: v / 100 })}
      onchange={(v) => {
        onlive({ id: filter.id, amount: v / 100 });
        onliveend();
      }}
    />
  {/if}
</ImagePopShell>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 3px;
    margin-bottom: var(--sp-2);
  }
  .cell {
    height: 24px;
    padding: 0 4px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .cell:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  .cell.on {
    border-color: var(--accent);
    color: var(--text-primary);
  }
</style>
