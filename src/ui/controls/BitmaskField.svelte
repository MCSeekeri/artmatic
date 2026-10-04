<script lang="ts">
  /**
   * BitmaskField — 位掩码参数（一维 CA 的规则号 / 生命类 CA 的 B/S 掩码）。
   *
   * 为什么不是一条滑杆：`bitmask` 的两种用法里，只有 ECA 的 8 位还勉强能
   * 「拖滑杆找规律」；18 位的 B/S 掩码在滑杆上完全没有语义（0..262143 的
   * 线性空间里，相邻两个值可能只差一位意义完全不同的规则）。所以真正的
   * 交互是**位表**：点一行翻转那一位，规则号实时联动。
   *
   * 行序规则（高位在前 / 低位在前）与「哪一位对应哪个邻域」都在
   * `core/bitmask.ts` 里 —— 生成器读同一个值，两边必须用同一套映射。
   */
  import { bitRows, getBit, maskMax, toggleBit } from '../../core/bitmask';
  import Slider from './Slider.svelte';
  import NumberInput from './NumberInput.svelte';
  import Button from './Button.svelte';

  interface GroupView {
    label: string;
    bits: number;
    style: 'eca' | 'count';
  }

  interface Props {
    value: number;
    bits: number;
    groups: GroupView[];
    slider?: boolean;
    presets?: { label: string; value: number }[];
    disabled?: boolean;
    testid?: string;
    oninput: (v: number) => void;
    onchange: (v: number) => void;
  }
  const {
    value,
    bits,
    groups,
    slider = false,
    presets,
    disabled = false,
    testid = 'bitmask',
    oninput,
    onchange,
  }: Props = $props();

  const max = $derived(maskMax(bits));
  const current = $derived(Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0);

  interface RowView {
    bit: number;
    on: boolean;
    /** `'eca'` 用：这一行代表的 3 位邻域（0..7，按 ■■■ 从左到右）。 */
    nb: number;
    /** `'count'` 用：邻居数。 */
    count: number;
    style: 'eca' | 'count';
  }

  const groupViews = $derived(
    (() => {
      const all = bitRows(groups.map((g) => ({ bits: g.bits, style: g.style })));
      return groups.map((g, gi) => ({
        label: g.label,
        rows: all
          .filter((r) => r.group === gi)
          .map<RowView>((r) => ({
            bit: r.bit,
            on: getBit(current, r.bit) === 1,
            nb: Math.max(0, g.bits - 1 - r.indexInGroup),
            count: r.indexInGroup,
            style: g.style,
          })),
      }));
    })(),
  );

  function flip(bit: number): void {
    if (disabled) return;
    // 单击是**一次离散动作**：只走 onchange（= 一笔撤销），不重复发 oninput。
    onchange(toggleBit(current, bit, bits));
  }
</script>

<div class="bmk" data-testid={testid}>
  <div class="bmk-head">
    {#if slider}
      <Slider
        value={current}
        min={0}
        max={max}
        step={1}
        disabled={disabled}
        ariaLabel="mask"
        testid={`${testid}-slider`}
        oninput={oninput}
        onchange={onchange}
      />
    {/if}
    <NumberInput
      value={current}
      min={0}
      max={max}
      step={1}
      width={54}
      disabled={disabled}
      testid={`${testid}-num`}
      onchange={onchange}
    />
  </div>

  <div class="bmk-table">
    {#each groupViews as g, gi (gi)}
      <div class="bmk-group">
        {#if g.label}<span class="bmk-gl">{g.label}</span>{/if}
        <div class="bmk-rows">
          {#each g.rows as r (r.bit)}
            <button
              type="button"
              class="bmk-row"
              aria-pressed={r.on}
              aria-label={`${r.style === 'eca' ? r.nb : r.count}`}
              disabled={disabled}
              data-testid={`${testid}-bit-${r.bit}`}
              onclick={() => flip(r.bit)}
            >
              {#if r.style === 'eca'}
                <span class="bmk-cells">
                  <span class="bmk-cell" class:live={(r.nb & 4) !== 0}></span>
                  <span class="bmk-cell" class:live={(r.nb & 2) !== 0}></span>
                  <span class="bmk-cell" class:live={(r.nb & 1) !== 0}></span>
                </span>
                <span class="bmk-arrow">→</span>
              {:else}
                <span class="bmk-count">{r.count}</span>
                <span class="bmk-arrow">→</span>
              {/if}
              <span class="bmk-out" class:on={r.on}></span>
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  {#if presets && presets.length}
    <div class="bmk-presets">
      {#each presets as p, i (i)}
        <Button
          label={p.label}
          variant="ghost"
          size="sm"
          disabled={disabled}
          testid={`${testid}-preset-${i}`}
          onclick={() => onchange(p.value)}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .bmk {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .bmk-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .bmk-head :global(.sld) {
    flex: 1;
    min-width: 0;
  }
  .bmk-table {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bmk-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bmk-gl {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }
  .bmk-rows {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .bmk-row {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 18px;
    padding: 0 3px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-secondary);
  }
  .bmk-row:hover:not(:disabled) {
    background: var(--btn-bg-hover);
  }
  .bmk-row:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .bmk-cells {
    display: inline-flex;
    gap: 1px;
  }
  .bmk-cell {
    width: 5px;
    height: 9px;
    background: var(--surface-3);
  }
  .bmk-cell.live {
    background: var(--text-secondary);
  }
  .bmk-count {
    min-width: 7px;
    font-size: var(--fs-xs);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .bmk-arrow {
    font-size: var(--fs-xs);
    opacity: 0.6;
  }
  .bmk-out {
    width: 9px;
    height: 9px;
    border: 1px solid var(--border);
    background: var(--surface-3);
  }
  .bmk-out.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .bmk-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
</style>
