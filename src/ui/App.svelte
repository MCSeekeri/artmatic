<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from './TopBar.svelte';
  import Rail from './Rail.svelte';
  import Transport from './Transport.svelte';
  import Preview from './Preview.svelte';
  import InspectorDrawer from './InspectorDrawer.svelte';
  import StatusBar from './StatusBar.svelte';
  import Tip from './Tip.svelte';
  import IconButton from './controls/IconButton.svelte';
  import Timeline from '../timeline/Timeline.svelte';
  import TypographyEditor from './typography/TypographyEditor.svelte';
  import { handleTypographyKey } from './typography/keys';
  import { appState } from './app-state.svelte';
  import { theme } from './theme.svelte';
  import { installTheme } from './theme-apply';
  import { activeElementOwnsSpace, isExempt } from './focus';
  import { saveProjectAs, saveProjectNow } from './project-actions';
  import { tr } from '../i18n/index.svelte';

  /**
   * 主题的唯一写入口。main.ts 在 mount 前已经装过一次（防首帧闪默认值），
   * 这里负责**后续变更**：runtime 改 mode/accent 后重新注入 :root。
   * 用 $effect 而不是 store 订阅，因为它天然读到哪些 rune 就订阅哪些。
   */
  $effect(() => {
    installTheme(theme.spec);
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 控件自己处理键盘的（自研控件带 data-exempt）一律让路，
      // 否则在下拉上按 Space 会「打开下拉 + 开始播放」同时发生。
      if (isExempt(e.target)) return;

      // —— 覆盖浏览器原生快捷键 ——
      // 这几组在浏览器里有默认行为（保存网页 / 打印 / 查找 / 前进后退），
      // 在一个浏览器内应用里它们全是误触。刻意**不**拦 Ctrl+滚轮（浏览器缩放）
      // 与 F5 / Ctrl+R / Ctrl+Shift+I：那是无障碍与开发的逃生舱，拦了只有坏处。
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 's') {
          e.preventDefault();
          // 位置未知时 saveProjectNow 会自己转成「另存为」——
          // 第一次保存本来就要问路径，没必要分成两个快捷键。
          void saveProjectNow();
          return;
        }
        if (k === 'p' || k === 'f') {
          e.preventDefault();
          return;
        }
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveProjectAs();
        return;
      }
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        return;
      }

      /*
       * 排版编辑页的快捷键**分流**在这里，而不是在下面每条分支上加
       * `if (!editorOpen)`。分流之后：S（切分）与 Alt+↑↓（移轨）在排版页
       * 自然失效 —— 它们在那边没有意义，而「不处理」正是想要的语义。
       */
      if (appState.editorOpen) {
        handleTypographyKey(e);
        return;
      }

      if (e.code === 'Space') {
        // 聚焦在按钮/role 控件上时 Space 归它们——否则会「激活按钮 + 播放」双触发
        if (activeElementOwnsSpace()) return;
        e.preventDefault();
        appState.togglePlay();
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && appState.selectedClipId) {
        // alt-up / alt-down：抬一轨 / 降一轨（剪辑软件的通用手势）
        e.preventDefault();
        const r = appState.store.shiftClipTrack(appState.selectedClipId, e.key === 'ArrowUp' ? -1 : 1);
        if (r === 'no-track') appState.flash(tr('app.noTrackFits'));
        else if (r === 'blocked') appState.flash(tr('app.targetOccupied'));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && appState.selectedClipId) {
        appState.store.removeClip(appState.selectedClipId);
        appState.selectedClipId = null;
      } else if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        appState.store.undo();
      } else if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && (e.key === 'Z' || e.key === 'z'))) {
        e.preventDefault();
        appState.store.redo();
      } else if (e.key === 's' && appState.selectedClipId) {
        const f = appState.store.findClip(appState.selectedClipId);
        if (f) appState.store.splitClipAt(f.track.id, f.clip.id, appState.playT);
      }
    };

    /**
     * 原生右键菜单全应用禁用（轨道区与菜单都用自绘 div 菜单）。
     * 文本类输入例外：那里的复制/粘贴/拼写检查是系统能力，禁掉只会让人难受。
     */
    const onContextMenu = (e: MouseEvent): void => {
      if (isExempt(e.target)) return;
      e.preventDefault();
    };

    /**
     * 关页面 / F5 / 关标签时的保护。
     *
     * 弹的是**浏览器自己的**确认框（文案我们控制不了，也不该控制 ——
     * 伪造一个页面内的对话框会撒谎，因为它挡不住真正的离开）。我们能决定的
     * 只有「有没有这个框」，而这正是需要的：F5 一下全部烟消云散是最糟的形态。
     *
     * 判据是 `anyDirty` 而不是当前那份 —— 关页面会把**所有**打开的工程一起丢掉。
     */
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (!appState.anyDirty) return;
      e.preventDefault();
      // 老浏览器看 returnValue 的内容；现代浏览器只看「有没有赋值」，
      // 赋值本身才是触发条件（赋任何非空串都一样）。
      e.returnValue = '';
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  });
</script>

