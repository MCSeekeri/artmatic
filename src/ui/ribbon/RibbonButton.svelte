<script lang="ts">
  /**
   * RibbonButton — icon 在上、文字在下的大按钮（PPT 风格）。
   *
   * 不做 tooltip：Ribbon 的整个设计前提就是「文字直接写在按钮上」，
   * 再加 tooltip 等于同一句话说两遍，还会在密集面板里到处冒气泡。
   */
  import Icon from '../Icon.svelte';
  import type { IconName } from '../icons';
  import type { RibbonItemSize } from './ribbon-model';

  interface Props {
    icon: IconName;
    label: string;
    size?: RibbonItemSize;
    active?: boolean;
    disabled?: boolean;
    testid?: string;
    /**
     * 显式宽度（px）。长标签（如「应用到整个项目」）在默认 50px 里会被截断成
     * 「应用到整…」—— 这一档就是给它用的。**预算与渲染必须同源**：同一份
     * `item.width` 既进 `itemWidth()`（组宽预算）又下发成 `--ribbon-btn-w`
     * （按钮实际宽度），两处各写一遍会让整条 Ribbon 的排布慢慢错位。
     * 不给则用 `DENSITY.ribbonBtnW`（根上下发的默认值）。
     */
    width?: number;
    onactivate: () => void;
  }
  const { icon, label, size = 'large', active = false, disabled = false, testid, width, onactivate }: Props =
    $props();

  /** 图标边长按档位：大按钮 18、紧凑 13、纯图标 15（没有文字，可以稍微大一点）。 */
  const iconSize = $derived(size === 'large' ? 18 : size === 'small' ? 13 : 15);
</script>

<button
  type="button"
  class="rbtn"
  class:small={size === 'small'}
  class:icon={size === 'icon'}
  class:active
  data-testid={testid}
  title={label}
  style:--ribbon-btn-w={width !== undefined ? `${width}px` : undefined}
  {disabled}
  aria-pressed={active}
  onclick={onactivate}
>
  <Icon name={icon} size={iconSize} />
  {#if size !== 'icon'}<span class="lbl">{label}</span>{/if}
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
    border: 1px solid var(--ribbon-btn-border);
    border-radius: var(--radius-sm);
    color: var(--ribbon-btn-fg);
    cursor: pointer;
    user-select: none;
    /* 只过渡颜色。Ribbon 的按钮宽度参与整条排布预算，缩放或位移会让
       相邻按钮看起来在跳，也会破坏对齐。 */
    transition:
      background-color var(--motion-duration-hover, 80ms) var(--motion-ease, ease-out),
      color var(--motion-duration-hover, 80ms) var(--motion-ease, ease-out),
      border-color var(--motion-duration-hover, 80ms) var(--motion-ease, ease-out);
  }
  .rbtn.small {
    flex-direction: row;
    gap: 4px;
    width: auto;
    min-width: var(--ribbon-btn-small-w, 32px);
    height: 24px;
    padding: 0 6px;
  }
  /* 纯图标档：方按钮、无文字。名字仍是 `label`（tooltip 与无障碍名靠它）。 */
  .rbtn.icon {
    flex-direction: row;
    gap: 0;
    width: var(--ribbon-icon-w, 26px);
    height: var(--ribbon-icon-h, 24px);
    padding: 0;
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

  @media (prefers-reduced-motion: reduce) {
    .rbtn {
      transition: none;
    }
  }
</style>
