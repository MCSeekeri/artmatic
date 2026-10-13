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
  import PaintEditor from './PaintEditor.svelte';
  import { appState } from '../app-state.svelte';
  import { editorState } from './editor-state.svelte';
  import { createTypographyActions } from './actions';
  import { MIX_BLENDS, type MixBlend, type Paint, type Stroke } from '../../typography/document';
  import { resolveThemeColor } from '../../typography/theme';
  import { tr } from '../../i18n/index.svelte';

  /** actions 只是回调的集合，无内部状态；建一次就够（与 TypographyEditor 同款）。 */
  const actions = createTypographyActions();

  /** 当前配色方案 id。传下去给 PaintEditor，也用来解析这里的两处描边色。 */
  const themeId = $derived(editorState.doc?.theme);

  /**
   * 颜色 → 可显示的值（配色方案引用解析成真实 hex）。
   *
   * 原生 `<input type="color">` 不认 `@accent1`，不解析就会把色块画成黑色 ——
   * 看起来像「颜色被改坏了」，而实际只是没解析。见 PaintEditor 的同名说明。
   */
  function dc(color: string | undefined, fallback: string): string {
    return color ? resolveThemeColor(color, themeId) : fallback;
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
    };
  });

  const multi = $derived((model?.count ?? 0) > 1);
  /** 旋转：模型存弧度，面板显示度（一位小数）。 */
  const rotDeg = $derived(Math.round((((model?.frame.rot ?? 0) * 180) / Math.PI) * 10) / 10);
</script>

{#snippet colorRow(label: string, value: string, testid: string, oninput: (v: string) => void)}
  <Field {label} labelWidth={74}>
    <span class="prop-swatch">
      <input
        type="color"
        {value}
        aria-label={label}
        data-testid={testid}
        oninput={(e) => oninput(e.currentTarget.value)}
      />
    </span>
  </Field>
{/snippet}

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
        <h4 class="prop-sec">{tr('typo.propFill')}</h4>
        <PaintEditor
          paint={model.fill}
          kindOptions={SHAPE_KIND_OPTIONS}
          prefix="prop-fill"
          {themeId}
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
          {themeId}
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
          {themeId}
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
  .prop-swatch input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
  }
</style>
