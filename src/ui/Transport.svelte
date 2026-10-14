<script lang="ts">
  /**
   * Transport — 轨道正上方的工具条。
   *
   * 只放**逐帧/逐拍**的操作（播放、拍网格、吸附、时长、缩放、重叠策略）。
   * 导出属于工程级动作，已搬去窄侧栏的面板；一次性提示（notice）搬去了底栏。
   * 这条划分见 AGENTS.md §5 的布局约定。
   */
  import Icon from './Icon.svelte';
  import IconButton from './controls/IconButton.svelte';
  import NumberInput from './controls/NumberInput.svelte';
  import Select from './controls/Select.svelte';
  import Slider from './controls/Slider.svelte';
  import { appState } from './app-state.svelte';
  import { beatAtTime, SNAP_MODES, type SnapMode } from '../core/time';
  import type { OverlapBehavior } from '../core/schema';
  import { browserPlatform } from '../platform/browser';
  import { tip } from './tip';
  import { tr } from '../i18n/index.svelte';

  const grid = $derived.by(() => {
    void appState.version;
    return { ...appState.store.project.beatGrid };
  });
  const overlapBehavior = $derived.by(() => {
    void appState.version;
    return appState.store.project.overlapBehavior;
  });
  /** 工程时长不是素材长度的函数，是一个可以随便改的独立参数。 */
  const duration = $derived.by(() => {
    void appState.version;
    return appState.store.project.duration;
  });
  const playT = $derived(appState.playT);
  const beatPos = $derived(beatAtTime(playT, grid));
  const barBeat = $derived.by(() => {
    const b = Math.max(0, beatPos);
    const bar = Math.floor(b / grid.beatsPerBar) + 1;
    const beat = Math.floor(b % grid.beatsPerBar) + 1;
    return `${bar}.${beat}`;
  });

  function fmt(t: number): string {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2).padStart(5, '0');
    return `${m}:${s}`;
  }

  const snapOptions = $derived(
    Object.entries(SNAP_MODES).map(([mode, def]) => ({
      value: mode as SnapMode,
      label: tr(def.labelKey),
    })),
  );

  const barOptions = [2, 3, 4, 6].map((n) => ({ value: n, label: String(n) }));

  const overlapOptions = $derived<{ value: OverlapBehavior; label: string }[]>([
    { value: 'reject', label: tr('tp.overlapReject') },
    { value: 'push', label: tr('tp.overlapPush') },
    { value: 'trim', label: tr('tp.overlapTrim') },
  ]);

  /**
   * 把**当前预览帧**送出去：默认进系统剪贴板，不支持 / 被拒时回退成下载。
   *
   * 为什么默认剪贴板：截图是「拿去用」的动作（贴进聊天 / 文档 / 当参考图），
   * 而下载会在下载文件夹里堆一串 `xxx-frame-00042.png`。
   * 逃生通道保留：**按住 Alt 点击 = 强制下载**（要文件名、要归档时用）。
   *
   * 渲染那段收在 `appState.snapshotFrame()`（它要碰 renderer 与工程分辨率，
   * 属于状态层的活）；这里只管「拿到 Blob → 挑通道 → 报一句结果」。
   * 两条通道都走平台层，不在这里自己拼 anchor / ClipboardItem。
   *
   * ⚠️ **剪贴板写入必须在手势里**（`clipboard.write` 要求瞬时激活）：
   * 这条链路上不能插 `setTimeout` / 二次事件循环，否则会被判成 `denied`。
   */
  async function saveCurrentFrame(forceDownload = false): Promise<void> {
    const shot = await appState.snapshotFrame();
    if (!shot) {
      appState.flash(tr('tp.snapshotFailed'), 'error');
      return;
    }
    if (!forceDownload) {
      const res = await browserPlatform.writeImageToClipboard(shot.blob);
      if (res === 'ok') {
        appState.flash(
          tr(shot.truncated ? 'tp.snapshotCopiedPartial' : 'tp.snapshotCopied', { frame: shot.frame }),
          'success',
        );
        return;
      }
      await browserPlatform.download(shot.blob, shot.filename);
      appState.flash(
        tr(res === 'denied' ? 'tp.snapshotClipDenied' : 'tp.snapshotClipUnsupported', {
          frame: shot.frame,
        }),
        'info',
      );
      return;
    }
    await browserPlatform.download(shot.blob, shot.filename);
    appState.flash(tr('tp.snapshotSaved', { frame: shot.frame }), 'success');
  }
</script>

