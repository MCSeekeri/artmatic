<script lang="ts">
  /**
   * Checkbox — 自绘复选框，替掉原生 `input[type=checkbox]`。
   *
   * 结构是 `role="checkbox"` 的 span 而不是 `<input>`，所以根节点必须带
   * `data-exempt`：否则全局的 Space/Delete 快捷键会在它上面照常触发。
   */
  import Icon from '../Icon.svelte';
  import { tip } from '../tip';

  interface Props {
    checked: boolean;
    label?: string;
    /** 图标型复选框（没有可见 label）的无障碍名。缺省用 label。 */
    ariaLabel?: string;
    disabled?: boolean;
    tipText?: string;
    testid?: string;
    onchange: (v: boolean) => void;
  }
  const {
    checked,
    label,
    ariaLabel,
    disabled = false,
    tipText,
    testid,
    onchange,
  }: Props = $props();

  function toggle(): void {
    if (disabled) return;
    onchange(!checked);
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle();
    }
  }
</script>

<span
  class="cbx"
  role="checkbox"
  tabindex={disabled ? -1 : 0}
  aria-checked={checked}
  aria-disabled={disabled}
  aria-label={ariaLabel ?? label}
  data-exempt
  data-testid={testid}
  use:tip={{ text: tipText ?? label ?? '', disabled: !tipText }}
  onclick={toggle}
  {onkeydown}
>
  <span class="cbx-box">
    {#if checked}<Icon name="check" size={10} stroke={3.2} />{/if}
  </span>
  {#if label}<span>{label}</span>{/if}
</span>
