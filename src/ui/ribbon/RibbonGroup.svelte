<script lang="ts">
  /**
   * RibbonGroup — 一组相关按钮 + 底部的组名。
   *
   * Ribbon 的可读性主要就靠这个分组：把 20 个按钮平铺是找不到东西的，
   * 分成「字体 / 段落 / 对齐 / 层级」四组之后，找东西靠的是位置记忆。
   *
   * 纯小按钮的组排成两行（见 ribbon-model 的 `layout`）：既省横向空间，
   * 也让「一排小图标」看起来仍然是一**组**而不是一条线。
   */
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    layout?: 'row' | 'grid';
    /** grid 布局的列数（由 Ribbon 按项数推）。 */
    columns?: number;
    children: Snippet;
  }
  const { label, layout = 'row', columns = 2, children }: Props = $props();
</script>

<div class="rgroup" data-testid="ribbon-group">
  <div
    class="rgroup-body"
    class:grid={layout === 'grid'}
    style:--grid-cols={String(columns)}
  >{@render children()}</div>
  <div class="rgroup-label">{label}</div>
</div>

<style>
  .rgroup {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: space-between;
    flex: none;
    height: 100%;
    padding: 2px 5px 0;
    position: relative;
  }
  /* 组间 1px 实线。用 ::after 而不是 border-right：分隔线只占 70% 高。 */
  .rgroup::after {
    content: '';
    position: absolute;
    right: 0;
    top: 15%;
    height: 70%;
    width: 1px;
    background: var(--ribbon-separator);
  }
  .rgroup-body {
    display: flex;
    /* 垂直居中：面板高度比按钮高（要留出底部滚动条），顶对齐会让按钮看起来偏上。 */
    align-items: center;
    gap: 2px;
    flex: 1;
    min-height: 0;
  }
  /*
   * 两行网格。`grid-auto-flow: row` + 固定列数保证**阅读顺序不变**
   * （1 2 / 3 4），而不是按列填充的 1 3 / 2 4 —— 后者会让图标顺序错位。
   */
  .rgroup-body.grid {
    display: grid;
    grid-template-columns: repeat(var(--grid-cols, 2), max-content);
    grid-auto-flow: row;
    justify-content: center;
    align-content: center;
    gap: 2px 3px;
  }
  .rgroup-label {
    text-align: center;
    font-size: var(--fs-xs);
    color: var(--ribbon-group-label);
    line-height: 1.2;
    padding-bottom: 1px;
    white-space: nowrap;
  }
</style>
