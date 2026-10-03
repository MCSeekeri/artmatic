<script lang="ts">
  /**
   * EmptyState — 一份工程都没有打开时的界面。
   *
   * 它盖在主界面之上（`position: fixed`），而不是替换掉主界面 ——
   * Studio 的 `<canvas>` 一旦离开 DOM，WebGL 上下文连同 kit 里所有
   * Program / Target / 纹理一起失效，且不是重新 mount 能恢复的。
   * 详见 app-state.svelte.ts 里 `placeholder` 的那段注释。
   *
   * 内容刻意只有三件事：新建、导入、从最近打开。没有工程的时候，
   * 用户能做的本来就只有这三件，把别的入口（设置、快捷键、试炼场）
   * 摆进来只会让「从哪开始」变模糊 —— 它们在左侧窄栏里一直都在，
   * 而且这一层是盖住的，所以这里给一句提示即可。
   */
  import Brand from './Brand.svelte';
  import Button from './controls/Button.svelte';
  import Icon from './Icon.svelte';
  import { appState } from './app-state.svelte';
  import { newProject, openProjectPicker, openRecentProject } from './project-actions';
  import { tr } from '../i18n/index.svelte';

  /** 相对时间。与 Rail 的最近工程列表同一套口径。 */
  function ago(ts: number): string {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return tr('common.justNow');
    if (s < 3600) return tr('common.minutesAgo', { n: Math.floor(s / 60) });
    if (s < 86400) return tr('common.hoursAgo', { n: Math.floor(s / 3600) });
    return tr('common.daysAgo', { n: Math.floor(s / 86400) });
  }
</script>

<div class="empty" data-testid="empty-state">
  <div class="empty-box">
    <span class="lockup">
      <Brand variant="mark" size={56} />
      <Brand variant="word" size={24} />
    </span>

    <p class="lead">{tr('app.emptyLead')}</p>

    <div class="acts">
      <Button
        label={tr('app.newProject')}
        icon="file-plus"
        variant="accent"
        size="lg"
        testid="empty-new"
        onclick={() => void newProject(false)}
      />
      <Button
        label={tr('app.emptyImport')}
        icon="folder-open"
        variant="outline"
        size="lg"
        disabled={appState.projectBusy}
        testid="empty-import"
        onclick={() => void openProjectPicker()}
      />
    </div>

    <div class="recent" data-testid="empty-recent">
      <h3>{tr('app.recentProjects')}</h3>
      {#if appState.recentProjects.length === 0}
        <p class="none">{tr('app.emptyRecentEmpty')}</p>
      {:else}
        {#each appState.recentProjects as r (r.key)}
          <button
            type="button"
            class="recent-row"
            data-testid="empty-recent-item"
            disabled={appState.projectBusy}
            onclick={() => void openRecentProject(r)}
          >
            <Icon name="folder" size={13} />
            <span class="grow">{r.name}</span>
            <span class="dim">{tr('app.assetCountShort', { n: r.assetCount ?? 0 })}</span>
            <span class="dim">{ago(r.openedAt)}</span>
          </button>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  /*
   * 盖满整屏。`inset: 0` + 不透明底 —— 视觉上就是「没有工程」这一个状态，
   * 而不是"主界面下面还压着别的东西"。
   */
  .empty {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-0);
    overflow-y: auto;
  }
  .empty-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-5);
    width: min(420px, 84vw);
    padding: var(--sp-6) 0;
  }
  .lockup {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    color: var(--text-primary);
  }
  .lead {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: center;
    line-height: 1.5;
  }
  .acts {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-3);
  }
  .recent {
    width: 100%;
    padding-top: var(--sp-5);
    border-top: 1px solid var(--border);
  }
  .recent h3 {
    margin: 0 0 var(--sp-3);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .none {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  .recent-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    padding: 6px var(--sp-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .recent-row:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .recent-row:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .grow {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dim {
    color: var(--text-muted);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
</style>
