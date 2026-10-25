<script lang="ts">
  /**
   * RibbonAnimStrip — 「动画」页里那条**很宽的预设条**（PPT 同款：一排示意图形 +
   * 名字，滚轮翻页）。
   *
   * 与「添加动画」弹层（`RibbonAnimGallery.svelte`）**并存**，不是替代：
   *  - 这条是**常驻**的：切到「动画」页就看得见全部预设，不用先点开一层；
   *  - 弹层是**分组 + 完整清单**（进入 / 强调 / 退出），预设变多之后它是目录。
   * 两处走同一个动作（`actions.applyPreset`），只是入口不同。
   *
   * 为什么不做成下拉 / 不塞进 `ribbon-body` 的横向滚动：
   *  - 十四个动画按名字挑不出来（见 `anim-catalog.ts`），必须有图示；
   *  - 塞进面板级滚动的话，**滚轮会先被面板吃掉**（`Ribbon.svelte` 把纵向滚轮
   *    换成了横向滚动），用户在这条上滚一下整条 Ribbon 就跑了。所以这条自己
   *    接管滚轮（`stopPropagation` + `preventDefault`），一次滚轮 = **翻一页**。
   *
   * 卡片上的高亮只是「刚插进去的那一个」，不是「当前值」：点一下 = 在播放头插
   * 一段动画，可以连点往后接。
   */
  import AnimPresetIcon from './AnimPresetIcon.svelte';
  import { animPick } from './anim-pick.svelte';
  import { ANIM_PRESETS, type AnimPreset } from '../../typography/animation';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    label: string;
    /** 整条宽度（px）。预算由 `itemWidth()` 下发，与这里的 CSS 同源。 */
    width?: number;
    disabled?: boolean;
    testid?: string;
    onselect: (id: string) => void;
  }
  const { label, width, disabled = false, testid = 'anim-strip', onselect }: Props = $props();

  /** 卡片宽度：**唯一真源**。JS 算翻页步长与 CSS 的 `--strip-card-w` 都用它。 */
  const CARD_W = 58;
  /** 一次滚轮至少翻多远：一页减去一张卡，翻完还留一张做参照。 */
  const pageStep = (el: HTMLElement): number => Math.max(CARD_W * 2, el.clientWidth - CARD_W);

  let trackEl = $state<HTMLDivElement | undefined>(undefined);
  let canPrev = $state(false);
  let canNext = $state(false);

  /** 卷到两端就把对应的翻页键灰掉（灰掉而不是隐藏：整条宽度不该随内容跳）。 */
  function syncEdges(): void {
    const el = trackEl;
    if (!el) return;
    canPrev = el.scrollLeft > 1;
    canNext = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  }

  /*
   * 首帧与尺寸变化时算一次「两端是否到头」。
   *
   * 只挂 `onscroll` 不够：刚切到这一页时 scroll 事件还没发生过，右翻页键会是
   * 灰的（用户以为后面没内容）。切 Tab / 改窗口宽都会被 ResizeObserver 兜住。
   */
  $effect(() => {
    const el = trackEl;
    if (!el) return;
    syncEdges();
    const ro = new ResizeObserver(() => syncEdges());
    ro.observe(el);
    return () => ro.disconnect();
  });

  function page(dir: 1 | -1): void {
    const el = trackEl;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    el.scrollBy({ left: dir * pageStep(el), behavior: reduce ? 'auto' : 'smooth' });
  }

  /*
   * 滚轮 = 翻页。
   *
   * 160ms 内只认第一次：一次鼠标滚轮会连发几个事件、一次触控板惯性能发几十个，
   * 不去重的话「滚一下」会一路翻到底（用户要的是翻一页）。
   */
  let lastPageAt = 0;
  function onWheel(e: WheelEvent): void {
    const el = trackEl;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    // 面板级的横向滚动不能同时生效：这条在面板里面，滚的是它自己。
    e.stopPropagation();
    e.preventDefault();
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (d === 0) return;
    const now = performance.now();
    if (now - lastPageAt < 160) return;
    lastPageAt = now;
    page(d > 0 ? 1 : -1);
  }

  /** 插入 + 高亮。**不关闭任何东西**：这条是常驻控件，连点才是主要用法。 */
  function pick(id: AnimPreset): void {
    animPick.last = id;
    onselect(id);
  }
