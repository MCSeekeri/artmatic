<script lang="ts">
  /**
   * IconPickerModal — 「插入图标」选择器（Lucide 全量 1800+）。
   *
   * 三个设计点：
   *  1. **格子全部先渲染，内容按可见性懒加载**。1800 多个图标一次性
   *     `import()` 会把浏览器打成一锅粥；反过来「滚到哪渲染到哪」又会让滚动条
   *     一直跳。折中是骨架全渲染（`content-visibility: auto` 让屏外的几乎零成本），
   *     `IntersectionObserver` 只在格子进入视口时才取它那份图标数据。
   *  2. **多选按点击顺序**，底部「插入（N）」—— 一次挑几个图标是常态
   *     （一排社交图标、一组状态点），而顺序就是它们在画布上的排布顺序。
   *  3. **预览与舞台同语义**：格子里的 `<svg>` 与 `syncShape` 写的是同一套
   *     属性（fill=none + 圆头描边 + 同一个线宽换算），所见即所得。
   */
  import Modal from '../controls/Modal.svelte';
  import Button from '../controls/Button.svelte';
  import Icon from '../Icon.svelte';
  import { ICON_NAMES, loadIconPath, searchIcons } from './icon-library';
  import { ICON_STROKE_WIDTH, type IconInsert } from '../../typography/icon-shapes';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    /** 确认：按选择顺序给出图标。 */
    onapply: (items: IconInsert[]) => void;
    onclose: () => void;
  }
  const { onapply, onclose }: Props = $props();

  let query = $state('');
  let bodyEl = $state<HTMLElement | null>(null);
  /** 图标名 → 路径。加载完成才写进来（null = 没有这个图标 / 数据坏）。 */
  let paths = $state<Record<string, string | null>>({});
  /** 已选，**按点击顺序**（不是列表顺序）—— 它就是要插入的排布顺序。 */
  let selected = $state<string[]>([]);

  const visible = $derived(searchIcons(ICON_NAMES, query));
  /** 名字 → 选中序号。列表有 1800 项，每次渲染都 `indexOf` 是平方级开销。 */
  const order = $derived.by(() => new Map(selected.map((n, i) => [n, i])));

  /* ------------------------------------------------------------ 懒加载 */

  /** 已发起过加载的名字（失败的也不再重试）。 */
  const tried = new Set<string>();
  let observer: IntersectionObserver | null = null;
  const pending = new Set<HTMLElement>();

  function ensure(name: string): void {
    if (tried.has(name)) return;
    tried.add(name);
    void loadIconPath(name).then((d) => {
      paths[name] = d;
    });
  }

  $effect(() => {
    const root = bodyEl;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          const name = (e.target as HTMLElement).dataset.icon;
          if (name) ensure(name);
        }
      },
      // 提前一屏多开始取：滚动到那里时图标已经在了，不会看到一片空白。
      { root, rootMargin: '480px 0px' },
    );
    observer = io;
    for (const el of pending) io.observe(el);
    pending.clear();
    return () => {
      observer = null;
      io.disconnect();
    };
  });

  /**
   * 格子挂到共享观察器上。
   *
   * 用 action 而不是在 `$effect` 里 `querySelectorAll`：`#each` 重建时新格子
   * 只走自己的挂载路径，不需要「每次列表变化就全量重扫一遍 DOM」。
   */
  function lazyCell(node: HTMLElement, name: string) {
    node.dataset.icon = name;
    if (observer) observer.observe(node);
    else pending.add(node);
    return {
      destroy(): void {
        observer?.unobserve(node);
        pending.delete(node);
      },
    };
  }

  /* ------------------------------------------------------------ 交互 */

  function toggle(name: string): void {
    // 还没加载出来的格子不可选：否则「选了 N 个」与「插入 N 个」会对不上。
    if (!paths[name]) return;
    selected = selected.includes(name)
      ? selected.filter((n) => n !== name)
      : [...selected, name];
  }

  function apply(): void {
    const items: IconInsert[] = [];
    for (const name of selected) {
      const d = paths[name];
      if (d) items.push({ name, path: d });
    }
    if (items.length) onapply(items);
  }

  // 换了关键词就回到顶部：否则从中间开始，命中的图标全在屏幕外。
  $effect(() => {
    void query;
    bodyEl?.scrollTo({ top: 0 });
  });
</script>

