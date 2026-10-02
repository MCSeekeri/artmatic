<script lang="ts">
  /**
   * RibbonGroup — 一组相关按钮 + 底部的组名。
   *
   * Ribbon 的可读性主要就靠这个分组：把 20 个按钮平铺是找不到东西的，
   * 分成「字体 / 段落 / 对齐 / 层级」四组之后，找东西靠的是位置记忆。
   */
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    children: Snippet;
  }
  const { label, children }: Props = $props();
</script>

<div class="rgroup" data-testid="ribbon-group">
  <div class="rgroup-body">{@render children()}</div>
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
  .rgroup-label {
    text-align: center;
    font-size: var(--fs-xs);
    color: var(--ribbon-group-label);
    line-height: 1.2;
    padding-bottom: 1px;
    white-space: nowrap;
  }
</style>
