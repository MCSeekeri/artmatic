<script lang="ts">
  import { appState } from './app-state.svelte';
  import KeyableField from './KeyableField.svelte';
  import Button from './controls/Button.svelte';
  import BitmaskField from './controls/BitmaskField.svelte';
  import Checkbox from './controls/Checkbox.svelte';
  import Field from './controls/Field.svelte';
  import IconButton from './controls/IconButton.svelte';
  import NumberInput from './controls/NumberInput.svelte';
  import PatternField from './controls/PatternField.svelte';
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
  import { defaultEffectValues, getEffect } from '../effects/registry';
  import EffectPickerModal from './effect-picker/EffectPickerModal.svelte';
  import {
    defaultTransitionValues,
    getTransition,
    listTransitions,
  } from '../effects/transitions/registry';
  import { transitionCut } from '../core/transitions';
  import { visibleParams, type RangeParam } from '../effects/types';
  import { tr } from '../i18n/index.svelte';

  const blendOptions = BLEND_MODES.map((m) => ({ value: m.id, label: tr(m.labelKey) }));
  const fitOptions = [
    { value: 'contain' as const, label: tr('insp.fitContain') },
    { value: 'cover' as const, label: tr('insp.fitCover') },
    { value: 'stretch' as const, label: tr('insp.fitStretch') },
  ] satisfies { value: SourceClip['fit']; label: string }[];

  /*
   * 转场选项。**名称与作者原样显示，不翻译**：
   * 它们逐字来自 gl-transitions 的第三方作者（`CrossZoom` / `pixelSize`…），
   * 翻译只会让「去上游查这条转场」变难。空串是「无」。
   */
  const transitionOptions = [
    { value: '', label: tr('insp.transitionNone') },
    ...listTransitions().map((e) => ({ value: e.id, label: e.id })),
  ];

  /** 新转场的默认时长。两拍以内、也不至于短到看不见。 */
  const DEFAULT_TRANSITION_SEC = 0.5;

  let pickerOpen = $state(false);

  /**
   * 按**选择顺序**把若干特效追加到链尾。
   *
   * 一次事务（一个 undo 步）：选择器允许多选，若逐个 push 各自成一笔撤销，
   * 用户按一次「撤销」只退掉最后一个，与"我加了一次特效"的直觉不符。
   */
  function addEffectInstances(clip: AnyClip, defIds: readonly string[]): void {
    if (defIds.length === 0) return;
    upd(clip, tr('insp.addEffect'), (c) => {
      if (c.kind !== 'effect') return;
      for (const defId of defIds) {
        c.chain.push({
          instanceId: newId(),
          defId,
          enabled: true,
          values: defaultEffectValues(defId),
        });
      }
    });
  }

  function removeInstance(clip: AnyClip, instanceId: string): void {
    upd(clip, tr('insp.removeEffect'), (c) => {
      if (c.kind === 'effect') c.chain = c.chain.filter((i) => i.instanceId !== instanceId);
    });
  }

  function moveInstance(clip: AnyClip, instanceId: string, dir: -1 | 1): void {
    upd(clip, tr('insp.reorderEffect'), (c) => {
      if (c.kind !== 'effect') return;
      const idx = c.chain.findIndex((i) => i.instanceId === instanceId);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= c.chain.length) return;
      const [it] = c.chain.splice(idx, 1);
      c.chain.splice(to, 0, it!);
    });
  }

  function setEffectParam(clip: AnyClip, inst: EffectInstance, key: string, v: number | string): void {
    upd(clip, tr('insp.editEffectParam'), (c) => {
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
        upd(clip, tr('insp.keyframe'), (c) => upsertCurveKey(c, curveKey, v, appState.playT, anchor, appState.project.beatGrid)),
      onRemoveKey: (i: number) =>
        upd(clip, tr('insp.removeKeyframe'), (c) => {
          const cv = c.curves[curveKey];
          if (cv) cv.keys = cv.keys.filter((_, k) => k !== i);
        }),
      onAnchorChange: (anchor: { beat: number } | null) =>
        upd(clip, tr('insp.toggleAnchor'), (c) => {
          const cv = c.curves[curveKey];
          if (cv) cv.beatAnchor = anchor;
        }),
      onClearCurve: () =>
        upd(clip, tr('insp.clearCurve'), (c) => {
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
    upd(clip, tr('insp.editParam'), (c) => {
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
        upd(clip, tr('insp.keyframe'), (c) => upsertCurveKey(c, p.key, v, appState.playT, anchor, appState.project.beatGrid)),
      onRemoveKey: (i: number) =>
        upd(clip, tr('insp.removeKeyframe'), (c) => {
          const cv = c.curves[p.key];
          if (cv) cv.keys = cv.keys.filter((_, idx) => idx !== i);
        }),
      onAnchorChange: (anchor: { beat: number } | null) =>
        upd(clip, tr('insp.toggleAnchor'), (c) => {
          const cv = c.curves[p.key];
          if (cv) cv.beatAnchor = anchor;
        }),
      onClearCurve: () =>
        upd(clip, tr('insp.clearCurve'), (c) => {
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
      onBase: (v: number) => upd(clip, tr('insp.editParam'), (c) => setBase(c, key, v)),
      onKey: (v: number, anchor: { beat: number } | null) =>
        upd(clip, tr('insp.keyframe'), (c) => upsertCurveKey(c, key, v, appState.playT, anchor, appState.project.beatGrid)),
      onRemoveKey: (i: number) =>
        upd(clip, tr('insp.removeKeyframe'), (c) => {
          const cv = c.curves[key];
          if (cv) cv.keys = cv.keys.filter((_, idx) => idx !== i);
        }),
      onAnchorChange: (anchor: { beat: number } | null) =>
        upd(clip, tr('insp.toggleAnchor'), (c) => {
          const cv = c.curves[key];
          if (cv) cv.beatAnchor = anchor;
        }),
      onClearCurve: () =>
        upd(clip, tr('insp.clearCurve'), (c) => {
          delete c.curves[key];
        }),
    };
  }

  /* ---------------------------------------------------------------- 转场 */

  /** 落不了地的原因 → 文案键。`cut.reason` 是闭联合，索引结果仍是字面量键。 */
  const REASON_KEYS = {
    'no-next': 'insp.transitionNoNext',
    'next-not-source': 'insp.transitionNextNotSource',
    'not-adjacent': 'insp.transitionNotAdjacent',
    'too-short': 'insp.transitionTooShort',
  } as const;

  /**
   * 剪切点几何。
   *
   * 注意这里**只做展示**：相邻判定与时长钳制只有 `core/transitions.ts` 一处实现，
   * 检查器不重算一遍（两边各写一套的话，"UI 上看着没问题、渲染时没生效" 就会
   * 变成一类查不出来的 bug）。
   */
  const transitionInfo = $derived.by(() => {
    void appState.version;
    const id = appState.selectedClipId;
    if (!id) return null;
    const f = appState.store.findClip(id);
    if (!f || f.track.kind !== 'visual') return null;
    const index = (f.track.clips as AnyClip[]).findIndex((c) => c.id === id);
    if (index < 0) return null;
    return transitionCut(f.track, index);
  });

  function setTransition(clip: AnyClip, defId: string): void {
    if (!defId) {
      appState.store.clearTransitionOut(clip.id);
      return;
    }
    // 换一条转场时**保住已有时长**：用户调好的节拍不该因为换了个效果被重置。
    const keep = clip.kind === 'source' ? clip.transitionOut?.duration : undefined;
    appState.store.setTransitionOut(
      clip.id,
      defId,
      keep ?? DEFAULT_TRANSITION_SEC,
      defaultTransitionValues(defId),
    );
  }

  function setTransitionParam(clip: AnyClip, key: string, v: number): void {
    appState.store.updateTransition(clip.id, tr('insp.editTransitionParam'), (t) => {
      t.values[key] = v;
    });
  }
</script>

<div class="inspector">
  {#if found}
    {@const clip = found.clip}
    {@const track = found.track}
    <h3>
      {tr(clip.kind === 'source' ? 'insp.clipKindSource' : clip.kind === 'effect' ? 'insp.clipKindEffect' : 'insp.clipKindAudio')}
      <span class="track-name">{track.name}</span>
    </h3>

    <Field label={tr('insp.name')}>
      <input
        class="txt"
        data-testid="clip-label"
        value={clip.label}
        onchange={(e) => upd(clip, tr('common.rename'), (c) => (c.label = e.currentTarget.value))}
      />
    </Field>

    <Field label={tr('insp.start')}>
      <NumberInput
        value={clip.start}
        min={0}
        step={0.01}
        width={64}
        suffix="s"
        testid="clip-start"
        onchange={(v) => upd(clip, tr('insp.changeStart'), (c) => (c.start = Math.max(0, Math.min(v, c.end - 0.05))))}
      />
      <span class="dim">{tr('insp.end')}</span>
      <NumberInput
        value={clip.end}
        min={0}
        step={0.01}
        width={64}
        suffix="s"
        testid="clip-end"
        onchange={(v) =>
          upd(clip, tr('insp.changeEnd'), (c) => (c.end = Math.min(appState.project.duration, Math.max(v, c.start + 0.05))))}
      />
    </Field>

    <Field label={tr('insp.fade')}>
      <NumberInput
        value={clip.fadeSec}
        min={0}
        step={0.05}
        width={64}
        suffix="s"
        testid="clip-fade"
        onchange={(v) => upd(clip, tr('insp.changeFade'), (c) => (c.fadeSec = Math.max(0, v)))}
      />
    </Field>

    {#if clip.kind === 'source'}
      <Field label={tr('insp.blend')}>
        <Select
          value={clip.blend}
          options={blendOptions}
          testid="clip-blend"
          optionTestidPrefix="clip-blend-opt"
          onchange={(v) =>
            upd(clip, tr('insp.changeBlend'), (c) => {
              if (c.kind === 'source') c.blend = v as BlendMode;
            })}
        />
      </Field>
      <Field label={tr('insp.fit')}>
        <Select
          value={clip.fit}
          options={fitOptions}
          testid="clip-fit"
          optionTestidPrefix="clip-fit-opt"
          onchange={(v) =>
            upd(clip, tr('insp.changeFit'), (c) => {
              if (c.kind === 'source') c.fit = v;
            })}
        />
      </Field>

      <KeyableField label={tr('insp.opacity')} min={0} max={1} step={0.01} {...keyableProps(clip, 'opacity')} />
      <KeyableField label={tr('insp.posX')} min={0} max={1} step={0.005} {...keyableProps(clip, 'transform.x')} />
      <KeyableField label={tr('insp.posY')} min={0} max={1} step={0.005} {...keyableProps(clip, 'transform.y')} />
      <KeyableField label={tr('insp.scaleX')} min={0.05} max={4} step={0.01} {...keyableProps(clip, 'transform.sx')} />
      <KeyableField label={tr('insp.scaleY')} min={0.05} max={4} step={0.01} {...keyableProps(clip, 'transform.sy')} />
      <KeyableField label={tr('insp.rotate')} min={-3.1416} max={3.1416} step={0.01} {...keyableProps(clip, 'transform.rot')} />

      {#if clip.source.type === 'solid'}
        <Field label={tr('insp.color')}>
          <input
            class="color"
            type="color"
            data-testid="clip-color"
            value={clip.source.color}
            oninput={(e) =>
              upd(clip, tr('insp.changeColor'), (c) => {
                if (c.kind === 'source' && c.source.type === 'solid') c.source.color = e.currentTarget.value;
              })}
          />
          <span class="dim mono">{clip.source.color}</span>
        </Field>
      {:else if clip.source.type === 'algo'}
        {@const def = getGenerator(clip.source.generator)}
        <p class="note">{tr('insp.algoGenerator', { name: def ? tr(def.nameKey) : clip.source.generator })}</p>
        {#if def}
          {#each visibleParams(def.params, clip.source.params) as p (p.key)}
            {#if p.type === 'range'}
              {#if keyframable(def.kind, p.key)}
                <KeyableField label={tr(p.labelKey)} min={p.min} max={p.max} step={p.step} {...paramKeyableProps(clip, p)} />
              {:else}
                <!-- 烘焙入参：改了要重烘，所以不能打关键帧（每帧重烘会卡死） -->
                <Field label={tr(p.labelKey)} tipText={tr('insp.bakedParamTip', { label: tr(p.labelKey) })}>
                  <Slider
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={Number(clip.source.params[p.key] ?? p.defaultValue)}
                    ariaLabel={tr(p.labelKey)}
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
              <Field label={tr(p.labelKey)}>
                <Select
                  value={String(clip.source.params[p.key] ?? p.defaultValue)}
                  options={p.options.map((o) => ({ value: o.value, label: tr(o.labelKey) }))}
                  testid={`algo-param-${p.key}`}
                  optionTestidPrefix={`algo-param-${p.key}-opt`}
                  onchange={(v) => setAlgoParam(clip, p.key, v)}
                />
              </Field>
            {:else if p.type === 'checkbox'}
              <Field label={tr(p.labelKey)}>
                <Checkbox
                  checked={Number(clip.source.params[p.key] ?? p.defaultValue) !== 0}
                  testid={`algo-param-${p.key}`}
                  onchange={(v) => setAlgoParam(clip, p.key, v ? 1 : 0)}
                />
              </Field>
            {:else if p.type === 'color'}
              <Field label={tr(p.labelKey)}>
                <input
                  class="color"
                  type="color"
                  value={String(clip.source.params[p.key] ?? p.defaultValue)}
                  oninput={(e) => setAlgoParam(clip, p.key, e.currentTarget.value)}
                />
              </Field>
            {:else if p.type === 'bitmask'}
              <!-- 规则号 / B/S 掩码：位表 + 数值框。同样是烘焙入参（不可打关键帧）。 -->
              <Field label={tr(p.labelKey)} tipText={tr('insp.bakedParamTip', { label: tr(p.labelKey) })}>
                <BitmaskField
                  value={Number(clip.source.params[p.key] ?? p.defaultValue)}
                  bits={p.bits}
                  slider={p.slider}
                  groups={p.groups.map((g) => ({ label: tr(g.labelKey), bits: g.bits, style: g.style }))}
                  presets={p.presets?.map((o) => ({ label: tr(o.labelKey), value: o.value }))}
                  testid={`algo-param-${p.key}`}
                  oninput={(v) => setAlgoParam(clip, p.key, v)}
                  onchange={(v) => setAlgoParam(clip, p.key, v)}
                />
              </Field>
            {:else if p.type === 'pattern'}
              <Field label={tr(p.labelKey)} tipText={tr('insp.bakedParamTip', { label: tr(p.labelKey) })}>
                <PatternField
                  value={String(clip.source.params[p.key] ?? p.defaultValue)}
                  label={tr(p.labelKey)}
                  mode={p.mode}
                  editorSize={p.editorSize}
                  colors={{
                    bg: String(clip.source.params.colorBg ?? '#05070f'),
                    live: String(clip.source.params.colorLive ?? '#7fd4ff'),
                  }}
                  testid={`algo-param-${p.key}`}
                  onchange={(v) => setAlgoParam(clip, p.key, v)}
                />
              </Field>
            {/if}
          {/each}
        {/if}
      {:else if clip.source.type === 'image'}
        <p class="note">{tr('insp.imageAsset', { name: appState.project.assets[clip.source.assetId]?.name ?? clip.source.assetId })}</p>
      {/if}

      <!-- 出画转场：挂在片段上，窗口以 end 为中心吃两侧各一半 -->
      {@const trRef = clip.transitionOut}
      {@const trEntry = trRef ? getTransition(trRef.defId) : null}
      {@const trMax = transitionInfo?.ok ? transitionInfo.max : 0}
      <Field label={tr('insp.transition')} tipText={tr('insp.transitionPick')}>
        <Select
          value={trRef?.defId ?? ''}
          options={transitionOptions}
          filterable
          filterPlaceholder={tr('insp.transitionPick')}
          testid="transition-picker"
          optionTestidPrefix="transition-opt"
          onchange={(v) => setTransition(clip, v)}
        />
      </Field>

      {#if trRef && trEntry}
        <!-- 署名：MIT / BSD 要求保留作者，顺带让人能回上游查这条转场 -->
        <p class="note">{trEntry.author} · {trEntry.license}</p>

        <Field label={tr('insp.transitionDuration')}>
          <NumberInput
            value={trRef.duration}
            min={0.05}
            max={trMax > 0 ? trMax : undefined}
            step={0.05}
            width={64}
            suffix="s"
            testid="transition-duration"
            onchange={(v) => appState.store.setTransitionDuration(clip.id, v)}
          />
        </Field>

        {#each trEntry.params as p (p.key)}
          {#if p.type === 'checkbox'}
            <Field label={p.label}>
              <Checkbox
                checked={Number(trRef.values[p.key] ?? p.defaultValue) !== 0}
                testid={`transition-param-${p.key}`}
                onchange={(v) => setTransitionParam(clip, p.key, v ? 1 : 0)}
              />
            </Field>
          {:else}
            <Field label={p.label}>
              <Slider
                min={p.min ?? 0}
                max={p.max ?? 1}
                step={p.step ?? 0.01}
                value={Number(trRef.values[p.key] ?? p.defaultValue)}
                ariaLabel={p.label}
                testid={`transition-param-${p.key}`}
                oninput={(v) => setTransitionParam(clip, p.key, v)}
              />
              <NumberInput
                value={Number(trRef.values[p.key] ?? p.defaultValue)}
                min={p.min ?? 0}
                max={p.max ?? 1}
                step={p.step ?? 0.01}
                width={64}
                testid={`transition-param-num-${p.key}`}
                onchange={(v) => setTransitionParam(clip, p.key, v)}
              />
            </Field>
          {/if}
        {/each}

        {#if transitionInfo && !transitionInfo.ok}
          <p class="note insp-warn">{tr('insp.transitionInactive')}：{tr(REASON_KEYS[transitionInfo.reason])}</p>
        {:else if trMax > 0 && trRef.duration > trMax + 1e-9}
          <p class="note insp-warn">
            {tr('insp.transitionClamped', { max: trMax.toFixed(2) })}
          </p>
        {/if}
        {#if clip.fadeSec > 0}
          <p class="note insp-warn">{tr('insp.transitionFadeTip')}</p>
        {/if}
      {/if}
    {:else if clip.kind === 'effect'}
      <!-- 添加特效：七十多个特效用一个下拉选不现实（不能搜、不能筛、看不见效果），
           改成唤起选择器。多选后一次追加到链尾，按选择顺序。 -->
      <Field label={tr('insp.addEffect')}>
        <Button
          label={tr('insp.addEffect')}
          icon="plus"
          variant="accent"
          testid="add-effect-instance"
          onclick={() => (pickerOpen = true)}
        />
      </Field>

      {#if pickerOpen}
        <EffectPickerModal
          onclose={() => (pickerOpen = false)}
          onapply={(ids) => {
            addEffectInstances(clip, ids);
            pickerOpen = false;
          }}
        />
      {/if}

      {#if clip.chain.length === 0}
        <p class="note">{tr('insp.emptyChain')}</p>
      {/if}

      {#each clip.chain as inst, idx (inst.instanceId)}
        {@const entry = getEffect(inst.defId)}
        <div class="fx" data-testid="effect-instance">
          <div class="fx-head">
            <Checkbox
              checked={inst.enabled}
              tipText={tr('insp.effectEnableTip')}
              testid="effect-enabled"
              onchange={(v) =>
                upd(clip, tr('insp.toggleEffect'), (c) => {
                  if (c.kind === 'effect') {
                    const it = c.chain.find((x) => x.instanceId === inst.instanceId);
                    if (it) it.enabled = v;
                  }
                })}
            />
            <span class="fx-name">{entry ? tr(entry.nameKey) : inst.defId}</span>
            <IconButton
              icon="arrow-up"
              label={tr('common.up')}
              size="sm"
              disabled={idx === 0}
              testid="effect-move-up"
              onclick={() => moveInstance(clip, inst.instanceId, -1)}
            />
            <IconButton
              icon="arrow-down"
              label={tr('common.down')}
              size="sm"
              disabled={idx === clip.chain.length - 1}
              testid="effect-move-down"
              onclick={() => moveInstance(clip, inst.instanceId, 1)}
            />
            <IconButton
              icon="x"
              label={tr('insp.removeEffect')}
              size="sm"
              variant="danger"
              testid="effect-remove"
              onclick={() => removeInstance(clip, inst.instanceId)}
            />
          </div>
          {#if entry}
            {#each visibleParams(entry.params, inst.values) as p (p.key)}
              {#if p.type === 'range'}
                <KeyableField label={tr(p.labelKey)} min={p.min} max={p.max} step={p.step} {...effectParamProps(clip, inst, p)} />
              {:else if p.type === 'select'}
                <Field label={tr(p.labelKey)}>
                  <Select
                    value={String(inst.values[p.key] ?? p.defaultValue)}
                    options={p.options.map((o) => ({ value: o.value, label: tr(o.labelKey) }))}
                    testid={`effect-param-${p.key}`}
                    optionTestidPrefix={`effect-param-${p.key}-opt`}
                    onchange={(v) => setEffectParam(clip, inst, p.key, v)}
                  />
                </Field>
              {:else if p.type === 'checkbox'}
                <Field label={tr(p.labelKey)}>
                  <Checkbox
                    checked={Number(inst.values[p.key] ?? p.defaultValue) !== 0}
                    testid={`effect-param-${p.key}`}
                    onchange={(v) => setEffectParam(clip, inst, p.key, v ? 1 : 0)}
                  />
                </Field>
              {:else if p.type === 'color'}
                <Field label={tr(p.labelKey)}>
                  <input
                    class="color"
                    type="color"
                    value={String(inst.values[p.key] ?? p.defaultValue)}
                    oninput={(e) => setEffectParam(clip, inst, p.key, e.currentTarget.value)}
                  />
                </Field>
              {:else if p.type === 'bitmask'}
                <Field label={tr(p.labelKey)}>
                  <BitmaskField
                    value={Number(inst.values[p.key] ?? p.defaultValue)}
                    bits={p.bits}
                    slider={p.slider}
                    groups={p.groups.map((g) => ({ label: tr(g.labelKey), bits: g.bits, style: g.style }))}
                    presets={p.presets?.map((o) => ({ label: tr(o.labelKey), value: o.value }))}
                    testid={`effect-param-${p.key}`}
                    oninput={(v) => setEffectParam(clip, inst, p.key, v)}
                    onchange={(v) => setEffectParam(clip, inst, p.key, v)}
                  />
                </Field>
              {:else if p.type === 'pattern'}
                <Field label={tr(p.labelKey)}>
                  <PatternField
                    value={String(inst.values[p.key] ?? p.defaultValue)}
                    label={tr(p.labelKey)}
                    mode={p.mode}
                    editorSize={p.editorSize}
                    colors={{
                      bg: String(inst.values.colorBg ?? '#05070f'),
                      live: String(inst.values.colorLive ?? '#7fd4ff'),
                    }}
                    testid={`effect-param-${p.key}`}
                    onchange={(v) => setEffectParam(clip, inst, p.key, v)}
                  />
                </Field>
              {/if}
            {/each}
          {/if}
        </div>
      {/each}
    {:else}
      <Field label={tr('insp.srcIn')}>
        <NumberInput
          value={clip.srcIn}
          min={0}
          step={0.01}
          width={70}
          suffix="s"
          testid="clip-srcin"
          onchange={(v) =>
            upd(clip, tr('insp.changeSrcIn'), (c) => {
              if (c.kind === 'audio') c.srcIn = Math.max(0, v);
            })}
        />
      </Field>
    {/if}

    <div class="actions">
      {#if clip.kind === 'source' && clip.source.type === 'text'}
        <!-- 双击片段也能打开；这里是可发现性更好的显式入口。 -->
        <Button
          label={tr('insp.editTypography')}
          icon="type"
          testid="edit-typography"
          onclick={() => appState.openTypographyTab(clip.id)}
        />
      {/if}
      <Button
        label={tr('insp.splitAtPlayhead')}
        icon="scissors"
        shortcut="S"
        testid="split-at-playhead"
        onclick={() => appState.store.splitClipAt(track.id, clip.id, playT)}
      />
      <Button
        label={tr('common.delete')}
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
    <h3>{tr('insp.title')}</h3>
    <p class="placeholder">
      {tr('insp.placeholderSelect')}
      <br />{tr('insp.placeholderRightClick')}
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
  /* 转场落不了地 / 被钳制 / 与 fadeSec 打架时的提示。用 warning 而不是 danger：
     这些都不阻断操作，只是「照这样下去不会按你想的生效」。 */
  .note.insp-warn {
    color: var(--warning);
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
