<script lang="ts">
  /**
   * Rail — 窄图标侧栏（44px）。纯图标 + tooltip，从上到下三块：
   *
   *   ① LOGO
   *   ② 快捷键 · 保存 · 导出
   *   ③ 设置 · 明暗切换
   *
   * 四个面板都是**全屏 modal**而不是贴着图标弹的 flyout：flyout 只有两百来像素宽，
   * 快捷键清单或导出信息塞进去就变成带滚动条的小盒子，而这几块只会继续长。
   * 现在留白多一点没关系。
   *
   * 「导出」从轨道工具条搬到了这里（属于工程级动作，与保存同类）；工具条只留
   * 逐帧/逐拍的操作。这条划分见 AGENTS.md §5。
   */
  import IconButton from './controls/IconButton.svelte';
  import Button from './controls/Button.svelte';
  import Modal from './controls/Modal.svelte';
  import RailShell from './RailShell.svelte';
  import SettingsModal from './SettingsModal.svelte';
  import ExportModal from './ExportModal.svelte';
  import PluginManagerModal from './plugin-manager/PluginManagerModal.svelte';
  import { tip } from './tip';
  import Brand from './Brand.svelte';
  import Icon from './Icon.svelte';
  import { appState } from './app-state.svelte';
  import { theme } from './theme.svelte';
  import { SHORTCUT_GROUPS } from './shortcuts';
  import { tr } from '../i18n/index.svelte';
  import {
    newProject,
    openProjectPicker,
    openRecentProject,
    saveProjectAs,
    saveProjectNow,
  } from './project-actions';

  type PanelId = 'about' | 'shortcuts' | 'export' | 'settings' | 'project' | 'plugins';
  let panel = $state<PanelId | null>(null);

  /**
   * 当前工程的素材计数。`void` 那两行是为了让它在工程改动与面板重开时重算。
   * 读的是 `appState.assets`（**当前工程**的素材仓），不是某个模块级单例。
   */
  const assetInfo = $derived.by(() => {
    void appState.version;
    void panel;
    return { count: appState.assets.ids().length, bytes: appState.assets.totalBytes() };
  });

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  /**
   * 相对时间。`Date.now()` 在这里是合规的：它是**界面显示**，不是渲染求值 ——
   * 硬约束 1.1 管的是「任何渲染函数不得接收 Date.now()」，这条路径不参与出帧。
   */
  function ago(ts: number): string {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return tr('common.justNow');
    if (s < 3600) return tr('common.minutesAgo', { n: Math.floor(s / 60) });
    if (s < 86400) return tr('common.hoursAgo', { n: Math.floor(s / 3600) });
    return tr('common.daysAgo', { n: Math.floor(s / 86400) });
  }

  const exporting = $derived(appState.exportProgress !== null);
</script>