</script>

<div
  class="strip"
  role="group"
  aria-label={label}
  data-testid={testid}
  style:--strip-w={width !== undefined ? `${width}px` : undefined}
  style:--strip-card-w={`${CARD_W}px`}
>
  <button
    type="button"
    class="page prev"
    aria-label={tr('rib.animPagePrev')}
    data-testid={`${testid}-prev`}
    disabled={!canPrev}
    onclick={() => page(-1)}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
  </button>

  <div
    class="track"
    bind:this={trackEl}
    data-testid={`${testid}-track`}
    onscroll={syncEdges}
    onwheel={onWheel}
  >
    {#each ANIM_PRESETS as p (p.id)}
      <button
        type="button"
        class="card"
        class:on={p.id === animPick.last}
        {disabled}
        title={tr(p.labelKey)}
        data-testid={`${testid}-card-${p.id}`}
        onclick={() => pick(p.id)}
      >
        <AnimPresetIcon id={p.id} size={28} />
        <span class="nm">{tr(p.labelKey)}</span>
      </button>
    {/each}
  </div>

  <button
    type="button"
    class="page next"
    aria-label={tr('rib.animPageNext')}
    data-testid={`${testid}-next`}
    disabled={!canNext}
    onclick={() => page(1)}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
  </button>
</div>

<style>
  /*
   * 视觉：纸面里的一块**凹槽**（`--surface-0` 比 Ribbon 本体深一档），
   * 与 PPT 那条一致。1px 实线 + 小圆角，没有阴影、没有渐变。
   */
  .strip {
    display: flex;
    align-items: stretch;
    flex: none;
    gap: 1px;
    width: var(--strip-w, 640px);
    height: 64px;
    padding: 1px;
    background: var(--surface-0);
    border: 1px solid var(--ribbon-gallery-border);
    border-radius: var(--radius-sm);
  }
  .track {
    display: flex;
    align-items: stretch;
    flex: 1 1 auto;
    gap: 1px;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    /* 滚动条藏掉：翻页键已经说明了「后面还有」，6px 的条会把这 64px 挤掉一截。 */
    scrollbar-width: none;
    overscroll-behavior-x: contain;
  }
  .track::-webkit-scrollbar {
    height: 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: none;
    gap: 2px;
    width: var(--strip-card-w, 58px);
    padding: 2px 2px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--ribbon-btn-fg);
    cursor: pointer;
  }
  .card:hover:not(:disabled) {
    background: var(--ribbon-btn-bg-hover);
    border-color: var(--border);
    color: var(--ribbon-btn-fg-hover);
  }
  /* 刚插入的那一个：与图库弹层、Ribbon 激活态同一条口径（主题色 = 当前生效）。 */
  .card.on {
    background: var(--ribbon-btn-bg-active);
    border-color: var(--accent-border);
    color: var(--ribbon-btn-fg-active);
  }
  .card:disabled {
    color: var(--ribbon-btn-fg-disabled);
    cursor: default;
  }
  .nm {
    font-size: var(--fs-xs);
    line-height: 1.1;
    white-space: nowrap;
  }
  .page {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 14px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--ribbon-btn-fg);
    cursor: pointer;
  }
  .page:hover:not(:disabled) {
    background: var(--ribbon-btn-bg-hover);
    color: var(--ribbon-btn-fg-hover);
  }
  .page:disabled {
    color: var(--ribbon-btn-fg-disabled);
    cursor: default;
  }
  .page svg {
    display: block;
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