<div class="transport">
  <IconButton
    icon={appState.playing ? 'pause' : 'play'}
    label={appState.playing ? tr('tp.pause') : tr('tp.play')}
    shortcut="Space"
    size="lg"
    tipPlacement="top"
    testid="play-toggle"
    onclick={() => appState.togglePlay()}
  />
  <IconButton
    icon="square"
    label={tr('tp.stop')}
    tipPlacement="top"
    testid="stop"
    onclick={() => appState.stop()}
  />

  <span class="time" use:tip={{ placement: 'top', text: tr('tp.timeTip') }}>
    {fmt(playT)}<em>{barBeat}</em>
  </span>

  <!-- 当前帧截图：与时间读数同一簇（都是「此刻这一帧」的事）。 -->
  <IconButton
    icon="image"
    label={tr('tp.snapshot')}
    tipText={tr('tp.snapshotTip')}
    tipPlacement="top"
    testid="preview-snapshot"
    disabled={appState.snapshotting}
    onclick={(e) => void saveCurrentFrame(e.altKey)}
  />

  <span class="sep"></span>

  <span class="ctl" use:tip={{ placement: 'top', text: tr('tp.bpmTip') }}>
    <span class="lbl">BPM</span>
    <NumberInput
      value={grid.bpm}
      min={20}
      max={300}
      step={0.1}
      width={58}
      ariaLabel="BPM"
      testid="bpm-input"
      onchange={(v) => appState.store.setBeatGrid({ bpm: Math.max(20, Math.min(300, v || 120)) })}
    />
    <!--
      自动估计（ADR-002）。放在 BPM 右边而不是设置面板里：它是「对着这首曲子
      调拍网格」这个动作的一部分，离 BPM/offset 越近越顺手。
    -->
    <IconButton
      icon="wand-sparkles"
      label={tr('tp.estimate')}
      tipText={appState.beatBusy ? tr('tp.estimateBusy') : tr('tp.estimateTip')}
      size="sm"
      disabled={appState.beatBusy}
      testid="estimate-bpm"
      onclick={() => void appState.estimateBeatGrid()}
    />
  </span>

  <span class="ctl" use:tip={{ placement: 'top', text: tr('tp.offsetTip') }}>
    <span class="lbl">offset</span>
    <NumberInput
      value={grid.offset}
      step={0.01}
      width={58}
      ariaLabel="offset"
      testid="offset-input"
      onchange={(v) => appState.store.setBeatGrid({ offset: v })}
    />
  </span>

  <span class="ctl" use:tip={{ placement: 'top', text: tr('tp.beatsPerBarTip') }}>
    <span class="lbl">{tr('tp.beatsPerBar')}</span>
    <Select
      value={grid.beatsPerBar}
      options={barOptions}
      onchange={(v) => appState.store.setBeatGrid({ beatsPerBar: v })}
      testid="beats-per-bar"
      optionTestidPrefix="beats-per-bar-opt"
      minWidth={56}
    />
  </span>

  <span class="ctl" use:tip={{ placement: 'top', text: tr('tp.snapTip') }}>
    <span class="lbl">{tr('tp.snap')}</span>
    <Select
      value={appState.snap}
      options={snapOptions}
      onchange={(v) => appState.setSnap(v)}
      testid="snap-mode"
      optionTestidPrefix="snap-mode-opt"
      minWidth={88}
    />
  </span>

  <span class="sep"></span>

  <span class="ctl" use:tip={{ placement: 'top', text: tr('tp.durationTip') }}>
    <span class="lbl">{tr('tp.duration')}</span>
    <NumberInput
      value={+duration.toFixed(2)}
      min={0.1}
      step={0.5}
      width={62}
      suffix="s"
      ariaLabel={tr('tp.projectDuration')}
      testid="duration-input"
      onchange={(v) => appState.store.setDuration(v || 0.1)}
    />
    <IconButton
      icon="minimize-2"
      label={tr('tp.fitDuration')}
      size="sm"
      tipPlacement="top"
      testid="fit-duration"
      onclick={() => appState.store.fitDurationToContent()}
    />
  </span>

  <span class="ctl" use:tip={{ placement: 'top', text: tr('tp.overlapTip') }}>
    <span class="lbl">{tr('tp.overlap')}</span>
    <Select
      value={overlapBehavior}
      options={overlapOptions}
      onchange={(v) => appState.store.setOverlapBehavior(v)}
      testid="overlap-behavior"
      optionTestidPrefix="overlap-behavior-opt"
      minWidth={96}
    />
  </span>

  <span class="ctl zoom" use:tip={{ placement: 'top', text: tr('tp.zoomTip') }}>
    <Icon name="search" size={12} />
    <Slider
      value={appState.pxPerBeat}
      min={6}
      max={96}
      step={1}
      ariaLabel={tr('tp.zoom')}
      testid="zoom-slider"
      oninput={(v) => (appState.pxPerBeat = v)}
    />
  </span>
</div>

<style>
  .transport {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    /* 允许换行：窄窗口下宁可工具条高一行，也不要它把 stage 的列撑宽
       （那会让 preview/toolbar/tracks 一起溢出到抽屉底下）。 */
    flex-wrap: wrap;
    row-gap: var(--sp-2);
    min-width: 0;
  }
  .time {
    display: inline-flex;
    align-items: baseline;
    gap: var(--sp-3);
    flex-shrink: 0;
    color: var(--text-primary);
    font-family: 'Cascadia Code', Consolas, monospace;
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .time em {
    font-style: normal;
    color: var(--accent);
  }
  .sep {
    width: 1px;
    height: 14px;
    flex-shrink: 0;
    background: var(--tl-border);
  }
  .ctl {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    flex-shrink: 0;
    min-width: 0;
  }
  .lbl {
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    white-space: nowrap;
  }
  .zoom {
    min-width: 140px;
  }
</style>
