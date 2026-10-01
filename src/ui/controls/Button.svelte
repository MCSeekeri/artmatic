<script lang="ts">
  /** Button — 带文字的按钮。外观在 controls.css 的 `.btn`。 */
  import Icon from '../Icon.svelte';
  import type { IconName } from '../icons';
  import { tip } from '../tip';
  import type { TipPlacement } from '../tooltip.svelte';

  interface Props {
    label: string;
    icon?: IconName;
    variant?: 'solid' | 'outline' | 'ghost' | 'accent' | 'danger';
    size?: 'sm' | 'lg';
    disabled?: boolean;
    tipText?: string;
    shortcut?: string;
    tipPlacement?: TipPlacement;
    testid?: string;
    onclick?: (e: MouseEvent) => void;
  }
  const {
    label,
    icon,
    variant = 'solid',
    size = 'sm',
    disabled = false,
    tipText,
    shortcut,
    tipPlacement = 'bottom',
    testid,
    onclick,
  }: Props = $props();

  const cls = $derived([variant === 'solid' ? '' : variant, size === 'lg' ? 'lg' : ''].filter(Boolean).join(' '));
</script>

<button
  type="button"
  class="btn {cls}"
  {disabled}
  data-testid={testid}
  use:tip={{ text: tipText ?? label, shortcut, placement: tipPlacement }}
  {onclick}
>
  {#if icon}<Icon name={icon} size={13} />{/if}
  {label}
</button>
