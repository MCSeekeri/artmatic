<script lang="ts">
  /**
   * RibbonMenu — 「图标 + 小箭头」的按钮，点开是一组并列动作（大小写转换、
   * 字符间距预设）。
   *
   * 与 `select` 的区别是**语义**：select 显示的是「当前值」，这里是一组
   * 一次性动作（「全部大写」不是一个会持续显示的状态）。用 select 表达它们
   * 会得到一个宽度随选项文字变化的按钮，而且选了之后还得把显示值还原 ——
   * Office 里这两个控件也确实是两种形态。
   *
   * 弹层底部的可选数值输入（字符间距的自定义值）刻意放在同一个弹层里：
   * 预设与自定义是同一个属性的两种调法，分开摆会让人以为是两件事。
   *
   * 定位与关闭复用 `controls/popover.ts`（fixed + 贴边翻转 + 外点/Esc/滚轮）——
   * Ribbon 面板是 overflow 裁剪的，absolute 弹层会被吃掉。
   */
  import Icon from '../Icon.svelte';
  import NumberInput from '../controls/NumberInput.svelte';
  import { attachDismiss, computePopoverPosition } from '../controls/popover';
  import type { IconName } from '../icons';
  import type {
    RibbonItemSize,
    RibbonMenuItemSpec,
    RibbonMenuNumeric,
  } from './ribbon-model';

  interface Props {
    label: string;
    icon: IconName;
    items: RibbonMenuItemSpec[];
    numeric?: RibbonMenuNumeric;
    size?: RibbonItemSize;
    disabled?: boolean;
    testid?: string;
  }
  const {
    label,
    icon,
    items,
    numeric,
    size = 'large',
    disabled = false,
    testid,
  }: Props = $props();

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement | undefined>(undefined);
  let panelEl = $state<HTMLDivElement | undefined>(undefined);
  const pos = $state({ x: -1, y: -1 });
  const positioned = $derived(pos.x >= 0 && pos.y >= 0);
  const panelId = $props.id();

  function close(): void {
    open = false;
    pos.x = -1;
    pos.y = -1;
  }

  $effect(() => {
    void open;
    if (!open) return;
    if (!panelEl || !triggerEl) return;
    const anchor = triggerEl.getBoundingClientRect();
    const p = computePopoverPosition(
      anchor,
      { width: panelEl.offsetWidth, height: panelEl.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    if (pos.x !== p.x || pos.y !== p.y) {
      pos.x = p.x;
      pos.y = p.y;
    }
  });

  $effect(() => {
    if (!open) return;
    const handle = attachDismiss({
      onclose: close,
      isInside: (t) => panelEl?.contains(t) === true || triggerEl?.contains(t) === true,
    });
    return () => handle.destroy();
  });

  /** 选一项：先关弹层再执行（动作里可能又开别的弹层）。 */
  function choose(item: RibbonMenuItemSpec): void {
    if (item.disabled) return;
    close();
    item.onselect();
  }
</script>

<button
  type="button"
  class="rmenu"
  class:icon={size === 'icon'}
  class:small={size === 'small'}
  class:open
  bind:this={triggerEl}
  {disabled}
  aria-haspopup="menu"
  aria-expanded={open}
  aria-controls={open ? panelId : undefined}
  aria-label={label}
  title={label}
  data-testid={testid}
  onclick={() => !disabled && (open = !open)}
>
  <span class="rmenu-icon"><Icon name={icon} size={size === 'large' ? 18 : 15} /></span>
  {#if size === 'large'}<span class="lbl">{label}</span>{/if}
  <span class="caret"><Icon name="chevron-down" size={10} /></span>
</button>

{#if open}
  <div
    class="rmenu-pop"
    id={panelId}
    bind:this={panelEl}
    role="menu"
    aria-label={label}
    data-testid={testid ? `${testid}-menu` : undefined}
    style:left={`${pos.x}px`}
    style:top={`${pos.y}px`}
    style:visibility={positioned ? undefined : 'hidden'}
    onwheel={(e) => e.stopPropagation()}
  >
    {#each items as item (item.id)}
      <button
        type="button"
        class="mi"
        class:active={item.active}
        role="menuitemradio"
        aria-checked={item.active === true}
        disabled={item.disabled}
        data-testid={item.id}
        onclick={() => choose(item)}
      >
        <span class="mi-icon">{#if item.icon}<Icon name={item.icon} size={13} />{/if}</span>
        <span class="mi-label">{item.label}</span>
        <span class="mi-check">{#if item.active}<Icon name="check" size={13} />{/if}</span>
      </button>
    {/each}

    {#if numeric}
      <div class="sep"></div>
      <div class="rmenu-num">
        <span class="rmenu-num-label">{numeric.label}</span>
        <NumberInput
          value={numeric.value}
          min={numeric.min}
          max={numeric.max}
          step={numeric.step ?? 1}
          precision={numeric.precision}
          suffix={numeric.suffix}
          width={62}
          ariaLabel={numeric.label}
          testid={testid ? `${testid}-custom` : undefined}
          oninput={numeric.oninput}
          onliveend={numeric.onliveend}
          onchange={numeric.onchange}
        />
      </div>
    {/if}
  </div>
{/if}

<style>
  .rmenu {
    position: relative;
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
  }
  .rmenu.small {
    flex-direction: row;
    gap: 3px;
    width: auto;
    min-width: var(--ribbon-btn-small-w, 32px);
    height: 24px;
    padding: 0 4px;
  }
  /* 纯图标档：宽度比普通图标按钮多出一个箭头的位子（图标 + ▾）。 */
  .rmenu.icon {
    flex-direction: row;
    gap: 1px;
    width: var(--ribbon-menu-icon-w, 30px);
    height: var(--ribbon-icon-h, 24px);
    padding: 0 2px;
  }
  .rmenu:hover:not(:disabled) {
    background: var(--ribbon-btn-bg-hover);
    color: var(--ribbon-btn-fg-hover);
  }
  .rmenu.open {
    background: var(--ribbon-btn-bg-active);
    color: var(--ribbon-btn-fg-active);
  }
  .rmenu:disabled {
    color: var(--ribbon-btn-fg-disabled);
    cursor: default;
  }
  .rmenu-icon {
    display: inline-flex;
  }
  .caret {
    display: inline-flex;
    opacity: 0.75;
  }
  .lbl {
    font-size: var(--fs-xs);
    line-height: 1.1;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rmenu-pop {
    position: fixed;
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 168px;
    padding: var(--sp-2);
    background: var(--menu-bg);
    border: 1px solid var(--menu-border);
    border-radius: var(--radius-md);
  }
  .mi {
    display: grid;
    grid-template-columns: 18px 1fr 16px;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .mi:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .mi.active {
    color: var(--accent);
  }
  .mi:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
  .mi-icon,
  .mi-check {
    display: inline-flex;
    justify-content: center;
    color: inherit;
  }
  .mi-label {
    white-space: nowrap;
  }
  .sep {
    height: 1px;
    margin: 3px 0;
    background: var(--menu-border);
  }
  /*
   * 类名带 `rmenu-` 前缀是**硬要求**：`.num` 这种短名与全局样式表撞车时，
   * 组件的 scoped 样式只声明了一部分属性，剩下的会从全局那条规则继承下来
   * （`tests/unit/css-namespace.test.ts` 就是为此存在的）。
   */
  .rmenu-num {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 6px;
  }
  .rmenu-num-label {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    white-space: nowrap;
  }
</style>
