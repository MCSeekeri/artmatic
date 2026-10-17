<script lang="ts">
  /**
   * PropertiesPanel — 「元素属性」窗格（与图层 / 动画共用右侧同一个位置）。
   *
   * 为什么要有它：填充 / 描边 / 几何这些参数原先散在 Ribbon 里，而 Ribbon 是
   * **按填充方式条件展开**控件的 —— 每切换一次填充方式，整条 Ribbon 的控件
   * 集合就变一次，右侧的按钮整体位移（用户点不到刚瞄准的那个）。这里把
   * 「当前选中元素长什么样」的完整参数收进一个**固定版式**的面板：
   * 控件集合不再随值变化，Ribbon 也能收成稳定的快速入口。
   *
   * 取值一律从 `editorState.selected` 派生（元素是原地改的对象，派生必须
   * 返回新对象、且 version 是依赖，否则模板会静默断更 —— 见 AGENTS §7）。
   * 写入一律走 actions（撤销栈完整的唯一前提）。
   *
   * 多选语义：
   *  - 位置：按首元素为锚整体平移（见 actions.setFrame）；
   *  - 宽 / 高 / 旋转：多选时禁用（「那条边」没有唯一定义）；
   *  - 填充 / 描边：显示首个元素的取值，写入作用于全部同类元素（与 Ribbon 同款）。
   */
  import Field from '../controls/Field.svelte';
  import NumberInput from '../controls/NumberInput.svelte';
  import Select from '../controls/Select.svelte';
  import Slider from '../controls/Slider.svelte';
  import Checkbox from '../controls/Checkbox.svelte';
  import IconButton from '../controls/IconButton.svelte';
  import Button from '../controls/Button.svelte';
  import SvgGenPickerModal from './SvgGenPickerModal.svelte';
  import PaintEditor from './PaintEditor.svelte';
