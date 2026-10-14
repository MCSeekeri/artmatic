<script lang="ts">
  import { onMount } from 'svelte';
  import TopBar from './TopBar.svelte';
  import Rail from './Rail.svelte';
  import Transport from './Transport.svelte';
  import Preview from './Preview.svelte';
  import InspectorDrawer from './InspectorDrawer.svelte';
  import MediaPoolDrawer from './MediaPoolDrawer.svelte';
  import StatusBar from './StatusBar.svelte';
  import Tip from './Tip.svelte';
  import EmptyState from './EmptyState.svelte';
  import PluginMissingBanner from './PluginMissingBanner.svelte';
  import RestoreTabsBanner from './RestoreTabsBanner.svelte';
  import IconButton from './controls/IconButton.svelte';
  import Timeline from '../timeline/Timeline.svelte';
  import TypographyEditor from './typography/TypographyEditor.svelte';
  import Mascot from './mascot/Mascot.svelte';
  import PasteAssetsModal from './PasteAssetsModal.svelte';
  import { handleTypographyKey, handleTypingFormatKey } from './typography/keys';
  import { appState } from './app-state.svelte';
  import { theme } from './theme.svelte';
  import { installTheme, applyFontScale } from './theme-apply';
  import { activeElementOwnsSpace, isExempt } from './focus';
  import { saveProjectAs, saveProjectNow } from './project-actions';
  import { isSplitKey } from './shortcuts';
  import { clipboardAssets, type ClipboardAsset } from './clipboard-assets';
  import { addAssetsToPool, pasteAssetsIntoTypography, placeAssetsAtPlayhead } from './paste-assets';
  import { tr } from '../i18n/index.svelte';

  /**
   * 剪贴板里有素材、等着选落点的那一批（时间轴视图）。
   * 走 paste 事件而不是 Ctrl+V 的 keydown：`clipboardData` 只在事件派发期间
   * 可读（同步、零权限），而 keydown 里只能去够 navigator.clipboard（要授权）。
   */
  let pendingPaste = $state<ClipboardAsset[] | null>(null);

  function resolvePaste(target: 'timeline' | 'pool'): void {
    const assets = pendingPaste;
    pendingPaste = null;
    if (!assets) return;
    if (target === 'timeline') void placeAssetsAtPlayhead(assets);
    else void addAssetsToPool(assets);
  }

  /**
   * 主题的唯一写入口。main.ts 在 mount 前已经装过一次（防首帧闪默认值），
   * 这里负责**后续变更**：runtime 改 mode/accent/fontScale 后重新注入 :root。
   * 用 $effect 而不是 store 订阅，因为它天然读到哪些 rune 就订阅哪些。
   */
  $effect(() => {
    installTheme(theme.spec);
    applyFontScale(theme.fontScale);
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      /*
       * **编辑文本时也要能用的**快捷键必须在豁免检查之前拦。
       *
       * contenteditable 命中了 `isExempt`（打字当然不能被全局键吃掉），
       * 但 Ctrl+B/I/U 是「正在打字时才最想按的」那三个键 —— 放在豁免之后
       * 等于它们只在没编辑时可用，正好把用处反过来了。
       */
      if (appState.editorOpen && handleTypingFormatKey(e)) return;

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

      /*
       * F2 = 给选中的片段就地改名（双击片段名是同一个入口）。
       * 放在时间轴这一侧：排版页有自己的 keys.ts 分流，那边没有「片段」这个概念。
       */
      if (e.key === 'F2' && appState.selectedClipId) {
        e.preventDefault();
        appState.beginClipRename(appState.selectedClipId);
        return;
      }

      /*
       * 切分键的方案别名（「操作习惯」）。默认方案下 `isSplitKey` 恒返回 false，
       * 走下面那条 `e.key === 's'` 的分支 —— 两处都判会让同一次击键切两刀。
       */
      if (appState.selectedClipId && isSplitKey(e, appState.shortcutScheme)) {
        e.preventDefault();
        const f = appState.store.findClip(appState.selectedClipId);
        if (f) appState.store.splitClipAt(f.track.id, f.clip.id, appState.playT);
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
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && appState.selectedClipIds.length) {
        // 框选之后一次删干净：走**一笔撤销**（逐个 removeClip 会让 Ctrl+Z
        // 只回来一个，看起来像撤销坏了）
        appState.removeSelectedClips();
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
     * 粘贴素材。
     *
     * 只在剪贴板里**真的有素材**（图片 / 视频 / 音频）时才接管：粘贴一段文字
     * 必须原样走浏览器的默认行为，否则输入类控件的粘贴会整个失灵。
     * `isExempt` 放最前面 —— 输入框与自研控件（data-exempt）的粘贴归它们自己；
     * 文本编辑区的粘贴守卫也会 `preventDefault`，由 defaultPrevented 让路。
     *
     * 时间轴视图弹 modal 问落点；排版视图按类型直接落地（图片进画布、
     * 视频 / 音频进媒体池）—— 在那边这是唯一合理的解释，不值得再问一次。
     */
    const onPaste = (e: ClipboardEvent): void => {
      if (e.defaultPrevented) return;
      if (isExempt(e.target)) return;
      // 没有工程时整段放行：素材仓属于「当前工程」，粘进 placeholder 等于无声丢弃。
      if (!appState.hasProject) return;
      const assets = clipboardAssets(Array.from(e.clipboardData?.items ?? []));
      if (!assets.length) return;
      e.preventDefault();
      if (appState.editorOpen) {
        void pasteAssetsIntoTypography(assets);
        return;
      }
      // 已经在问一次了：第二次粘贴既不覆盖上一个询问、也不弹第二个框。
      if (!pendingPaste) pendingPaste = assets;
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
    window.addEventListener('paste', onPaste);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  });
</script>

<!--
  `inert` + 空界面覆盖层：没有工程时，主界面**留在 DOM 里**（Studio 的 canvas
  不能卸载，否则 WebGL 上下文永久失效），但整棵树对焦点与指针都失效，
  视觉上被 EmptyState 完全盖住。见 app-state.svelte.ts 的 `placeholder`。
-->
<div class="shell" inert={!appState.hasProject}>
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
        style={`--pool-w: ${appState.mediaPoolOpen
          ? `${appState.mediaPoolWidth}px`
          : '0px'}; --drawer-w: ${appState.drawerOpen ? `${appState.drawerWidth}px` : '0px'}`}
      >
        <!--
          媒体池（左）与检查器（右）是两个独立抽屉，各自条件渲染、各自记宽度。
          它们与 `.stage` 的关系见下面 `.body` 的网格注释。

          ⚠️ `!editorOpen` 是必须的：排版编辑页也有自己的媒体池（同一个开关、
          同一个组件）。主界面切到排版页只是 `display:none`、**不卸载**，
          少了这个条件时两份抽屉会同时在 DOM 里 —— 两份列表、两份视频缩略图
          队列，`getByTestId('media-drawer')` 也会同时命中两个。
        -->
        {#if appState.mediaPoolOpen && !appState.editorOpen}
          <MediaPoolDrawer />
        {/if}

        <div class="stage">
          <Preview />
          <!--
            缺失插件提示条：绝对定位浮在预览上方，**不参与网格** ——
            stage 的三行（预览 / 工具条 / 轨道区）是精心排过的，
            多一个流内子项会把轨道区顶出去。见组件自己的说明。
          -->
          <PluginMissingBanner />
          <RestoreTabsBanner />
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

          <!--
            彩蛋：看板娘（设置 → 外观）。挂在 `.stage` 里 ⇒ 她的右边界自动
            跟着检查器的宽度走（`.body` 的列是 1fr + --drawer-w）。绝对定位
            ⇒ 不参与 `.stage` 的网格，其余控件的几何与她在不在无关。
          -->
          {#if appState.mascotEnabled}
            <Mascot />
          {/if}
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

{#if !appState.hasProject}
  <EmptyState />
{/if}

<!--
  粘贴素材的落点询问。挂在 shell **外面**：这里是根层叠上下文，
  modal 不会被任何祖先的 z-index / 层叠上下文困住（见 tokens.ts 的 z-modal）。
-->
{#if pendingPaste}
  <PasteAssetsModal
    assets={pendingPaste}
    onplace={() => resolvePaste('timeline')}
    onpool={() => resolvePaste('pool')}
    oncancel={() => (pendingPaste = null)}
  />
{/if}

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
  /* 三列：媒体池 | 舞台 | 检查器。两个抽屉的宽度都是实例值（用户可拖），
     关掉时是 0 —— 列还在，只是没有宽度。 */
  .body {
    display: grid;
    grid-template-columns: var(--pool-w) minmax(0, 1fr) var(--drawer-w);
    min-height: 0;
    min-width: 0;
  }
  .body.is-hidden {
    display: none;
  }
  /*
   * 显式定位，**不能靠自动排布**：两个抽屉都是条件渲染的，缺一个的时候
   * `.stage` 会被填进那一列（关掉媒体池时它落在 0px 宽的第一列上，整块画面消失）。
   */
  .body > :global(aside.media-drawer) {
    grid-column: 1;
  }
  .body > :global(aside.drawer) {
    grid-column: 3;
  }
  .stage {
    grid-column: 2;
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
    /*
     * 只为一个东西存在：看板娘（绝对定位，锚在右下角）。它是定位**祖先**，
     * 且它的右边界就是检查器的左边界（`.body` 的列 = 1fr + --drawer-w），
     * 所以「位置跟着检查器宽度让开」不需要任何 calc。
     * 加这一行不改布局：静态→relative 的盒模型完全一致；也没有后代依赖
     * `.stage` 之上的包含块（悬浮工具条锚 `.preview`、时间轴的绝对元素锚
     * `.rows`，都是各自组件里显式 relative）。
     */
    position: relative;
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
