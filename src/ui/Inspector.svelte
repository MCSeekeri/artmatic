<script lang="ts">
  import { appState } from './app-state.svelte';
  import KeyableField from './KeyableField.svelte';
  import { BLEND_MODES, type AnyClip, type BlendMode, type SourceClip } from '../core/schema';
  import { baseOf, setBase, upsertCurveKey } from './clip-edit';

  const found = $derived.by(() => {
    void appState.version;
    return appState.selectedClipId ? appState.store.findClip(appState.selectedClipId) : null;
  });
  const playT = $derived(appState.playT);

  function upd(clip: AnyClip, label: string, fn: (c: AnyClip) => void): void {
    appState.store.updateClip(clip.id, label, fn);
  }

  function keyableProps(clip: AnyClip, key: string) {
    return {
      base: baseOf(clip, key),
      curve: clip.curves[key],
      clipStart: clip.start,
      onBase: (v: number) => upd(clip, '修改参数', (c) => setBase(c, key, v)),
      onKey: (v: number, anchor: { beat: number } | null) =>
        upd(clip, '打关键帧', (c) => upsertCurveKey(c, key, v, appState.playT, anchor, appState.project.beatGrid)),
      onRemoveKey: (i: number) =>
        upd(clip, '删除关键帧', (c) => {
          const cv = c.curves[key];
          if (cv) cv.keys = cv.keys.filter((_, idx) => idx !== i);
        }),
      onAnchorChange: (anchor: { beat: number } | null) =>
        upd(clip, '切换锚到拍', (c) => {
          const cv = c.curves[key];
          if (cv) cv.beatAnchor = anchor;
        }),
      onClearCurve: () =>
        upd(clip, '清除曲线', (c) => {
          delete c.curves[key];
        }),
    };
  }
</script>

