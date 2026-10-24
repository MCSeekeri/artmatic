<script lang="ts">
  /**
   * ImageRecolorPopover — 重新着色：把**亮度**映射到一条双色渐变上。
   *
   * 两色（暗部 / 亮部）而不是单色：单色映射把明暗层次压平，整张图会变成一块
   * 色板。预设给六组现成的双色调，点一下就成型，不必先理解两个颜色各自管什么。
   */
  import ColorField from '../controls/ColorField.svelte';
  import NumericField from '../controls/NumericField.svelte';
  import ImagePopShell from './ImagePopShell.svelte';
  import type { ImageRecolor } from '../../typography/image-effects';
  import type { TypographyTheme } from '../../typography/theme';
  import { tr } from '../../i18n/index.svelte';

  interface Props {
    anchor: HTMLElement;
    onclose: () => void;
    recolor: ImageRecolor;
    /** 当前配色方案（取色卡的主题色网格 + 引用解析）。 */
    theme: TypographyTheme;
    /** 离散提交（选色 / 点预设 / 强度松手）。 */
    onchange: (patch: Partial<ImageRecolor>) => void;
    /** 强度滑杆拖动中。 */
    onlive: (patch: Partial<ImageRecolor>) => void;
    /** 拖动结束。 */
    onliveend: () => void;
  }
  const { anchor, onclose, recolor, theme, onchange, onlive, onliveend }: Props = $props();

  /**
   * 六组双色调。**只有颜色，没有名字** —— 一排色块本身就是说明
   * （用户原话：「预览 icon 直接使用形状本身，不需要文字说明」的同一条道理）。
   */
  const PRESETS: [string, string][] = [
    ['#ffd9a0', '#1b2a4a'],
    ['#00e3c0', '#0a1f2a'],
    ['#ff4d6d', '#1a0812'],
    ['#c8b6ff', '#150f2e'],
    ['#ffe066', '#2a1c05'],
    ['#8ecae6', '#07131c'],
  ];
</script>

<ImagePopShell {anchor} {onclose} title={tr('rib.imageRecolor')} testid="img-recolor-pop">
  <div class="row">
    <ColorField
      label={tr('rib.imgRecolorLight')}
      value={recolor.color}
      {theme}
      testid="img-recolor-light"
      onchange={(v) => onchange({ color: v })}
    />
    <span class="cap">{tr('rib.imgRecolorLight')}</span>
  </div>
  <div class="row">
    <ColorField
      label={tr('rib.imgRecolorShadow')}
      value={recolor.shadow}
      {theme}
      testid="img-recolor-shadow"
      onchange={(v) => onchange({ shadow: v })}
    />
    <span class="cap">{tr('rib.imgRecolorShadow')}</span>
  </div>

  <div class="presets" data-testid="img-recolor-presets">
    {#each PRESETS as [light, shadow], i (light + shadow)}
      <button
        type="button"
        class="ipop-swatch"
        title={`${light} → ${shadow}`}
        aria-label={`${light} ${shadow}`}
        data-testid={`img-recolor-preset-${i}`}
        style:background={`linear-gradient(135deg, ${shadow}, ${light})`}
        onclick={() => onchange({ color: light, shadow, amount: 1 })}
      ></button>
    {/each}
  </div>

  <NumericField
    label={tr('rib.imgRecolorAmount')}
    labelWidth={44}
    numberWidth={44}
    min={0}
    max={100}
    step={1}
    value={Math.round(recolor.amount * 100)}
    sliderTestid="img-recolor-amount"
    numberTestid="img-recolor-amount-num"
    oninput={(v) => onlive({ amount: v / 100 })}
    onchange={(v) => {
      onlive({ amount: v / 100 });
      onliveend();
    }}
  />
</ImagePopShell>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .cap {
    color: var(--text-secondary);
    font-size: var(--fs-xs);
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
    margin: var(--sp-1) 0 var(--sp-2);
  }
  .ipop-swatch {
    width: 28px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .ipop-swatch:hover {
    border-color: var(--border-strong);
  }
</style>
