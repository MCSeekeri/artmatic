/**
 * color.ts — 颜色的纯函数工具（core 层：无 DOM / WebGL，可单测）。
 *
 * 从 `engine/sources.ts` 提到这里，因为三个地方要用同一份：源解析（solid
 * 贴图）、算法运行时的 tint、特效应 def 的 `setUniforms`。留一份实现在
 * engine 里会让 effects/algos 反过来为了一个十六进制解析去 import 整个
 * SourceManager。
 */

/** `#rrggbb` 或 `#rrggbbaa` → 0..255 的四分量。坏颜色返回品红（立刻可见）。 */
export function hexToRgba(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return [255, 0, 255, 255]; // 坏颜色画成品红，立刻可见
  const n = parseInt(m[1]!, 16);
  const a = m[2] ? parseInt(m[2], 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/** 同上，但归一化到 0..1 且丢掉 alpha —— vec3 uniform 要的形状。 */
export function colorVec3(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgba(hex);
  return [r / 255, g / 255, b / 255];
}

/* ------------------------------------------------------------ HSL 工具
 *
 * 排版配色方案的**明暗变体**需要「只改亮度、不动色相/饱和度」——
 * 这是 Office 主题色变体的实测行为（见 typography/theme.ts 的说明）。
 *
 * `ui/tokens.ts` 里另有一份 `parseHex` / `rgbToHsl` / `hslToRgb`：那是给
 * 界面主题（品牌色/语义色）派生用的，带它自己的 clamp 约定。两份暂时并存，
 * 但**新增的颜色数学一律放这里** —— core 层不依赖 UI，反过来才成立。
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  l: number;
}

/**
 * `#rgb` / `#rrggbb` → RGB。**失败返回 null**（与 `hexToRgba` 的「坏值画品红」
 * 不同：那个是渲染路径，要立刻可见；这里是配色方案解析，必须能区分「不是颜色」）。
 */
export function hexToRgb(hex: string): Rgb | null {
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]!;
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(c: Rgb): string {
  const h = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function rgbToHsl(c: Rgb): Hsl {
  const rn = c.r / 255;
  const gn = c.g / 255;
  const bn = c.b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hh = ((((h % 360) + 360) % 360) / 360);
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  if (ss === 0) {
    const v = ll * 255;
    return { r: v, g: v, b: v };
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const f = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: f(hh + 1 / 3) * 255, g: f(hh) * 255, b: f(hh - 1 / 3) * 255 };
}

/** 线性混合：t=0 → a，t=1 → b。 */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return { r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k };
}
