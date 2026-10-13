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
    disabled?: boolean;
    testid?: string;
    onchange: (active: boolean) => void;
  }
  const { icon, label, active, size = 'large', disabled = false, testid, onchange }: Props = $props();
</script>

<RibbonButton
  {icon}
  {label}
  {size}
  active={active}
  {disabled}
  {testid}
  onactivate={() => onchange(!active)}
/>
