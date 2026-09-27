<script lang="ts">
  /**
   * Brand — 品牌标志（小标 + 字标）。
   *
   * 为什么内联而不是 `<img src>`：
   * 原文的字标没有任何 fill，走 SVG 默认的黑色；标记里另有一块 `rgb(47,47,47)`。
   * 两者在本应用的暗底上直接看不见。`<img>` 是独立文档，页面 CSS 的
   * `color` 传不进去，`currentColor` 只会解析成 SVG 文档自己的默认黑色。
   * 内联之后字标才跟随主题文字色（CSS 变量），一处改色全局生效。
   *
   * 资源文件里已把「无 fill 的字标 + 那块 #2F2F2F」统一成 currentColor，
   * 单独打开该 .svg 仍是黑色字标（默认 color），行为不变。
   */
  import rawLogo from '../assets/brand/logo-small-with-fonttype.svg?raw';

  interface Props {
    height?: number;
  }
  const { height = 22 }: Props = $props();

  // 只有 <svg> 片段进 DOM：XML 声明与 DOCTYPE 在 innerHTML 语境里是没有意义的噪声。
  const markup = rawLogo.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/^<!DOCTYPE[^>]*>\s*/, '');
</script>

<span class="brand" role="img" aria-label="Artmatic" style:height={`${height}px`}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  {@html markup}
</span>

<style>
  .brand {
    display: inline-flex;
    align-items: center;
    color: var(--text-0);
    flex-shrink: 0;
  }
  /* 资源里 svg 是 width/height=100%，这里用外层定高、宽度按 viewBox 比例走 */
  .brand :global(svg) {
    height: 100%;
    width: auto;
    display: block;
  }
</style>
