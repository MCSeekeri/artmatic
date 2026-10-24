<script lang="ts">
  /**
   * Ribbon — Tab 条 + 激活面板（数据驱动）。
   *
   * 这个组件**不认识排版文档**，只认 `RibbonTabDef[]`。业务侧（ribbon-defs.ts）
   * 负责把「文档 + 选择集 + 动作」编译成描述数组，于是换文档模型、加新 Tab
   * 都不用动这里一行。
   *
   * 装不下时**横向滚动**，不做「更多」溢出按钮：面板高度必须是固定的
   * （否则舞台高度会随窗口宽度抖动），而任何开在面板内部的弹层都会被这个
   * 裁剪吃掉 —— 试过一版 popover 溢出，用户反馈「更多按钮没有用」。
   * Office 也是横向滚动条，照做。
   */
  import RibbonGroup from './RibbonGroup.svelte';
  import RibbonItem from './RibbonItem.svelte';
  import { resolveVisibleTabs, type RibbonTabDef } from './ribbon-model';
  import { DENSITY } from '../tokens';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    tabs: RibbonTabDef[];
    activeId: string;
    /** 当前应当出现的 contextual Tab（由选择集派生）。 */
    contextualActive: ReadonlySet<string>;
    onchange: (id: string) => void;
  }
  const { tabs, activeId, contextualActive, onchange }: Props = $props();

  const resolved = $derived(resolveVisibleTabs(tabs, contextualActive, activeId));

  /*
   * 当前 Tab 消失时（比如取消选中图形 → 「图形格式」没了）必须把 activeId
   * 纠正回去，否则面板会整个空掉。
   *
   * 纠正写回父组件要放 queueMicrotask：在 effect 的同步阶段写别的 rune 会抛
   * state_unsafe_mutation，这是本项目踩过三次的坑（AGENTS §7 坑 2）。
   */
  $effect(() => {
    const next = resolved.activeId;
    if (next && next !== activeId) queueMicrotask(() => onchange(next));
  });

  const activeTab = $derived(
    resolved.visible.find((t) => t.id === resolved.activeId) ?? resolved.visible[0] ?? null,
  );

  let bodyEl = $state<HTMLDivElement | null>(null);

  /**
   * 上一个真正生效的 Tab id。
   *
   * ⚠️ 这里必须是**普通 let**，不能是 `$state` —— 下面的 effect 会读它，
   * 做成响应式的话 effect 自己就会把自己再触发一遍。
   */
  let lastScrollResetTab = '';

  /**
   * 切 Tab 后回到最左。不这么做的话，切到一个更短的 Tab 会停在空白的右侧。
   *
   * **只在 activeId 真的变化时归零。** 原来无条件写 `scrollLeft = 0`，而
   * `resolved` 是 `$derived(resolveVisibleTabs(...))` —— 它每次重算都返回
   * **新对象**，Svelte 的 `===` 判等随即认为值变了，于是 effect 每一轮都跑。
   * `tabs` 挂在 `appState.version` 上，所以「选中一个元素」「改一个参数」
   * 这类刷新都会把 Ribbon 打回最左 —— 而用户的实际动线恰恰是
   * 「先把 Ribbon 滚到想要的操作，再选中元素去点它」，一选中就归零等于
   * 那个按钮永远点不到。
   */
  $effect(() => {
    const el = bodyEl;
    const id = resolved.activeId;
    if (!el) return;
    if (id === lastScrollResetTab) return;
    lastScrollResetTab = id;
    el.scrollLeft = 0;
  });

  /** 纵向滚轮改为横向滚动 —— 面板没有纵向可滚的内容，不接管就完全没反应。 */
  function onWheel(e: WheelEvent): void {
    const el = bodyEl;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return;
    if (e.deltaY !== 0) el.scrollLeft += e.deltaY;
    if (e.deltaX !== 0) el.scrollLeft += e.deltaX;
  }
</script>

<!--
  `mousedown` 上拦一道：**除文本输入外，按面板不让焦点离开编辑区**。
  不拦的话，在文本里选了一段再点「加粗」，编辑区先失焦 —— 选区没了、行内格式
  也就无从作用（表现是「点了加粗，整块变粗」）。这是工具条的通行做法。
  文本输入（字号、字距）必须能聚焦，所以对 input / textarea 放行；
  那种情况下靠 editorState 保留 textRange 兜住（见它的注释）。
-->
<!--
  尺寸口径统一在**这里**下发 CSS 变量：`ribbon-model.ts` 的 `itemWidth()`（组的宽度
  预算）与按钮自己的 `width` 必须同源，两处各写一遍的话「预算说 26px、按钮实际
  30px」这种偏差会让整条 Ribbon 的横向排布慢慢错位。值全部来自 `DENSITY`。
