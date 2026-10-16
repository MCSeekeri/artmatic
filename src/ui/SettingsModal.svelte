<script lang="ts">
  /**
   * SettingsModal — 设置面板。
   *
   * 结构：head（Modal 提供）/ body（左 navside + 右内容）/ footer（取消 · 保存并应用）。
   *
   * ## 为什么是草稿模型
   *
   * 面板一打开就把值抄成草稿，只有「保存并应用」才写回。取消 = 什么都不做。
   * 直接即时生效的话，「取消」按钮就只能是个装饰；而设置里恰好有几项
   * （分辨率、快捷键方案）改错了是要一个个改回来的。
   *
   * 已更改的项在标签前标一个主题色星号：**与打开面板时的值比较**，不是与
   * 默认值比较 —— 用户关心的是「我这次动了什么」，不是「这份配置离出厂设置多远」。
   *
   * ## 四个分页
   *
   * 当前工程 / 外观 / 操作习惯 / 编辑器行为。分页而不是一长条滚动：这四块
   * 服务的时刻不同（调工程、调自己看得舒服、调习惯、调行为），一长条会把
   * 「工程级」和「界面级」混在一起。
   *
   * 从 Rail.svelte 抽出来：那已经是第四个面板了，再往里塞会让 rail 文件
   * 同时承担导航、面板内容、导出编排三件事。
   */
  import Modal from './controls/Modal.svelte';
  import Button from './controls/Button.svelte';
  import NumberInput from './controls/NumberInput.svelte';
  import Select from './controls/Select.svelte';
  import Checkbox from './controls/Checkbox.svelte';
  import { appState } from './app-state.svelte';
  import { theme, FONT_SCALE_STEPS, type FontScale } from './theme.svelte';
  import { ACCENT_PRESETS, BRAND_IDS, type AccentSource, type BrandId } from './tokens';
  import { SHORTCUT_SCHEMES, type ShortcutScheme } from './shortcuts';
  import type { OverlapBehavior } from '../core/schema';
  import { tr } from '../i18n/index.svelte';

  interface Props {
    onclose: () => void;
  }
  const { onclose }: Props = $props();

  type Section = 'project' | 'appearance' | 'habits' | 'editor';
  let section = $state<Section>('project');

  const SECTIONS: { id: Section; labelKey: 'app.settingsNavProject' | 'app.settingsNavAppearance' | 'app.settingsNavHabits' | 'app.settingsNavEditor' }[] = [
    { id: 'project', labelKey: 'app.settingsNavProject' },
    { id: 'appearance', labelKey: 'app.settingsNavAppearance' },
    { id: 'habits', labelKey: 'app.settingsNavHabits' },
    { id: 'editor', labelKey: 'app.settingsNavEditor' },
  ];

  /*
   * 打开时的基准值，**只在挂载那一刻读一次** —— 不是 `$derived`。
   *
   * 草稿的参照必须冻结：星号与「哪些项真的要写库」都在拿草稿跟它比。
   * 做成派生的话，用户每改一下、`version` 一动，基准就跟着变，
   * 星号会在自己刚刚变亮的瞬间又熄掉。
   */
  function snapshotBase() {
    const p = appState.store.project;
    return {
      name: p.name,
      w: p.resolution.w,
      h: p.resolution.h,
      fps: p.fps,
      bpm: p.beatGrid.bpm,
      offset: p.beatGrid.offset,
      beatsPerBar: p.beatGrid.beatsPerBar,
      overlap: p.overlapBehavior,
    };
  }
  const base = snapshotBase();

  /* ------------------------------------------------------------ 草稿 */

  let name = $state(base.name);
  let resW = $state(base.w);
  let resH = $state(base.h);
  let fps = $state(base.fps);
  let bpm = $state(base.bpm);
  let offset = $state(base.offset);
  let beatsPerBar = $state(base.beatsPerBar);
  let overlap = $state<OverlapBehavior>(base.overlap);

  let mode = $state(theme.mode);
  let accent = $state<AccentSource>(theme.accent);
  let fontScale = $state<FontScale>(theme.fontScale);
  let scheme = $state<ShortcutScheme>(appState.shortcutScheme);
  let mascot = $state(appState.mascotEnabled);

  /* ------------------------------------------------------------ 已更改标记 */

  const nameChanged = $derived(name.trim() !== base.name && name.trim() !== '');
  const resChanged = $derived(resW !== base.w || resH !== base.h);
  const fpsChanged = $derived(fps !== base.fps);
  const gridChanged = $derived(
    bpm !== base.bpm || offset !== base.offset || beatsPerBar !== base.beatsPerBar,
  );
  const overlapChanged = $derived(overlap !== base.overlap);
  const modeChanged = $derived(mode !== theme.mode);
  const fontScaleChanged = $derived(fontScale !== theme.fontScale);
  const schemeChanged = $derived(scheme !== appState.shortcutScheme);
  const mascotChanged = $derived(mascot !== appState.mascotEnabled);
  /** 主题色的比较：预设比 id，自定义比 hex（用户可能在两者间来回切）。 */
  const accentChanged = $derived(
    accent.kind !== theme.accent.kind ||
      (accent.kind === 'preset' && theme.accent.kind === 'preset' && accent.id !== theme.accent.id) ||
      (accent.kind === 'custom' && theme.accent.kind === 'custom' && accent.hex !== theme.accent.hex),
  );

  /**
   * 取色器当前值。
   *
   * `<input type="color">` 只吃 `#rrggbb`，而主题色的"hex"对快捷键方案之外的
   * 东西都可能有三位简写形态 —— 这里统一补齐，免得取色器显示成黑色。
   */
  const pickerHex = $derived(
    accent.kind === 'custom' ? normalizeHex(accent.hex) : '#6f64ef',
  );

  function normalizeHex(hex: string): string {
    const s = hex.trim().replace(/^#/, '');
    if (s.length === 3) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`.toLowerCase();
    return `#${s}`.toLowerCase();
  }

  /* ------------------------------------------------------------ 分辨率 / 帧率预设 */

  const RES_PRESETS = [
    { id: 'landscape', labelKey: 'app.presetLandscape', w: 1920, h: 1080 },
    { id: 'hd720', labelKey: 'app.preset720', w: 1280, h: 720 },
    { id: 'uhd4k', labelKey: 'app.preset4k', w: 3840, h: 2160 },
    { id: 'vertical', labelKey: 'app.presetVertical', w: 1080, h: 1920 },
    { id: 'square', labelKey: 'app.presetSquare', w: 1080, h: 1080 },
  ] as const;

  const resPreset = $derived(RES_PRESETS.find((p) => p.w === resW && p.h === resH)?.id ?? 'custom');
  const resPresetOptions = $derived([
    ...RES_PRESETS.map((p) => ({ value: p.id as string, label: tr(p.labelKey) })),
    { value: 'custom', label: tr('app.custom') },
  ]);

  function applyResPreset(id: string): void {
    const p = RES_PRESETS.find((x) => x.id === id);
    if (p) {
      resW = p.w;
      resH = p.h;
    }
  }

  const FPS_PRESETS = [23.976, 24, 25, 29.97, 30, 50, 60] as const;
  const fpsPreset = $derived(FPS_PRESETS.some((v) => Math.abs(v - fps) < 1e-6) ? String(fps) : 'custom');
  const fpsPresetOptions = $derived([
    ...FPS_PRESETS.map((v) => ({ value: String(v), label: `${v} fps` })),
    { value: 'custom', label: tr('app.custom') },
  ]);

  function applyFpsPreset(v: string): void {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) fps = n;
  }

  const fontScaleOptions = $derived(
    FONT_SCALE_STEPS.map((s) => ({
      value: String(s),
      label: tr(
        s === 0.9
          ? 'app.fontScaleSmall'
          : s === 1
            ? 'app.fontScaleNormal'
            : s === 1.1
              ? 'app.fontScaleLarge'
              : 'app.fontScaleXLarge',
      ),
    })),
  );

  const schemeOptions = SHORTCUT_SCHEMES.map((s) => ({ value: s.id as string, label: s.label }));
  const currentScheme = $derived(SHORTCUT_SCHEMES.find((s) => s.id === scheme) ?? SHORTCUT_SCHEMES[0]!);

  /* ------------------------------------------------------------ 应用 */

  /**
   * 保存并应用。
   *
   * 逐项判「草稿是否真的变了」再写库：`commit` 会拍快照并推 version，
   * 无脑全写会让「只改了个字号」也产生一堆撤销记录（Ctrl+Z 要按很多下才回到
   * 用户以为的那一步）。
   */
  function apply(): void {
    const store = appState.store;

    if (nameChanged) {
      const next = name.trim();
      store.commit(tr('app.renameProject'), (p) => {
        p.name = next;
      });
    }
    if (resChanged) store.setResolution(resW, resH);
    if (fpsChanged) store.setFps(fps);
    if (gridChanged) store.setBeatGrid({ bpm, offset, beatsPerBar });
    if (overlapChanged) store.setOverlapBehavior(overlap);

    /* 主题三项即时生效（它们本来就是即刻可见的观感），但仍走同一个按钮：
       分成「立即生效」与「保存生效」两套规则会让这个面板变得需要解释。 */
    if (modeChanged) theme.setMode(mode);
    if (accentChanged) {
      if (accent.kind === 'preset') theme.setPreset(accent.id as BrandId);
      else theme.setCustomAccent(accent.hex);
    }
    if (fontScaleChanged) theme.setFontScale(fontScale);
    if (schemeChanged) appState.setShortcutScheme(scheme);
    if (mascotChanged) appState.setMascotEnabled(mascot);

    onclose();
  }
