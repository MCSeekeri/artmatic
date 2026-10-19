<script lang="ts">
  /**
   * Menu — 菜单，支持二级（含三级）。
   *
   * 一份实现服务三类调用，避免三处各写一套导致行为不一致：
   *   · 轨道行的 ⋯ 菜单（锚点 = 按钮）
   *   · 时间轴的右键菜单（锚点 = 鼠标坐标）
   *   · 侧栏 / 下拉的弹层
   *
   * 为什么必须支持二级：原来右键一次把所有算法生成器平铺出来，等特效与素材
   * 类型再增加就会被撑爆。二级把「类别」和「具体项」分开，菜单长度可预期。
   *
   * 定位交给 popover.ts 的纯函数（含贴边翻转）——旧版右键菜单在窗口右下角会
   * 整个溢出视口，按钮点不到，那是 E2E 抓出来的真事故。
   */
  import Icon from '../Icon.svelte';
  import {
    backLevel,
    edgeLevel,
    hoverLevel,
    initialMenuState,
    itemsAtLevel,
    keyIntent,
    moveLevel,
    openSubmenu,
    type MenuItem,
    type MenuState,
  } from './menu-model';
  import { attachDismiss, computePopoverPosition, computePreviewPosition } from './popover';

  interface Props {
    items: MenuItem[];
    /** 固定屏幕坐标（右键菜单用）。与 anchorEl 二选一。 */
    at?: { x: number; y: number };
    /** 锚点元素（⋯ 按钮用）。 */
    anchorEl?: HTMLElement | null;
    /** 顶部信息条：轨道名 + 时间之类。 */
    head?: { label: string; value?: string };
    onclose: () => void;
    testid?: string;
  }
  const { items, at, anchorEl, head, onclose, testid = 'menu' }: Props = $props();

  // 菜单是「打开时构造、关闭时销毁」的短生命周期对象，items 在它存活期间不变，
  // 所以只取初始值是刻意的（不写成 derived，否则高亮下标会被外部重建冲掉）。
  // svelte-ignore state_referenced_locally
  let menu: MenuState = $state(initialMenuState(items));
  let positions = $state<{ x: number; y: number }[]>([]);
  /**
   * 预览浮层的位置。`null` = 不显示。
   *
   * 与菜单面板分开一个状态：浮层贴在**当前高亮项**右侧，而高亮项会随
   * 键盘上下移动，所以它跟 `positions` 的变化时机并不一样。
   */
  let previewAt = $state<{ x: number; y: number } | null>(null);
  /** 当前高亮项带 `thumb` 时就是要展示的那一项，否则不显示浮层。 */
  const preview = $derived.by(() => {
    const level = menu.levels.length - 1;
    const cur = itemsAtLevel(items, level, menu)[menu.levels[level]!];
    return cur?.thumb ? cur : null;
  });
  /**
   * 浮层元素。用**单元素数组**而不是 `let`：`bind:this` 挂可变绑定会被
   * svelte-check 报 `non_reactive_update`，而这里也不需要响应式 ——
   * `$effect` 在 DOM 更新之后运行，那时已经量得到了。
   * 与下面的 `panels` 同一个手法。
   */
  const previewPanels: HTMLDivElement[] = [];
  /** 每层的面板元素。普通数组即可：$effect 在 DOM 更新之后运行，
   *  那时 bind:this 已经写好了，不需要靠它触发重算。 */
  const panels: HTMLDivElement[] = [];

  function anchorRect(): { left: number; top: number; right: number; bottom: number } {
    if (at) return { left: at.x, top: at.y, right: at.x, bottom: at.y };
    const el = anchorEl;
    if (el) {
      const r = el.getBoundingClientRect();
      // ⋯ 按钮：从按钮左下角往下展开更自然（按钮通常贴在行右侧）
      return { left: r.right, top: r.bottom, right: r.right, bottom: r.bottom };
    }
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }

  // $effect 在 DOM 更新之后运行，所以可以直接量元素尺寸，不需要 await tick。
  $effect(() => {
    // 建立依赖：层的数量与每层的下标、菜单项、锚点
    void menu.levels.join(',');
    void items;
    void at?.x;
    void at?.y;
    void anchorEl;

    const vp = { width: window.innerWidth, height: window.innerHeight };
    const next: { x: number; y: number }[] = [];

    for (let level = 0; level < menu.levels.length; level += 1) {
      const panel = panels[level];
      if (!panel) return;
      const size = { width: panel.offsetWidth, height: panel.offsetHeight };

      if (level === 0) {
        const p = computePopoverPosition(anchorRect(), size, vp, 'bottom-start');
        next.push({ x: p.x, y: p.y });
      } else {
        const parentIdx = menu.levels[level - 1] ?? 0;
        const row = panels[level - 1]?.querySelector<HTMLElement>(
          `[data-menu-index="${parentIdx}"]`,
        );
        const r = row?.getBoundingClientRect();
        if (!r) return;
        const p = computePopoverPosition(
          { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          size,
          vp,
          'right-start',
        );
        next.push({ x: p.x, y: p.y });
      }
    }

    // 值相同就不写回，避免 bind:this 与 effect 互相触发成环
    if (JSON.stringify(next) !== JSON.stringify(positions)) positions = next;

    /*
     * 预览浮层：贴在**当前高亮项**右侧。
     *
     * 用与子菜单同一招（按 `data-menu-index` 找到那一行量它的 rect），
     * 走同一个 `computePopoverPosition`（含贴边翻转）—— 各写一套定位逻辑
     * 迟早会因为「右边放不下怎么办」而分叉。
     */
    let nextPreview: { x: number; y: number } | null = null;
    const panel = previewPanels[0];
    if (preview && panel) {
      const level = menu.levels.length - 1;
      const row = panels[level]?.querySelector<HTMLElement>(`[data-menu-index="${menu.levels[level]}"]`);
      const r = row?.getBoundingClientRect();
      const curPanel = panels[level]?.getBoundingClientRect();
      const rects = panels
        .map((p) => p?.getBoundingClientRect())
        .filter((x): x is DOMRect => Boolean(x));
      if (r && curPanel) {
        const size = { width: panel.offsetWidth, height: panel.offsetHeight };
        nextPreview = computePreviewPosition(curPanel, rects, r.top, size, vp);
      }
    }
    if (JSON.stringify(nextPreview) !== JSON.stringify(previewAt)) previewAt = nextPreview;
  });

  // 外点 / 滚轮 / Esc 关闭
  $effect(() => {
    const handle = attachDismiss({
      onclose,
      isInside: (t) => panels.some((p) => p?.contains(t)),
      keepOnRightButton: true,
    });
    return () => handle.destroy();
  });

  // 键盘导航挂在 window：面板本身不抢焦点（抢了会把菜单项的 hover 态打断）
  $effect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const intent = keyIntent(e.key);
      if (!intent) return;
      e.preventDefault();
      e.stopPropagation();

      if (intent === 'close') {
        onclose();
        return;
      }
      if (intent === 'next' || intent === 'prev') {
        menu = moveLevel(items, menu, intent === 'next' ? 1 : -1);
        return;
      }
      if (intent === 'first' || intent === 'last') {
        menu = edgeLevel(items, menu, intent);
        return;
      }
      if (intent === 'back') {
        const back = backLevel(menu);
        if (back) menu = back;
        else onclose();
        return;
      }
      if (intent === 'enter') {
        const level = menu.levels.length - 1;
        const list = itemsAtLevel(items, level, menu);
        const cur = list[menu.levels[level]!];
        if (!cur) return;
        if (cur.children?.length) {
          menu = openSubmenu(items, menu);
        } else {
          activate(cur);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  function activate(item: MenuItem): void {
    if (item.disabled || item.separator) return;
    onclose();
    item.onselect?.();
  }

  function clickItem(item: MenuItem): void {
    if (item.children?.length) return; // 有子菜单的项：点击只展开，不激活
    activate(item);
  }
</script>

{#each menu.levels as _, level (level)}
  {@const list = itemsAtLevel(items, level, menu)}
  {@const pos = positions[level]}
  <div
    class="menu"
    bind:this={panels[level]}
    role="menu"
    tabindex="-1"
    data-testid={level === 0 ? testid : undefined}
    style:left={`${pos?.x ?? -9999}px`}
    style:top={`${pos?.y ?? -9999}px`}
  >
    {#if level === 0 && head}
      <div class="menu-head">
        <span class="menu-item-label">{head.label}</span>
        {#if head.value}<span class="menu-head-v">{head.value}</span>{/if}
      </div>
    {/if}

    {#each list as item, i (item.id)}
      {#if item.separator}
        <div class="menu-sep" role="separator"></div>
      {:else}
        <button
          type="button"
          class="menu-item"
          class:danger={item.danger}
          role="menuitem"
          data-active={menu.levels[level] === i ? 'true' : undefined}
          data-menu-index={i}
          disabled={item.disabled}
          data-testid={item.testid}
          onpointerenter={() => (menu = hoverLevel(items, menu, level, i))}
          onclick={() => clickItem(item)}
        >
          <span class="menu-item-icon">
            {#if item.icon}<Icon name={item.icon} size={13} />{/if}
          </span>
          <span class="menu-item-label">{item.label}</span>
          {#if item.shortcut}<span class="menu-item-shortcut">{item.shortcut}</span>{/if}
          {#if item.children?.length}
            <span class="menu-item-caret"><Icon name="chevron-right" size={12} /></span>
          {/if}
        </button>
      {/if}
    {/each}
  </div>
{/each}

<!--
  预览浮层。**只在当前高亮项带 `thumb` 时存在**，所以它是「跟着键盘导航走」的，
  不需要额外的 hover 状态 —— `menu.levels` 就是唯一真源（鼠标划过与方向键
  都走 `hoverLevel` / `moveLevel`，两条路都会更新它）。
-->
<!--
  浮层的 testid 是**固定**的 `menu-preview`，不跟 `testid` 拼：它是屏幕上
  唯一一个浮层（同时只可能开一个菜单），而拼出来的名字会让测试绑死
  「从哪个入口打开的菜单」—— 浮层本身与入口无关。
-->
{#if preview}
  <div
    class="menu-preview"
    bind:this={previewPanels[0]}
    aria-hidden="true"
    data-testid="menu-preview"
    style:left={`${previewAt?.x ?? -9999}px`}
    style:top={`${previewAt?.y ?? -9999}px`}
  >
    <img class="menu-preview-img" src={preview.thumb} alt="" decoding="async" />
    {#if preview.desc}<p class="menu-preview-desc">{preview.desc}</p>{/if}
  </div>
{/if}
