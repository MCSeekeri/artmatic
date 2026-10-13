<script lang="ts">
  /**
   * RibbonGroup — 一组相关按钮 + 底部的组名。
   *
   * Ribbon 的可读性主要就靠这个分组：把 20 个按钮平铺是找不到东西的，
   * 分成「字体 / 段落 / 对齐 / 层级」四组之后，找东西靠的是位置记忆。
   *
   * 三种排布（见 ribbon-model 的 `layout`）：
   *  - `row`：一行平铺（默认）；
   *  - `grid`：等宽两行，给「整组都是小按钮」的组省横向空间；
   *  - `rows`：**内容自己分行**（字体组：第一排是宽下拉、第二排是纯图标）——
   *    行由 Ribbon 逐行渲染好塞进来，这里只负责纵向排列。
   */
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    layout?: 'row' | 'grid' | 'rows';
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
    class:rows={layout === 'rows'}
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
  /*
   * 内容自己分行的组。两排之间留 4px：第一排是输入类控件（高 22-24px）、
   * 第二排是图标按钮，贴着放会看起来像一排东西塞不下才折行的。
   *
   * `align-items` 必须是 stretch（默认）：每行都要**撑满组宽**，
   * 行内的弹性间隔才有空间可吃、两排的右边缘才能对齐。
   * 用 flex-start 的话每行只有内容宽，间隔恒为 0 宽。
   */
  .rgroup-body.rows {
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 4px;
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
