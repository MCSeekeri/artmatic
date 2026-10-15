<script lang="ts">
  /**
   * ColorField — 面板用的取色卡入口：一个色块按钮，点开是 `ColorPickerPanel`
   * （主题色 / 标准色 / 最近使用 / 其他颜色 / 取色器）。
   *
   * 为什么替换原生 `<input type="color">`：原生控件给不出**主题色引用**
   * （`@accent1`），于是「换配色方案 → 用了主题色的元素跟着变」在这些入口上
   * 根本没有发生的可能。取色卡里写进文档的是槽位引用，那才是配色方案能
   * 生效的原因（ Ribbon 的颜色按钮早就是这么做的，见 RibbonColor）。
   *
   * 值的口径与 Ribbon 的颜色按钮一致：**存进去的可能是引用，显示的是解析后的
   *  hex**；而从面板里改色写回的是**裸 hex** —— 这些位置是精细调整区，
   * 「改完就该钉死」，引用只在取色卡里产生。
   *
   * 定位与关闭照抄 RibbonColor 的同一套纯函数（`controls/popover.ts`）：
   * fixed + 贴边翻转，外点 / Esc / 滚轮关闭。弹层里必须 `stopPropagation`
   * 滚轮 —— 否则在卡片上滚一下会把背后的面板也滚了。
   */
  import ColorPickerPanel from './ColorPickerPanel.svelte';
  import { attachDismiss, computePopoverPosition } from './popover';
  import {
    resolveThemeColor,
    themeById,
    type TypographyTheme,
  } from '../../typography/theme';

  interface Props {
    /** 文档里存的值（可能是 `@accent1` 这样的主题引用；空 = 无颜色）。 */
    value: string;
    /** 当前配色方案：对象 / id / 不传（= 默认方案）。 */
    theme?: TypographyTheme | string | null;
    /** 工程自定义方案（`theme` 给 id 时，id 可能是自定义的）。 */
    customThemes?: readonly TypographyTheme[] | null;
    /** 允许「无颜色」（高亮 / 填充这类可以没有的颜色）。 */
    allowNone?: boolean;
    /** 无障碍名（色块没有文字，必须给）。 */
    label: string;
    /** 宿主想加在按钮上的类（尺寸微调）。 */
    class?: string;
    testid?: string;
    onchange: (v: string) => void;
  }
  const {
    value = '',
    theme = null,
    customThemes = null,
    allowNone = false,
    label,
    class: className = '',
    testid,
    onchange,
  }: Props = $props();

  const palette = $derived(
    typeof theme === 'object' && theme !== null ? theme : themeById(theme, customThemes),
  );
  /** 色块上显示的是**解析后**的颜色（值可能是 `@accent1` 这种引用）。 */
  const swatch = $derived(value ? resolveThemeColor(value, palette) : '');

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
  class="cf {className}"
  class:open
  class:none={!value}
  bind:this={triggerEl}
  style:--c={swatch || 'transparent'}
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-controls={open ? panelId : undefined}
  aria-label={label}
  title={label}
  data-testid={testid}
  onclick={toggle}
>
  {#if !value}<span class="cf-none" aria-hidden="true"></span>{/if}
</button>

{#if open}
  <div
    class="cf-pop"
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
      {value}
      theme={palette}
      {allowNone}
      testid={testid ? `${testid}-palette` : 'color-picker'}
      onchange={pick}
    />
  </div>
{/if}

<style>
  .cf {
    position: relative;
    display: block;
    width: 26px;
    height: 18px;
    padding: 0;
    background: var(--c);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .cf:hover {
    border-color: var(--text-primary);
  }
  .cf.open {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  /* 「无颜色」：白底一道斜线（与取色卡里的「无颜色」项同款，不用文字解释）。 */
  .cf.none {
    background: var(--surface-0);
  }
  .cf-none {
    position: absolute;
    left: -1px;
    top: 8px;
    width: 26px;
    height: 1px;
    background: var(--danger);
    transform: rotate(-45deg);
  }
  .cf-pop {
    position: fixed;
    z-index: var(--z-menu);
    padding: var(--sp-3);
    background: var(--menu-bg);
    border: 1px solid var(--menu-border);
    border-radius: var(--radius-md);
  }
</style>
