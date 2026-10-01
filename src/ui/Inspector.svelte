<script lang="ts">
  import { appState } from './app-state.svelte';
  import KeyableField from './KeyableField.svelte';
  import Button from './controls/Button.svelte';
  import Checkbox from './controls/Checkbox.svelte';
  import Field from './controls/Field.svelte';
  import IconButton from './controls/IconButton.svelte';
  import NumberInput from './controls/NumberInput.svelte';
  import Select from './controls/Select.svelte';
  import Slider from './controls/Slider.svelte';
  import {
    BLEND_MODES,
    newId,
    type AnyClip,
    type BlendMode,
    type EffectInstance,
    type SourceClip,
  } from '../core/schema';
  import { baseOf, setBase, upsertCurveKey } from './clip-edit';
  import { getGenerator } from '../algos/registry';
  import { defaultEffectValues, getEffect, listEffects } from '../effects/registry';
  import type { RangeParam } from '../effects/types';

  const effectsList = listEffects();
  const effectOptions = effectsList.map((e) => ({ value: e.id, label: e.name }));
  const blendOptions = BLEND_MODES.map((m) => ({ value: m.id, label: m.label }));
  const fitOptions = ['contain', 'cover', 'stretch'].map((v) => ({ value: v as SourceClip['fit'], label: v }));

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
   * found.clip 每次都是同一引用 → clip 派生视为「没变」→ 整块模板 effect 不重跑。
   * 症状：加/删特效链只改 store，右侧面板纹丝不动；换选中再换回来才刷新。
   *
   * 所以包装对象每次新建、clip 深拷一份；track 浅拷即可（模板只读 name）。
   * 代价是一次片段级 structuredClone，可忽略。
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

    <Field label="名称">
      <input
        class="txt"
        data-testid="clip-label"
        value={clip.label}
        onchange={(e) => upd(clip, '重命名', (c) => (c.label = e.currentTarget.value))}
      />
    </Field>

    <Field label="起点">
      <NumberInput
        value={clip.start}
        min={0}
        step={0.01}
        width={64}
        suffix="s"
        testid="clip-start"
        onchange={(v) => upd(clip, '改起点', (c) => (c.start = Math.max(0, Math.min(v, c.end - 0.05))))}
      />
      <span class="dim">终点</span>
      <NumberInput
        value={clip.end}
        min={0}
        step={0.01}
        width={64}
        suffix="s"
        testid="clip-end"
        onchange={(v) =>
          upd(clip, '改终点', (c) => (c.end = Math.min(appState.project.duration, Math.max(v, c.start + 0.05))))}
      />
    </Field>

    <Field label="淡变">
      <NumberInput
        value={clip.fadeSec}
        min={0}
        step={0.05}
        width={64}
        suffix="s"
        testid="clip-fade"
        onchange={(v) => upd(clip, '改淡变', (c) => (c.fadeSec = Math.max(0, v)))}
      />
    </Field>

    {#if clip.kind === 'source'}
      <Field label="混合">
        <Select
          value={clip.blend}
          options={blendOptions}
          testid="clip-blend"
          optionTestidPrefix="clip-blend-opt"
          onchange={(v) =>
            upd(clip, '改混合模式', (c) => {
              if (c.kind === 'source') c.blend = v as BlendMode;
            })}
        />
      </Field>
      <Field label="适配">
        <Select
          value={clip.fit}
          options={fitOptions}
          testid="clip-fit"
          optionTestidPrefix="clip-fit-opt"
          onchange={(v) =>
            upd(clip, '改适配', (c) => {
              if (c.kind === 'source') c.fit = v;
            })}
        />
      </Field>

      <KeyableField label="不透明度" min={0} max={1} step={0.01} {...keyableProps(clip, 'opacity')} />
      <KeyableField label="位置 X" min={0} max={1} step={0.005} {...keyableProps(clip, 'transform.x')} />
      <KeyableField label="位置 Y" min={0} max={1} step={0.005} {...keyableProps(clip, 'transform.y')} />
      <KeyableField label="缩放 X" min={0.05} max={4} step={0.01} {...keyableProps(clip, 'transform.sx')} />
      <KeyableField label="缩放 Y" min={0.05} max={4} step={0.01} {...keyableProps(clip, 'transform.sy')} />
      <KeyableField label="旋转" min={-3.1416} max={3.1416} step={0.01} {...keyableProps(clip, 'transform.rot')} />

      {#if clip.source.type === 'solid'}
        <Field label="颜色">
          <input
            class="color"
            type="color"
            data-testid="clip-color"
            value={clip.source.color}
            oninput={(e) =>
              upd(clip, '改颜色', (c) => {
                if (c.kind === 'source' && c.source.type === 'solid') c.source.color = e.currentTarget.value;
              })}
          />
          <span class="dim mono">{clip.source.color}</span>
        </Field>
      {:else if clip.source.type === 'algo'}
        {@const def = getGenerator(clip.source.generator)}
        <p class="note">算法生成器：{def?.name ?? clip.source.generator}</p>
        {#if def}
          {#each def.params as p (p.key)}
            {#if p.type === 'range'}
              {#if keyframable(def.kind, p.key)}
                <KeyableField label={p.label} min={p.min} max={p.max} step={p.step} {...paramKeyableProps(clip, p)} />
              {:else}
                <!-- 烘焙入参：改了要重烘，所以不能打关键帧（每帧重烘会卡死） -->
                <Field label={p.label} tipText={`${p.label}（烘焙入参，不可打关键帧）`}>
                  <Slider
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={Number(clip.source.params[p.key] ?? p.defaultValue)}
                    ariaLabel={p.label}
                    testid="bake-param-slider"
                    oninput={(v) => setAlgoParam(clip, p.key, v)}
                  />
                  <NumberInput
                    value={Number(clip.source.params[p.key] ?? p.defaultValue)}
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    width={64}
                    testid="bake-param-number"
                    oninput={(v) => setAlgoParam(clip, p.key, v)}
                    onchange={(v) => setAlgoParam(clip, p.key, v)}
                  />
                </Field>
              {/if}
            {:else if p.type === 'select'}
              <Field label={p.label}>
                <Select
                  value={String(clip.source.params[p.key] ?? p.defaultValue)}
                  options={p.options.map((o) => ({ value: o.value, label: o.label }))}
                  testid={`algo-param-${p.key}`}
                  optionTestidPrefix={`algo-param-${p.key}-opt`}
                  onchange={(v) => setAlgoParam(clip, p.key, v)}
                />
              </Field>
            {:else if p.type === 'color'}
              <Field label={p.label}>
                <input
                  class="color"
                  type="color"
                  value={String(clip.source.params[p.key] ?? p.defaultValue)}
                  oninput={(e) => setAlgoParam(clip, p.key, e.currentTarget.value)}
                />
              </Field>
            {/if}
          {/each}
        {/if}
      {:else if clip.source.type === 'image'}
        <p class="note">图片素材：{appState.project.assets[clip.source.assetId]?.name ?? clip.source.assetId}</p>
      {/if}
    {:else if clip.kind === 'effect'}
      <Field label="添加特效">
        <Select
          value={addChoice}
          options={effectOptions}
          testid="effect-picker"
          optionTestidPrefix="effect-picker-opt"
          onchange={(v) => (addChoice = v)}
        />
        <Button
          label="添加"
          icon="plus"
          testid="add-effect-instance"
          onclick={() => addEffectInstance(clip)}
        />
      </Field>

      {#if clip.chain.length === 0}
        <p class="note">空链：从上面添加特效。特效只作用于 z 序在它之下的画面（adjustment layer）。</p>
      {/if}

      {#each clip.chain as inst, idx (inst.instanceId)}
        {@const entry = getEffect(inst.defId)}
        <div class="fx" data-testid="effect-instance">
          <div class="fx-head">
            <Checkbox
              checked={inst.enabled}
              tipText="启用 / 禁用这个特效实例"
              testid="effect-enabled"
              onchange={(v) =>
                upd(clip, '切换特效', (c) => {
                  if (c.kind === 'effect') {
                    const it = c.chain.find((x) => x.instanceId === inst.instanceId);
                    if (it) it.enabled = v;
                  }
                })}
            />
            <span class="fx-name">{entry?.name ?? inst.defId}</span>
            <IconButton
              icon="arrow-up"
              label="上移"
              size="sm"
              disabled={idx === 0}
              testid="effect-move-up"
              onclick={() => moveInstance(clip, inst.instanceId, -1)}
            />
            <IconButton
              icon="arrow-down"
              label="下移"
              size="sm"
              disabled={idx === clip.chain.length - 1}
              testid="effect-move-down"
              onclick={() => moveInstance(clip, inst.instanceId, 1)}
            />
            <IconButton
              icon="x"
              label="删除特效"
              size="sm"
              variant="danger"
              testid="effect-remove"
              onclick={() => removeInstance(clip, inst.instanceId)}
            />
          </div>
          {#if entry}
            {#each entry.params as p (p.key)}
              {#if p.type === 'range'}
                <KeyableField label={p.label} min={p.min} max={p.max} step={p.step} {...effectParamProps(clip, inst, p)} />
              {:else if p.type === 'select'}
                <Field label={p.label}>
                  <Select
                    value={String(inst.values[p.key] ?? p.defaultValue)}
                    options={p.options.map((o) => ({ value: o.value, label: o.label }))}
                    testid={`effect-param-${p.key}`}
                    optionTestidPrefix={`effect-param-${p.key}-opt`}
                    onchange={(v) => setEffectParam(clip, inst, p.key, v)}
                  />
                </Field>
              {:else if p.type === 'color'}
                <Field label={p.label}>
                  <input
                    class="color"
                    type="color"
                    value={String(inst.values[p.key] ?? p.defaultValue)}
                    oninput={(e) => setEffectParam(clip, inst, p.key, e.currentTarget.value)}
                  />
                </Field>
              {/if}
            {/each}
          {/if}
        </div>
      {/each}
    {:else}
      <Field label="源内偏移">
        <NumberInput
          value={clip.srcIn}
          min={0}
          step={0.01}
          width={70}
          suffix="s"
          testid="clip-srcin"
          onchange={(v) =>
            upd(clip, '改 srcIn', (c) => {
              if (c.kind === 'audio') c.srcIn = Math.max(0, v);
            })}
        />
      </Field>
    {/if}

    <div class="actions">
      <Button
        label="在播放头切分"
        icon="scissors"
        shortcut="S"
        testid="split-at-playhead"
        onclick={() => appState.store.splitClipAt(track.id, clip.id, playT)}
      />
      <Button
        label="删除"
        icon="trash"
        variant="danger"
        shortcut="Del"
        testid="delete-clip"
        onclick={() => {
          appState.store.removeClip(clip.id);
          appState.selectedClipId = null;
        }}
      />
    </div>
  {:else}
    <h3>检查器</h3>
    <p class="placeholder">
      选中一个片段查看属性。
      <br />空白处右键可以在鼠标位置新建片段。
    </p>
  {/if}
</div>

<style>
  .inspector {
    padding: var(--sp-3) var(--sp-4);
  }
  h3 {
    margin: 0 0 var(--sp-3);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .track-name {
    margin-left: var(--sp-2);
    color: var(--text-muted);
    text-transform: none;
    letter-spacing: 0;
  }
  .placeholder,
  .note {
    color: var(--text-muted);
    font-size: var(--fs-sm);
    margin: 0 0 var(--sp-2);
  }
  .dim {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }
  .mono {
    font-family: 'Cascadia Code', Consolas, monospace;
  }
  .txt {
    flex: 1;
    min-width: 0;
    height: var(--control-h);
  }
  .color {
    width: 32px;
    height: var(--control-h);
    padding: 1px;
    cursor: pointer;
  }
  .fx {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--sp-2) var(--sp-3);
    margin-bottom: var(--sp-3);
    background: var(--surface-2);
  }
  .fx-head {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    margin-bottom: var(--sp-2);
  }
  .fx-name {
    flex: 1;
    min-width: 0;
    color: var(--text-primary);
    font-size: var(--fs-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    gap: var(--sp-3);
    margin-top: var(--sp-4);
  }
</style>
