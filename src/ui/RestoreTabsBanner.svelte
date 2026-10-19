<script lang="ts">
  /**
   * RestoreTabsBanner — 「上次的东西要恢复吗？」。
   *
   * 两段，来源完全不同：
   *
   * | 段 | 来源 | 内容 |
   * |---|---|---|
   * | 打开的工程 | localStorage 的句柄 key | 恢复整份工程（磁盘上的真相） |
   * | 未保存的草稿 | OPFS `drafts/`（W1.2） | 恢复自动保存下来的 `Project` |
   *
   * 背景：`/lab` 是第二个 HTML 入口，离开主应用再回来时页面从零开始 ——
   * 打开的工程全没了，boot 只会拿一份 demo 工程顶上（`main.ts` 的 init）。
   * 所以这个入口不能放在空界面里（空界面根本不出现），必须是一条常驻提示。
   *
   * 两个刻意的选择：
   *  - **不阻塞**：浮在画面顶部，可忽略。这是提示，不是拦路。
   *  - **只在真的有记录、且没被忽略时出现**：新用户、或上一次是空手
   *    离开的，不该看到它。`dismiss` 只压住这一次（记录被清空或重新开工程时
   *    自动解除，见 open-tabs.ts）。
   *
   * 草稿段与句柄段**分开忽略**：草稿是一个真实存在的文件，忽略 = 丢掉它
   * （`discardDraft`），而句柄段忽略只是这次不问。
   */
  import { onMount } from 'svelte';
  import Button from './controls/Button.svelte';
  import Icon from './Icon.svelte';
  import { appState } from './app-state.svelte';
  import { openRecentProject, restoreDraftProject } from './project-actions';
  import { dismissRestore, isRestoreDismissed, loadOpenTabs, type OpenTabRef } from '../project/open-tabs';
  import { discardDraft, listDrafts } from './autosave';
  import type { DraftRecord } from '../project/drafts';
  import { tr } from '../i18n/index.svelte';

  /** 只读一次：这条提示解决的是「刚进页面」那个时刻。 */
  let tabs = $state<OpenTabRef[]>(loadOpenTabs());
  let dismissed = $state(isRestoreDismissed());
  /** 本地草稿（异步列出来；OPFS 不可用时保持空）。 */
  let drafts = $state<DraftRecord[]>([]);
  let hiddenDrafts = $state<string[]>([]);

  const show = $derived(tabs.length > 0 && !dismissed);
  const visibleDrafts = $derived(drafts.filter((d) => !hiddenDrafts.includes(d.key)));

  onMount(() => {
    void (async () => {
      drafts = await listDrafts();
    })();
  });

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

  async function restoreDraft(key: string): Promise<void> {
    if (await restoreDraftProject(key)) drafts = drafts.filter((d) => d.key !== key);
  }

  async function dismissDraft(key: string): Promise<void> {
    // 忽略 = 真的丢掉这份草稿。留着它只会在每次启动时再问一遍。
    hiddenDrafts = [...hiddenDrafts, key];
    await discardDraft(key);
  }

  /** 草稿时间只用于「多久以前」的判断，本地化格式交给浏览器。 */
  function timeOf(ms: number): string {
    return ms > 0 ? new Date(ms).toLocaleTimeString() : '—';
  }
</script>

{#if show || visibleDrafts.length}
  <div class="banners">
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

    {#each visibleDrafts as d (d.key)}
      <div class="banner" data-testid="restore-draft">
        <Icon name="history" size={13} />
        <span class="title">
          {tr('proj.draftHint', { name: d.name, time: timeOf(d.savedAt) })}
        </span>
        <span class="spacer"></span>
        <Button
          label={tr('proj.draftRestore')}
          variant="accent"
          testid="restore-draft-do"
          disabled={appState.projectBusy}
          onclick={() => void restoreDraft(d.key)}
        />
        <Button
          label={tr('proj.draftDismiss')}
          variant="outline"
          testid="restore-draft-dismiss"
          onclick={() => void dismissDraft(d.key)}
        />
      </div>
    {/each}
  </div>
{/if}

<style>
  /*
   * 两段可能同时出现，所以这里必须是**列容器**：各自 `position: absolute`
   * 会叠在一起，而第一条提示被盖住的表现是「按钮点不到」。
   */
  .banners {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
  }
  .banner {
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
