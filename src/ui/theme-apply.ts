/**
 * theme-apply.ts — 全项目**唯一**写 CSS 自定义属性的地方。
 *
 * 单独成文件有两个理由：
 *   1. AGENTS §7 要求单测只测纯函数，不能碰 DOM。tokens.ts 保持纯数据，
 *      所有 DOM 写入集中在这里，于是「token 解析」可以被单测完整覆盖。
 *   2. 想换注入方式（内联 style → CSSStyleSheet → style-src 头）只需改这里。
 */

import {
  paperScopeRule,
  resolveMotionTokens,
  resolveTokens,
  themeFamily,
  type MotionSpeed,
  type ThemeSpec,
} from './tokens';

export function applyTokens(vars: Record<string, string>, el: HTMLElement | SVGElement): void {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
}

/**
 * 把一套主题装到元素上（默认 `:root`）。
 *
 * 同时写 `color-scheme`，让原生滚动条、`<input type=color>` 弹层、选区高亮
 * 这些浏览器自己画的东西也跟着亮/暗——否则亮色主题里会突然冒出一块深色。
 * 值取**族**而不是 mode：`gray` / `contrast` 都是深底，浏览器那边只认 light/dark。
 */
export function installTheme(spec: ThemeSpec, el?: HTMLElement): void {
  const target = el ?? document.documentElement;
  applyTokens(resolveTokens(spec), target);
  target.style.colorScheme = themeFamily(spec.mode);
  target.dataset.theme = spec.mode;
  installPaperScope();
}

/**
 * 纸面作用域规则（`[data-paper] { … }`）只在文档里存在一份。
 *
 * 为什么不做成 `app.css` 里的一段：那条规则要列出**全部** semantic / component
 * 变量，手写清单在加 token 时必然漏，而漏掉的表现是「弹窗里有一个控件还是深色」。
 * 规则文本由 `tokens.paperScopeRule()` 从同一张表生成，物理上不可能不同步。
 *
 * 各套模式的 `--paper-*` 值由 `installTheme` 每次写到 :root 上，所以这条规则
 * 本身与模式无关，注入一次即可。
 */
const PAPER_SCOPE_ID = 'artmatic-paper-scope';

function installPaperScope(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(PAPER_SCOPE_ID)) return;
  const style = document.createElement('style');
  style.id = PAPER_SCOPE_ID;
  style.textContent = paperScopeRule();
  document.head.appendChild(style);
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

/**
 * 界面微动效偏好。
 *
 * 与 applyFontScale 同一个理由单独成函数：基准时长留在 tokens.ts 的纯函数里，
 * 这里只负责把解析结果写到根节点。关闭时也保留变量（值为 0），因此组件不需要
 * 再判一次开关。
 */
export function applyMotion(enabled: boolean, speed: MotionSpeed, el?: HTMLElement): void {
  const target = el ?? document.documentElement;
  applyTokens(resolveMotionTokens(enabled, speed), target);
}
