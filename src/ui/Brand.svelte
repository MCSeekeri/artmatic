<script lang="ts">
  /**
   * Brand — logo 的唯一入口。
   *
   * 资源是 O9 按「亮/暗背景」成对导出的，`Brand.svelte` 按当前主题选一个：
   *
   *   artmatic-small-*      2×2 标记（viewBox 143×163）
   *   artmatic-main-*       3×3 标记（viewBox 1280×1251）
   *   artmatic-fonttype-*   字标（viewBox 1218×260）
   *
   * ⚠️ **文件名说的是「墨色」，不是「目标模式」**——这里很容易搞反：
   *   `-dark`  里的墨是 rgb(47,47,47) 深灰 → 用在**亮背景**上，即亮色主题
   *   `-light` 里的墨是 rgb(248,248,248) 近白 → 用在**暗背景**上，即暗色主题
   * 也就是 `mode === 'light'` 要取 `-dark` 文件，反之亦然。搞反的后果是 logo 整块
   * 隐形（只有那点紫色还看得见），而不是「颜色不太对」，所以别靠肉眼验收——这条
   * 有 E2E 断言兜着（tests/e2e/brand.spec.ts）。
   *
   * 为什么必须内联而不是 `<img src>`：`<img>` 是独立文档，页面 CSS 进不去，主题切换
   * 只能靠换文件；内联后品牌紫还能跟着 `--accent` 走（见下面 prepare 里的替换）。
   */
  import smallLight from '../assets/brand/artmatic-small-light.svg?raw';
  import smallDark from '../assets/brand/artmatic-small-dark.svg?raw';
  import mainLight from '../assets/brand/artmatic-main-light.svg?raw';
  import mainDark from '../assets/brand/artmatic-main-dark.svg?raw';
  import wordLight from '../assets/brand/artmatic-fonttype-light.svg?raw';
  import wordDark from '../assets/brand/artmatic-fonttype-dark.svg?raw';
  import { theme } from './theme.svelte';

  type Variant = 'mark' | 'word';

  interface Props {
    variant?: Variant;
    /** 高度（px）。宽度按 viewBox 比例走。 */
    size?: number;
    /** mark 变体在多高以上用 3×3 的大标记。20px 的位子放 3×3 会糊成一团。 */
    largeFrom?: number;
  }
  const { variant = 'mark', size = 20, largeFrom = 44 }: Props = $props();

  const SOURCES = {
    mark: { small: { light: smallDark, dark: smallLight }, large: { light: mainDark, dark: mainLight } },
    word: { light: wordDark, dark: wordLight },
  } as const;

  /**
   * 把品牌紫换成 var(--accent)，好让标记跟着主题色走。
   * 墨色（rgb(47,47,47) / rgb(248,248,248)）**保持资源里的原值**——那正是成对导出的
   * 意义所在，不再用 currentColor 覆盖。
   */
  const prepare = (raw: string): string =>
    raw
      .replace(/^<\?xml[^>]*\?>\s*/, '')
      .replace(/^<!DOCTYPE[^>]*>\s*/i, '')
      .replace(/fill:rgb\(111,\s*100,\s*239\)/g, 'fill:var(--accent)');

  const src = $derived(
    variant === 'word'
      ? SOURCES.word[theme.mode]
      : size >= largeFrom
        ? SOURCES.mark.large[theme.mode]
        : SOURCES.mark.small[theme.mode],
  );
  const markup = $derived(prepare(src));
</script>

<span class="brand" data-variant={variant} role="img" aria-label="Artmatic" style:height={`${size}px`}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  {@html markup}
</span>

<style>
  .brand {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }
  /* 资源里 svg 是 width/height=100%，这里用外层定高、宽度按 viewBox 比例走 */
  .brand :global(svg) {
    height: 100%;
    width: auto;
    display: block;
  }
</style>
