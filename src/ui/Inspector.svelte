<script lang="ts">
  import { appState } from './app-state.svelte';
  import KeyableField from './KeyableField.svelte';
  import { BLEND_MODES, newId, type AnyClip, type BlendMode, type EffectInstance, type SourceClip } from '../core/schema';
  import { baseOf, setBase, upsertCurveKey } from './clip-edit';
  import { getGenerator } from '../algos/registry';
  import { defaultEffectValues, getEffect, listEffects } from '../effects/registry';
  import type { RangeParam } from '../effects/types';

  const effectsList = listEffects();
  let addChoice = $state(effectsList[0]?.id ?? '');

  function addEffectInstance(clip: AnyClip): void {
    if (!addChoice) return;
    upd(clip, '添加特效', (c) => {
      if (c.kind !== 'effect') return;
      c.chain.push({
        instanceId: newId(),
        defId: addChoice,
        enabled: true,
        values: defaultEffectValues(addChoice),
      });
    });
  }

  function removeInstance(clip: AnyClip, instanceId: string): void {
    upd(clip, '删除特效', (c) => {
      if (c.kind === 'effect') c.chain = c.chain.filter((i) => i.instanceId !== instanceId);
    });
  }

  function moveInstance(clip: AnyClip, instanceId: string, dir: -1 | 1): void {
    upd(clip, '调整特效顺序', (c) => {
      if (c.kind !== 'effect') return;
      const idx = c.chain.findIndex((i) => i.instanceId === instanceId);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= c.chain.length) return;
      const [it] = c.chain.splice(idx, 1);
      c.chain.splice(to, 0, it!);
    });
  }

  function setEffectParam(clip: AnyClip, inst: EffectInstance, key: string, v: number | string): void {
    upd(clip, '修改特效参数', (c) => {
      if (c.kind !== 'effect') return;
      const it = c.chain.find((i) => i.instanceId === inst.instanceId);
      if (it) it.values[key] = v;
    });
  }

  function effectParamProps(clip: AnyClip, inst: EffectInstance, p: RangeParam) {
    const curveKey = `${inst.instanceId}.${p.key}`;
    return {
      base: Number(inst.values[p.key] ?? p.defaultValue),
      curve: clip.curves[curveKey],
      clipStart: clip.start,
      onBase: (v: number) => setEffectParam(clip, inst, p.key, v),
      onKey: (v: number, anchor: { beat: number } | null) =>
        upd(clip, '打关键帧', (c) => upsertCurveKey(c, curveKey, v, appState.playT, anchor, appState.project.beatGrid)),
      onRemoveKey: (i: number) =>
        upd(clip, '删除关键帧', (c) => {
          const cv = c.curves[curveKey];
          if (cv) cv.keys = cv.keys.filter((_, k) => k !== i);
        }),
      onAnchorChange: (anchor: { beat: number } | null) =>
        upd(clip, '切换锚到拍', (c) => {
          const cv = c.curves[curveKey];
          if (cv) cv.beatAnchor = anchor;
        }),
      onClearCurve: () =>
        upd(clip, '清除曲线', (c) => {
          delete c.curves[curveKey];
        }),
    };
  }

  /**
   * 可关键帧的算法参数：realtime 生成器的全部 range 参数 +
   * bake 型的渲染期 speed。烘焙入参（width/rule/…）打关键帧 = 每帧重烘，禁止。
   */
  function keyframable(kind: string, key: string): boolean {
    return kind === 'realtime' || (kind === 'bake' && key === 'speed');
  }

  function setAlgoParam(clip: AnyClip, key: string, v: number | string): void {
    upd(clip, '修改参数', (c) => {
      if (c.kind === 'source' && c.source.type === 'algo') c.source.params[key] = v;
    });
  }

  function paramKeyableProps(clip: AnyClip, p: RangeParam) {
    return {
      base:
        clip.kind === 'source' && clip.source.type === 'algo'
          ? Number(clip.source.params[p.key] ?? p.defaultValue)
          : p.defaultValue,
      curve: clip.curves[p.key],
      clipStart: clip.start,
      onBase: (v: number) => setAlgoParam(clip, p.key, v),
      onKey: (v: number, anchor: { beat: number } | null) =>
        upd(clip, '打关键帧', (c) => upsertCurveKey(c, p.key, v, appState.playT, anchor, appState.project.beatGrid)),
      onRemoveKey: (i: number) =>
        upd(clip, '删除关键帧', (c) => {
          const cv = c.curves[p.key];
          if (cv) cv.keys = cv.keys.filter((_, idx) => idx !== i);
        }),
      onAnchorChange: (anchor: { beat: number } | null) =>
        upd(clip, '切换锚到拍', (c) => {
          const cv = c.curves[p.key];
          if (cv) cv.beatAnchor = anchor;
        }),
      onClearCurve: () =>
        upd(clip, '清除曲线', (c) => {
          delete c.curves[p.key];
        }),
    };
  }

  /**
   * 必须返回**新的引用**，不能只返回 store 里的原对象。
   *
   * Svelte 5 把 `{@const clip = found.clip}` 编译成 `$.derived(() => found.clip)`，
   * 而 derived 靠 `===` 判等决定是否向模板 effect 传播。store 里的 clip 是原地改的，
   * `found.clip` 每次都是同一个引用 → clip 派生视为「没变」→ 整块模板 effect 不重跑。
   * 症状：加/删特效链只改 store，右侧面板纹丝不动；换选中再换回来才刷新
   * （`{#if found}` 换分支 → 子树重建 → 读到新值）。
   *
   * 所以：包装对象每次新建，clip 深拷一份，track 浅拷即可（模板只读 name / id）。
   * 深拷的代价是一次片段级别的 structuredClone，可忽略；换来的是面板里任何一层
   * 嵌套读（chain / values / curves.keys）都必然拿到最新值。
   */
  const found = $derived.by(() => {
    void appState.version;
    const id = appState.selectedClipId;
    if (!id) return null;
    const f = appState.store.findClip(id);
    if (!f) return null;
    return { track: { ...f.track }, clip: structuredClone(f.clip) as AnyClip };
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
        {@const def = getGenerator(clip.source.generator)}
        <p class="note">算法生成器：{def?.name ?? clip.source.generator}</p>
        {#if def}
          {#each def.params as p (p.key)}
            {#if p.type === 'range'}
              {#if keyframable(def.kind, p.key)}
                <KeyableField label={p.label} min={p.min} max={p.max} step={p.step} {...paramKeyableProps(clip, p)} />
              {:else}
                <div class="kf">
                  <div class="row">
                    <span class="lbl" title={`${p.label}（烘焙入参，不可打关键帧）`}>{p.label}</span>
                    <input
                      type="range"
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      value={Number(clip.source.params[p.key] ?? p.defaultValue)}
                      oninput={(e) => setAlgoParam(clip, p.key, +e.currentTarget.value)}
                    />
                    <input
                      class="num"
                      type="number"
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      value={Number(clip.source.params[p.key] ?? p.defaultValue)}
                      onchange={(e) => setAlgoParam(clip, p.key, +e.currentTarget.value)}
                    />
                  </div>
                </div>
              {/if}
            {:else if p.type === 'select'}
              <label class="line">
                {p.label}
                <select
                  value={clip.source.params[p.key] ?? p.defaultValue}
                  onchange={(e) => setAlgoParam(clip, p.key, e.currentTarget.value)}
                >
                  {#each p.options as o (o.value)}
                    <option value={o.value}>{o.label}</option>
                  {/each}
                </select>
              </label>
            {:else if p.type === 'color'}
              <label class="line">
                {p.label}
                <input
                  type="color"
                  value={String(clip.source.params[p.key] ?? p.defaultValue)}
                  oninput={(e) => setAlgoParam(clip, p.key, e.currentTarget.value)}
                />
              </label>
            {/if}
          {/each}
        {/if}
      {:else if clip.source.type === 'image'}
        <p class="note">图片素材：{appState.project.assets[clip.source.assetId]?.name ?? clip.source.assetId}</p>
      {/if}
    {:else if clip.kind === 'effect'}
      <div class="line">
        <select bind:value={addChoice} title="选择要添加的特效">
          {#each effectsList as e (e.id)}
            <option value={e.id}>{e.name}</option>
          {/each}
        </select>
        <button data-testid="add-effect-instance" onclick={() => addEffectInstance(clip)}>
          <i class="fa-solid fa-plus"></i> 添加
        </button>
      </div>
      {#if clip.chain.length === 0}
        <p class="note">空链：从上面添加特效。特效只作用于 z 序在它之下的画面（adjustment layer）。</p>
      {/if}
      {#each clip.chain as inst, idx (inst.instanceId)}
        {@const entry = getEffect(inst.defId)}
        <div class="fx">
          <div class="fx-head">
            <input
              type="checkbox"
              checked={inst.enabled}
              title="启用/禁用"
              onchange={(e) =>
                upd(clip, '切换特效', (c) => {
                  if (c.kind === 'effect') {
                    const it = c.chain.find((x) => x.instanceId === inst.instanceId);
                    if (it) it.enabled = e.currentTarget.checked;
                  }
                })}
            />
            <span class="fx-name">{entry?.name ?? inst.defId}</span>
            <button title="上移" disabled={idx === 0} onclick={() => moveInstance(clip, inst.instanceId, -1)}>
              <i class="fa-solid fa-arrow-up"></i>
            </button>
            <button title="下移" disabled={idx === clip.chain.length - 1} onclick={() => moveInstance(clip, inst.instanceId, 1)}>
              <i class="fa-solid fa-arrow-down"></i>
            </button>
            <button title="删除" onclick={() => removeInstance(clip, inst.instanceId)}>
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          {#if entry}
            {#each entry.params as p (p.key)}
              {#if p.type === 'range'}
                <KeyableField label={p.label} min={p.min} max={p.max} step={p.step} {...effectParamProps(clip, inst, p)} />
              {:else if p.type === 'select'}
                <label class="line">
                  {p.label}
                  <select
                    value={inst.values[p.key] ?? p.defaultValue}
                    onchange={(e) => setEffectParam(clip, inst, p.key, e.currentTarget.value)}
                  >
                    {#each p.options as o (o.value)}
                      <option value={o.value}>{o.label}</option>
                    {/each}
                  </select>
                </label>
              {:else if p.type === 'color'}
                <label class="line">
                  {p.label}
                  <input
                    type="color"
                    value={String(inst.values[p.key] ?? p.defaultValue)}
                    oninput={(e) => setEffectParam(clip, inst, p.key, e.currentTarget.value)}
                  />
                </label>
              {/if}
            {/each}
          {/if}
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
  .fx {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 6px 8px;
    margin-bottom: 8px;
    background: var(--bg-2);
  }
  .fx-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .fx-name {
    flex: 1;
    font-size: 12px;
    color: var(--text-0);
  }
  .fx-head button {
    padding: 1px 5px;
    font-size: 9px;
    background: transparent;
    border-color: transparent;
  }
  .kf {
    margin-bottom: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .lbl {
    width: 64px;
    flex-shrink: 0;
    color: var(--text-1);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row input[type='range'] {
    flex: 1;
    min-width: 0;
  }
  .num {
    width: 60px;
    font-size: 11px;
  }
</style>