import ColorField from '../controls/ColorField.svelte';
  import { appState } from '../app-state.svelte';
  import { editorState } from './editor-state.svelte';
  import { createTypographyActions } from './actions';
  import { MIX_BLENDS, type MixBlend, type Paint, type Stroke } from '../../typography/document';
  import { resolveThemeColor, themeById } from '../../typography/theme';
  import { generatorById, mergeParams } from '../../typography/svg-gen';
  import { visibleParams } from '../../effects/types';
  import { tr } from '../../i18n/index.svelte';
  import { resolveLabel } from '../../i18n/label';

  /** actions 只是回调的集合，无内部状态；建一次就够（与 TypographyEditor 同款）。 */
  const actions = createTypographyActions();

  /**
   * 当前配色方案（**对象**，含工程自定义方案）。
   *
   * 文档里的 `@slot` 引用可能指向自定义方案（`Project.customThemes`）——
   * 只按 id 查内置表的话那些颜色会静默回落默认方案。传给 PaintEditor 与
   * 这里的两处描边色共用同一份。
   */
  const theme = $derived(themeById(editorState.doc?.theme, appState.project.customThemes));

  /**
   * 颜色 → 可显示的值（配色方案引用解析成真实 hex）。
   *
   * 取色卡不认 `@accent1`，不解析就会把色块画成黑色 —— 看起来像「颜色被
   * 改坏了」，而实际只是没解析。见 PaintEditor 的同名说明。
   */
  function dc(color: string | undefined, fallback: string): string {
    return color ? resolveThemeColor(color, theme) : fallback;
  }

  /** 线型选项。与 Ribbon 的同一套值，标签取自本面板的文案。 */
  const LINE_OPTIONS = [
    { value: 'solid' as const, label: tr('typo.propLineSolid') },
    { value: 'dashed' as const, label: tr('typo.propLineDashed') },
    { value: 'dotted' as const, label: tr('typo.propLineDotted') },
  ];

  const SHAPE_KIND_OPTIONS: { value: Paint['kind']; label: string }[] = [
    { value: 'none', label: tr('typo.propNone') },
    { value: 'solid', label: tr('typo.propFillSolid') },
    { value: 'linear', label: tr('typo.propFillLinear') },
    { value: 'radial', label: tr('typo.propFillRadial') },
    { value: 'texture', label: tr('typo.propFillTexture') },
  ];

  /** 字形填充没有「纯色」：纯色字形走 `style.color`，「无」= 跟随文字色。 */
  const GLYPH_KIND_OPTIONS: { value: Paint['kind']; label: string }[] = SHAPE_KIND_OPTIONS.filter(
    (o) => o.value !== 'solid',
  ).map((o) => (o.value === 'none' ? { ...o, label: tr('typo.propFillFollow') } : o));

  /** 深拷贝一份 Paint：派生必须产出新对象，否则 Svelte 认为值没变（见文件头）。 */
  function clonePaint(p: Paint | undefined): Paint | undefined {
    if (!p) return undefined;
    if (p.kind === 'linear' || p.kind === 'radial') {
      return { ...p, stops: p.stops.map((s) => ({ ...s })) };
    }
    return { ...p };
  }

  const model = $derived.by(() => {
    void appState.version;
    const sel = editorState.selected;
    if (!sel.length) return null;
    const el = sel[0]!;
    return {
      count: sel.length,
      kind: el.kind,
      frame: { ...el.frame },
      opacity: el.opacity,
      blend: el.blend,
      /** 图形填充（shape.fill）。 */
      fill: el.kind === 'shape' ? clonePaint(el.fill) : undefined,
      stroke: el.kind === 'shape' && el.stroke ? ({ ...el.stroke } as Stroke) : null,
      /** 字形填充（text.fill）。 */
      glyphFill: el.kind === 'text' ? clonePaint(el.fill) : undefined,
      /** 文本框背景 / 边框（text.boxFill / boxStroke）。 */
      boxFill: el.kind === 'text' ? clonePaint(el.boxFill) : undefined,
      boxStroke: el.kind === 'text' && el.boxStroke ? ({ ...el.boxStroke } as Stroke) : null,
      /** 图形路径（「已烘焙」的命令数提示用）。 */
      path: el.kind === 'shape' ? (el.path ?? '') : '',
      /** 生成器状态。浅拷贝：面板只读，写入一律走 actions。 */
      gen:
        el.kind === 'shape' && el.gen
          ? { id: el.gen.id, seed: el.gen.seed, params: { ...el.gen.params } }
          : null,
      genSpec: el.kind === 'shape' ? generatorById(el.gen?.id) : null,
    };
  });

  /** 生成器的参数表（已合并默认值）。未知 id ⇒ null，整节降级。 */
  const genParams = $derived(
    model?.gen && model.genSpec ? mergeParams(model.genSpec, model.gen.params) : null,
  );
  /** 按 `visibleWhen` 过滤后的可见参数（模式切换时控件集合会变，见 ParamDef）。 */
  const genVisible = $derived(
    model?.genSpec && genParams ? visibleParams(model.genSpec.params, genParams) : [],
  );
  /** 路径命令数：直接数 `d` 里的命令字母，不重新 build 一遍。 */
  const genCommands = $derived((model?.path?.match(/[MLCZ]/gi) ?? []).length);
  /** 「更换生成器」弹窗（与插入时同一个选择器，只是换标题 + 高亮当前项）。 */
  let genPickerOpen = $state(false);

  const multi = $derived((model?.count ?? 0) > 1);
  /** 旋转：模型存弧度，面板显示度（一位小数）。 */
  const rotDeg = $derived(Math.round((((model?.frame.rot ?? 0) * 180) / Math.PI) * 10) / 10);
</script>