-->
<div
  class="ribbon"
  data-paper=""
  role="toolbar"
  aria-label={tr('rib.ariaTools')}
  // -1：不进 Tab 序（面板里的控件自己排），但满足 toolbar 角色的可达性要求。
  tabindex="-1"
  data-testid="ribbon"
  style:--ribbon-btn-w={`${DENSITY.ribbonBtnW}px`}
  style:--ribbon-btn-h={`${DENSITY.ribbonBtnH}px`}
  style:--ribbon-btn-small-w={`${DENSITY.ribbonBtnSmallW}px`}
  style:--ribbon-icon-w={`${DENSITY.ribbonIconW}px`}
  style:--ribbon-icon-h={`${DENSITY.ribbonIconH}px`}
  style:--ribbon-menu-icon-w={`${DENSITY.ribbonIconW + 4}px`}
  onmousedown={(e) => {
    const t = e.target as HTMLElement | null;
    if (!t?.closest('input, textarea')) e.preventDefault();
  }}
>
  <div class="ribbon-tabs" role="tablist" aria-label={tr('rib.ariaTools')} data-testid="ribbon-tabs">
    {#each resolved.visible as tab (tab.id)}
      <button
        type="button"
        class="r-tab"
        role="tab"
        class:contextual={tab.contextual}
        aria-selected={tab.id === resolved.activeId}
        data-active={tab.id === resolved.activeId ? 'true' : undefined}
        data-testid={`ribbon-tab-${tab.id}`}
        onclick={() => onchange(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="ribbon-body" bind:this={bodyEl} onwheel={onWheel} data-testid="ribbon-body">
    {#if activeTab}
      {#each activeTab.groups as group (group.id)}
        <RibbonGroup
          label={group.label}
          layout={group.layout}
          columns={group.layout === 'grid' ? Math.ceil(group.items.length / 2) : undefined}
        >
          {#if group.layout === 'rows' && group.rows}
            {#each group.rows as row, ri (ri)}
              <div class="ribbon-row">
                {#each row as item (item.id)}
                  <RibbonItem {item} />
                {/each}
              </div>
            {/each}
          {:else}
            {#each group.items as item (item.id)}
              <RibbonItem {item} />
            {/each}
          {/if}
        </RibbonGroup>
      {/each}
    {/if}
  </div>
</div>

<style>
  .ribbon {
    display: grid;
    grid-template-rows: var(--ribbon-tab-h) var(--ribbon-body-h);
    /* 显式约束列：隐式列是 auto，会被子项的最小内容宽度撑爆（AGENTS §7 坑 3）。 */
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
    background: var(--ribbon-bg);
    border-bottom: 1px solid var(--ribbon-border);
  }
  .ribbon-tabs {
    display: flex;
    align-items: stretch;
    gap: 1px;
    padding: 0 var(--sp-3);
    min-width: 0;
    overflow: hidden;
    border-bottom: 1px solid var(--ribbon-border);
  }
  .r-tab {
    padding: 0 var(--sp-5);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: var(--ribbon-tab-fg);
    font-size: var(--fs-sm);
    cursor: pointer;
    white-space: nowrap;
  }
  .r-tab:hover {
    color: var(--ribbon-tab-fg-hover);
  }
  /* 当前 Tab 用主题色 + 下划线；**不填色块**，与顶栏页面 Tab 同款。 */
  .r-tab[data-active='true'] {
    color: var(--ribbon-tab-fg-active);
    border-bottom-color: var(--accent);
  }
  /*
   * contextual Tab 用**文字颜色**标记「它是因为你选中了东西才出现的」。
   *
   * 原来这里给它加了一条 `border-top` 的主题色线，于是激活中的「图片格式」
   * 上下各一条线、像个盒子，而其它 Tab 只有下面一条 —— 看着像 bug（用户反馈）。
   * 视觉重心只能有一处，所以标记改走颜色：只用一条下划线，contextual 的
   * 标签本身是主题色，未选中时也能认出来。
   */
  .r-tab.contextual {
    color: var(--accent);
  }
  .r-tab.contextual:hover {
    color: var(--ribbon-tab-fg-hover);
  }
  .r-tab.contextual[data-active='true'] {
    color: var(--ribbon-tab-fg-active);
  }

  /* `layout: 'rows'` 的一行。间距比组内列间距略小：同一排的按钮是一件事。 */
  .ribbon-row {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .ribbon-body {
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: 0;
    padding: 0 var(--sp-2);
    /* 横向滚动、纵向裁剪。见文件头注释：固定高度换来的稳定版式，
       代价是内部不能开弹层（所以没有溢出按钮）。 */
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
  }
  /* 细滚动条：只在真的溢出时才出现（auto），高度 6px，不抢视觉。 */
  .ribbon-body::-webkit-scrollbar {
    height: 6px;
  }
  .ribbon-body::-webkit-scrollbar-track {
    background: transparent;
  }
  .ribbon-body::-webkit-scrollbar-thumb {
    background: var(--scrollbar);
    border-radius: 3px;
  }
  .ribbon-body::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-hover);
  }
</style>