<RailShell>
  {#snippet brand()}
    <!-- ① 品牌 -->
    <button
      type="button"
      class="logo-btn"
      aria-label={tr('app.aboutArtmatic')}
      data-testid="rail-logo"
      onclick={() => (panel = 'about')}
    >
      <Brand variant="mark" size={20} />
    </button>
  {/snippet}

  {#snippet main()}
    <!-- ② 快捷键 · 工程 · 保存 · 导出 -->
    <IconButton
      icon="keyboard"
      label={tr('app.shortcuts')}
      testid="rail-shortcuts"
      onclick={() => (panel = 'shortcuts')}
    />
    <IconButton
      icon="folder"
      label={tr('app.project')}
      tipText={tr('app.projectPanelTip')}
      testid="rail-project"
      active={panel === 'project'}
      onclick={() => (panel = 'project')}
    />
    <!--
      插件紧挨着「工程」：它们是**工程级**的扩展（每个工程一套，随工程目录走），
      与「保存 / 导出」那种对当前工程的动作为邻，语义上才连得起来。
    -->
    <IconButton
      icon="puzzle"
      label={tr('pl.title')}
      tipText={tr('pl.open')}
      testid="rail-plugins"
      active={panel === 'plugins'}
      onclick={() => (panel = 'plugins')}
    />
    <!--
      媒体池：与「工程 / 插件」同组 —— 它回答的也是「这份工程里有什么」，
      只是范围收窄到已导入的素材。点它开的是**左边**那条抽屉（检查器在右边，
      两个开关互不相干）。

      两个视图共用同一个开关：时间轴那边是「拖素材建片段」的来源，排版页那边
      是「拖图片进画布」的来源 —— 同一份素材清单，两处各渲染一份抽屉。
    -->
    <IconButton
      icon="images"
      label={tr('pool.title')}
      tipText={tr('pool.openTip')}
      testid="rail-media"
      active={appState.mediaPoolOpen}
      onclick={() => appState.toggleMediaPool()}
    />
    <IconButton
      icon="save"
      label={tr('app.saveProject')}
      tipText={tr(appState.projectDir ? 'app.saveToCurrentDir' : 'app.savePickDir')}
      testid="rail-save"
      disabled={appState.projectBusy}
      onclick={() => void saveProjectNow()}
    />
    <IconButton
      icon="download"
      label={tr('app.export')}
      testid="rail-export"
      active={exporting}
      onclick={() => (panel = 'export')}
    />
  {/snippet}

  {#snippet bottom()}
    <!-- ③ 设置 · 试炼场入口 · 明暗 -->
    <IconButton
      icon="settings"
      label={tr('app.settings')}
      testid="rail-settings"
      onclick={() => (panel = 'settings')}
    />
    <!--
      试炼场入口用 `<a>` 而不是 Button：它是一次**真的页面跳转**
      （lab 是独立 Vite 入口，不是 SPA 视图）。锚点才有无障碍语义，
      中键新开标签页、复制链接也才跟着成立。

      `class="ic-btn"` 是刻意复用全局样式：rail 上所有图标的尺寸/颜色/hover
      必须一致，而那套规则在 `controls.css` 里已经定义了一份。**不加这个类
      的话锚点会用浏览器默认的链接蓝**（实测 `rgb(158,158,255)`）——
      一个又蓝又大的异类，正好破坏了「rail 每个界面都一致」。
    -->
    <a
      class="ic-btn rail-lab-link"
      href="/lab/"
      aria-label={tr('app.openLab')}
      data-testid="rail-lab"
      use:tip={{ text: tr('app.openLabTip') }}
    >
      <Icon name="flask-conical" size={14} />
    </a>
    <IconButton
      icon={theme.mode === 'light' ? 'moon' : 'sun'}
      label={tr(theme.mode === 'light' ? 'app.toDark' : 'app.toLight')}
      testid="theme-toggle"
      onclick={() => theme.toggleMode()}
    />
  {/snippet}
</RailShell>

{#if panel === 'about'}
  <Modal title={tr('app.aboutArtmatic')} testid="modal-about" onclose={() => (panel = null)}>
    {#snippet hero()}
      <span class="hero-lockup">
        <Brand variant="mark" size={72} />
        <Brand variant="word" size={26} />
      </span>
    {/snippet}
    <p class="lead">{tr('app.aboutLead')}</p>
    <div class="kv">
      <span>{tr('app.version')}</span><span class="mono">{__APP_VERSION__}</span>
      <span>{tr('app.render')}</span><span class="mono">WebGL2 + GLSL ES 3.00</span>
      <span>{tr('app.icons')}</span><span class="mono">{tr('app.licenseLucide')}</span>
      <span>{tr('app.compression')}</span><span class="mono">{tr('app.licenseFflate')}</span>
    </div>
  </Modal>
{/if}

{#if panel === 'plugins'}
  <PluginManagerModal onclose={() => (panel = null)} />
{/if}

{#if panel === 'shortcuts'}
  <Modal title={tr('app.shortcuts')} testid="modal-shortcuts" width="wide" onclose={() => (panel = null)}>
    <div class="sc-grid">
      {#each SHORTCUT_GROUPS as group (group.titleKey)}
        <section>
          <h3>{tr(group.titleKey)}</h3>
          {#each group.items as s (s.labelKey)}
            <div class="sc-row">
              <span class="grow">{tr(s.labelKey)}</span>
              <kbd class="kbd">{tr(s.keysKey)}</kbd>
            </div>
          {/each}
        </section>
      {/each}
    </div>
  </Modal>
{/if}

{#if panel === 'export'}
  <ExportModal onclose={() => (panel = null)} />
{/if}

{#if panel === 'project'}
  <Modal title={tr('app.project')} testid="modal-project" onclose={() => (panel = null)}>
    <div class="kv">
      <span>{tr('app.name')}</span>
      <span data-testid="project-name">{appState.projectName}</span>
      <span>{tr('app.location')}</span>
      <span data-testid="project-location">
        {tr(appState.projectDir ? 'app.dirConnected' : 'app.dirNotChosen')}
      </span>
      <span>{tr('app.status')}</span>
      <span data-testid="project-dirty">
        {#if appState.projectDirty}
          <span class="dirty">{tr('app.unsavedChanges')}</span>
        {:else if appState.savedAt}
          {tr('app.savedAgo', { ago: ago(appState.savedAt) })}
        {:else}
          {tr('app.notSavedYet')}
        {/if}
      </span>
      <span>{tr('app.assets')}</span>
      <span class="mono" data-testid="project-assets">
        {tr('app.assetCount', { n: assetInfo.count, size: fmtBytes(assetInfo.bytes) })}
      </span>
    </div>

    <!--
      画幅与帧率**不在这里**：它们已经搬进「设置 → 当前工程」。
      面板的职责收窄成「这份工程现在是什么状态、能对它做什么」，
      改参数的入口集中在设置里 —— 同一个值有两个编辑入口迟早会漂移。
      改分辨率的后果（已有排版不会跟着缩放）在那边有一句小字说明。
    -->

    {#if appState.projectIssues.length}
      <section class="setting">
        <h3>{tr('app.assetAudit')}</h3>        {#each appState.projectIssues as issue (issue.kind + ':' + issue.assetId + ':' + issue.path)}
          <div class="issue" class:err={issue.severity === 'error'}>
            <Icon name={issue.severity === 'error' ? 'triangle-alert' : 'info'} size={13} />
            <span>{issue.message}</span>
          </div>
        {/each}
      </section>
    {/if}

    <section class="setting">
      <h3>{tr('app.actions')}</h3>
      <div class="row wrap">
        <Button
          label={tr('app.newBlank')}
          icon="file-plus"
          variant="outline"
          testid="project-new"
          onclick={() => {
            void newProject(false);
            panel = null;
          }}
        />
        <Button
          label={tr('app.loadDemo')}
          icon="sparkles"
          variant="outline"
          testid="project-demo"
          onclick={() => {
            void newProject(true);
            panel = null;
          }}
        />
        <Button
          label={tr('app.openProjectEllipsis')}
          icon="folder-open"
          variant="outline"
          disabled={appState.projectBusy}
          testid="project-open"
          onclick={() => void openProjectPicker()}
        />
        <Button
          label={tr('app.saveAsEllipsis')}
          icon="hard-drive"
          variant="outline"
          disabled={appState.projectBusy}
          testid="project-save-as"
          onclick={() => void saveProjectAs()}
        />
      </div>
    </section>

    {#if appState.recentProjects.length}
      <section class="setting">
        <h3>{tr('app.recentProjects')}</h3>
        {#each appState.recentProjects as r (r.key)}
          <button
            type="button"
            class="recent"
            data-testid="project-recent"
            disabled={appState.projectBusy}
            onclick={() => void openRecentProject(r)}
          >
            <Icon name="folder" size={13} />
            <span class="grow">{r.name}</span>
            <span class="dim">{tr('app.assetCountShort', { n: r.assetCount ?? 0 })}</span>
            <span class="dim">{ago(r.openedAt)}</span>
          </button>
        {/each}
      </section>
    {/if}

    <!-- 这句话被三个 <code> 打断，所以按段取词（见语言文件里的注释）。 -->
    <p class="hint">
      {tr('app.projectHintA')}<code class="mono">project.json</code>{tr('app.projectHintB')}<code
        class="mono">assets.json</code
      >{tr('app.projectHintC')}<code class="mono">assets/</code>{tr('app.projectHintD')}
    </p>
  </Modal>
{/if}

{#if panel === 'settings'}
  <SettingsModal onclose={() => (panel = null)} />
{/if}

<style>
  /* `.rail / .rail-block / .rail-spacer` 已上移到 RailShell.svelte ——
     它们在主应用与 lab 之间必须完全一致，留两份就是两个真源。 */

  /*
   * 试炼场入口复用全局 `.ic-btn`（尺寸/颜色/hover 全跟其它 rail 图标一致），
   * 这里只清掉锚点自带的浏览器默认样式 —— 下划线和链接色都是浏览器的，
   * 不是我们的设计。不加这一段，图标会是默认链接蓝，在一排灰色图标里非常扎眼。
   */
  a.rail-lab-link {
    text-decoration: none;
  }
  .logo-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .logo-btn:hover {
    background: var(--surface-hover);
  }

  .lead {
    margin: 0 0 var(--sp-5);
    color: var(--text-secondary);
    font-size: var(--fs-md);
  }
  /* 「关于」里的锁合：大标记 + 字标并排（资源里没有现成的锁合文件，两个部件拼一下） */
  .hero-lockup {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-6);
  }
  .kv {
    display: grid;
    grid-template-columns: 88px 1fr;
    gap: var(--sp-2) var(--sp-4);
    font-size: var(--fs-sm);
  }
  .kv > span:nth-child(odd) {
    color: var(--text-muted);
  }
  .kv > span:nth-child(even) {
    color: var(--text-primary);
  }
  .mono {
    font-family: 'Cascadia Code', Consolas, monospace;
  }
  .dim {
    color: var(--text-muted);
  }
  .hint {
    margin: 0 0 var(--sp-4);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }

  .sc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--sp-5) var(--sp-6);
  }
  .sc-grid h3 {
    margin: 0 0 var(--sp-2);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .sc-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    min-height: 20px;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }

  .setting {
    padding: var(--sp-4) 0;
    border-bottom: 1px solid var(--border);
  }
  .setting:first-child {
    padding-top: 0;
  }
  .setting h3 {
    margin: 0 0 var(--sp-2);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }
  .dim {
    color: var(--text-muted);
  }
  .hint {
    margin: 0 0 var(--sp-4);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }

  /* ------------------------------------------------ 工程面板 */
  /* 未保存用主题色：它是「该做点什么」的提示，不是错误。 */
  .dirty {
    color: var(--accent);
  }
  .issue {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-2);
    padding: 3px 0;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    line-height: 1.45;
  }
  /* 图标跟随严重级上色；文字保持中性，免得整块面板变成一片红。 */
  .issue.err {
    color: var(--text-primary);
  }
  .issue.err > :global(svg) {
    color: var(--danger);
    flex-shrink: 0;
  }
  .wrap {
    flex-wrap: wrap;
  }
  .recent {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    padding: 6px var(--sp-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .recent:hover:not(:disabled) {
    background: var(--surface-hover);
  }
  .recent:disabled {
    opacity: 0.5;
    cursor: default;
  }
  code {
    padding: 0 3px;
    background: var(--surface-active);
    border-radius: 3px;
  }
</style>
