<script lang="ts">
  /**
   * LabApp — 试炼场的三栏骨架。
   *
   * 布局与主应用一样走 CSS Grid 手写（项目里没有通用 SplitPane，也不打算为
   * 一个页面造一个）。三栏：清单 / 舞台 / 参数。
   *
   * 快捷键刻意对齐 openmosh 的 lab：↑↓ 切换、Space 播放、按住 B 旁路、R 重置。
   * 这四个是「一边看一边调」时手不离键盘的那几个动作。
   */
  import { onMount } from 'svelte';
  import LabRail from './LabRail.svelte';
  import LabList from './LabList.svelte';
  import LabStage from './LabStage.svelte';
  import LabParams from './LabParams.svelte';
  import { labState } from './lab-state.svelte';
  import { isExempt } from '../src/ui/focus';

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 搜索框 / 数字框里打字时全部让路（Space 会变空格、B 会变字母）。
      if (isExempt(e.target)) return;
      // 浏览器原生快捷键（F5、Ctrl+R）不拦：那是开发的逃生舱。
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        labState.moveSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        labState.moveSelection(-1);
      } else if (e.code === 'Space') {
        e.preventDefault();
        labState.togglePlay();
      } else if (e.key.toLowerCase() === 'b') {
        labState.setBypass(true);
      } else if (e.key.toLowerCase() === 'r') {
        labState.resetParams('source');
        labState.resetParams('effect');
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() === 'b') labState.setBypass(false);
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  });
</script>

<div class="lab-shell">
  <!-- 左侧窄栏与主应用共用 RailShell：rail 在每个界面都必须一致 -->
  <LabRail />
  <LabList />
  <LabStage />
  <LabParams />
</div>

<style>
  .lab-shell {
    height: 100%;
    display: grid;
    /*
     * 显式 minmax(0, 1fr) 是必须的：隐式列是 auto，会被子项的**最小内容宽度**
     * 撑开，工具栏那一排 flex-shrink:0 的控件能把中间列顶到溢出去
     * （主应用 .stage 踩过同一个坑，AGENTS §7 有记）。
     */
    grid-template-columns: auto 248px minmax(0, 1fr) 300px;
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
    background: var(--surface-0);
  }
  .lab-shell > :global(*) {
    min-width: 0;
    min-height: 0;
  }
</style>
