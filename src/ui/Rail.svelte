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
  import Brand from './Brand.svelte';
  import Icon from './Icon.svelte';
  import { appState } from './app-state.svelte';
  import { theme } from './theme.svelte';
  import { ACCENT_PRESETS, BRAND_IDS, DENSITY, type BrandId } from './tokens';
  import { SHORTCUT_GROUPS } from './shortcuts';
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

  function ago(ts: number): string {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    return `${Math.floor(s / 86400)} 天前`;
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

  let hexDraft = $state('');
</script>

<aside class="rail" data-testid="rail">
  <!-- ① 品牌 -->
  <div class="rail-block">
    <button
      type="button"
      class="logo-btn"
      aria-label="关于 Artmatic"
      data-testid="rail-logo"
      onclick={() => (panel = 'about')}
    >
      <Brand variant="mark" size={20} />
    </button>
  </div>

  <!-- ② 快捷键 · 工程 · 保存 · 导出 -->
  <div class="rail-block">
    <IconButton icon="keyboard" label="快捷键" testid="rail-shortcuts" onclick={() => (panel = 'shortcuts')} />
    <IconButton
      icon="folder"
      label="工程"
      tipText="新建 / 打开 / 最近工程"
      testid="rail-project"
      active={panel === 'project'}
      onclick={() => (panel = 'project')}
    />
    <IconButton
      icon="save"
      label="保存工程"
      tipText={appState.projectDir ? '保存到当前工程目录（Ctrl+S）' : '选择目录并保存（Ctrl+S）'}
      testid="rail-save"
      disabled={appState.projectBusy}
      onclick={() => void saveProjectNow()}
    />
    <IconButton
      icon="download"
      label="导出"
      testid="rail-export"
      active={exporting}
      onclick={() => (panel = 'export')}
    />
  </div>

  <div class="rail-spacer"></div>

  <!-- ③ 设置 · 明暗 -->
  <div class="rail-block">
    <IconButton icon="settings" label="设置" testid="rail-settings" onclick={() => (panel = 'settings')} />
    <IconButton
      icon={theme.mode === 'light' ? 'moon' : 'sun'}
      label={theme.mode === 'light' ? '切到暗色' : '切到亮色'}
      testid="theme-toggle"
      active={theme.mode === 'dark'}
      onclick={() => theme.toggleMode()}
    />
  </div>
</aside>

{#if panel === 'about'}
  <Modal title="关于 Artmatic" testid="modal-about" onclose={() => (panel = null)}>
    {#snippet hero()}
      <span class="hero-lockup">
        <Brand variant="mark" size={72} />
        <Brand variant="word" size={26} />
      </span>
    {/snippet}
    <p class="lead">把算法艺术与故障艺术按音乐结构编排起来的时间轴工具。</p>
    <div class="kv">
      <span>版本</span><span class="mono">0.1.0</span>
      <span>渲染</span><span class="mono">WebGL2 + GLSL ES 3.00</span>
      <span>图标</span><span class="mono">Lucide（ISC）</span>
      <span>压缩</span><span class="mono">fflate（MIT）</span>
    </div>
  </Modal>
{/if}

{#if panel === 'shortcuts'}
  <Modal title="快捷键" testid="modal-shortcuts" width="wide" onclose={() => (panel = null)}>
    <div class="sc-grid">
      {#each SHORTCUT_GROUPS as group (group.title)}
        <section>
          <h3>{group.title}</h3>
          {#each group.items as s (s.label)}
            <div class="sc-row">
              <span class="grow">{s.label}</span>
              <kbd class="kbd">{s.keys}</kbd>
            </div>
          {/each}
        </section>
      {/each}
    </div>
  </Modal>
{/if}

{#if panel === 'export'}
  <Modal title="导出" testid="modal-export" onclose={() => (panel = null)}>
    <div class="kv">
      <span>范围</span><span class="mono">{frames} 帧</span>
      <span>分辨率</span><span class="mono">{res.w}×{res.h}</span>
      <span>帧率</span><span class="mono">{fps} fps</span>
    </div>
    {#if exporting}
      <div class="progress">
        <div class="progress-track"><div class="progress-fill" style:width={`${pct}%`}></div></div>
        <span class="mono">{pct}%</span>
        <Button label="取消" variant="outline" testid="export-cancel" onclick={cancelExport} />
      </div>
    {:else}
      <p class="hint">
        导出是确定性逐帧渲染：与预览走同一条求值路径，差别只在分辨率。
        帧数 = 工程时长 × 帧率，时长可在轨道上方的工具条里改。
      </p>
      <Button
        label={`导出 MP4（约 ${mp4Size}）`}
        icon="download"
        variant="accent"
        size="lg"
        testid="export-mp4"
        disabled={!canMp4}
        onclick={() => void exportMp4()}
      />
      <p class="hint" data-testid="export-mp4-hint">
        {#if canMp4}
          H.264 + AAC，含工程里的音频轨。{fmtSize(estimateMp4Bytes())} 是按码率估的，
          画面越复杂实际越大。
        {:else}
          本机浏览器不支持 WebCodecs（`VideoEncoder` 不存在），只能导出 PNG 序列。
        {/if}
      </p>
      <Button
        label="导出 PNG 序列（.zip）"
        icon="download"
        variant="outline"
        size="lg"
        testid="export-png"
        onclick={() => void exportPngSequence()}
      />
      <p class="hint">
        PNG 序列体积大得多，但它是逃生舱：任何浏览器都能出，
        而且逐帧交给达芬奇 / Cavalry 精修本身是正当用途。
      </p>
    {/if}
  </Modal>
{/if}

{#if panel === 'project'}
  <Modal title="工程" testid="modal-project" onclose={() => (panel = null)}>
    <div class="kv">
      <span>名称</span>
      <span data-testid="project-name">{appState.projectName}</span>
      <span>位置</span>
      <span data-testid="project-location">
        {appState.projectDir ? '已连接磁盘目录' : '尚未选择（首次保存时会问）'}
      </span>
      <span>状态</span>
      <span data-testid="project-dirty">
        {#if appState.projectDirty}
          <span class="dirty">有未保存改动</span>
        {:else if appState.savedAt}
          已保存 · {ago(appState.savedAt)}
        {:else}
          尚未保存
        {/if}
      </span>
      <span>素材</span>
      <span class="mono" data-testid="project-assets">
        {assetInfo.count} 个 · {fmtBytes(assetInfo.bytes)}
      </span>
    </div>

    {#if appState.projectIssues.length}
      <section class="setting">
        <h3>素材检查</h3>
        {#each appState.projectIssues as issue (issue.kind + ':' + issue.assetId + ':' + issue.path)}
          <div class="issue" class:err={issue.severity === 'error'}>
            <Icon name={issue.severity === 'error' ? 'triangle-alert' : 'info'} size={13} />
            <span>{issue.message}</span>
          </div>
        {/each}
      </section>
    {/if}

    <section class="setting">
      <h3>动作</h3>
      <div class="row wrap">
        <Button
          label="新建空白"
          icon="file-plus"
          variant="outline"
          testid="project-new"
          onclick={() => {
            void newProject(false);
            panel = null;
          }}
        />
        <Button
          label="载入演示"
          icon="sparkles"
          variant="outline"
          testid="project-demo"
          onclick={() => {
            void newProject(true);
            panel = null;
          }}
        />
        <Button
          label="打开工程…"
          icon="folder-open"
          variant="outline"
          disabled={appState.projectBusy}
          testid="project-open"
          onclick={() => void openProjectPicker()}
        />
        <Button
          label="另存为…"
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
        <h3>最近的工程</h3>
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
            <span class="dim">{r.assetCount ?? 0} 素材</span>
            <span class="dim">{ago(r.openedAt)}</span>
          </button>
        {/each}
      </section>
    {/if}

    <p class="hint">
      工程是一个磁盘目录：<code class="mono">project.json</code> 是内容，
      <code class="mono">assets.json</code> 是素材台账，素材字节在
      <code class="mono">assets/</code>。整个目录可以直接拷走。
    </p>
  </Modal>
{/if}

{#if panel === 'settings'}
  <Modal title="设置" testid="modal-settings" onclose={() => (panel = null)}>
    <section class="setting">
      <h3>主题色</h3>
      <p class="hint">主题色只用在「选中 / 激活 / 焦点 / 播放头」这几处，其余一律中性灰。</p>
      <div class="swatch-row">
        {#each BRAND_IDS as id (id)}
          <button
            type="button"
            class="swatch"
            style:background={ACCENT_PRESETS[id].hex}
            aria-label={ACCENT_PRESETS[id].label}
            aria-pressed={theme.accent.kind === 'preset' && theme.accent.id === id}
            data-testid={`brand-${id}`}
            onclick={() => theme.setPreset(id as BrandId)}
          ></button>
        {/each}
        <input
          class="hex"
          type="text"
          placeholder="#rrggbb"
          aria-label="自定义主题色"
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
      <h3>模式</h3>
      <div class="row">
        <span class="grow">当前：{theme.mode === 'light' ? '亮色' : '暗色'}</span>
        <Button
          label={theme.mode === 'light' ? '切到暗色' : '切到亮色'}
          icon={theme.mode === 'light' ? 'moon' : 'sun'}
          variant="outline"
          testid="setting-toggle-mode"
          onclick={() => theme.toggleMode()}
        />
      </div>
    </section>

    <section class="setting">
      <h3>关键帧</h3>
      <Checkbox
        checked={appState.beatAnchorNewKeys}
        label="新关键帧默认锚到拍"
        tipText="锚到拍：改 BPM / offset 时卡点自动跟随"
        testid="setting-beat-anchor"
        onchange={(v) => (appState.beatAnchorNewKeys = v)}
      />
    </section>

    <section class="setting">
      <h3>检查器</h3>
      <div class="row">
        <span class="grow">宽度 {appState.drawerWidth}px</span>
        <Button
          label="重置为默认"
          variant="outline"
          testid="setting-reset-drawer"
          onclick={() => appState.setDrawerWidth(DENSITY.drawerW)}
        />
      </div>
    </section>

    <div class="modal-actions">
      <Button
        label="恢复默认主题"
        icon="trash"
        variant="outline"
        testid="setting-reset-theme"
        onclick={() => theme.reset()}
      />
    </div>
  </Modal>
{/if}

<style>
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
    width: var(--rail-w);
    flex-shrink: 0;
    padding: var(--sp-3) 0;
    background: var(--rail-bg);
    border-right: 1px solid var(--rail-border);
    overflow: hidden;
  }
  .rail-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
  }
  .rail-spacer {
    flex: 1;
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
