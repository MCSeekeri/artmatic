<script lang="ts">
  /**
   * RibbonSegment — 分段控件（互斥二/三选一）。
   * 用在「对齐到：画布 | 选区」这类地方：下拉太重，并排两个按钮刚好。
   */
  interface Props {
    value: string;
    options: { value: string; label: string }[];
    disabled?: boolean;
    testid?: string;
    onchange: (value: string) => void;
  }
  const { value, options, disabled = false, testid, onchange }: Props = $props();
</script>

<div class="rseg" data-testid={testid} role="radiogroup">
  {#each options as opt (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={opt.value === value}
      class="seg"
      class:active={opt.value === value}
      {disabled}
      data-testid={testid ? `${testid}-${opt.value}` : undefined}
      onclick={() => onchange(opt.value)}
    >
      {opt.label}
    </button>
  {/each}
</div>

<style>
  .rseg {
    display: flex;
    align-items: center;
    height: 22px;
    align-self: center;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .seg {
    height: 100%;
    padding: 0 8px;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--ribbon-btn-fg);
    font-size: var(--fs-xs);
    cursor: pointer;
    white-space: nowrap;
  }
  .seg + .seg {
    border-left: 1px solid var(--border);
  }
  .seg:hover:not(:disabled) {
    color: var(--ribbon-btn-fg-hover);
  }
  /* 选中的那一档用主题色 —— 「这是当前生效的」语义。 */
  .seg.active {
    background: var(--ribbon-btn-bg-active);
    color: var(--ribbon-btn-fg-active);
  }
  .seg:disabled {
    color: var(--ribbon-btn-fg-disabled);
  }
</style>
