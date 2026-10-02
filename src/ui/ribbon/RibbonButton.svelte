<script lang="ts">
  /**
   * RibbonButton — icon 在上、文字在下的大按钮（PPT 风格）。
   *
   * 不做 tooltip：Ribbon 的整个设计前提就是「文字直接写在按钮上」，
   * 再加 tooltip 等于同一句话说两遍，还会在密集面板里到处冒气泡。
   */
  import Icon from '../Icon.svelte';
  import type { IconName } from '../icons';

  interface Props {
    icon: IconName;
    label: string;
    size?: 'large' | 'small';
    active?: boolean;
    disabled?: boolean;
    testid?: string;
    onactivate: () => void;
  }
  const { icon, label, size = 'large', active = false, disabled = false, testid, onactivate }: Props =
    $props();
</script>

<button
  type="button"
  class="rbtn"
  class:small={size === 'small'}
  class:active
  data-testid={testid}
  {disabled}
  aria-pressed={active}
  onclick={onactivate}
>
  <Icon name={icon} size={size === 'small' ? 13 : 18} />
  <span class="lbl">{label}</span>
</button>

<style>
  .rbtn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    width: var(--ribbon-btn-w, 50px);
    height: var(--ribbon-btn-h, 56px);
    padding: 2px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--ribbon-btn-fg);
    cursor: pointer;
    user-select: none;
  }
  .rbtn.small {
    flex-direction: row;
    gap: 4px;
    width: auto;
    min-width: var(--ribbon-btn-small-w, 32px);
    height: 24px;
    padding: 0 6px;
  }
  .rbtn:hover:not(:disabled) {
    background: var(--ribbon-btn-bg-hover);
    color: var(--ribbon-btn-fg-hover);
  }
  /* 激活态是主题色出现的合规位置之一（「这是当前生效的」）。 */
  .rbtn.active {
    background: var(--ribbon-btn-bg-active);
    color: var(--ribbon-btn-fg-active);
  }
  .rbtn:disabled {
    color: var(--ribbon-btn-fg-disabled);
    cursor: default;
  }
  .lbl {
    font-size: var(--fs-xs);
    line-height: 1.1;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
