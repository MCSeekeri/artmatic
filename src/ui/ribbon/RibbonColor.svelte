<script lang="ts">
  /**
   * RibbonColor — 一个色块按钮，点开系统的取色器。
   *
   * 用原生 `<input type="color">` 而不是自绘取色面板：自绘的轮子 / 色带 /
   * 十六进制输入要几百行，而原生的那一套在 Windows 上就是系统的取色器
   * （含吸管、最近使用色），体验比自绘好。检查器里也一直是这么做的。
   */
  interface Props {
    label: string;
    value: string;
    disabled?: boolean;
    testid?: string;
    onchange: (value: string) => void;
  }
  const { label, value, disabled = false, testid, onchange }: Props = $props();
</script>

<div class="rcolor" class:disabled data-testid={testid}>
  <span class="rcolor-swatch" style:--swatch={value}>
    <input
      class="picker"
      type="color"
      {value}
      {disabled}
      aria-label={label}
      oninput={(e) => onchange(e.currentTarget.value)}
    />
  </span>
  <span class="lbl">{label}</span>
</div>

<style>
  .rcolor {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: var(--ribbon-btn-w, 50px);
    height: var(--ribbon-btn-h, 56px);
    padding: 2px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--ribbon-btn-fg);
  }
  .rcolor:hover:not(.disabled) {
    background: var(--ribbon-btn-bg-hover);
    color: var(--ribbon-btn-fg-hover);
  }
  .rcolor.disabled {
    color: var(--ribbon-btn-fg-disabled);
  }
  .rcolor-swatch {
    position: relative;
    display: block;
    width: 22px;
    height: 22px;
    background: var(--swatch, #ffffff);
    /* 1px 实线描边：没有阴影，色块与底色靠它分开 */
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }
  .picker {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    opacity: 0;
    cursor: pointer;
  }
  .lbl {
    font-size: var(--fs-xs);
    line-height: 1.1;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
