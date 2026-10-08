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
    /**
     * 可编辑：触发区变成一个输入框，直接打字即改值；右侧箭头仍然打开预设列表。
     * PPT 的字号就是这套 —— 能输 37，也能点箭头从预设里挑。
     *
     * 键盘分工：输入框聚焦时方向键归光标（否则连"往右挪一格"都做不到），
     * 只接管 Enter（提交）、Esc（还原）、上下键（打开列表）。
     */
    editable?: boolean;
    /** editable 时，输入非预设值也按数字提交（字号允许 37 这种值）。 */
    numeric?: boolean;
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
    editable = false,
    numeric = false,
  }: Props = $props();

  /** 弹层 id，供 aria-controls 指向。 */
  const listboxId = $props.id();

  let open = $state(false);
  let active = $state(-1);
  let triggerEl = $state<HTMLDivElement | undefined>(undefined);
  let panelEl = $state<HTMLDivElement | undefined>(undefined);
  let filterEl = $state<HTMLInputElement | undefined>(undefined);
  let inputEl = $state<HTMLInputElement | undefined>(undefined);
  const pos = $state({ x: -1, y: -1 });
  let panelWidth = $state(0);

  let query = $state('');
  /** 过滤后的选项：所有索引操作的唯一作用对象。 */
  const visible = $derived(filterable ? filterOptions(options, query) : options);

  const current = $derived(options.find((o) => o.value === value));

  /* ------------------------------------------------------------ 可编辑模式 */

  /** 触发区里显示的文字。非编辑模式下它只是 current.label 的镜像。 */
  let text = $state('');
  let inputFocused = $state(false);

  function labelOf(v: T): string {
    return options.find((o) => o.value === v)?.label ?? String(v);
  }

  // 编辑器里没聚焦时才跟随外部值 —— 打字打到一半被覆盖是这类控件最烦的问题。
  $effect(() => {
    const v = value;
    void options;
    if (!inputFocused) text = labelOf(v);
  });

  /**
   * 提交键入的值：先按 label 匹配、再按 value 匹配，都不是才在 `numeric`
   * 下当数字收。匹配不上一律**还原**成当前值 —— 静默吞掉非法输入
   * 比报错更糟（用户以为改成功了）。
   */
  function commitText(): void {
    const raw = text.trim();
    text = labelOf(value);
    if (!raw) return;
    const byLabel = options.find((o) => o.label.toLowerCase() === raw.toLowerCase());
    if (byLabel) {
      if (byLabel.value !== value) onchange(byLabel.value);
      return;
    }
    const byValue = options.find((o) => String(o.value) === raw);
    if (byValue) {
      if (byValue.value !== value) onchange(byValue.value);
      return;
    }
    if (!numeric) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const next = (typeof value === 'string' ? String(n) : n) as T;
    if (next !== value) onchange(next);
  }

  function onEditKey(e: KeyboardEvent): void {
    if (disabled) return;
    // 列表开着时把导航整个让给它 —— 否则方向键会被这里重新「打开」一次，
    // 表现为高亮永远停在第一项。
    if (open) {
      onkeydown(e);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commitText();
      inputEl?.blur();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      text = labelOf(value);
      inputEl?.blur();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openWith(indexOfValue(visible, value));
    }
  }

  function onTriggerClick(e: MouseEvent): void {
    if (disabled) return;
    // 点正文（输入框）是去改文字，不是开列表。
    const t = e.target as Node | null;
    if (editable && t && inputEl && (t === inputEl || inputEl.contains(t))) return;
    open ? close() : openWith(indexOfValue(visible, value));
  }
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
  class:editable
  role="combobox"
  bind:this={triggerEl}
  tabindex={editable || disabled ? -1 : 0}
  aria-expanded={open}
  aria-haspopup="listbox"
  aria-controls={open ? listboxId : undefined}
  aria-label={ariaLabel}
  aria-disabled={disabled}
  data-exempt
  data-testid={testid}
  use:tip={{ text: tipText ?? '', disabled: !tipText }}
  onclick={onTriggerClick}
  onkeydown={(e) => !editable && onkeydown(e)}
>
  {#if editable}
    <!-- 可编辑触发区：直接打字即改值，右侧箭头仍开预设列表。 -->
    <input
      class="sel-input"
      bind:this={inputEl}
      type="text"
      inputmode={numeric ? 'decimal' : 'text'}
      autocomplete="off"
      spellcheck="false"
      aria-label={ariaLabel}
      {disabled}
      value={text}
      data-exempt
      data-testid={`${testid}-input`}
      oninput={(e) => (text = e.currentTarget.value)}
      onfocus={() => {
        inputFocused = true;
        text = labelOf(value);
      }}
      onblur={() => {
        inputFocused = false;
        commitText();
      }}
      onkeydown={onEditKey}
      onclick={(e) => e.stopPropagation()}
    />
  {:else}
    <span class="sel-label">{current?.label ?? String(value)}</span>
  {/if}
  <span class="sel-arrow"><Icon name="chevron-right" size={11} /></span>
</div>

{#if open}
  <!--
    弹层必须**拦住 wheel 冒泡**。

    不能只靠 CSS 的 `overscroll-behavior: contain`：那条只管**原生滚动链**，
    而 Ribbon 的横向滚动是自己写的一个 wheel 监听（`el.scrollLeft += e.deltaY`），
    它直接读事件、根本不走原生滚动 —— 于是「弹层与 Ribbon 重叠的那块滚一下，
    Ribbon 跟着横向滚」。`stopPropagation` 不影响弹层自己滚动。
  -->
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
    onwheel={(e) => e.stopPropagation()}
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
