/**
 * css-family.ts — 把一个族名写成 CSS `font-family` 值（纯函数）。
 *
 * 用在字体下拉里：**每个字体名用它自己的字体渲染**（「宋体」两个字就是宋体）。
 * 这比任何小字说明都直接 —— 用户挑字体时看的是「长什么样」。
 *
 * 为什么要加引号而不是原样拼：族名来自本机字体枚举，`Noto Sans SC` 这类
 * 多词名不加引号虽然合法，但 `5by7`、`A+B`、含逗号的名字会直接被判成
 * 语法错（整条声明失效，预览退回默认字体，且没有任何提示）。
 *
 * 为什么通用族不能加引号：`"serif"` 是一个叫 serif 的**具体字体**，不是
 * 通用族 —— 本机不存在这个名字，于是声明失效。用户在「自定义 CSS」里写
 * `serif` 是这个功能唯一会遇到的通用族。
 */

/** CSS Fonts 4 §2.2 的通用族关键词。写死清单而不是靠正则：清单是规范。 */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);

/**
 * 取族列表里的第一个族名。`"Inter", sans-serif` → `Inter`。
 *
 * 引号内的逗号不算分隔符（`"Foo, Bar", serif` 是合法 CSS，名字里就有逗号）。
 */
export function firstFamily(list: string): string {
  const src = list.trim();
  const quote = src[0];
  if (quote === '"' || quote === "'") {
    const end = src.indexOf(quote, 1);
    return end > 1 ? src.slice(1, end) : src.slice(1);
  }
  const comma = src.indexOf(',');
  return (comma < 0 ? src : src.slice(0, comma)).trim();
}

/**
 * 族名 → 可直接写进 `font-family` 的值（含引号转义）。
 *
 * 空串返回空串：调用方据此**不写**这条声明（写成 `font-family: ""` 会让
 * 整条声明失效，样式表里留一条坏声明比不写更糟）。
 */
export function cssFamily(name: string): string {
  const family = firstFamily(name).trim();
  if (!family) return '';
  const lower = family.toLowerCase();
  if (GENERIC_FAMILIES.has(lower)) return lower;
  // 反斜杠先逃，否则会把后面那次转义再吃一层（与 font-registry 的 cssUrl 同一手法）。
  return `"${family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
