<script lang="ts">
  /**
   * RibbonAnimGallery — 「动画」页的**添加动画**图库（PPT 式：一排示意图形 + 名字）。
   *
   * 为什么不用 Select：十四个动画按名字挑不出来 —— 用户得先在脑子里把「弹一下」
   * 翻成一段动效。图库里每张卡自带**示意图形**（见 `ui/typography/anim-catalog.ts`：
   * 圆角方形 + 运动提示），看一眼就知道要哪个。
   *
   * 卡片是**一次性动作**，不是「当前值」：点一下 = 在这个播放头位置插一段动画
   * （可以连点，逐段往后接），所以高亮的只是「刚插进去的那一个」，不是状态。
   *
   * 定位复用 `controls/popover.ts`（含贴边翻转）；面板本身在
   * `.ribbon-body` 里（`overflow` 会裁剪 absolute 弹层），所以弹层必须
   * `position: fixed`。
   */
  import Icon from '../Icon.svelte';
  import { attachDismiss, computePopoverPosition } from '../controls/popover';
  import AnimPresetIcon from './AnimPresetIcon.svelte';
  import { animPick } from './anim-pick.svelte';
  import { ANIM_GROUPS, animGroupOf } from '../typography/anim-catalog';
  import { ANIM_PRESETS, type AnimPreset } from '../../typography/animation';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    label: string;
    /** 与 `itemWidth()` 预算同源的宽度（两处各写一遍会让整条 Ribbon 慢慢错位）。 */
    width?: number;
    disabled?: boolean;
    testid?: string;
    onselect: (id: string) => void;
  }
  const { label, width, disabled = false, testid = 'anim-gallery', onselect }: Props = $props();

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement | undefined>(undefined);
  let panelEl = $state<HTMLDivElement | undefined>(undefined);
  const pos = $state({ x: -1, y: -1 });
  const positioned = $derived(pos.x >= 0 && pos.y >= 0);
  const panelId = $props.id();

  /** 分组 → 该组的预设（顺序 = `ANIM_PRESETS` 的声明顺序）。 */
  const grouped = $derived(
    ANIM_GROUPS.map((g) => ({
      id: g.id,
      label: tr(g.labelKey),
      presets: ANIM_PRESETS.filter((p) => animGroupOf(p.id) === g.id),
    })).filter((g) => g.presets.length > 0),
  );

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
    });
    return () => handle.destroy();
  });

  function pick(id: AnimPreset): void {
    animPick.last = id;
    close();
    onselect(id);
  }
</script>

<button
  type="button"
  class="ag"
  class:open
  bind:this={triggerEl}
  aria-haspopup="dialog"
  aria-expanded={open}
  aria-controls={open ? panelId : undefined}
  aria-disabled={disabled}
  {disabled}
  title={label}
  data-exempt
  data-testid={testid}
  style:--ribbon-btn-w={width !== undefined ? `${width}px` : undefined}
  onclick={() => (open ? close() : (open = true))}
>
  <Icon name="sparkles" size={18} />
  <span class="lbl">{label}</span>
  <span class="chev" aria-hidden="true"><Icon name="chevron-down" size={9} /></span>
</button>

{#if open}
  <div
    class="ag-pop"
    id={panelId}
    bind:this={panelEl}
    role="dialog"
    aria-label={label}
    data-testid={`${testid}-pop`}
    style:left={`${pos.x}px`}
    style:top={`${pos.y}px`}
    style:visibility={positioned ? undefined : 'hidden'}
    onwheel={(e) => e.stopPropagation()}
  >
    {#each grouped as g (g.id)}
      <p class="grp">{g.label}</p>
      <div class="grid">
        {#each g.presets as p (p.id)}
          <button
            type="button"
            class="card"
            class:on={p.id === animPick.last}
            title={tr(p.labelKey)}
            data-testid={`${testid}-card-${p.id}`}
            onclick={() => pick(p.id)}
          >
            <AnimPresetIcon id={p.id} size={30} />
            <span class="nm">{tr(p.labelKey)}</span>
          </button>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  /* 与 RibbonButton 的 large 档同一套变量：宽度由 `itemWidth()` 预算下发，
     hover / 激活色也共用 `--ribbon-btn-*`（新增一套等于把同一个视觉决定拆成两份）。 */
  .ag {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    width: var(--ribbon-btn-w, 56px);
    height: var(--ribbon-btn-h, 56px);
    padding: 2px 2px 2px;
    background: transparent;
    border: 1px solid var(--ribbon-btn-border);
    border-radius: var(--radius-sm);
    color: var(--ribbon-btn-fg);
    cursor: pointer;
    user-select: none;
    transition:
      background-color var(--motion-duration-hover, 80ms) var(--motion-ease, ease-out),
      color var(--motion-duration-hover, 80ms) var(--motion-ease, ease-out),
      border-color var(--motion-duration-hover, 80ms) var(--motion-ease, ease-out);
  }
  .ag:hover:not(:disabled) {
    background: var(--ribbon-btn-bg-hover);
    color: var(--ribbon-btn-fg-hover);
  }
  .ag.open {
    background: var(--ribbon-btn-bg-active);
    color: var(--ribbon-btn-fg-active);
    border-color: var(--accent-border);
  }
  .ag:disabled {
    color: var(--ribbon-btn-fg-disabled);
    cursor: default;
  }
  .lbl {
    font-size: var(--fs-xs);
    line-height: 1.1;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 「这里会展开一层」的指示：PPT 的添加动画面板也是这个位置。 */
  .chev {
    position: absolute;
    right: 1px;
    bottom: 1px;
    display: inline-flex;
    opacity: 0.7;
  }

  /*
   * 五十多个预设 + 三个分组标题会超过一屏：**必须给自己留一道滚动**。
   * 弹层是 `position: fixed`，面板（`.ribbon-body`）裁不到它 —— 但没有
   * max-height 时它会从视口底下伸出去，最后两排（退出的那几页）永远点不到。
   */
  .ag-pop {
    position: fixed;
    z-index: var(--z-menu);
    max-height: calc(100vh - 24px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--sp-2);
    background: var(--menu-bg);
    border: 1px solid var(--menu-border);
    border-radius: var(--radius-md);
  }
  .grp {
    margin: 0 0 2px;
    padding-left: 2px;
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
  .grp + .grid {
    margin-bottom: var(--sp-2);
  }
  /* 七列：三组共五十多条，五列会排成十一行（滚动条比翻页累）。 */
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 56px);
    gap: 2px;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 56px;
    height: 56px;
    padding: 3px 2px 3px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .card:hover {
    background: var(--surface-hover);
    border-color: var(--border);
    color: var(--accent);
  }
  /* 刚插入的那一张：与 Ribbon 的激活态、常驻条的 `.on` 同一条口径
     （主题色只出现在「当前生效」处）。 */
  .card.on {
    background: var(--ribbon-btn-bg-active);
    border-color: var(--accent-border);
    color: var(--accent);
  }
  .nm {
    font-size: var(--fs-xs);
    line-height: 1.1;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .ag {
      transition: none;
    }
  }
</style>
