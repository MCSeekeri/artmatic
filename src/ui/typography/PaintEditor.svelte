<script lang="ts">
  /**
   * PaintEditor — 一份 Paint 的编辑器（填充方式 + 参数 + 色标列表）。
   *
   * 面板里的三处填充共用一个它：图形填充、文本框背景、文本字形填充。三者只有
   * 「类型集合」与「类型切换怎么写」不同，其余（颜色 / 角度 / 色标增删与位置 /
   * 纹理参数 / 整体不透明度）完全一样 —— 各写一份的话，加一个纹理参数要改三处。
   *
   * 色标列表按**文档数组顺序**显示（不是按 offset 排序）：渲染时排序、
   * 编辑时保持用户顺序，于是拖动某个色标的位置不会让整列行跳位
   * （行跳位时「正在拖的那个输入框」会在指针底下换成另一个色标）。
   *
   * 每个控件都是「一次改动 = 一笔撤销」：字段级 patch 交给 applyPaintPatch，
   * 色标整份替换（增删 / 改色 / 改位置都是同一件事，见 document.ts 的说明）。
   */
  import Icon from '../Icon.svelte';
  import Field from '../controls/Field.svelte';
  import NumberInput from '../controls/NumberInput.svelte';
  import Select from '../controls/Select.svelte';
  import {
    TEXTURE_PATTERNS,
    type Paint,
    type PaintStop,
    type ShapePaintPatch,
    type TexturePattern,
  } from '../../typography/document';
  import { resolveThemeColor } from '../../typography/theme';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    /** 当前填充。undefined = 这一层没有填充（显示为「无」）。 */
    paint: Paint | undefined;
    /** 类型下拉的选项（字形填充没有「纯色」这一项）。 */
    kindOptions: { value: Paint['kind']; label: string }[];
    /** 类型切换。字形填充的「无」要清字段而不是写 `kind:'none'`，所以单独一个回调。 */
    onkind: (kind: Paint['kind']) => void;
    /** 其余字段的局部更新。 */
    onpatch: (patch: ShapePaintPatch) => void;
    /** testid 前缀：`${prefix}-kind` / `${prefix}-color` / `${prefix}-stop-pos-0` … */
    prefix: string;
    /** 当前文档的配色方案 id：颜色可能是 `@accent1` 这样的引用，显示前要解析。 */
    themeId?: string;
  }
  const { paint, kindOptions, onkind, onpatch, prefix, themeId }: Props = $props();

  /**
   * 颜色 → 可显示的值（把配色方案引用解析成真实 hex）。
   *
   * 原生 `<input type="color">` 不认 `@accent1`，不解析的话色块会显示成黑色 ——
   * 而「看到黑色」正是用户会去改它的理由，这个误导很难被察觉。
   * 反过来：面板里改色写回的是**裸色**（引用只在取色卡里产生）—— 这是有意的，
   * 这里是精细调整区，改完就该钉死。
   */
  function dc(color: string | undefined, fallback: string): string {
    return color ? resolveThemeColor(color, themeId) : fallback;
  }

  const kind = $derived(paint?.kind ?? 'none');
  /** 色标（仅渐变有）。**保持文档顺序**，见文件头。 */
  const stops = $derived<PaintStop[]>(
    paint && (paint.kind === 'linear' || paint.kind === 'radial') ? paint.stops : [],
  );
  /** 整体不透明度，0..100 的百分数（模型里存 0..1）。 */
  const opacityPct = $derived(
    Math.round((paint && paint.kind !== 'none' ? (paint.opacity ?? 1) : 1) * 100),
  );

  function writeStops(list: PaintStop[]): void {
    onpatch({ stops: list });
  }

  /**
   * 加一个色标：插在**最大间隔的中点**，颜色取左邻色标。
   *
   * 用左邻色而不是「插值出中间色」：颜色插值要解析任意 CSS 颜色并做色彩空间
   * 混色（只靠字符串做不到），而「复制左邻」在视觉上是零变化的（同色相邻色标
   * 不改变渐变），用户随后改颜色即可 —— 宁可少一点智能，也不要一个会猜错
   * 颜色的按钮。
   */
  function addStop(): void {
    const list = stops.length
      ? [...stops]
      : [
          { offset: 0, color: '#ffffff' },
          { offset: 1, color: '#000000' },
        ];
    const sorted = [...list].sort((a, b) => a.offset - b.offset);
    let at = 0.5;
    let color = sorted[0]?.color ?? '#ffffff';
    let best = -1;
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i]!.offset - sorted[i - 1]!.offset;
      if (gap > best) {
        best = gap;
        at = (sorted[i]!.offset + sorted[i - 1]!.offset) / 2;
        color = sorted[i - 1]!.color;
      }
    }
    writeStops([...list, { offset: at, color }]);
  }
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

