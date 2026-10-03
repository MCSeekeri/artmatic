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
  import Checkbox from './controls/Checkbox.svelte';
  import Modal from './controls/Modal.svelte';
  import RailShell from './RailShell.svelte';
  import { tip } from './tip';
  import NumberInput from './controls/NumberInput.svelte';
  import Select from './controls/Select.svelte';
  import Brand from './Brand.svelte';
  import Icon from './Icon.svelte';
  import { appState } from './app-state.svelte';
  import { theme } from './theme.svelte';
  import { ACCENT_PRESETS, BRAND_IDS, DENSITY, type BrandId } from './tokens';
  import { SHORTCUT_GROUPS } from './shortcuts';
  import { tr } from '../i18n/index.svelte';
  import {
    cancelExport,
    estimateMp4Bytes,
    exportMp4,
    exportPngSequence,
    fmtSize,
    mp4Supported,
    totalFrames,
  } from './export';
  import {
    newProject,
    openProjectPicker,
    openRecentProject,
    saveProjectAs,
    saveProjectNow,
  } from './project-actions';

  type PanelId = 'about' | 'shortcuts' | 'export' | 'settings' | 'project';
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
  const pct = $derived(Math.round((appState.exportProgress ?? 0) * 100));
  const frames = $derived.by(() => {
    void appState.version;
    return totalFrames();
  });
  const res = $derived.by(() => {
    void appState.version;
    return appState.project.resolution;
  });
  /** MP4 的预计体积。点之前就告诉用户要花多少磁盘。 */
  const mp4Size = $derived.by(() => {
    void appState.version;
    return fmtSize(estimateMp4Bytes());
  });
  const canMp4 = $derived(mp4Supported());
  const fps = $derived.by(() => {
    void appState.version;
    return appState.project.fps;
  });

  /* ------------------------------------------------ 画幅与帧率的预设 */

  /** 常用画幅。用户点一个就同时把宽高写进工程（`setResolution` 会钳成偶数）。 */
  const RES_PRESETS = [
    { id: 'landscape', labelKey: 'app.presetLandscape', w: 1920, h: 1080 },
    { id: 'hd720', labelKey: 'app.preset720', w: 1280, h: 720 },
    { id: 'uhd4k', labelKey: 'app.preset4k', w: 3840, h: 2160 },
    { id: 'vertical', labelKey: 'app.presetVertical', w: 1080, h: 1920 },
    { id: 'square', labelKey: 'app.presetSquare', w: 1080, h: 1080 },
  ] as const;

  /** 当前画幅命中了哪个预设；没命中就是「自定义」。 */
  const resPreset = $derived(
    RES_PRESETS.find((p) => p.w === res.w && p.h === res.h)?.id ?? 'custom',
  );
  const resPresetOptions = $derived([
    ...RES_PRESETS.map((p) => ({ value: p.id as string, label: tr(p.labelKey) })),
    { value: 'custom', label: tr('app.custom') },
  ]);

  function applyResPreset(id: string): void {
    const p = RES_PRESETS.find((x) => x.id === id);
    if (p) appState.store.setResolution(p.w, p.h);
  }

  const FPS_PRESETS = [23.976, 24, 25, 29.97, 30, 50, 60] as const;
  const fpsPreset = $derived(
    FPS_PRESETS.some((v) => Math.abs(v - fps) < 1e-6) ? String(fps) : 'custom',
  );
  const fpsPresetOptions = $derived([
    ...FPS_PRESETS.map((v) => ({ value: String(v), label: `${v} fps` })),
    { value: 'custom', label: tr('app.custom') },
  ]);

  function applyFpsPreset(v: string): void {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) appState.store.setFps(n);
  }

  /**
   * 改过帧率才提示「随机画面会跟着变」。
   * 默认工程是 30 fps —— 等于 30 时说明用户没动过，不必解释一个没发生的事。
   */
  const fpsChanged = $derived(Math.abs(fps - 30) > 1e-9);

  let hexDraft = $state('');
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
      <span>{tr('app.version')}</span><span class="mono">0.1.0</span>
      <span>{tr('app.render')}</span><span class="mono">WebGL2 + GLSL ES 3.00</span>
      <span>{tr('app.icons')}</span><span class="mono">{tr('app.licenseLucide')}</span>
      <span>{tr('app.compression')}</span><span class="mono">{tr('app.licenseFflate')}</span>
    </div>
  </Modal>
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
  <Modal title={tr('app.export')} testid="modal-export" onclose={() => (panel = null)}>
    <div class="kv">
      <span>{tr('app.range')}</span><span class="mono">{tr('app.frames', { n: frames })}</span>
      <span>{tr('app.resolution')}</span><span class="mono">{res.w}×{res.h}</span>
      <span>{tr('app.frameRate')}</span><span class="mono">{fps} fps</span>
    </div>
    {#if exporting}
      <div class="progress">
        <div class="progress-track"><div class="progress-fill" style:width={`${pct}%`}></div></div>
        <span class="mono">{pct}%</span>
        <Button label={tr('common.cancel')} variant="outline" testid="export-cancel" onclick={cancelExport} />
      </div>
    {:else}
      <p class="hint">{tr('app.exportHint')}</p>
      <Button
        label={tr('app.exportMp4', { size: mp4Size })}
        icon="download"
        variant="accent"
        size="lg"
        testid="export-mp4"
        disabled={!canMp4}
        onclick={() => void exportMp4()}
      />
      <p class="hint" data-testid="export-mp4-hint">
        {#if canMp4}
          {tr('app.exportMp4Hint', { size: fmtSize(estimateMp4Bytes()) })}
        {:else}
          {tr('app.exportMp4Unsupported')}
        {/if}
      </p>
      <Button
        label={tr('app.exportPng')}
        icon="download"
        variant="outline"
        size="lg"
        testid="export-png"
        onclick={() => void exportPngSequence()}
      />
      <p class="hint">{tr('app.exportPngHint')}</p>
    {/if}
  </Modal>
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
      画幅与帧率：**工程**级设置，所以放在「工程」面板而不是主题设置里。
      这两个值决定导出帧数、逐帧随机种子、排版光栅化尺寸。
    -->
    <section class="setting">
      <h3>{tr('app.canvas')}</h3>
      <p class="hint">{tr('app.canvasHint')}</p>

      <div class="row">
        <span class="grow">{tr('app.preset')}</span>
        <Select
          value={resPreset}
          options={resPresetOptions}
          testid="project-res-preset"
          optionTestidPrefix="project-res-opt"
          minWidth={140}
          onchange={(v) => applyResPreset(v)}
        />
      </div>

      <div class="row">
        <span class="grow">{tr('app.resolution')}</span>
        <NumberInput
          value={res.w}
          min={16}
          step={2}
          width={70}
          ariaLabel={tr('app.resolution')}
          testid="project-res-w"
          onchange={(v) => appState.store.setResolution(v, res.h)}
        />
        <span class="dim">×</span>
        <NumberInput
          value={res.h}
          min={16}
          step={2}
          width={70}
          ariaLabel={tr('app.resolution')}
          testid="project-res-h"
          onchange={(v) => appState.store.setResolution(res.w, v)}
        />
      </div>

      <div class="row">
        <span class="grow">{tr('app.frameRate')}</span>
        <Select
          value={fpsPreset}
          options={fpsPresetOptions}
          testid="project-fps-preset"
          optionTestidPrefix="project-fps-opt"
          minWidth={140}
          onchange={(v) => applyFpsPreset(v)}
        />
        <NumberInput
          value={fps}
          min={1}
          max={240}
          step={0.001}
          width={70}
          ariaLabel={tr('app.frameRate')}
          testid="project-fps"
          onchange={(v) => appState.store.setFps(v)}
        />
      </div>

      {#if fpsChanged}
        <p class="hint warn">{tr('app.fpsChangeHint')}</p>
      {/if}
    </section>

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
  <Modal title={tr('app.settings')} testid="modal-settings" onclose={() => (panel = null)}>
    <section class="setting">
      <h3>{tr('app.accentColor')}</h3>
      <p class="hint">{tr('app.accentHint')}</p>
      <div class="swatch-row">
        {#each BRAND_IDS as id (id)}
          <button
            type="button"
            class="swatch"
            style:background={ACCENT_PRESETS[id].hex}
            aria-label={tr(ACCENT_PRESETS[id].labelKey)}
            aria-pressed={theme.accent.kind === 'preset' && theme.accent.id === id}
            data-testid={`brand-${id}`}
            onclick={() => theme.setPreset(id as BrandId)}
          ></button>
        {/each}
        <input
          class="hex"
          type="text"
          placeholder="#rrggbb"
          aria-label={tr('app.customAccent')}
          data-testid="brand-hex"
          bind:value={hexDraft}
          onchange={() => {
            theme.setCustomAccent(hexDraft);
            hexDraft = '';
          }}
        />
        <span class="mono dim">{theme.accentLabel}</span>
      </div>
    </section>

    <section class="setting">
      <h3>{tr('app.mode')}</h3>
      <div class="row">
        <span class="grow">
          {tr('app.modeCurrent', { mode: tr(theme.mode === 'light' ? 'app.light' : 'app.dark') })}
        </span>
        <Button
          label={tr(theme.mode === 'light' ? 'app.toDark' : 'app.toLight')}
          icon={theme.mode === 'light' ? 'moon' : 'sun'}
          variant="outline"
          testid="setting-toggle-mode"
          onclick={() => theme.toggleMode()}
        />
      </div>
    </section>

    <section class="setting">
      <h3>{tr('app.keyframes')}</h3>
      <Checkbox
        checked={appState.beatAnchorNewKeys}
        label={tr('app.beatAnchorNew')}
        tipText={tr('app.beatAnchorTip')}
        testid="setting-beat-anchor"
        onchange={(v) => (appState.beatAnchorNewKeys = v)}
      />
    </section>

    <section class="setting">
      <h3>{tr('app.inspector')}</h3>
      <div class="row">
        <span class="grow">{tr('app.drawerWidth', { px: appState.drawerWidth })}</span>
        <Button
          label={tr('app.resetDefault')}
          variant="outline"
          testid="setting-reset-drawer"
          onclick={() => appState.setDrawerWidth(DENSITY.drawerW)}
        />
      </div>
    </section>

    <div class="modal-actions">
      <Button
        label={tr('app.resetTheme')}
        icon="trash"
        variant="outline"
        testid="setting-reset-theme"
        onclick={() => theme.reset()}
      />
    </div>
  </Modal>
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
  .sc-grid h3,
  .setting h3 {
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

  .progress {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
  }
  .progress-track {
    flex: 1;
    height: 6px;
    background: var(--surface-active);
    border-radius: 3px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
  }

  .setting {
    padding: var(--sp-4) 0;
    border-bottom: 1px solid var(--border);
  }
  .setting:first-child {
    padding-top: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }
  .swatch-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .hex {
    width: 110px;
    height: var(--control-h);
    font-family: 'Cascadia Code', Consolas, monospace;
    font-size: var(--fs-sm);
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--sp-5);
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