</script>

<Modal
  title={tr('app.settings')}
  testid="modal-settings"
  width="tall"
  flushBody
  {onclose}
>
  {#snippet footer()}
    <Button label={tr('common.cancel')} variant="outline" testid="settings-cancel" onclick={onclose} />
    <Button label={tr('app.applySettings')} variant="accent" testid="settings-apply" onclick={apply} />
  {/snippet}

  <div class="set">
    <nav class="set-nav" aria-label={tr('app.settings')} data-testid="settings-nav">
      {#each SECTIONS as s (s.id)}
        <button
          type="button"
          class="set-nav-item"
          class:active={section === s.id}
          data-testid={`settings-nav-${s.id}`}
          onclick={() => (section = s.id)}
        >
          {tr(s.labelKey)}
        </button>
      {/each}
    </nav>

    <div class="set-pane" data-testid={`settings-pane-${section}`}>
      {#if section === 'project'}
        <h3>{tr('app.basic')}</h3>

        <div class="set-row">
          <span class="set-lbl">
            {#if nameChanged}<i class="star" title={tr('app.changedMark')} aria-hidden="true">*</i>{/if}
            {tr('app.projectName')}
          </span>
          <div class="set-ctl">
            <input class="set-text" data-testid="settings-name" bind:value={name} />
          </div>
        </div>

        <div class="set-row">
          <span class="set-lbl">
            {#if resChanged}<i class="star" title={tr('app.changedMark')} aria-hidden="true">*</i>{/if}
            {tr('app.resolution')}
          </span>
          <div class="set-ctl">
            <Select
              value={resPreset}
              options={resPresetOptions}
              testid="project-res-preset"
              optionTestidPrefix="project-res-opt"
              minWidth={180}
              onchange={applyResPreset}
            />
          </div>
        </div>

        <div class="set-row">
          <span class="set-lbl sub">{tr('app.customResolution')}</span>
          <div class="set-ctl">
            <span class="set-inline">
              <span class="set-unit">{tr('app.width')}</span>
              <NumberInput
                value={resW}
                min={16}
                step={2}
                width={78}
                ariaLabel={tr('app.width')}
                testid="project-res-w"
                onchange={(v) => (resW = v)}
              />
              <span class="set-unit">{tr('app.height')}</span>
              <NumberInput
                value={resH}
                min={16}
                step={2}
                width={78}
                ariaLabel={tr('app.height')}
                testid="project-res-h"
                onchange={(v) => (resH = v)}
              />
            </span>
          </div>
        </div>

        <!-- 小字警告：改分辨率不会缩放已有排版，画布一变，元素位置与换行跟着变。 -->
        <p class="set-note warn" data-testid="settings-resolution-warn">
          {tr('app.resolutionWarn')}
        </p>

        <div class="set-row">
          <span class="set-lbl">
            {#if fpsChanged}<i class="star" title={tr('app.changedMark')} aria-hidden="true">*</i>{/if}
            {tr('app.frameRate')}
          </span>
          <div class="set-ctl">
            <Select
              value={fpsPreset}
              options={fpsPresetOptions}
              testid="project-fps-preset"
              optionTestidPrefix="project-fps-opt"
              minWidth={180}
              onchange={applyFpsPreset}
            />
          </div>
        </div>

        <div class="set-row">
          <span class="set-lbl sub">{tr('app.customFps')}</span>
          <div class="set-ctl">
            <NumberInput
              value={fps}
              min={1}
              max={240}
              step={0.001}
              width={110}
              suffix="fps"
              ariaLabel={tr('app.frameRate')}
              testid="project-fps"
              onchange={(v) => (fps = v)}
            />
          </div>
        </div>

        {#if fpsChanged}
          <p class="set-note">{tr('app.fpsChangeHint')}</p>
        {/if}

        <h3 class="set-gap">{tr('app.music')}</h3>

        <div class="set-row">
          <span class="set-lbl">
            {#if bpm !== base.bpm}<i class="star" title={tr('app.changedMark')} aria-hidden="true">*</i>{/if}
            {tr('app.bpm')}
          </span>
          <div class="set-ctl">
            <NumberInput
              value={bpm}
              min={20}
              max={300}
              step={0.1}
              width={110}
              ariaLabel={tr('app.bpm')}
              testid="settings-bpm"
              onchange={(v) => (bpm = v)}
            />
          </div>
        </div>

        <div class="set-row">
          <span class="set-lbl">
            {#if offset !== base.offset}<i class="star" title={tr('app.changedMark')} aria-hidden="true">*</i>{/if}
            {tr('app.offset')}
          </span>
          <div class="set-ctl">
            <NumberInput
              value={offset}
              step={0.01}
              width={110}
              suffix="s"
              ariaLabel={tr('app.offset')}
              testid="settings-offset"
              onchange={(v) => (offset = v)}
            />
          </div>
        </div>

        <div class="set-row">
          <span class="set-lbl">
            {#if beatsPerBar !== base.beatsPerBar}<i class="star" title={tr('app.changedMark')} aria-hidden="true">*</i>{/if}
            {tr('app.beatsPerBar')}
          </span>
          <div class="set-ctl">
            <Select
              value={beatsPerBar}
              options={[2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n) }))}
              minWidth={110}
              testid="settings-beats-per-bar"
              onchange={(v) => (beatsPerBar = v)}
            />
          </div>
        </div>

        <p class="set-note">{tr('app.beatsPerBarHint')}</p>
      {:else if section === 'appearance'}
        <!-- 没有 h3：分页名已经在左侧 navside 上写着，再抄一遍只是噪声 -->
        <div class="set-row">
          <span class="set-lbl">
            {#if fontScaleChanged}<i class="star" title={tr('app.changedMark')} aria-hidden="true">*</i>{/if}
            {tr('app.fontScale')}
          </span>
          <div class="set-ctl">
            <Select
              value={String(fontScale)}
              options={fontScaleOptions}
              minWidth={110}
              testid="settings-font-scale"
              onchange={(v) => (fontScale = Number(v) as FontScale)}
            />
          </div>
        </div>

        <div class="set-row">
          <span class="set-lbl">
            {#if accentChanged}<i class="star" title={tr('app.changedMark')} aria-hidden="true">*</i>{/if}
            {tr('app.accentColor')}
          </span>
          <div class="set-ctl">
            <span class="set-swatches">
              {#each BRAND_IDS as id (id)}
                <button
                  type="button"
                  class="swatch"
                  style:background={ACCENT_PRESETS[id].hex}
                  aria-label={tr(ACCENT_PRESETS[id].labelKey)}
                  aria-pressed={accent.kind === 'preset' && accent.id === id}
                  data-testid={`brand-${id}`}
                  onclick={() => (accent = { kind: 'preset', id })}
                ></button>
              {/each}
            </span>
          </div>
        </div>

        <div class="set-row">
          <span class="set-lbl sub">{tr('app.customAccent')}</span>
          <div class="set-ctl">
            <span class="set-inline">
              <input
                class="set-color"
                type="color"
                aria-label={tr('app.customAccent')}
                data-testid="settings-accent-picker"
                value={pickerHex}
                oninput={(e) => (accent = { kind: 'custom', hex: e.currentTarget.value })}
              />
              <input
                class="set-text mono"
                placeholder="#rrggbb"
                aria-label={tr('app.customAccent')}
                data-testid="settings-accent-hex"
                value={accent.kind === 'custom' ? accent.hex : ''}
                onchange={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (!v) return;
                  accent = { kind: 'custom', hex: v.startsWith('#') ? v : `#${v}` };
                }}
              />
            </span>
          </div>
        </div>

        <div class="set-row">
          <span class="set-lbl">
            {#if modeChanged}<i class="star" title={tr('app.changedMark')} aria-hidden="true">*</i>{/if}
            {tr('app.mode')}
          </span>
          <div class="set-ctl">
            <Select
              value={mode}
              options={[
                { value: 'light', label: tr('app.light') },
                { value: 'dark', label: tr('app.dark') },
              ]}
              minWidth={110}
              testid="settings-mode"
              onchange={(v) => (mode = v as 'light' | 'dark')}
            />
          </div>
        </div>

        <!-- 彩蛋：默认关，且走同一个草稿模型（点「保存并应用」才生效）。 -->
        <div class="set-row">
          <span class="set-lbl">
            {#if mascotChanged}<i class="star" title={tr('app.changedMark')} aria-hidden="true">*</i>{/if}
            {tr('app.mascot')}
          </span>
          <div class="set-ctl">
            <Checkbox
              checked={mascot}
              label={tr('app.mascotEnable')}
              tipText={tr('app.mascotTip')}
              testid="settings-mascot"
              onchange={(v) => (mascot = v)}
            />
          </div>
        </div>
      {:else if section === 'habits'}
        <div class="set-row">
          <span class="set-lbl">
            {#if schemeChanged}<i class="star" title={tr('app.changedMark')} aria-hidden="true">*</i>{/if}
            {tr('app.shortcutScheme')}
          </span>
          <div class="set-ctl">
            <Select
              value={scheme}
              options={schemeOptions}
              minWidth={180}
              testid="settings-scheme"
              onchange={(v) => (scheme = v as ShortcutScheme)}
            />
          </div>
        </div>

        <!-- 只列**真的有差异**的那一项：其余按键各方案一致，编出差异就是假说明书。 -->
        <div class="set-table" data-testid="settings-scheme-table">
          <span class="set-td muted">{tr('app.shortcutSplit')}</span>
          <span class="set-td mono">{tr(currentScheme.splitKeysKey)}</span>
        </div>
        <p class="set-note">{tr('app.shortcutSchemeHint')}</p>
      {:else}
        <div class="set-row">
          <span class="set-lbl">
            {#if overlapChanged}<i class="star" title={tr('app.changedMark')} aria-hidden="true">*</i>{/if}
            {tr('app.overlapBehavior')}
          </span>
          <div class="set-ctl">
            <Select
              value={overlap}
              options={[
                { value: 'reject', label: tr('tp.overlapReject') },
                { value: 'push', label: tr('tp.overlapPush') },
                { value: 'trim', label: tr('tp.overlapTrim') },
              ]}
              minWidth={180}
              testid="settings-overlap"
              onchange={(v) => (overlap = v as OverlapBehavior)}
            />
          </div>
        </div>
        <p class="set-note">{tr('app.overlapBehaviorTip')}</p>

        <!--
          这一项原来是「设置」面板里唯一的编辑器行为开关。新的分页里
          用户只要「片段重叠行为」一项，但它不能就这么消失 —— 没有 UI 的
          偏好等于不可改的偏好（`beatAnchorNewKeys` 会被永远钉在 true）。
        -->
        <div class="set-row">
          <span class="set-lbl">{tr('app.keyframes')}</span>
          <div class="set-ctl">
            <Checkbox
              checked={appState.beatAnchorNewKeys}
              label={tr('app.beatAnchorNew')}
              tipText={tr('app.beatAnchorTip')}
              testid="setting-beat-anchor"
              onchange={(v) => (appState.beatAnchorNewKeys = v)}
            />
          </div>
        </div>
      {/if}
    </div>
  </div>
</Modal>

<style>
  /* navside 固定宽 + 内容列吃满；两者都必须能各自滚动/裁剪。 */
  .set {
    display: grid;
    grid-template-columns: 128px minmax(0, 1fr);
    width: 100%;
    min-width: 0;
    min-height: 0;
  }
  .set-nav {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--sp-4) var(--sp-3);
    background: var(--surface-2);
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  .set-nav-item {
    padding: 5px var(--sp-4);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .set-nav-item:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  /* 当前分页用主题色 —— 「主题色只出现在选中/激活」的一处。 */
  .set-nav-item.active {
    background: var(--accent-weak);
    color: var(--accent);
  }
  .set-pane {
    min-width: 0;
    min-height: 0;
    padding: var(--sp-5) var(--sp-6);
    overflow-y: auto;
  }
  .set-pane h3 {
    margin: 0 0 var(--sp-4);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .set-pane h3.set-gap {
    margin-top: var(--sp-6);
  }
  /*
   * 行：左标签、右控件。
   *
   * 标签列 `1fr`、控件列定宽 —— 控件列跟着内容走的话，同一个面板里
   * 几个下拉会各宽各的（这是用户明确点出的问题：控件把半个面板占满）。
   */
  .set-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 230px;
    align-items: center;
    gap: var(--sp-4);
    min-height: 26px;
    margin-bottom: var(--sp-2);
  }
  .set-lbl {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }
  /* 子项（自定义分辨率 / 自定义帧率）：缩进表示它从属于上一行。 */
  .set-lbl.sub {
    padding-left: var(--sp-5);
    color: var(--text-muted);
  }
  /* 已更改标记：主题色，与「选中/激活」同一套语义。 */
  .star {
    color: var(--accent);
    font-size: var(--fs-sm);
    font-style: normal;
    line-height: 1;
  }
  .set-ctl {
    display: flex;
    justify-content: flex-end;
    min-width: 0;
  }
  .set-ctl > :global(.sel) {
    flex: none;
    width: 100%;
  }
  .set-inline {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
  }
  .set-unit {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }
  .set-text {
    width: 100%;
    height: var(--control-h);
  }
  .set-color {
    width: 28px;
    height: var(--control-h);
    padding: 1px;
    cursor: pointer;
  }
  .set-swatches {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-3);
  }
  .mono {
    font-family: 'Cascadia Code', Consolas, monospace;
  }
  .set-note {
    margin: 0 0 var(--sp-4);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }
  /* 分辨率的小字警告：它是「你可能会被结果吓一跳」，不是错误，所以用 warning。 */
  .set-note.warn {
    color: var(--warning);
  }
  .set-table {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    padding: var(--sp-2) var(--sp-3);
    margin-bottom: var(--sp-3);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
  }
  .set-td.muted {
    color: var(--text-secondary);
  }
</style>