<div class="prop-paint">
  <Field label={tr('typo.propFillKind')} labelWidth={74} testid={`${prefix}-kind-row`}>
    <Select
      value={kind}
      options={kindOptions}
      testid={`${prefix}-kind`}
      optionTestidPrefix={`${prefix}-kind-option`}
      onchange={(v) => onkind(v)}
    />
  </Field>

  {#if kind === 'solid'}
    {@render colorRow(tr('typo.propFillSolid'), dc(paint?.kind === 'solid' ? paint.color : undefined, '#6f64ef'), `${prefix}-color`, (v) =>
      onpatch({ color: v }))}
  {:else if kind === 'linear' || kind === 'radial'}
    {#if kind === 'linear'}
      <Field label={tr('typo.propAngle')} labelWidth={74}>
        <NumberInput
          value={paint?.kind === 'linear' ? paint.angle : 0}
          step={15}
          width={62}
          suffix="°"
          testid={`${prefix}-angle`}
          ariaLabel={tr('typo.propAngle')}
          onchange={(v) => onpatch({ angle: v })}
        />
      </Field>
    {/if}

    <div class="prop-stops" data-testid={`${prefix}-stops`}>
      {#each stops as s, i (i)}
        <div class="prop-stop" data-testid={`${prefix}-stop-${i}`}>
          <span class="prop-swatch prop-swatch-sm">
            <input
              type="color"
              value={dc(s.color, '#ffffff')}
              aria-label={tr('typo.propStops')}
              data-testid={`${prefix}-stop-color-${i}`}
              oninput={(e) =>
                writeStops(stops.map((x, j) => (j === i ? { ...x, color: e.currentTarget.value } : x)))}
            />
          </span>
          <NumberInput
            value={Math.round(s.offset * 100)}
            min={0}
            max={100}
            step={1}
            width={54}
            suffix="%"
            testid={`${prefix}-stop-pos-${i}`}
            ariaLabel={tr('typo.propStopPos')}
            onchange={(v) => writeStops(stops.map((x, j) => (j === i ? { ...x, offset: v / 100 } : x)))}
          />
          <button
            type="button"
            class="prop-ic"
            disabled={stops.length <= 2}
            aria-label={tr('typo.propStopRemove')}
            data-testid={`${prefix}-stop-remove-${i}`}
            onclick={() => writeStops(stops.filter((_, j) => j !== i))}
          >
            <Icon name="minus" size={11} />
          </button>
        </div>
      {/each}
      <button type="button" class="prop-add" data-testid={`${prefix}-stop-add`} onclick={addStop}>
        <Icon name="plus" size={11} />
        {tr('typo.propStopAdd')}
      </button>
    </div>
  {:else if kind === 'texture'}
    <Field label={tr('typo.propPattern')} labelWidth={74}>
      <Select
        value={paint?.kind === 'texture' ? paint.pattern : 'dots'}
        options={TEXTURE_PATTERNS.map((t) => ({ value: t.id, label: tr(t.labelKey) }))}
        testid={`${prefix}-pattern`}
        optionTestidPrefix={`${prefix}-pattern-option`}
        onchange={(v) => onpatch({ pattern: v as TexturePattern })}
      />
    </Field>
    {@render colorRow(tr('typo.propTextureInk'), dc(paint?.kind === 'texture' ? paint.color : undefined, '#6f64ef'), `${prefix}-color`, (v) =>
      onpatch({ color: v }))}
    {@render colorRow(tr('typo.propTextureBg'), dc(paint?.kind === 'texture' ? paint.bg : undefined, '#000000'), `${prefix}-bg`, (v) =>
      onpatch({ color2: v }))}
    <Field label={tr('typo.propTextureScale')} labelWidth={74}>
      <NumberInput
        value={paint?.kind === 'texture' ? paint.scale : 28}
        min={2}
        step={2}
        width={62}
        suffix="px"
        testid={`${prefix}-scale`}
        ariaLabel={tr('typo.propTextureScale')}
        onchange={(v) => onpatch({ scale: Math.max(2, v) })}
      />
    </Field>
    <Field label={tr('typo.propTextureThickness')} labelWidth={74}>
      <NumberInput
        value={paint?.kind === 'texture' ? paint.thickness : 3}
        min={0.5}
        step={0.5}
        precision={1}
        width={62}
        suffix="px"
        testid={`${prefix}-thickness`}
        ariaLabel={tr('typo.propTextureThickness')}
        onchange={(v) => onpatch({ thickness: Math.max(0.5, v) })}
      />
    </Field>
  {/if}

  {#if kind !== 'none'}
    <Field label={tr('typo.propFillOpacity')} labelWidth={74}>
      <NumberInput
        value={opacityPct}
        min={0}
        max={100}
        step={5}
        width={62}
        suffix="%"
        testid={`${prefix}-opacity`}
        ariaLabel={tr('typo.propFillOpacity')}
        onchange={(v) => onpatch({ opacity: Math.max(0, Math.min(100, v)) / 100 })}
      />
    </Field>
  {/if}
</div>

<style>
  .prop-paint {
    display: grid;
    gap: 2px;
  }
  /* 色块：`input[type=color]` 铺满一个可见的方块（原生外观只留取色器本身）。 */
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
  .prop-swatch-sm {
    width: 18px;
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
  /* 与上面的字段行对齐：标签列 74px（色标列表是「填充方式」那一行的子项）。 */
  .prop-stops {
    display: grid;
    gap: 2px;
    margin: 2px 0 4px 74px;
  }
  .prop-stop {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .prop-ic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .prop-ic:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--surface-hover);
  }
  .prop-ic:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
  .prop-add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    justify-self: start;
    height: 20px;
    padding: 0 var(--sp-2);
    background: transparent;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .prop-add:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }
</style>
