<script lang="ts">
  /**
   * RestoreTabsBanner — 「上次打开着的工程要恢复吗？」。
   *
   * 背景：`/lab` 是第二个 HTML 入口，离开主应用再回来时页面从零开始 ——
   * 打开的工程全没了，boot 只会拿一份 demo 工程顶上（`main.ts` 的 init）。
   * 所以这个入口不能放在空界面里（空界面根本不出现），必须是一条常驻提示。
   *
   * 两个刻意的选择：
   *  - **不阻塞**：浮在画面顶部一条，可忽略。这是提示，不是拦路。
   *  - **只在真的有过打开记录、且没被忽略时出现**：新用户、或上一次是空手
   *    离开的，不该看到它。`dismiss` 只压住这一次（记录被清空或重新开工程时
   *   自动解除，见 open-tabs.ts）。
   */
  import Button from './controls/Button.svelte';
  import Icon from './Icon.svelte';
  import { appState } from './app-state.svelte';
  import { openRecentProject } from './project-actions';
  import { dismissRestore, isRestoreDismissed, loadOpenTabs, type OpenTabRef } from '../project/open-tabs';
  import { tr } from '../i18n/index.svelte';

  /** 只读一次：这条提示解决的是「刚进页面」那个时刻。 */
  let tabs = $state<OpenTabRef[]>(loadOpenTabs());
  let dismissed = $state(isRestoreDismissed());
  const show = $derived(tabs.length > 0 && !dismissed);

  function dismiss(): void {
    dismissRestore();
    dismissed = true;
  }

  async function restore(): Promise<void> {
    let ok = 0;
    for (const t of tabs) {
      // 一次点击里连续申请权限：user activation 有窗口期，几份工程够用；
      // 超出窗口的会走 deny 分支（`openRecentProject` 自己 flash 报错）。
      if (await openRecentProject({ key: t.key, name: t.name, openedAt: Date.now() })) ok++;
    }
    if (ok > 0) {
      tabs = [];
    } else {
      appState.flash(tr('app.restoreTabsFailed'), 'error');
      dismiss();
    }
  }
</script>

{#if show}
  <div class="banner" data-testid="restore-project">
    <Icon name="clock" size={13} />
    <span class="title">{tr('app.restoreTabsHint')}</span>
    <span class="spacer"></span>
    <Button
      label={tr('app.restoreTabsDo')}
      variant="accent"
      testid="restore-do"
      disabled={appState.projectBusy}
      onclick={() => void restore()}
    />
    <Button label={tr('app.restoreTabsDismiss')} variant="outline" testid="restore-dismiss" onclick={dismiss} />
  </div>
{/if}

<style>
  .banner {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-4);
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }
  .title {
    color: var(--text-primary);
    font-weight: 600;
  }
  .spacer {
    flex: 1;
  }
</style>
