/**
 * 品牌 SVG 的内联处理。
 *
 * 主应用里 `ui/Brand.svelte` 是「选整份文件」：亮底用 `-dark`、暗底用 `-light`，
 * 墨色不改成 currentColor。官网没有那个必要 —— 一套内联 + currentColor 就能跟着
 * 主题走，而且不会再出现「文件名说的是墨色、不是目标模式」那种翻车。
 * 紫色仍走 `var(--accent)`，和主应用同一套品牌色。
 */
export function inlineBrand(raw: string, opts: { morph?: boolean } = {}): string {
  let svg = raw
    .replace(/^<\?xml[^>]*\?>\s*/, '')
    .replace(/^<!DOCTYPE[^>]*>\s*/i, '')
    // 宽高交给外层 CSS 定，否则 inline-block 里 100% 会退化成循环依赖
    .replace(/width="100%"\s+height="100%"\s*/, '')
    .replace(/fill:rgb\(111,\s*100,\s*239\)/g, 'fill:var(--accent)')
    .replace(/fill:rgb\((?:47,\s*47,\s*47|248,\s*248,\s*248)\)/g, 'fill:currentColor');

  if (opts.morph) {
    let i = 0;
    // small 标记是三个 path（紫三角 / 墨形 / 紫横条），各包一层好单独变形
    svg = svg.replace(/<path\b[\s\S]*?\/>/g, (path) => `<g class="part part-${++i}">${path}</g>`);
  }

  return svg;
}
