<script lang="ts">
  /**
   * RibbonColor — Office 式的颜色按钮：**图标 + 一条当前色的色条**，
   * 点开是本项目的取色卡（主题色 / 标准色 / 最近使用 / 其他颜色 / 取色器）。
   *
   * 与原来的原生 `<input type="color">` 版本的区别不只是外观：原生取色器
   * **给不出主题色**，于是「换配色方案，用了主题色的元素跟着换」这条功能
   * 在 UI 上根本没有入口。色卡里的主题网格写的是**槽位引用**（`@accent1`），
   * 那才是配色方案能生效的原因。
   *
   * 弹层用 `position: fixed` + `popover.ts` 的纯函数定位，**不能**是 absolute：
   * Ribbon 的面板是 `overflow: auto/hidden`（横向滚动 + 固定高度），
   * absolute 弹层会被整个裁掉 —— 这条踩过一次（见 ribbon-model 的文件头）。
   */
  import Icon from '../Icon.svelte';
  import ColorPickerPanel from '../controls/ColorPickerPanel.svelte';
  import { attachDismiss, computePopoverPosition } from '../controls/popover';
  import type { IconName } from '../icons';
  import type { RibbonItemSize } from './ribbon-model';
  import { resolveThemeColor, themeById, type TypographyTheme } from '../../typography/theme';

  interface Props {
    label: string;
    value: string;
    /**
     * 当前配色方案。可以给方案对象、id、或什么都不给（缺省 = 默认方案）。
     * 由调用方从文档上取 —— 组件自己不认识 TypographyDocument。
     */
    theme?: TypographyTheme | string | null;
    /** 图标（Office 式按钮）。不给则用「填充」图标。 */
    icon?: IconName;
    /** `icon` = 纯图标 + 底部色条（字体区第二排用）；`large` = 图标 + 文字。 */
    size?: RibbonItemSize;
    /** 允许「无颜色」（高亮 / 填充这类可以没有的颜色）。 */
    allowNone?: boolean;
    disabled?: boolean;
    testid?: string;
    onchange: (value: string) => void;
  }
  const {
    label,
    value,
    theme = null,
    icon = 'paint-bucket',
    size = 'large',
    allowNone = false,
    disabled = false,
    testid,
    onchange,
  }: Props = $props();

  const palette = $derived(typeof theme === 'object' && theme !== null ? theme : themeById(theme));
  /** 色条上显示的是**解析后**的颜色（值可能是 `@accent1` 这种引用）。 */
  const swatch = $derived(resolveThemeColor(value, palette));

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

  function toggle(): void {
    if (disabled) return;
    open = !open;
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

  function pick(v: string): void {
    close();
    onchange(v);
  }
</script>

<button
  type="button"
  class="rcolor"
  class:icon={size === 'icon'}
  class:disabled
  class:open
  bind:this={triggerEl}
  {disabled}
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-controls={open ? panelId : undefined}
  aria-label={label}
  title={label}
  data-testid={testid}
  onclick={toggle}
>
  <span class="rcolor-icon"><Icon name={icon} size={size === 'large' ? 18 : 15} /></span>
  {#if size === 'large'}<span class="lbl">{label}</span>{/if}
  <span class="bar" style:--c={value ? swatch : 'transparent'}></span>
</button>

{#if open}
  <div
    class="rcolor-pop"
    id={panelId}
    bind:this={panelEl}
    role="dialog"
    aria-label={label}
    data-testid={testid ? `${testid}-pop` : undefined}
    style:left={`${pos.x}px`}
    style:top={`${pos.y}px`}
    style:visibility={positioned ? undefined : 'hidden'}
    onwheel={(e) => e.stopPropagation()}
  >
    <ColorPickerPanel
      value={value}
      theme={palette}
      {allowNone}
      testid={testid ? `${testid}-palette` : 'color-picker'}
      onchange={pick}
    />
  </div>
{/if}

<style>
  .rcolor {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: var(--ribbon-btn-w, 50px);
    height: var(--ribbon-btn-h, 56px);
    padding: 2px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--ribbon-btn-fg);
    cursor: pointer;
  }
  /*
   * 紧凑档（字体区第二排）：纯图标 + 底部色条，无文字。
   * 高度与同排的其它图标按钮一致，色条压在底边 —— 这正是 Office 的形态。
   */
  .rcolor.icon {
    width: var(--ribbon-icon-w, 26px);
    height: var(--ribbon-icon-h, 24px);
    padding: 0;
  }
  .rcolor:hover:not(.disabled) {
    background: var(--ribbon-btn-bg-hover);
    color: var(--ribbon-btn-fg-hover);
  }
  .rcolor.open {
    background: var(--ribbon-btn-bg-active);
    color: var(--ribbon-btn-fg-active);
  }
  .rcolor.disabled {
    color: var(--ribbon-btn-fg-disabled);
    cursor: default;
  }
  .rcolor-icon {
    display: inline-flex;
  }
  .bar {
    position: absolute;
    left: 4px;
    right: 4px;
    bottom: 2px;
    height: 3px;
    background: var(--c);
    /* 1px 描边：白色/浅色色条在浅底上也要看得见。没有阴影可用（视觉纪律）。 */
    border: 1px solid var(--border-strong);
    border-radius: 1px;
  }
  .rcolor.icon .bar {
    left: 3px;
    right: 3px;
    bottom: 1px;
  }
  .lbl {
    font-size: var(--fs-xs);
    line-height: 1.1;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rcolor-pop {
    position: fixed;
    z-index: var(--z-menu);
    padding: var(--sp-3);
    background: var(--menu-bg);
    border: 1px solid var(--menu-border);
    border-radius: var(--radius-md);
    /* 面板与密集的 Ribbon 同源：内容自己定宽，这里只管外壳。 */
  }
</style>
