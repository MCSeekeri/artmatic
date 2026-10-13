<script lang="ts">
  /**
   * ColorPickerPanel — Office 式取色卡（「主题颜色 / 标准色 / 最近使用 / 其他颜色 / 取色器」）。
   *
   * 为什么不用原生 `<input type="color">`：它能取到任意色，但**给不出主题色**。
   * 而我们整套「换配色方案 → 用了主题色的元素自动跟着换」都建立在
   * 「用户挑的是一个**槽位引用**（`@accent1`）而不是一个 hex」之上 ——
   * 系统取色器里没有这个概念，只能盲选。
   *
   * 这个组件**只负责内容**，不管定位与关闭：定位是 fixed + 贴边翻转
   * （ribbon 的面板会裁剪 absolute 弹层），关闭是外点/Esc/滚轮 —— 两件事
   * 都由宿主用 `controls/popover.ts` 的同一套纯函数处理（见 RibbonColor）。
   *
   * 选中态同时认**引用**与**裸 hex**：前者高亮主题网格里对应的那一格
   * （含变体），后者是标准色 / 最近使用 / 其他颜色来的值。
   */
  import Icon from '../Icon.svelte';
  import { tr } from '../../i18n/index.svelte';
  import {
    SHADE_IDS,
    SHADE_LABEL,
    STANDARD_COLORS,
    THEME_SLOT_LABEL,
    paletteGrid,
    parseThemeRef,
    themeRef,
    type ShadeId,
    type ThemeSlot,
    type TypographyTheme,
  } from '../../typography/theme';
  import { rememberRecentColor, recentColors } from '../typography/recent-colors';

  interface Props {
    value: string;
    /** 当前文档的配色方案 —— 主题网格的数据源。 */
    theme: TypographyTheme;
    /** 显示「无颜色」项（高亮 / 填充这类可以「没有」的颜色）。 */
    allowNone?: boolean;
    onchange: (v: string) => void;
    testid?: string;
  }
  const { value = '', theme, allowNone = false, onchange, testid = 'color-picker' }: Props = $props();

  const grid = $derived(paletteGrid(theme));
  const recent = $derived(recentColors());

  /**
   * 网格的行：第 0 行是原色槽（没有变体标记），后面 5 行各带一个变体标记
   * （点击时写成 `@slot.<变体>`）。行序 = 网格从上到下。
   */
  const rows = $derived([
    { label: null as ShadeId | null, colors: grid.base },
    ...grid.variants.map((colors, i) => ({ label: SHADE_IDS[i] ?? null, colors })),
  ]);

  /** 当前值拆成「引用 / 裸色」两态，网格与标准色各认一边。 */
  const activeRef = $derived(parseThemeRef(value));

  /** 该格子是不是当前选中项。 */
  function isActiveRef(slot: ThemeSlot, shade: ShadeId | null): boolean {
    return activeRef?.slot === slot && activeRef.shade === shade;
  }
  function isActiveHex(hex: string): boolean {
    return !activeRef && value.toLowerCase() === hex.toLowerCase();
  }

  /** 选色：记一次「最近使用」（只记裸色）后回调。 */
  function pick(color: string): void {
    if (!color.startsWith('@')) rememberRecentColor(color);
    onchange(color);
  }

  /* ------------------------------------------------------------ 取色器 */

  interface EyeDropperCtor {
    new (): { open(): Promise<{ sRGBHex: string }> };
  }
  /** 只有 Chromium 系有；别的地方整项隐藏（灰着更让人费解）。 */
  const eyedropperCtor = $derived(
    typeof window === 'undefined'
      ? undefined
      : (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper,
  );

  async function pickFromScreen(): Promise<void> {
    const Ctor = eyedropperCtor;
    if (!Ctor) return;
    try {
      const { sRGBHex } = await new Ctor().open();
      pick(sRGBHex);
    } catch {
      /* 用户按 Esc 取消取色 —— 这不是错误，什么都不做。 */
    }
  }

  /* ------------------------------------------------------------ 其他颜色 */

  /**
   * 「其他颜色…」= 系统取色器。
   *
   * 原生 input 必须**真实存在于 DOM 里**才能被 click() 唤起（display:none
   * 的元素在部分浏览器上不触发），所以用 0 尺寸 + opacity 0 而不是 display:none。
   */
  let nativePicker = $state<HTMLInputElement | undefined>(undefined);
  function openNative(): void {
    nativePicker?.click();
  }
  const safeNativeValue = $derived(/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000');
</script>

<div class="picker" data-testid={testid}>
  <div class="sec-title">{tr('rib.pick.themeColors')}</div>
  {#each rows as row, ri (ri)}
    <div class="grid" class:gap-below={ri === 0}>
      {#each row.colors as color, ci (ci)}
        {@const slot = grid.slots[ci]!}
        <button
          type="button"
          class="sw"
          class:active={isActiveRef(slot, row.label)}
          style:--c={color}
          title={row.label ? `${tr(THEME_SLOT_LABEL[slot])} ${tr(SHADE_LABEL[row.label])}` : tr(THEME_SLOT_LABEL[slot])}
          aria-label={row.label ? `${tr(THEME_SLOT_LABEL[slot])} ${tr(SHADE_LABEL[row.label])}` : tr(THEME_SLOT_LABEL[slot])}
          data-testid={`${testid}-theme-${themeRef(slot, row.label)}`}
          onclick={() => pick(themeRef(slot, row.label))}
        ></button>
      {/each}
    </div>
  {/each}

  <div class="sec-title">{tr('rib.pick.standardColors')}</div>
  <div class="grid">
    {#each STANDARD_COLORS as color (color)}
      <button
        type="button"
        class="sw"
        class:active={isActiveHex(color)}
        style:--c={color}
        title={color}
        aria-label={color}
        data-testid={`${testid}-std-${color.slice(1)}`}
        onclick={() => pick(color)}
      ></button>
    {/each}
  </div>

  {#if recent.length}
    <div class="sec-title">{tr('rib.pick.recentColors')}</div>
    <div class="grid">
      {#each recent as color (color)}
        <button
          type="button"
          class="sw"
          class:active={isActiveHex(color)}
          style:--c={color}
          title={color}
          aria-label={color}
          data-testid={`${testid}-recent-${color.slice(1)}`}
          onclick={() => pick(color)}
        ></button>
      {/each}
    </div>
  {/if}

  <div class="sep"></div>

  {#if allowNone}
    <button
      type="button"
      class="act"
      class:active={activeRef === null && value === ''}
      data-testid={`${testid}-none`}
      onclick={() => onchange('')}
    >
      <span class="none-sw"></span>
      <span class="act-label">{tr('rib.pick.none')}</span>
    </button>
  {/if}

  <button type="button" class="act" data-testid={`${testid}-more`} onclick={openNative}>
    <span class="act-icon"><Icon name="palette" size={14} /></span>
    <span class="act-label">{tr('rib.pick.moreColors')}</span>
  </button>

  {#if eyedropperCtor}
    <button type="button" class="act" data-testid={`${testid}-dropper`} onclick={pickFromScreen}>
      <span class="act-icon"><Icon name="droplet" size={14} /></span>
      <span class="act-label">{tr('rib.pick.eyedropper')}</span>
    </button>
  {/if}

  <!--
    原生取色器只在 **change**（用户确认）上提交，**不听 `input`**。

    为什么：`<input type="color">` 在拖动过程中会持续派发 `input`，而我们的
    提交动作要顺手关掉取色卡 —— 弹层一关，这个 `<input>` 就从 DOM 上摘掉了，
    原生取色器随之被强制关闭。表现是「点一下取色器，它和取色卡一起消失，
    颜色根本拖不动」（用户报的 bug）。

    代价：拖动中没有实时预览（舞台上看到的是松手后的颜色）。可以接受 ——
    原生取色器自己有色块预览，而**一次确认 = 一笔撤销**是本项目的硬纪律
    （把 `input` 接进去的话，拖一次色会往撤销栈里塞几十笔）。
    真正需要实时预览的场合应该走手势事务（见 actions.ts 的 live/endGesture）。
  -->
  <input
    class="native"
    bind:this={nativePicker}
    type="color"
    value={safeNativeValue}
    tabindex="-1"
    aria-hidden="true"
    data-testid={`${testid}-native`}
    onchange={(e) => pick(e.currentTarget.value)}
  />
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 226px;
  }
  .sec-title {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(10, 20px);
    gap: 2px;
  }
  /* 第一行（原色槽）与下面的变体行之间留一道空隙 —— 与 Office 的分组感一致。 */
  .grid.gap-below {
    margin-bottom: 6px;
  }
  .sw {
    width: 20px;
    height: 20px;
    padding: 0;
    background: var(--c);
    border: 1px solid var(--border-strong);
    border-radius: 2px;
    cursor: pointer;
  }
  .sw:hover {
    border-color: var(--text-primary);
  }
  .sw.active {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .sep {
    height: 1px;
    background: var(--menu-border);
    margin: 2px 0;
  }
  .act {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 4px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .act:hover {
    background: var(--surface-hover);
    border-color: var(--border);
  }
  .act.active {
    border-color: var(--accent-border);
  }
  .act-icon,
  .none-sw {
    display: inline-flex;
    width: 14px;
    justify-content: center;
    color: var(--text-secondary);
  }
  /* 「无颜色」的示意：白底加一道斜线（与 Office 同款，不用文字解释）。 */
  .none-sw {
    position: relative;
    width: 14px;
    height: 14px;
    background: var(--surface-3);
    border: 1px solid var(--border-strong);
    border-radius: 2px;
  }
  .none-sw::after {
    content: '';
    position: absolute;
    left: -1px;
    top: 6px;
    width: 14px;
    height: 1px;
    background: var(--danger);
    transform: rotate(-45deg);
  }
  .act-label {
    white-space: nowrap;
  }
  /* 原生取色器：要能 click() 唤起，所以是 0 尺寸 + 透明而不是 display:none。 */
  .native {
    position: absolute;
    width: 0;
    height: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    pointer-events: none;
  }
</style>
