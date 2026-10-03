/**
 * theme-apply.ts — 全项目**唯一**写 CSS 自定义属性的地方。
 *
 * 单独成文件有两个理由：
 *   1. AGENTS §7 要求单测只测纯函数，不能碰 DOM。tokens.ts 保持纯数据，
 *      所有 DOM 写入集中在这里，于是「token 解析」可以被单测完整覆盖。
 *   2. 想换注入方式（内联 style → CSSStyleSheet → style-src 头）只需改这里。
 */

import { resolveTokens, type ThemeSpec } from './tokens';

export function applyTokens(vars: Record<string, string>, el: HTMLElement | SVGElement): void {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}

/**
 * 把一套主题装到元素上（默认 `:root`）。
 *
 * 同时写 `color-scheme`，让原生滚动条、`<input type=color>` 弹层、选区高亮
 * 这些浏览器自己画的东西也跟着亮/暗——否则亮色主题里会突然冒出一块深色。
 */
export function installTheme(spec: ThemeSpec, el?: HTMLElement): void {
  const target = el ?? document.documentElement;
  applyTokens(resolveTokens(spec), target);
  target.style.colorScheme = spec.mode;
  target.dataset.theme = spec.mode;
}

/** `--fs-*` 的基准值（与 tokens.ts 的 STATIC 一致）。 */
const FONT_BASE = { 'fs-xs': 10, 'fs-sm': 11, 'fs-md': 12 } as const;

/**
 * 界面字号缩放。
 *
 * 单独一个函数、而不是塞进 `resolveTokens`：token 解析是纯函数且有单测钉在
 * 基准值上，把缩放揉进去会让「基准主题」这件事失真。这里只覆盖三个字号变量，
 * **不动**图标与控件高度 —— 理由见 theme.svelte.ts 的 FONT_SCALE_STEPS。
 */
export function applyFontScale(scale: number, el?: HTMLElement): void {
  const target = el ?? document.documentElement;
  for (const [k, base] of Object.entries(FONT_BASE)) {
    target.style.setProperty(`--${k}`, `${Math.round(base * scale * 10) / 10}px`);
  }
}
