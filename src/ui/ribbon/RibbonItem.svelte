<script lang="ts">
  /**
   * RibbonItem — 把一个 RibbonItemSpec 渲染成控件。
   *
   * 宽度是**显式**的（`--stack-w`），不是由内容撑开。原因有两个：
   *  1. 组的宽度必须可预测，否则容器一换内容（比如字体名变长）整条 Ribbon
   *     的布局就会跳一下；
   *  2. 长文本靠 `text-overflow: ellipsis` 截断，而不是把邻居挤走。
   *
   * 注意 controls 的 `.sel` 自带 `flex: 1`。它放进 `flex-direction: column`
   * 的容器里时，`flex` 控制的是**高度** —— 会被拉满整个按钮高度，看起来
   * 「下拉框比按钮还高」。所以这里显式覆盖掉。
   */
  import Select from '../controls/Select.svelte';
  import NumberInput from '../controls/NumberInput.svelte';
  import RibbonButton from './RibbonButton.svelte';
  import RibbonToggle from './RibbonToggle.svelte';
  import RibbonColor from './RibbonColor.svelte';
  import RibbonSegment from './RibbonSegment.svelte';
  import RibbonGallery from './RibbonGallery.svelte';
  import RibbonMenu from './RibbonMenu.svelte';
  import RibbonThemes from './RibbonThemes.svelte';
  import { itemWidth, type RibbonItemSpec } from './ribbon-model';

  interface Props {
    item: RibbonItemSpec;
  }
  const { item }: Props = $props();

  // 间隔没有宽度（它吃的是剩余空间），所以不走通用的宽度推算。
  const w = $derived(item.kind === 'spacer' ? 0 : (item.width ?? itemWidth(item)));
  /** 数字框比按钮窄，减去左右内边距才是控件宽度。 */
  const inner = $derived(Math.max(40, w - 8));
</script>

{#if item.kind === 'button'}
  <RibbonButton
    icon={item.icon}
    label={item.label}
    size={item.size}
    width={w}
    disabled={item.disabled}
    testid={item.testid}
    onactivate={item.onselect}
  />
{:else if item.kind === 'toggle'}
  <RibbonToggle
    icon={item.icon}
    label={item.label}
    size={item.size}
    width={w}
    active={item.active}
    disabled={item.disabled}
    testid={item.testid}
    onchange={item.onchange}
  />
{:else if item.kind === 'color'}
  <RibbonColor
    label={item.label}
    value={item.value}
    theme={item.themeId}
    icon={item.icon}
    size={item.size}
    allowNone={item.allowNone}
    disabled={item.disabled}
    testid={item.testid}
    onchange={item.onchange}
  />
{:else if item.kind === 'menu'}
  <RibbonMenu
    label={item.label}
    icon={item.icon}
    items={item.items}
    numeric={item.numeric}
    size={item.size}
    disabled={item.disabled}
    testid={item.testid}
  />
{:else if item.kind === 'themes'}
  <RibbonThemes
    label={item.label}
    options={item.options}
    value={item.value}
    size={item.size}
    disabled={item.disabled}
    testid={item.testid}
    onselect={item.onselect}
    onremove={item.onremove}
  />
{:else if item.kind === 'spacer'}
  <span class="rspacer" aria-hidden="true"></span>
{:else if item.kind === 'select'}
  <div class="stack" style:--stack-w={`${w}px`}>
    <Select
      value={item.value}
      options={item.options}
      disabled={item.disabled}
      testid={item.testid}
      optionTestidPrefix={item.optionTestidPrefix}
      minWidth={item.minWidth ?? w}
      ariaLabel={item.label}
      editable={item.editable}
      numeric={item.numeric}
      filterable={item.filterable}
      filterPlaceholder={item.filterPlaceholder}
      onchange={item.onchange}
    />
    {#if !item.hideLabel}
      <span class="lbl">{item.label}</span>
    {/if}
  </div>
{:else if item.kind === 'number'}
  <div class="stack" style:--stack-w={`${w}px`}>
    <NumberInput
      value={item.value}
      min={item.min}
      max={item.max}
      step={item.step ?? 1}
      precision={item.precision}
      suffix={item.suffix}
      width={inner}
      disabled={item.disabled}
      testid={item.testid}
      ariaLabel={item.label}
      oninput={item.oninput}
      onliveend={item.onliveend}
      onchange={item.onchange}
    />
    {#if !item.hideLabel}
      <span class="lbl">{item.label}</span>
    {/if}
  </div>
{:else if item.kind === 'gallery'}
  <RibbonGallery
    cards={item.cards}
    label={item.label}
    columns={item.columns}
    disabled={item.disabled}
    testid={item.testid}
    onselect={item.onselect}
  />
{:else if item.kind === 'segment'}
  <div class="stack" style:--stack-w={`${w}px`}>
    <RibbonSegment
      value={item.value}
      options={item.options}
      disabled={item.disabled}
      testid={item.testid}
      onchange={item.onchange}
    />
    {#if !item.hideLabel}
      <span class="lbl">{item.label}</span>
    {/if}
  </div>
{/if}

<style>
  .stack {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 4px;
    width: var(--stack-w);
    flex: none;
    padding: 0 4px;
  }
  /* 覆盖 controls 的 `.sel { flex: 1 }`：在 column 容器里它会把高度拉满。
     宽度也要钉死，否则长字体名会把整组撑宽。 */
  .stack :global(.sel) {
    flex: none;
    width: 100%;
    height: var(--control-h);
  }
  .lbl {
    text-align: center;
    font-size: var(--fs-xs);
    line-height: 1.1;
    color: var(--ribbon-group-label);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /*
   * 行内间隔：吃掉剩余宽度。
   *
   * `min-width` 不是装饰 —— 两排内容一样长时剩余是 0，没有下限的话这一格
   * 会塌成 0 宽，两侧的按钮贴在一起（看起来像少了一个间隔）。
   */
  .rspacer {
    flex: 1 1 0;
    min-width: 6px;
    align-self: stretch;
  }
</style>
