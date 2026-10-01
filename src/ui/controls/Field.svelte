<script lang="ts">
  /**
   * Field — 参数行的统一布局：`标签 | 控件 | 右侧槽`。
   *
   * 存在的意义之一是把「`.kf .row` 与时间轴 `.row` 同名」这个历史坑埋掉：
   * 迁移前检查器与时间轴各有一套同构但类名冲突的行结构，E2E 因此踩过选择器
   * 撞车。现在参数行只有一个实现，并且带稳定的 `data-testid`。
   */
  import type { Snippet } from 'svelte';
  import { tip } from '../tip';

  interface Props {
    label?: string;
    /** 标签列宽。默认 66px，指标题短的行可以调窄。 */
    labelWidth?: number;
    tipText?: string;
    /** 标签右侧的额外内容（如「已打关键帧」小标）。 */
    hint?: Snippet;
    /** 行尾的额外控件（如关键帧 ◆ 按钮）。 */
    trailing?: Snippet;
    children: Snippet;
    testid?: string;
  }
  const {
    label,
    labelWidth = 66,
    tipText,
    hint,
    trailing,
    children,
    testid = 'param-row',
  }: Props = $props();
</script>

<div class="field" style:--field-label-w={`${labelWidth}px`} data-testid={testid}>
  {#if label}
    <span class="field-label" data-testid="param-label" use:tip={{ text: tipText ?? '', disabled: !tipText }}>
      {label}
    </span>
  {/if}
  <span class="field-control">
    {@render children()}
    {#if hint}{@render hint()}{/if}
  </span>
  {#if trailing}{@render trailing()}{/if}
</div>
