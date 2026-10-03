<script lang="ts" generics="T extends string | number">
  /**
   * Select — 自绘下拉，替掉原生 `<select>`。
   *
   * 触发区用 `div role="combobox"` 而不是 `<button>`：原生 button 会把 Space
   * 当「激活」键，会与「Space = 播放/暂停」的全局快捷键打架，也与下拉自身的
   * 「Space = 打开/提交」冲突。用 role 化的 div 从此没有这层默认行为。
   *
   * 索引与键盘状态机在 select-model.ts（纯函数、可单测）；定位与关闭复用
   * popover.ts（贴边翻转）。
   */
  import Icon from '../Icon.svelte';
  import { attachDismiss, computePopoverPosition } from './popover';
  import {
    TYPEAHEAD_RESET_MS,
    edgeIndex,
    filterOptions,
    indexOfValue,
    keyIntent,
    stepIndex,
    typeaheadIndex,
    type SelectOption,
  } from './select-model';
  import { tip } from '../tip';

  interface Props {
    value: T;
    options: SelectOption<T>[];
    onchange: (v: T) => void;
    disabled?: boolean;
    tipText?: string;
    ariaLabel?: string;
    testid?: string;
    /** 选项 testid 前缀，实际为 `${prefix}-${value}`。 */
    optionTestidPrefix?: string;
    /** 弹层最小宽度（px）。默认跟随触发区。 */
    minWidth?: number;
    /**
     * 弹层顶部加一个筛选输入框。选项上百时（转场有 122 条）必需。
     *
     * 打开时**索引语义会变**：`active` 与 `indexOfValue` 一律作用在过滤后的
     * `visible` 上。筛选态下不接管字母键（否则用户没法打字）。
     */
    filterable?: boolean;
    filterPlaceholder?: string;
  }
  const {
    value,
    options,
    onchange,
    disabled = false,
    tipText,
    ariaLabel,
    testid = 'select',
    optionTestidPrefix = 'select-option',
    minWidth = 0,
    filterable = false,
    filterPlaceholder = '',
  }: Props = $props();

  /** 弹层 id，供 aria-controls 指向。 */
  const listboxId = $props.id();

  let open = $state(false);
  let active = $state(-1);
  let triggerEl = $state<HTMLDivElement | undefined>(undefined);
  let panelEl = $state<HTMLDivElement | undefined>(undefined);
  let filterEl = $state<HTMLInputElement | undefined>(undefined);
  const pos = $state({ x: -1, y: -1 });
  let panelWidth = $state(0);

  let query = $state('');
  /** 过滤后的选项：所有索引操作的唯一作用对象。 */
  const visible = $derived(filterable ? filterOptions(options, query) : options);

  const current = $derived(options.find((o) => o.value === value));
  /** 定位完成前不显示，避免在 (-1,-1) 闪一帧。$effect 在 DOM 更新后、绘制前跑，
   *  所以正常情况下这个值在第一次绘制时就已经是 true。 */
  const positioned = $derived(pos.x >= 0 && pos.y >= 0);

  let buffer = '';
  let bufferAt = 0;

  function openWith(startIndex: number): void {
    open = true;
    query = '';
    active = startIndex >= 0 ? startIndex : edgeIndex(visible, 'first');
  }

  function close(): void {
    open = false;
    query = '';
    pos.x = -1;
    pos.y = -1;
  }

  /** 打开后把焦点交给筛选框（键盘用户直接就能打字）。 */
  $effect(() => {
    if (open && filterable && filterEl) filterEl.focus();
  });

  /** 筛选结果变了就把高亮拉回第一项，否则 active 会指到过滤后的界外。 */
  $effect(() => {
    void query;
    if (!open || !filterable) return;
    active = edgeIndex(visible, 'first');
  });

  function commit(opt: SelectOption<T> | undefined): void {
    if (!opt || opt.disabled) return;
    close();
    if (opt.value !== value) onchange(opt.value);
  }

  // 定位：面板已渲染后量尺寸，再按 popover 的纯函数摆放（含贴边翻转）。
  $effect(() => {
    void open;
    void visible;
    if (!open) return;
    if (!panelEl || !triggerEl) return;
    const anchor = triggerEl.getBoundingClientRect();
    const size = { width: panelEl.offsetWidth, height: panelEl.offsetHeight };
    const p = computePopoverPosition(anchor, size, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    const w = Math.max(minWidth, anchor.width);
    if (panelWidth !== w) panelWidth = w;
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

  function onkeydown(e: KeyboardEvent): void {
    if (disabled) return;
    const intent = keyIntent(e.key, open);

    if (intent === 'open') {
      e.preventDefault();
      openWith(indexOfValue(visible, value));
      return;
    }
    if (!open || !intent) return;

    // 筛选态下文本键归输入框，不要被 typeahead 抢走（否则什么都打不出来）。
    if (intent === 'type') {
      if (filterable) return;
      e.preventDefault();
      const now = Date.now();
      buffer = now - bufferAt > TYPEAHEAD_RESET_MS ? e.key : buffer + e.key;
      bufferAt = now;
      active = typeaheadIndex(visible, buffer, active);
      return;
    }

    e.preventDefault();
    if (intent === 'cancel') {
      close();
      return;
    }
    if (intent === 'next' || intent === 'prev') {
      active = stepIndex(visible, active, intent === 'next' ? 1 : -1);
      return;
    }
    if (intent === 'first' || intent === 'last') {
      active = edgeIndex(visible, intent);
      return;
    }
    if (intent === 'commit') {
      commit(visible[active]);
    }
  }
</script>

<div
  class="sel"
  role="combobox"
  bind:this={triggerEl}
  tabindex={disabled ? -1 : 0}
  aria-expanded={open}
  aria-haspopup="listbox"
  aria-controls={open ? listboxId : undefined}
  aria-label={ariaLabel}
  aria-disabled={disabled}
  data-exempt
  data-testid={testid}
  use:tip={{ text: tipText ?? '', disabled: !tipText }}
  onclick={() => !disabled && (open ? close() : openWith(indexOfValue(visible, value)))}
  {onkeydown}
>
  <span class="sel-label">{current?.label ?? String(value)}</span>
  <span class="sel-arrow"><Icon name="chevron-right" size={11} /></span>
</div>

{#if open}
  <div
    class="sel-pop"
    id={listboxId}
    bind:this={panelEl}
    role="listbox"
    data-testid={`${testid}-pop`}
    style:left={`${pos.x}px`}
    style:top={`${pos.y}px`}
    style:min-width={`${panelWidth}px`}
    style:visibility={positioned ? undefined : 'hidden'}
  >
    {#if filterable}
      <input
        class="sel-filter"
        bind:this={filterEl}
        type="text"
        value={query}
        placeholder={filterPlaceholder}
        aria-label={filterPlaceholder}
        data-exempt
        data-testid={`${testid}-filter`}
        oninput={(e) => (query = e.currentTarget.value)}
        {onkeydown}
      />
    {/if}
    {#each visible as opt, i (opt.value)}
      <button
        type="button"
        class="sel-opt"
        role="option"
        tabindex="-1"
        aria-selected={opt.value === value}
        aria-disabled={opt.disabled}
        data-active={active === i ? 'true' : undefined}
        data-testid={`${optionTestidPrefix}-${opt.value}`}
        disabled={opt.disabled}
        onpointerenter={() => (active = i)}
        onclick={() => commit(opt)}
      >
        {opt.label}
      </button>
    {/each}
  </div>
{/if}
