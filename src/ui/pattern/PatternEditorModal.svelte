<script lang="ts">
  /**
   * PatternEditorModal — 手绘种子图案的编辑器（精简版）。
   *
   * 刻意**不做**旋转 / 镜像 / 平移 / 洪水填充：那些是「图案编辑器」这个
   * 东西自己的功能膨胀，而它存在的唯一理由是「让用户画出随机撒种给不出的
   * 初始条件」（滑翔机、滑翔机枪这类构造）。工具多了反而把注意力从
   * 「画什么」引到「怎么画」上。
   *
   * 画笔模型是**经典的那一种**：没有独立的笔/橡皮开关，`pointerdown` 落在
   * 哪一格就决定了这一次拖拽是「画」还是「擦」（`brush = 1 - cell`）。
   * 从空格起手 = 画，从活格起手 = 擦，单击 = 翻转。这样一只手就够了。
   *
   * 所有改动都发生在**本地草稿**上，只有「应用」才回写参数 —— 于是整个
   * 编辑过程是一笔撤销，而不是每涂一格就压一层撤销栈。
   */
  import Modal from '../controls/Modal.svelte';
  import Button from '../controls/Button.svelte';
  import Select from '../controls/Select.svelte';
  import AssetPickerModal from './AssetPickerModal.svelte';
  import type { PatternAssetSource } from './pattern-import';
  import { tr } from '../../i18n/index.svelte';
  import { hashSeed, mulberry32 } from '../../core/prng';
  import { hexToRgba } from '../../core/color';
  import {
    decodePattern,
    emptyBitmap,
    encodePattern,
    invertBitmap,
    liveCount,
    randomBitmap,
    resizeBitmap,
    stampCentered,
    stampRow,
    type Bitmap,
  } from '../../algos/pattern-codec';
  import { PATTERN_PRESETS, presetBitmap } from '../../algos/pattern-presets';
  import { cellAt, gridLayout, linePoints, paintCells, type Cell } from './pattern-paint';

  interface Props {
    title: string;
    /**
     * 模拟网格的尺寸。给了它，「从素材导入」按**这个分辨率**采样 ——
     * 图案盖回网格时是恒等映射，图片就是初始状态本身（而不是缩在中间的一块）。
     * 不给则退回 `editorSize` 的正方形。
     */
    grid?: { w: number; h: number };
    /** 初值用函数取（同 CustomCssModal 的理由：避免在 props 求值期读 store）。 */
    initial: () => string;
    mode?: '2d' | '1d';
    /** 新建空白图案时的边长。 */
    editorSize?: number;
    /**
     * 「从素材导入」的数据源。**不给就没有这个按钮** —— `/lab/` 不装配
     * `appState`，在那里它不该出现（见 `pattern-import.ts` 的文件头）。
     */
    source?: PatternAssetSource;
    colors: { bg: string; live: string };
    onapply: (encoded: string) => void;
    onclose: () => void;
    testid?: string;
  }
  const {
    title,
    grid,
    initial,
    mode = '2d',
    editorSize = 32,
    source,
    colors,
    onapply,
    onclose,
    testid = 'pattern-editor',
  }: Props = $props();

  const SIZES: number[] = [8, 16, 24, 32, 48, 64];
  /**
   * 画布 CSS 尺寸。1D 只画一行，所以很扁。
   *
   * 2D 取 320 而不是更大：模态的 body 在 720px 高的视口里只有约 480px
   * 可用（head 40 + foot 46 + padding 40），画布再高就会把工具栏挤出可视区
   * —— 那时「点预设按钮」和「在画布上拖」都点不到（前者要滚动、后者被裁）。
   *
   * 用 `$derived` 而不是普通 const：`mode` 是 prop，直接读会被 Svelte
   * 记成「只在初始化时捕获一次」（state_referenced_locally）。
   */
  const CANVAS = $derived(mode === '1d' ? { w: 448, h: 44 } : { w: 320, h: 320 });

  /** 「一格一像素」的离屏图（仅格子 <2px 时用）。见 `draw` 的注释。 */
  let dots: HTMLCanvasElement | null = null;
  let dotsForBm: Bitmap | null = null;
  let dotsLive = '';

  function dotsFor(b: Bitmap, live: string): HTMLCanvasElement {
    if (dots && dotsForBm === b && dotsLive === live) return dots;
    const c = document.createElement('canvas');
    c.width = b.w;
    c.height = b.h;
    const cx = c.getContext('2d')!;
    const img = cx.createImageData(b.w, b.h);
    const [r, g, bl] = hexToRgba(live);
    for (let i = 0; i < b.data.length; i++) {
      if (!b.data[i]) continue;
      const j = i * 4;
      img.data[j] = r;
      img.data[j + 1] = g;
      img.data[j + 2] = bl;
      img.data[j + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    dots = c;
    dotsForBm = b;
    dotsLive = live;
    return c;
  }

  function makeInitial(): Bitmap {
    const decoded = decodePattern(initial());
    if (decoded) return mode === '1d' && decoded.h !== 1 ? resizeBitmap(decoded, decoded.w, 1) : decoded;
    const n = Math.max(4, Math.min(64, Math.round(editorSize)));
    return emptyBitmap(n, mode === '1d' ? 1 : n);
  }

  let canvas: HTMLCanvasElement;
  /**
   * 草稿位图。用 `$state.raw`：
   *
   * 涂画是**就地改** `bm.data`（避免每移动一格就拷一份位图），而就地改不会
   * 触发响应式 —— 所以涂完再 `bm = { ...bm }` 换一次对象引用。位图数据本身
   * 是共享的，所以这次「换引用」是零成本的，只是用来通知渲染。
   */
  let bm = $state.raw<Bitmap>(makeInitial());
  /** 「随机」的种子计数器：每次点击不同，但同一次会话里可复现。 */
  let randTick = 0;

  /**
   * 下拉项跟着草稿走：从素材导入的图案可能不是方形（按网格尺寸采样），
   * 它的边长可能不在预设里 —— 不补一项的话触发器会显示成空值。
   */
  const sizeOptions = $derived.by(() => {
    const opts = SIZES.map((n) => ({ value: n, label: String(n) }));
    if (!SIZES.includes(bm.w)) {
      opts.unshift({ value: bm.w, label: bm.h === bm.w ? String(bm.w) : `${bm.w}×${bm.h}` });
    }
    return opts;
  });

  function draw(b: Bitmap): void {
    const c = canvas;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = CANVAS.w;
    const cssH = CANVAS.h;
    // canvas.width 是整数，dpr 非整数时直接比会永远不等（AGENTS §6.4.2）。
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    const lay = gridLayout(b.w, b.h, cssW, cssH);
    const gw = lay.cell * b.w;
    const gh = lay.cell * b.h;

    ctx.fillStyle = colors.live;
    if (lay.cell >= 2) {
      for (let y = 0; y < b.h; y++) {
        for (let x = 0; x < b.w; x++) {
          if (!b.data[y * b.w + x]) continue;
          ctx.fillRect(lay.ox + x * lay.cell, lay.oy + y * lay.cell, lay.cell, lay.cell);
        }
      }
    } else {
      /*
       * 从素材导入的图案可能和网格一样大（512² = 26 万格）。逐格 `fillRect`
       * 在 `pointermove` 里是几十万次调用，拖动会直接卡住；这里预渲一张
       * 「一格一像素」的小图再整体放大（`imageSmoothingEnabled = false`，
       * 观感与逐格画一致）。缓存按 `bm` 的对象身份失效 —— 涂一笔换一次引用。
       */
      ctx.drawImage(dotsFor(b, colors.live), lay.ox, lay.oy, gw, gh);
    }

    // 格线：格子太小时不画（否则整片是灰的）。
    if (lay.cell >= 5) {
      ctx.strokeStyle = 'rgba(128, 140, 160, 0.30)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= b.w; x++) {
        const px = lay.ox + x * lay.cell + 0.5;
        ctx.moveTo(px, lay.oy + 0.5);
        ctx.lineTo(px, lay.oy + gh + 0.5);
      }
      for (let y = 0; y <= b.h; y++) {
        const py = lay.oy + y * lay.cell + 0.5;
        ctx.moveTo(lay.ox + 0.5, py);
        ctx.lineTo(lay.ox + gw + 0.5, py);
      }
      ctx.stroke();
    }
  }

  // 唯一的重绘入口：读 `bm` 建立依赖，于是每次改动只要换一次引用就会重画。
  $effect(() => {
    draw(bm);
  });

  function localPoint(e: PointerEvent): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    const sx = r.width > 0 ? CANVAS.w / r.width : 1;
    const sy = r.height > 0 ? CANVAS.h / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  let brush = 1;
  let last: Cell | null = null;

  function down(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const lay = gridLayout(bm.w, bm.h, CANVAS.w, CANVAS.h);
    const p = localPoint(e);
    const c = cellAt(p.x, p.y, lay, bm.w, bm.h);
    if (!c) {
      last = null;
      return;
    }
    brush = bm.data[c.y * bm.w + c.x] ? 0 : 1;
    paintCells(bm.data, bm.w, bm.h, [c], brush);
    last = c;
    bm = { ...bm }; // 就地改过 data，换引用触发重绘
  }

  function move(e: PointerEvent): void {
    if (!canvas.hasPointerCapture(e.pointerId)) return;
    const lay = gridLayout(bm.w, bm.h, CANVAS.w, CANVAS.h);
    const p = localPoint(e);
    const c = cellAt(p.x, p.y, lay, bm.w, bm.h);
    if (!c) {
      last = null;
      return;
    }
    // 补线：pointermove 的采样率低于快速拖动的速度，只处理落点会画出虚线。
    const pts = last ? linePoints(last.x, last.y, c.x, c.y) : [c];
    paintCells(bm.data, bm.w, bm.h, pts, brush);
    last = c;
    bm = { ...bm }; // 就地改过 data，换引用触发重绘
  }

  function up(e: PointerEvent): void {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    last = null;
  }

  function clearAll(): void {
    bm = emptyBitmap(bm.w, bm.h);
  }

  function invert(): void {
    bm = invertBitmap(bm);
  }

  function roll(): void {
    randTick++;
    bm = randomBitmap(bm.w, bm.h, mulberry32(hashSeed(randTick, 'pattern-editor')), 0.35);
  }

  function setSize(n: number): void {
    // 导入的矩形图案：选中它自己那一项时不要悄悄把它压成正方形。
    if (n === bm.w && mode === '2d' && bm.h !== bm.w) return;
    bm = resizeBitmap(bm, n, mode === '1d' ? 1 : n);
  }

  /* --------------------------------------------------- 从素材导入图案 */

  let assetOpen = $state(false);
  let importing = $state(false);

  /** 导入失败时的提示。没有 `appState` 的宿主（lab）就没有闪条，静默保留草稿。 */
  let importFailed = $state(false);

  async function importAsset(assetId: string): Promise<void> {
    assetOpen = false;
    importing = true;
    importFailed = false;
    try {
      const size = grid ?? { w: bm.w, h: bm.h };
      const next = source ? await source.load(assetId, size.w, size.h) : null;
      if (!next) {
        importFailed = true;
        return;
      }
      bm = next;
    } finally {
      importing = false;
    }
  }

  function loadPreset(id: string): void {
    const p = presetBitmap(id);
    if (!p) return;
    // 预设比当前网格大时先把网格撑到「最小的放得下的档位」——
    // 否则 36×9 的滑翔机枪盖到 32×32 上会被裁掉两头。
    const need = Math.max(p.w, p.h);
    let n = bm.w;
    if (need > n) n = SIZES.find((o) => o >= need) ?? 64;
    const next = emptyBitmap(n, mode === '1d' ? 1 : n);
    if (mode === '1d') stampRow(next.data, n, p, 1);
    else stampCentered(next.data, n, n, p, 1);
    bm = next;
  }
</script>

<Modal {title} onclose={onclose} {testid}>
  <div class="pe">
    <div class="pe-tools">
      <span class="pe-lab">{tr('algo.pattern.grid')}</span>
      <Select
        value={bm.w}
        options={sizeOptions}
        testid={`${testid}-size`}
        optionTestidPrefix={`${testid}-size-opt`}
        minWidth={70}
        onchange={(v) => setSize(Number(v))}
      />
      <span class="pe-lab">{tr('algo.pattern.presets')}</span>
      <div class="pe-presets">
        {#each PATTERN_PRESETS as p (p.id)}
          <Button
            label={tr(p.labelKey)}
            variant="ghost"
            size="sm"
            testid={`${testid}-preset-${p.id}`}
            onclick={() => loadPreset(p.id)}
          />
        {/each}
      </div>
    </div>

    <div class="pe-tools">
      <Button label={tr('algo.pattern.clear')} variant="outline" testid={`${testid}-clear`} onclick={clearAll} />
      <Button label={tr('algo.pattern.invert')} variant="outline" testid={`${testid}-invert`} onclick={invert} />
      <Button label={tr('algo.pattern.random')} variant="outline" testid={`${testid}-random`} onclick={roll} />
      {#if mode === '2d' && source}
        <Button
          label={tr('algo.pattern.import')}
          icon="image"
          variant="outline"
          disabled={importing}
          testid={`${testid}-import`}
          onclick={() => (assetOpen = true)}
        />
      {/if}
    </div>

    <div class="pe-stage" data-exempt>
      <canvas
        bind:this={canvas}
        data-testid={`${testid}-canvas`}
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
      ></canvas>
    </div>

    <p class="pe-hint">
      {tr('algo.pattern.hint')} · {tr('algo.pattern.alive')}: {liveCount(bm)}
      {#if importFailed}<span class="pe-err">{tr('algo.pattern.importFailed')}</span>{/if}
    </p>
  </div>

  {#snippet footer()}
    <Button label={tr('common.cancel')} variant="outline" testid={`${testid}-cancel`} onclick={onclose} />
    <Button
      label={tr('common.apply')}
      variant="accent"
      testid={`${testid}-apply`}
      onclick={() => onapply(encodePattern(bm))}
    />
  {/snippet}
</Modal>

{#if assetOpen && source}
  <AssetPickerModal items={source.list()} onpick={importAsset} onclose={() => (assetOpen = false)} />
{/if}

<style>
  .pe {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    min-width: 0;
  }
  .pe-tools {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
  }
  .pe-lab {
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  .pe-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .pe-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--sp-2);
  }
  .pe-stage canvas {
    display: block;
    cursor: crosshair;
    touch-action: none;
  }
  .pe-hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }
  .pe-err {
    margin-left: var(--sp-2);
    color: var(--danger);
  }
</style>