{#snippet footer()}
  <span class="icp-count" data-testid="icon-picker-count">
    {tr('typo.iconPickerSelCount', { n: selected.length })}
  </span>
  <div class="icp-foot">
    <Button
      label={tr('common.cancel')}
      variant="outline"
      testid="icon-picker-cancel"
      onclick={onclose}
    />
    <Button
      label={selected.length > 0
        ? tr('typo.iconPickerApplyN', { n: selected.length })
        : tr('typo.iconPickerApply')}
      icon="plus"
      variant="accent"
      disabled={selected.length === 0}
      testid="icon-picker-confirm"
      onclick={apply}
    />
  </div>
{/snippet}

<Modal title={tr('rib.addIcon')} testid="modal-icon-picker" width="picker" flushBody {onclose} {footer}>
  <div class="icp">
    <div class="icp-bar">
      <label class="icp-search">
        <Icon name="search" size={14} />
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          autofocus
          data-testid="icon-picker-search"
          placeholder={tr('typo.iconPickerSearch')}
          bind:value={query}
        />
      </label>
    </div>

    <div class="icp-body" bind:this={bodyEl} data-testid="icon-picker-body">
      {#if visible.length === 0}
        <p class="icp-none" data-testid="icon-picker-none">
          {tr('typo.iconPickerNone')}
          <br /><span class="icp-none-hint">{tr('typo.iconPickerNoneHint')}</span>
        </p>
      {:else}
        {#each visible as name (name)}
          {@const d = paths[name]}
          {@const ord = order.get(name)}
          <button
            type="button"
            class="icp-cell"
            class:on={ord !== undefined}
            use:lazyCell={name}
            data-testid={`icon-cell-${name}`}
            title={name}
            aria-pressed={ord !== undefined}
            onclick={() => toggle(name)}
          >
            {#if d}
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <path
                  d={d}
                  fill="none"
                  stroke="currentColor"
                  stroke-width={ICON_STROKE_WIDTH}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            {/if}
            {#if ord !== undefined}
              <span class="icp-badge">{ord + 1}</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>

    <div class="icp-status" data-testid="icon-picker-hit">
      {tr('typo.iconPickerHit', { n: visible.length })}
    </div>
  </div>
</Modal>

<style>
  /* flex 列 + 主体自己滚动：modal 已 flushBody（见 Modal.svelte 的 width='picker'）。 */
  .icp {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  /* -------------------------------------------------------------- 工具栏 */
  .icp-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex-shrink: 0;
    padding: var(--sp-4) var(--sp-5);
    border-bottom: 1px solid var(--border);
  }
  .icp-search {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex: 1;
    min-width: 0;
    height: var(--control-h);
    padding: 0 var(--sp-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--input-bg);
    color: var(--text-muted);
  }
  .icp-search:focus-within {
    border-color: var(--accent);
  }
  .icp-search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    outline: none;
  }

  /* ---------------------------------------------------------------- 网格 */
  .icp-body {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
    gap: var(--sp-2);
    align-content: start;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--sp-4) var(--sp-5);
  }
  /*
   * 屏幕外的格子浏览器不排版、不绘制 —— 1800 个骨架节点的成本主要就在这儿。
   * `contain-intrinsic-size` 必须给：否则未知高度会让滚动条随滚动不停抖。
   */
  .icp-cell {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    content-visibility: auto;
    contain-intrinsic-size: auto 52px;
  }
  .icp-cell svg {
    width: 70%;
    height: 70%;
  }
  .icp-cell:hover {
    border-color: var(--border);
    background: var(--surface-2);
    color: var(--text-primary);
  }
  .icp-cell.on {
    border-color: var(--accent);
    background: var(--surface-active);
    color: var(--text-primary);
  }
  .icp-badge {
    position: absolute;
    top: 1px;
    right: 2px;
    min-width: 12px;
    padding: 0 2px;
    border-radius: 2px;
    background: var(--accent);
    color: var(--on-accent, #fff);
    font-size: var(--fs-xs);
    line-height: 12px;
    text-align: center;
  }

  .icp-none {
    grid-column: 1 / -1;
    margin: var(--sp-6) 0;
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: center;
  }
  .icp-none-hint {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }

  /* 命中数：固定一条，滚动时不跟着走 —— 它是筛选器的读数，不是列表的注脚。 */
  .icp-status {
    flex-shrink: 0;
    padding: var(--sp-2) var(--sp-5);
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }

  /* -------------------------------------------------------------- 底栏 */
  /* modal-foot 是 flex-end：已选计数推到左边，两个按钮留在右边。 */
  .icp-count {
    margin-right: auto;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }
  .icp-foot {
    display: flex;
    gap: var(--sp-3);
  }
</style>