{#snippet colorRow(label: string, value: string, testid: string, oninput: (v: string) => void)}
  <Field {label} labelWidth={74}>
    <span class="prop-swatch">
      <ColorField
        {label}
        {value}
        {theme}
        testid={testid}
        onchange={oninput}
      />
    </span>
  </Field>
{/snippet}

{#if genPickerOpen && model?.gen}
  <SvgGenPickerModal
    title={tr('gen.changeTypeTitle')}
    current={model.gen.id}
    onclose={() => (genPickerOpen = false)}
    onpick={(id) => {
      genPickerOpen = false;
      actions.setGeneratorType(id);
    }}
  />
{/if}

<aside class="props" data-testid="typo-props">
  {#if !model}
    <p class="props-empty">{tr('typo.propsEmpty')}</p>
  {:else}
    <div class="props-scroll">
      <h4 class="prop-sec">{tr('typo.propTransform')}</h4>
      {#if multi}
        <p class="props-note">{tr('typo.propsMulti', { n: model.count })}</p>
      {/if}
      <Field label={tr('typo.propPos')} labelWidth={50} testid="prop-pos">
        <NumberInput
          value={model.frame.x}
          step={1}
          width={54}
          ariaLabel="X"
          testid="prop-x"
          onchange={(v) => actions.setFrame({ x: v })}
        />
        <NumberInput
          value={model.frame.y}
          step={1}
          width={54}
          ariaLabel="Y"
          testid="prop-y"
          onchange={(v) => actions.setFrame({ y: v })}
        />
      </Field>
      <Field label={tr('typo.propSize')} labelWidth={50}>
        <NumberInput
          value={model.frame.w}
          min={1}
          step={1}
          width={54}
          disabled={multi}
          ariaLabel={tr('typo.propSize')}
          testid="prop-w"
          onchange={(v) => actions.setFrame({ w: v })}
        />
        <NumberInput
          value={model.frame.h}
          min={1}
          step={1}
          width={54}
          disabled={multi}
          ariaLabel={tr('typo.propSize')}
          testid="prop-h"
          onchange={(v) => actions.setFrame({ h: v })}
        />
      </Field>
      <Field label={tr('typo.propRotate')} labelWidth={50}>
        <NumberInput
          value={rotDeg}
          step={1}
          precision={1}
          width={62}
          suffix="°"
          disabled={multi}
          ariaLabel={tr('typo.propRotate')}
          testid="prop-rot"
          onchange={(v) => actions.setFrame({ rot: (v * Math.PI) / 180 })}
        />
      </Field>
      <Field label={tr('typo.propOpacity')} labelWidth={50}>
        <NumberInput
          value={Math.round(model.opacity * 100)}
          min={0}
          max={100}
          step={5}
          width={62}
          suffix="%"
          ariaLabel={tr('typo.propOpacity')}
          testid="prop-opacity"
          onchange={(v) => actions.setOpacity(Math.max(0, Math.min(100, v)) / 100)}
        />
      </Field>
      <Field label={tr('typo.propBlend')} labelWidth={50}>
        <Select
          value={model.blend}
          options={MIX_BLENDS.map((b) => ({ value: b.id, label: tr(b.labelKey) }))}
          testid="prop-blend"
          optionTestidPrefix="prop-blend-option"
          onchange={(v) => actions.setBlend(v as MixBlend)}
        />
      </Field>

      {#if model.kind === 'shape'}
        <!--
          生成器区放在**填充之前**：它是「这个图形怎么长出来的」，比「填什么色」
          更接近元素的身份。类型 / 种子 / 参数三块版式固定，切换类型时不跳位。
        -->
        {#if model.gen}
          <h4 class="prop-sec">{tr('gen.panelTitle')}</h4>
          {#if !model.genSpec || !genParams}
            <!-- 未知 id（旧档 / 别人的数据）：路径照常渲染，只把参数区降级。 -->
            <p class="props-note">{tr('gen.unknown')}</p>
          {:else}
            <!--
              类型不是下拉而是**弹窗**：二十个生成器靠名字挑不出来，必须看见
              缩略图（与「更换特效 / 转场 / 算法艺术」同一种交互）。
            -->
            <Field label={tr('gen.type')} labelWidth={56}>
              <Button
                label={tr(model.genSpec.labelKey)}
                icon="layout-grid"
                variant="outline"
                testid="prop-gen-type"
                tipText={tr('gen.changeType')}
                onclick={() => (genPickerOpen = true)}
              />
            </Field>
            <Field label={tr('gen.seed')} labelWidth={56}>
              <NumberInput
                value={model.gen.seed}
                min={0}
                step={1}
                precision={0}
                width={64}
                ariaLabel={tr('gen.seed')}
                testid="prop-gen-seed"
                onchange={(v) => actions.setGeneratorSeed(v)}
              />
              <!--
                图标按钮而不是带字按钮：这一栏只有 150px 左右，「换一个」会被
                截成「换一…」。语义靠 tooltip（`gen.reseedTip`）给全。
              -->
              <IconButton
                icon="rotate-cw"
                label={tr('gen.reseed')}
                tipText={tr('gen.reseedTip')}
                size="sm"
                testid="prop-gen-reseed"
                onclick={() => actions.reseedGenerator()}
              />
            </Field>
            {#each genVisible as p (p.key)}
              {#if p.type === 'range'}
                {@const v = Number(genParams[p.key] ?? p.defaultValue)}
                <Field label={resolveLabel(p.labelKey, tr)} labelWidth={56}>
                  <Slider
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={v}
                    ariaLabel={resolveLabel(p.labelKey, tr)}
                    testid={`prop-gen-${p.key}-slider`}
                    oninput={(nv) => actions.setGeneratorParamLive(p.key, nv)}
                    onchange={() => actions.endGeneratorParamLive()}
                  />
                  <NumberInput
                    value={v}
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    width={58}
                    ariaLabel={resolveLabel(p.labelKey, tr)}
                    testid={`prop-gen-${p.key}-number`}
                    oninput={(nv) => actions.setGeneratorParamLive(p.key, nv)}
                    onliveend={() => actions.endGeneratorParamLive()}
                    onchange={(nv) => {
                      actions.setGeneratorParamLive(p.key, nv);
                      actions.endGeneratorParamLive();
                    }}
                  />
                </Field>
              {:else if p.type === 'select'}
                <Field label={resolveLabel(p.labelKey, tr)} labelWidth={56}>
                  <Select
                    value={String(genParams[p.key] ?? p.defaultValue)}
                    options={p.options.map((o) => ({
                      value: o.value,
                      label: resolveLabel(o.labelKey, tr),
                    }))}
                    testid={`prop-gen-${p.key}`}
                    optionTestidPrefix={`prop-gen-${p.key}-opt`}
                    onchange={(nv) => actions.setGeneratorParam(p.key, nv)}
                  />
                </Field>
              {:else if p.type === 'checkbox'}
                <Field label={resolveLabel(p.labelKey, tr)} labelWidth={56}>
                  <Checkbox
                    checked={Number(genParams[p.key] ?? p.defaultValue) >= 0.5}
                    label={resolveLabel(p.labelKey, tr)}
                    testid={`prop-gen-${p.key}`}
                    onchange={(on) => actions.setGeneratorParam(p.key, on ? 1 : 0)}
                  />
                </Field>
              {/if}
            {/each}
            <p class="props-note">{tr('gen.commands', { n: genCommands })}</p>
          {/if}
        {/if}
        <h4 class="prop-sec">{tr('typo.propFill')}</h4>
        <PaintEditor
          paint={model.fill}
          kindOptions={SHAPE_KIND_OPTIONS}
          prefix="prop-fill"
          {theme}
          onkind={(k) => actions.setShapePaint({ kind: k })}
          onpatch={(p) => actions.setShapePaint(p)}
        />

        <h4 class="prop-sec">{tr('typo.propStroke')}</h4>
        {@render colorRow(tr('typo.propStrokeColor'), dc(model.stroke?.color, '#ffffff'), 'prop-stroke-color', (v) =>
          actions.setShapeStroke(v))}
        <Field label={tr('typo.propStrokeWidth')} labelWidth={74}>
          <NumberInput
            value={model.stroke?.width ?? 0}
            min={0}
            step={1}
            width={62}
            suffix="px"
            ariaLabel={tr('typo.propStrokeWidth')}
            testid="prop-stroke-width"
            onchange={(v) => actions.setShapeStrokeWidth(v)}
          />
        </Field>
        <Field label={tr('typo.propStrokeStyle')} labelWidth={74}>
          <Select
            value={model.stroke?.style ?? 'solid'}
            options={LINE_OPTIONS}
            testid="prop-stroke-style"
            optionTestidPrefix="prop-stroke-style-option"
            onchange={(v) => actions.setShapeStrokeStyle(v)}
          />
        </Field>
      {:else if model.kind === 'text'}
        <h4 class="prop-sec">{tr('typo.propTextBg')}</h4>
        <PaintEditor
          paint={model.boxFill}
          kindOptions={SHAPE_KIND_OPTIONS}
          prefix="prop-box"
          {theme}
          onkind={(k) => actions.setTextBoxFill({ kind: k })}
          onpatch={(p) => actions.setTextBoxFill(p)}
        />

        <h4 class="prop-sec">{tr('typo.propTextBorder')}</h4>
        {@render colorRow(tr('typo.propStrokeColor'), dc(model.boxStroke?.color, '#ffffff'), 'prop-box-stroke-color', (v) =>
          actions.setTextBoxStroke({ color: v }))}
        <Field label={tr('typo.propStrokeWidth')} labelWidth={74}>
          <NumberInput
            value={model.boxStroke?.width ?? 0}
            min={0}
            step={1}
            width={62}
            suffix="px"
            ariaLabel={tr('typo.propStrokeWidth')}
            testid="prop-box-stroke-width"
            onchange={(v) => actions.setTextBoxStroke({ width: v })}
          />
        </Field>
        <Field label={tr('typo.propStrokeStyle')} labelWidth={74}>
          <Select
            value={model.boxStroke?.style ?? 'solid'}
            options={LINE_OPTIONS}
            testid="prop-box-stroke-style"
            optionTestidPrefix="prop-box-stroke-style-option"
            onchange={(v) => actions.setTextBoxStroke({ style: v })}
          />
        </Field>

        <h4 class="prop-sec">{tr('typo.propGlyphFill')}</h4>
        <PaintEditor
          paint={model.glyphFill}
          kindOptions={GLYPH_KIND_OPTIONS}
          prefix="prop-glyph"
          {theme}
          onkind={(k) => (k === 'none' ? actions.clearTextFill() : actions.setTextFill({ kind: k }))}
          onpatch={(p) => actions.setTextFill(p)}
        />
      {/if}
    </div>
  {/if}
</aside>

<style>
  .props {
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
    background: var(--surface-1);
  }
  .props-scroll {
    overflow: auto;
    min-height: 0;
    padding: var(--sp-2) var(--sp-3) var(--sp-5);
  }
  /* 分节标题：比正文重一点、有上间距把它和上一段分开。 */
  .prop-sec {
    margin: var(--sp-3) 0 var(--sp-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: none;
  }
  .prop-sec:first-child {
    margin-top: 0;
  }
  .props-note {
    margin: 0 0 var(--sp-2);
    font-size: var(--fs-xs);
    color: var(--text-muted);
    line-height: 1.5;
  }
  .props-empty {
    padding: var(--sp-4);
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-muted);
    line-height: 1.5;
  }
  .prop-swatch {
    position: relative;
    display: block;
    width: 26px;
    height: 18px;
    background: var(--surface-0);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
</style>
