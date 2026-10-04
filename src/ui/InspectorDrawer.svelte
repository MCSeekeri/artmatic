<script lang="ts">
  /**
   * InspectorDrawer — 右侧可收起的属性抽屉。
   *
   * 三个行为（用户拍板）：默认展开（持久化）· 选中片段时自动展开 · 宽度可拖并记忆。
   *
   * 宽度走**元素内联样式**而不是 CSS 变量：token 的注入函数每次主题变化都会
   * 重写 :root 的全部变量，若把 --drawer-w 放进去，用户拖出来的宽度会被主题
   * 切换覆盖掉。所以它是实例值，不是 token。
   */
  import Icon from './Icon.svelte';
  import IconButton from './controls/IconButton.svelte';
  import Inspector from './Inspector.svelte';
  import { appState } from './app-state.svelte';
  import { DENSITY } from './tokens';
  import { tr } from '../i18n/index.svelte';

  let resizing = $state(false);
  let dragStartX = 0;
  let dragStartW = 0;

  // 选中片段 → 自动展开。只在 selectedClipId **变化**时触发，所以用户手动
  // 收起后不会被立刻弹回来（那个 id 没变，effect 不会重跑）。
  $effect(() => {
    if (appState.selectedClipId && !appState.drawerOpen) appState.drawerOpen = true;
  });

  function startResize(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    resizing = true;
    dragStartX = e.clientX;
    dragStartW = appState.drawerWidth;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    const mv = (ev: PointerEvent): void => {
      // 往左拖变宽
      appState.setDrawerWidth(dragStartW - (ev.clientX - dragStartX));
    };
    const up = (ev: PointerEvent): void => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      resizing = false;
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
</script>

<aside
  class="drawer"
  class:resizing
  data-testid="drawer"
  style:width={`${appState.drawerWidth}px`}
  style:min-width={`${DENSITY.drawerMinW}px`}
>
  <!-- 拖宽热区：贴在左边界的一条窄带 -->
  <div
    class="drawer-resize"
    role="separator"
    aria-label={tr('insp.resizeWidth')}
    aria-orientation="vertical"
    data-testid="drawer-resize"
    onpointerdown={startResize}
  ></div>

  <div class="drawer-head">
    <span class="drawer-title">
      <Icon name="panel-right" size={12} />
      {tr('insp.title')}
    </span>
    <IconButton
      icon="x"
      label={tr('insp.collapseDrawer')}
      size="sm"
      testid="drawer-toggle"
      onclick={() => appState.setDrawerOpen(false)}
    />
  </div>

  <div class="drawer-body">
    <Inspector />
  </div>
</aside>

<style>
  .drawer {
    position: relative;
    /*
     * 只为一个东西：看板娘（`.stage` 里的绝对定位元素，z-index: 0）。她贴在
     * `.stage` 的右下角，也就是抽屉的左边上；抽屉不显式抬起来的话，同级里
     * 后出现的定位元素不一定压得住她（而她是 `position: absolute`，一定会
     * 盖过非定位内容）。这里给一个明确的、比她大的值。
     */
    z-index: 1;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--drawer-bg);
    border-left: 1px solid var(--drawer-border);
    overflow: hidden;
  }
  .drawer-resize {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: ew-resize;
    z-index: 1;
  }
  .drawer-resize:hover,
  .resizing .drawer-resize {
    background: var(--accent);
  }
  /* 拖动中禁止选中文本，否则整页会变蓝 */
  .resizing {
    user-select: none;
  }
  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    flex-shrink: 0;
    height: var(--topbar-h);
    padding: 0 var(--sp-2) 0 var(--sp-4);
    border-bottom: 1px solid var(--drawer-border);
  }
  .drawer-title {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
</style>
