<script lang="ts">
  /**
   * RibbonThemes — 配色方案图库（「设计」选项卡用）。
   *
   * 每一项是**一排色块 + 方案名**：配色方案靠名字挑不出来，「蓝色暖调」到底
   * 暖到什么程度只能看。色块顺序与 Office 的缩略图一致（深色 2 / 浅色 2 再
   * 六个强调色）—— 那是用户认方案的位置记忆。
   *
   * 与 `RibbonGallery`（形状）分开一个组件：那个的卡片是「一张单色 SVG」，
   * 这个是「多条色带」，塞进同一套渲染里会长出两个 if 分支。
   *
   * 自定义方案可以**右键移除**（内置方案只读）。右键菜单渲染在组件根，不在
   * `{#if open}` 里面 —— 点菜单项时指针不在图库面板上，图库会先自关，嵌套的
   * 菜单会被连带卸载，点击根本落不到菜单项上。
   */
  import Icon from '../Icon.svelte';
  import Menu from '../controls/Menu.svelte';
  import type { MenuItem } from '../controls/menu-model';
  import { attachDismiss, computePopoverPosition } from '../controls/popover';
  import type { RibbonItemSize } from './ribbon-model';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    label: string;
    options: { id: string; label: string; colors: string[]; removable?: boolean }[];
    value: string;
    size?: RibbonItemSize;
    disabled?: boolean;
    testid?: string;
    onselect: (id: string) => void;
    /** 移除一份自定义方案（只对 `options[].removable` 生效）。 */
    onremove?: (id: string) => void;
  }
  const {
    label,
    options,
    value,
    size = 'large',
    disabled = false,
    testid = 'themes',
    onselect,
    onremove,
  }: Props = $props();

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement | undefined>(undefined);
  let panelEl = $state<HTMLDivElement | undefined>(undefined);
  const pos = $state({ x: -1, y: -1 });
  const positioned = $derived(pos.x >= 0 && pos.y >= 0);
  const panelId = $props.id();
  /** 右键菜单的屏幕坐标与被点的方案。null = 关着。 */
  let ctx = $state<{ x: number; y: number; id: string; label: string } | null>(null);

  /**
   * 右键菜单的项。**id 必须在这里闭包捕获**：`Menu.activate` 会先 `onclose()`
   * 再跑 `onselect()`，那时 `ctx` 已经是 null，回调里再去读就拿不到 id 了。
   */
  const ctxItems = $derived.by<MenuItem[]>(() => {
    const c = ctx;
    if (!c) return [];
    return [
      {
        id: 'remove',
        label: tr('rib.themeRemove'),
        icon: 'trash',
        danger: true,
        testid: `${testid}-remove`,
        onselect: () => onremove?.(c.id),
      },
    ];
  });

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
      // 右键要开的是移除菜单，不能把图库自己先关掉（面板一没，contextmenu 就
      // 落不到那一行上了）。
      keepOnRightButton: true,
    });
    return () => handle.destroy();
  });

  function pick(id: string): void {
    close();
    if (id !== value) onselect(id);
  }

  function openCtx(e: MouseEvent, opt: Props['options'][number]): void {
    if (!onremove || !opt.removable) return;
    e.preventDefault();
    e.stopPropagation();
    ctx = { x: e.clientX, y: e.clientY, id: opt.id, label: opt.label };
  }
</script>

<button
  type="button"
  class="rt"
  class:icon={size === 'icon'}
  class:open
  bind:this={triggerEl}
  {disabled}
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={open ? panelId : undefined}
  title={label}
  aria-label={label}
  data-testid={testid}
  onclick={() => !disabled && (open = !open)}
>
  <span class="rt-icon"><Icon name="palette" size={size === 'icon' ? 15 : 16} /></span>
  {#if size !== 'icon'}<span class="rt-label">{label}</span>{/if}
</button>

{#if open}
  <div
    class="rt-pop"
    id={panelId}
    bind:this={panelEl}
    role="listbox"
    aria-label={label}
    data-testid={`${testid}-pop`}
    style:left={`${pos.x}px`}
    style:top={`${pos.y}px`}
    style:visibility={positioned ? undefined : 'hidden'}
    onwheel={(e) => e.stopPropagation()}
  >
    {#each options as opt (opt.id)}
      <button
        type="button"
        class="th"
        class:active={opt.id === value}
        role="option"
        aria-selected={opt.id === value}
        data-testid={`${testid}-opt-${opt.id}`}
        onclick={() => pick(opt.id)}
        oncontextmenu={(e) => openCtx(e, opt)}
      >
        <span class="bands">
          {#each opt.colors as c, i (i)}
            <span class="band" style:--c={c}></span>
          {/each}
        </span>
        <span class="th-label">{opt.label}</span>
      </button>
    {/each}
  </div>
{/if}

{#if ctx}
  <Menu
    items={ctxItems}
    at={ctx}
    head={{ label: ctx.label }}
    onclose={() => (ctx = null)}
    testid={`${testid}-ctx`}
  />
{/if}

<style>
  .rt {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 46px;
    height: 100%;
    padding: 0 6px;
    background: transparent;
    border: 1px solid var(--ribbon-btn-border);
    border-radius: var(--radius-sm);
    color: var(--ribbon-btn-fg);
    cursor: pointer;
    user-select: none;
  }
  .rt.icon {
    flex-direction: row;
    min-width: var(--ribbon-icon-w, 26px);
    height: var(--ribbon-icon-h, 24px);
    padding: 0;
  }
  .rt:hover:not(:disabled) {
    background: var(--ribbon-btn-bg-hover);
    color: var(--ribbon-btn-fg-hover);
  }
  .rt.open {
    background: var(--ribbon-btn-bg-active);
    color: var(--ribbon-btn-fg-active);
    border-color: var(--accent-border);
  }
  .rt:disabled {
    color: var(--ribbon-btn-fg-disabled);
    cursor: default;
  }
  .rt-icon {
    display: inline-flex;
  }
  .rt-label {
    font-size: var(--fs-xs);
    line-height: 1.1;
    white-space: nowrap;
  }

  .rt-pop {
    position: fixed;
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    gap: 1px;
    /*
     * 23 个方案一列排不下来，所以给一个**视口相关**的上限再滚动。
     * 用 vh 而不是写死 px：小窗口下 420px 会把面板顶到屏幕外，而弹层的
     * 贴边翻转只在「完全放不下」时才翻，装得下但压到边的情形它救不了。
     */
    max-height: min(420px, 66vh);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--sp-2);
    background: var(--menu-bg);
    border: 1px solid var(--menu-border);
    border-radius: var(--radius-md);
  }
  .th {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .th:hover {
    background: var(--surface-hover);
  }
  .th.active {
    border-color: var(--accent-border);
    color: var(--accent);
  }
  .bands {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: 2px;
    overflow: hidden;
  }
  .band {
    width: 14px;
    height: 14px;
    background: var(--c);
  }
  .th-label {
    white-space: nowrap;
  }
</style>
