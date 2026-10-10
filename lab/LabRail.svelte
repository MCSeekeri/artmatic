<script lang="ts">
  /**
   * LabRail — 试炼场的左侧窄栏。
   *
   * 与主应用共用 `src/ui/RailShell.svelte`，所以**外表完全一致**（同样的宽度、
   * 同样的分块、同样的背景与分隔线）。内容是本页面自己的。
   *
   * ⚠️ 这个文件刻意**不 import appState / App.svelte**：lab 是独立 Vite 入口，
   * 引主应用的图会把工程/导出/排版整棵子树拖进 lab 的 bundle，
   * 而 `lab.spec.ts` 有一条断言钉着「lab 里没有 window.__artmatic」。
   * 共享的边界是「骨架 + 控件 + token + i18n + render-core」，不是应用状态。
   */
  import RailShell from '../src/ui/RailShell.svelte';
  import IconButton from '../src/ui/controls/IconButton.svelte';
  import Icon from '../src/ui/Icon.svelte';
  import { labState } from './lab-state.svelte';
  import { tr } from '../src/i18n/index.svelte';
</script>

<RailShell testid="lab-rail">
  {#snippet brand()}
    <span class="lab-brand" aria-hidden="true">
      <Icon name="flask-conical" size={18} />
    </span>
  {/snippet}

  {#snippet main()}
    <!--
      与舞台工具条上的「全部编译」是同一个动作。rail 上再放一个是刻意的：
      工具条那个同时兼作**状态读数**（通过数/失败数），而 rail 上的这个
      是「不管滚到哪儿都够得着」的入口。testid 必须不同，否则
      `getByTestId` 的严格模式会因两个匹配而报错。
    -->
    <IconButton
      icon="combine"
      label={tr('lab.compileAll')}
      tipText={tr('lab.compileAllTip')}
      testid="lab-rail-compile"
      onclick={() => void labState.runCompile()}
    />
    <IconButton
      icon="rotate-ccw"
      label={tr('lab.reset')}
      tipText={tr('lab.resetTip')}
      testid="lab-rail-reset"
      onclick={() => {
        labState.resetParams('source');
        labState.resetParams('effect');
      }}
    />
  {/snippet}

  {#snippet bottom()}
    <!--
      回主应用：真跳转，用锚点（中键新开标签页也才成立）。
      和主应用那边同款：复用全局 `.ic-btn` 拿到与 rail 图标一致的尺寸与颜色，
      只清掉锚点自带的蓝色与下划线。
    -->
    <a class="ic-btn lab-home" href="/" aria-label={tr('lab.backToApp')} data-testid="lab-home">
      <Icon name="arrow-left" size={14} />
    </a>
  {/snippet}
</RailShell>

<style>
  .lab-brand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-h);
    height: var(--control-h);
    color: var(--text-secondary);
  }
  /* 只清浏览器默认样式；尺寸/颜色/hover 全交给全局 .ic-btn */
  a.lab-home {
    text-decoration: none;
  }
</style>