<div class="inspector">
  {#if found}
    {@const clip = found.clip}
    {@const track = found.track}
    <h3>
      {clip.kind === 'source' ? '画面片段' : clip.kind === 'effect' ? '特效片段' : '音频片段'}
      <span class="track-name">{track.name}</span>
    </h3>

    <label class="line">
      名称
      <input value={clip.label} onchange={(e) => upd(clip, '重命名', (c) => (c.label = e.currentTarget.value))} />
    </label>

    <div class="line nums">
      <label>
        起点
        <input
          type="number"
          step="0.01"
          min="0"
          value={+clip.start.toFixed(3)}
          onchange={(e) =>
            upd(clip, '改起点', (c) => {
              c.start = Math.max(0, Math.min(+e.currentTarget.value || 0, c.end - 0.05));
            })}
        />
      </label>
      <label>
        终点
        <input
          type="number"
          step="0.01"
          min="0"
          value={+clip.end.toFixed(3)}
          onchange={(e) =>
            upd(clip, '改终点', (c) => {
              c.end = Math.min(appState.project.duration, Math.max(+e.currentTarget.value || 0, c.start + 0.05));
            })}
        />
      </label>
      <label>
        淡变
        <input
          type="number"
          step="0.05"
          min="0"
          value={+clip.fadeSec.toFixed(2)}
          onchange={(e) => upd(clip, '改淡变', (c) => (c.fadeSec = Math.max(0, +e.currentTarget.value || 0)))}
        />
      </label>
    </div>

    {#if clip.kind === 'source'}
      <div class="line">
        <label>
          混合
          <select
            value={clip.blend}
            onchange={(e) =>
              upd(clip, '改混合模式', (c) => {
                if (c.kind === 'source') c.blend = e.currentTarget.value as BlendMode;
              })}
          >
            {#each BLEND_MODES as m (m.id)}
              <option value={m.id}>{m.label}</option>
            {/each}
          </select>
        </label>
        <label>
          适配
          <select
            value={clip.fit}
            onchange={(e) =>
              upd(clip, '改适配', (c) => {
                if (c.kind === 'source') c.fit = e.currentTarget.value as SourceClip['fit'];
              })}
          >
            <option value="contain">contain</option>
            <option value="cover">cover</option>
            <option value="stretch">stretch</option>
          </select>
        </label>
      </div>

      <KeyableField label="不透明度" min={0} max={1} step={0.01} {...keyableProps(clip, 'opacity')} />
      <KeyableField label="位置 X" min={0} max={1} step={0.005} {...keyableProps(clip, 'transform.x')} />
      <KeyableField label="位置 Y" min={0} max={1} step={0.005} {...keyableProps(clip, 'transform.y')} />
      <KeyableField label="缩放 X" min={0.05} max={4} step={0.01} {...keyableProps(clip, 'transform.sx')} />
      <KeyableField label="缩放 Y" min={0.05} max={4} step={0.01} {...keyableProps(clip, 'transform.sy')} />
      <KeyableField label="旋转" min={-3.1416} max={3.1416} step={0.01} {...keyableProps(clip, 'transform.rot')} />

      {#if clip.source.type === 'solid'}
        <label class="line">
          颜色
          <input
            type="color"
            value={clip.source.color}
            oninput={(e) =>
              upd(clip, '改颜色', (c) => {
                if (c.kind === 'source' && c.source.type === 'solid') c.source.color = e.currentTarget.value;
              })}
          />
        </label>
      {:else if clip.source.type === 'algo'}
        <p class="note">算法生成器：{clip.source.generator}（参数面板在 B7/B8 接入）</p>
      {:else if clip.source.type === 'image'}
        <p class="note">图片素材：{appState.project.assets[clip.source.assetId]?.name ?? clip.source.assetId}</p>
      {/if}
    {:else if clip.kind === 'effect'}
      <p class="note">特效链（B8 接入）：{clip.chain.length} 个实例</p>
      {#each clip.chain as inst (inst.instanceId)}
        <div class="line">
          <input
            type="checkbox"
            checked={inst.enabled}
            onchange={(e) =>
              upd(clip, '切换特效', (c) => {
                if (c.kind === 'effect') {
                  const it = c.chain.find((x) => x.instanceId === inst.instanceId);
                  if (it) it.enabled = e.currentTarget.checked;
                }
              })}
          />
          <span>{inst.defId}</span>
        </div>
      {/each}
    {:else}
      <label class="line">
        源内偏移 srcIn
        <input
          type="number"
          step="0.01"
          min="0"
          value={clip.srcIn}
          onchange={(e) =>
            upd(clip, '改 srcIn', (c) => {
              if (c.kind === 'audio') c.srcIn = Math.max(0, +e.currentTarget.value || 0);
            })}
        />
      </label>
    {/if}

    <div class="actions">
      <button
        data-testid="split-at-playhead"
        title="在播放头处切分 (S)"
        onclick={() => appState.store.splitClipAt(track.id, clip.id, playT)}
      >
        <i class="fa-solid fa-scissors"></i> 在播放头切分
      </button>
      <button
        data-testid="delete-clip"
        class="danger"
        title="删除片段 (Del)"
        onclick={() => {
          appState.store.removeClip(clip.id);
          appState.selectedClipId = null;
        }}
      >
        <i class="fa-solid fa-trash"></i> 删除
      </button>
    </div>
  {:else}
    <h3>检查器</h3>
    <p class="placeholder">选中一个片段查看属性</p>
  {/if}
</div>

<style>
  .inspector {
    padding: 10px 12px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--text-1);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .track-name {
    margin-left: 6px;
    color: var(--text-2);
    text-transform: none;
  }
  .placeholder,
  .note {
    color: var(--text-2);
  }
  .note {
    font-size: 11px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    color: var(--text-1);
    font-size: 12px;
  }
  .line input:not([type='checkbox']) {
    flex: 1;
    min-width: 0;
  }
  .nums {
    flex-wrap: wrap;
  }
  .nums label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }
  .nums input {
    width: 62px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .danger {
    color: var(--danger);
  }
</style>
