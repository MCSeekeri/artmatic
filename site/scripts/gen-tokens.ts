/**
 * gen-tokens.ts — 把 `src/ui/tokens.ts` 摊成站点能用的 CSS 变量表。
 *
 * 为什么不手抄一份：设计令牌的真源在主应用里，抄一份的后果是「改了 token、
 * 官网没变」，而且这种漂移没有任何测试能发现。这里直接 import 那个模块跑
 * `resolveTokens()` —— 它是纯数据 + 纯函数（只额外 import `core/color`），
 * 不碰 DOM，所以能在 node 里跑（`tsx` 负责去掉类型）。
 *
 * 两段都必须**完整**：
 *   - Starlight 的 SSR 输出固定写 `<html data-theme="dark">`，再由首屏前的内联
 *     脚本改成实际主题。所以 `:root` 是亮色默认值，暗色靠属性选择器覆盖。
 *   - 只写暗色块会让亮色用户继承 Starlight 自带的暗色调色板（它不是我们的颜色）。
 *
 * 生成物 `src/styles/tokens.css` 进 .gitignore —— 每次 build 先跑这个脚本。
 */
import { writeFile } from 'node:fs/promises';
import { resolveTokens, type ThemeSpec } from '../../src/ui/tokens.ts';

const HEADER = `/* 由 site/scripts/gen-tokens.ts 生成，不要手改。
 * 真源：src/ui/tokens.ts（跑 \`pnpm run gen\` 重新生成） */`;

/** 站点只做单品牌：品牌紫总是 violet 预设。 */
const spec = (mode: 'light' | 'dark'): ThemeSpec => ({
  mode,
  accent: { kind: 'preset', id: 'violet' },
});

function block(selector: string, vars: Record<string, string>, scheme: string): string {
  const lines = Object.entries(vars).map(([key, value]) => `  ${key}: ${value};`);
  return `${selector} {\n${lines.join('\n')}\n  color-scheme: ${scheme};\n}`;
}

const light = resolveTokens(spec('light'));
const dark = resolveTokens(spec('dark'));

const css = [
  HEADER,
  '',
  block(':root', light, 'light'),
  '',
  block(':root[data-theme="dark"]', dark, 'dark'),
  '',
].join('\n');

const out = new URL('../src/styles/tokens.css', import.meta.url);
await writeFile(out, css);

console.log(`tokens.css  ${Object.keys(light).length} 个变量 × 2 套`);
