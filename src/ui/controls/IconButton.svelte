<script lang="ts">
  /**
   * IconButton — 只有一个图标的按钮。
   *
   * 硬性外观纪律：**永远 background: transparent，hover 只变图标颜色**。
   * 这是本项目明确要求的交互，也省掉一大片灰底按钮的视觉噪声。
   * 样式在 controls.css 的 `.ic-btn`，这里只管行为与无障碍。
   */
  import Icon from '../Icon.svelte';
  import type { IconName } from '../icons';
  import { tip } from '../tip';
  import type { TipPlacement } from '../tooltip.svelte';

  interface Props {
    icon: IconName;
    /** 无障碍名。同时作为没有 tipText 时的提示文字。 */
    label: string;
    /** 提示文字（默认取 label）。 */
    tipText?: string;
    /** 快捷键角标，会显示在提示气泡里，也供底栏同步。 */
    shortcut?: string;
    /** 气泡方位。工具条里的按钮下方紧挨轨道区，用 'top'。 */
    tipPlacement?: TipPlacement;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'ghost' | 'danger';
    /** 开关类按钮（eye / megaphone / 关键帧）：会映射到 aria-pressed。 */
    active?: boolean;
    disabled?: boolean;
    testid?: string;
    onclick?: (e: MouseEvent) => void;
  }
  const {
    icon,
    label,
    tipText,
    shortcut,
    tipPlacement = 'bottom',
    size = 'md',
    variant = 'ghost',
    active,
    disabled = false,
    testid,
    onclick,
  }: Props = $props();

  const ICON_PX = { sm: 12, md: 14, lg: 17 } as const;
</script>

<button
  type="button"
  class="ic-btn {size}"
  class:danger={variant === 'danger'}
  aria-label={label}
  aria-pressed={active === undefined ? undefined : active}
  {disabled}
  data-testid={testid}
  use:tip={{ text: tipText ?? label, shortcut, placement: tipPlacement }}
  {onclick}
>
  <Icon name={icon} size={ICON_PX[size]} />
</button>
