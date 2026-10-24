<script lang="ts">
  /**
   * RibbonToggle — 复选态按钮（加粗 / 斜体 / 下划线 / 对齐态…）。
   *
   * 实现上就是 RibbonButton 加一个翻转回调：两种形态必须**长得一模一样**，
   * 否则「B 按钮和左边那个按钮高度差 2px」这种问题会在面板里到处冒出来。
   */
  import RibbonButton from './RibbonButton.svelte';
  import type { IconName } from '../icons';
  import type { RibbonItemSize } from './ribbon-model';

  interface Props {
    icon: IconName;
    label: string;
    active: boolean;
    size?: RibbonItemSize;
    /** 与 `itemWidth()` 同源（文字长短决定宽度，见 ribbon-model::labelWidthPx）。 */
    width?: number;
    disabled?: boolean;
    testid?: string;
    onchange: (active: boolean) => void;
    /** 见 ribbon-model::RibbonToggleSpec.ondblclick。 */
    ondblclick?: () => void;
  }
  const {
    icon,
    label,
    active,
    size = 'large',
    width,
    disabled = false,
    testid,
    onchange,
    ondblclick,
  }: Props = $props();
</script>

<RibbonButton
  {icon}
  {label}
  {size}
  {width}
  active={active}
  {disabled}
  {testid}
  {ondblclick}
  onactivate={() => onchange(!active)}
/>