<div class="shell">
  <TopBar />

  <div class="content">
    <!--
      窄侧栏在页面**外面**：切到排版页时它必须还在（工程级动作、设置、明暗
      切换都不该随页面消失）。所以页面级的切换发生在它右边那一格里。
    -->
    <Rail />

    <div class="page">
      <!--
        主界面**永不卸载**，切到排版页只是 display:none。
        卸载 Preview 的 <canvas> 会丢掉 WebGL 上下文 —— kit 里所有 Program /
        Target / 纹理随之失效，renderer 永久坏掉，而且不是重新 mount 能恢复的。
        代价是排版页打开时它还在 DOM 里，由 appState.tick() 的闸门挡住渲染。
      -->
      <div
        class="body"
        class:is-hidden={appState.editorOpen}
        style={`--drawer-w: ${appState.drawerOpen ? `${appState.drawerWidth}px` : '0px'}`}
      >
        <div class="stage">
          <Preview />
          <div class="toolbar">
            <Transport />
            <span class="toolbar-tail">
              <IconButton
                icon="panel-right"
                label={tr('app.inspector')}
                tipPlacement="top"
                testid="drawer-open"
                active={appState.drawerOpen}
                onclick={() => appState.toggleDrawer()}
              />
            </span>
          </div>
          <div class="tracks">
            <Timeline />
          </div>
        </div>

        {#if appState.drawerOpen}
          <InspectorDrawer />
        {/if}
      </div>

      <!-- 排版编辑页：同格兄弟，同一时刻只有一个在流内。 -->
      {#if appState.editorOpen && appState.activeTypoClipId}
        <TypographyEditor clipId={appState.activeTypoClipId} />
      {/if}
    </div>
  </div>

  <StatusBar />
</div>

<Tip />

<style>
  .shell {
    height: 100%;
    display: grid;
    grid-template-rows: var(--topbar-h) minmax(0, 1fr) var(--statusbar-h);
    background: var(--surface-0);
  }
  /*
   * .content：左侧窄侧栏（常驻）+ 右侧「页面」列。切页面时侧栏不消失。
   * 必须显式约束列：隐式列默认是 auto，会被子项的最小内容宽度撑开
   * —— 与 .stage 那条教训同源（AGENTS §7 坑 3）。同一时刻只有一个子项在流内。
   */
  .content {
    display: grid;
    grid-template-columns: var(--rail-w) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
  }
  /* 页面宿主：同一时刻只有一个子项在流内（时间轴主界面 或 排版编辑页）。 */
  .page {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
  }
  .page > :global(*) {
    min-height: 0;
    min-width: 0;
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--drawer-w);
    min-height: 0;
    min-width: 0;
  }
  .body.is-hidden {
    display: none;
  }
  .stage {
    display: grid;
    /* 预览吃满剩余高度；工具条与轨道区按内容/固定高度排在下面 */
    grid-template-rows: minmax(0, 1fr) auto auto;
    /*
     * 必须显式约束列宽。隐式列默认是 `auto`，会被子项的**最小内容宽度**撑开——
     * 工具条里几乎所有控件都是 flex-shrink:0，实测在 1280 宽的窗口下把这一列
     * 撑到 1058px，而 stage 本身只有 936px：preview / toolbar / tracks 三个子项
     * 一起溢出到右侧抽屉底下，并把预览宿主撑成一个不受网格约束的尺寸。
     */
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    flex-shrink: 0;
    min-width: 0;
    padding: 3px var(--sp-4);
    background: var(--surface-2);
    border-top: 1px solid var(--tl-border);
    border-bottom: 1px solid var(--tl-border);
  }
  .toolbar-tail {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .tracks {
    height: 320px;
    min-height: 0;
    min-width: 0;
    border-top: none;
  }
</style>
