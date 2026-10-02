/**
 * tokens.ts — Design Token 单一真源（纯数据 + 纯函数，**不碰 DOM**）。
 *
 * 为什么要有一个 TS 文件当唯一真源，而不是只在 app.css 里写 :root：
 *   时间轴是 Canvas2D 自绘，`ctx.fillStyle` 写不了 `var(--x)`。改版前
 *   grid-draw.ts 因此在 TS 里完整重抄了一份调色板（9 个字面量与 CSS 变量
 *   同值一一对应）——改一次配色要改两处，改漏就是「面板变了、网格没变」
 *   这种极难定位的偏色。现在两份都从这一个文件来，物理上不可能不同步。
 *
 * 分层（每条只允许引用它下面那一层）：
 *
 *   primitive  `--p-*`        只描述值（neutral-900 / violet-500），不含意图
 *   semantic   `--surface-*`  描述用途（surface-raised / text-danger），不含颜色词
 *   component  `--btn-*`      某个 UI 元素的具体绑定，值必须是某个 semantic
 *   content    `--clip-*`     数据的类别色（画面/特效/音频片段），**永不随品牌变**
 *
 * 最后一层是为解一个具体问题：片段类型色编码的是「这是哪类数据」，不是
 * 「界面上的什么角色」。若把它挂进品牌组，用户换主题色时特效片段的样貌会
 * 跟着变，破坏对内容的心智映射。所以它随亮暗变（保对比度）但永不随品牌变。
 *
 * 另有一条边界：生成器默认色（`#3a6ea5`、mandelbrot 的 colorA/B 之类）**不是
 * token**，那是 Project 文档内容（schema 字段）。Inspector 里颜色控件的外观走
 * component 层，控件的**值**走内容。这条守住，将来换主题才不会连带改掉用户
 * 工程里没动过的画面。
 */

/* ------------------------------------------------------------ 类型 */

/** 只借类型，不引运行时 —— tokens 保持「纯数据 + 纯函数」的定位。 */
import type { MessageKey } from '../i18n/locales';

export type ThemeMode = 'light' | 'dark';

/** 预置品牌色相。注意这是「色相」不是「某个 hex」——亮暗两套取不同明度步进。 */
export type BrandId = 'violet' | 'cyan' | 'lime' | 'amber';

/** 品牌来源：预置 id，或用户给的任意 hex。 */
export type AccentSource = { kind: 'preset'; id: BrandId } | { kind: 'custom'; hex: string };

export interface ThemeSpec {
  mode: ThemeMode;
  accent: AccentSource;
}

/** 主题色的一条完整色阶。5 个值足够覆盖「选中底 / 主色 / 描边 / 按下 / 反差文字」。 */
export interface AccentRamp {
  accent: string;
  accentStrong: string;
  accentWeak: string;
  accentBorder: string;
  accentOn: string;
}

/** semantic 的键。component 层的值类型就是它——写错层直接编译报错。 */
export type SemanticKey =
  | 'surface-0'
  | 'surface-1'
  | 'surface-2'
  | 'surface-3'
  | 'surface-hover'
  | 'surface-active'
  | 'border'
  | 'border-strong'
  | 'border-focus'
  | 'text-primary'
  | 'text-secondary'
  | 'text-muted'
  | 'text-disabled'
  | 'accent'
  | 'accent-strong'
  | 'accent-weak'
  | 'accent-border'
  | 'accent-on'
  | 'danger'
  | 'danger-weak'
  | 'success'
  | 'warning'
  | 'overlay'
  | 'scrollbar'
  | 'scrollbar-hover';

/** 数据类别色（片段 / 波形）。随 mode 变，不随品牌变。 */
export type ContentKey =
  | 'clip-source-bg'
  | 'clip-source-border'
  | 'clip-source-text'
  | 'clip-effect-bg'
  | 'clip-effect-border'
  | 'clip-effect-text'
  | 'clip-audio-bg'
  | 'clip-audio-border'
  | 'clip-audio-text';

/* ------------------------------------------------------------ 密度常量
 *
 * 数值在这里，CSS 字符串也在（由数值生成）。时间轴的 Canvas 数学
 * （行高、标尺高）直接 import 这里的数，不许各写一份。
 */

export const DENSITY = {
  /** 轨道行高。40 → 28 是 Terminal-Native 的密度取向：同屏多出 40% 的轨道。 */
  rowH: 28,
  rulerH: 24,
  controlH: 22,
  topbarH: 30,
  statusbarH: 22,
  railW: 44,
  tlSideW: 160,
  drawerW: 300,
  drawerMinW: 240,
  drawerMaxW: 520,

  /* 排版编辑器的 Ribbon。数值与 CSS 都从这里来（见 STATIC 的派生）。 */
  /** Tab 条高。 */
  ribbonTabH: 26,
  /** 面板高（分组按钮区，含底部 6px 的细横向滚动条）。总高 = 26 + 88 = 114。 */
  ribbonBodyH: 88,
  /** large 按钮（icon 在上、文字在下）。 */
  ribbonBtnW: 50,
  ribbonBtnH: 56,
  /** small 按钮：只放得下一个图标加短文字的紧凑项。 */
  ribbonBtnSmallW: 32,
} as const;

/* ------------------------------------------------------------ primitive */

/** 近零饱和度的冷中性灰。刻意不做成纯灰（#808080 系）——极小的蓝偏在
 *  深色表面上比纯灰更「干净」，这是终端主题的常见处理。 */
const NEUTRAL = {
  '0': '#ffffff',
  '50': '#f8f9fa',
  '100': '#eff1f3',
  '150': '#e5e7ea',
  '200': '#d9dcdf',
  '300': '#c3c7cb',
  '400': '#9ba0a6',
  '500': '#787d84',
  '600': '#5b6067',
  '700': '#43474e',
  '800': '#2d3136',
  '850': '#24272c',
  '900': '#1b1e22',
  '950': '#131518',
  '1000': '#0c0e10',
} as const;

export const PRIMITIVES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(NEUTRAL).map(([k, v]) => [`neutral-${k}`, v])),
  'red-400': '#ef5f63',
  'red-500': '#e5484d',
  'green-400': '#46b07c',
  'green-500': '#30a46c',
  'amber-500': '#d99a1f',
};

/** 预置品牌的锚点 hex（= 该品牌 500 步）。亮暗模式各自派生到合适的明度，
 *  所以「品牌紫是 #6F64EF」不等于「亮色下 accent 就是 #6F64EF」——亮色下
 *  它会落到更暗的一档以满足对比度。这是设计系统的常规做法，不是笔误。 */
/** 品牌名的展示文案走 i18n（`labelKey`），理由见 effects/types.ts 的注释。 */
export const ACCENT_PRESETS: Record<BrandId, { labelKey: MessageKey; hex: string }> = {
  violet: { labelKey: 'app.accentViolet', hex: '#6f64ef' },
  cyan: { labelKey: 'app.accentCyan', hex: '#2b9fd8' },
  lime: { labelKey: 'app.accentLime', hex: '#6ba03a' },
  amber: { labelKey: 'app.accentAmber', hex: '#d99a1f' },
};

export const BRAND_IDS = Object.keys(ACCENT_PRESETS) as BrandId[];

/* ------------------------------------------------------------ semantic
 *
 * 结构色与品牌无关，只有 accent 组随品牌走。所以这里先给「非 accent 部分」，
 *  accent 组由 accentRampOf() 填。
 */

export const SEMANTIC: Record<ThemeMode, Record<SemanticKey, string>> = {
  light: {
    'surface-0': NEUTRAL['0'], // body / 时间轴底
    'surface-1': NEUTRAL['50'], // 顶栏 / 底栏 / 侧栏 / 抽屉
    'surface-2': NEUTRAL['100'], // 工具条 / 轨道侧栏
    'surface-3': NEUTRAL['0'], // 菜单 / 气泡 / 输入框
    'surface-hover': NEUTRAL['150'],
    'surface-active': NEUTRAL['200'],
    border: NEUTRAL['200'],
    'border-strong': NEUTRAL['300'],
    'border-focus': '#000000', // 被 accent 覆盖
    'text-primary': NEUTRAL['1000'],
    'text-secondary': NEUTRAL['600'],
    'text-muted': NEUTRAL['500'],
    'text-disabled': NEUTRAL['400'],
    'accent': '#000000',
    'accent-strong': '#000000',
    'accent-weak': '#000000',
    'accent-border': '#000000',
    'accent-on': '#ffffff',
    danger: PRIMITIVES['red-500']!,
    'danger-weak': '#fbeaea',
    success: PRIMITIVES['green-500']!,
    warning: PRIMITIVES['amber-500']!,
    overlay: 'rgba(0, 0, 0, 0.30)',
    scrollbar: NEUTRAL['300'],
    'scrollbar-hover': NEUTRAL['400'],
  },
  dark: {
    'surface-0': NEUTRAL['1000'],
    'surface-1': NEUTRAL['950'],
    'surface-2': NEUTRAL['900'],
    'surface-3': NEUTRAL['850'],
    'surface-hover': NEUTRAL['800'],
    'surface-active': NEUTRAL['700'],
    border: NEUTRAL['800'],
    'border-strong': NEUTRAL['700'],
    'border-focus': '#ffffff',
    'text-primary': NEUTRAL['100'],
    'text-secondary': NEUTRAL['400'],
    'text-muted': NEUTRAL['500'],
    'text-disabled': NEUTRAL['600'],
    'accent': '#000000',
    'accent-strong': '#000000',
    'accent-weak': '#000000',
    'accent-border': '#000000',
    'accent-on': '#ffffff',
    danger: PRIMITIVES['red-400']!,
    'danger-weak': '#3a2226',
    success: PRIMITIVES['green-400']!,
    warning: PRIMITIVES['amber-500']!,
    overlay: 'rgba(0, 0, 0, 0.50)',
    scrollbar: NEUTRAL['700'],
    'scrollbar-hover': NEUTRAL['600'],
  },
};

/* ------------------------------------------------------------ content
 *
 * 片段类别色。极低彩度：要让三种片段在时间轴上可区分，但不跟主题色抢，
 *  也不违反「中性灰为主」的取向。
 */

export const CONTENT: Record<ThemeMode, Record<ContentKey, string>> = {
  light: {
    'clip-source-bg': '#e8ebef',
    'clip-source-border': '#b4bbc5',
    'clip-source-text': '#2b3037',
    'clip-effect-bg': '#ebe8f3',
    'clip-effect-border': '#b0a8d2',
    'clip-effect-text': '#332c4a',
    /*
     * 音频片段的底色**必须是半透明**：波形是画在 canvas.grid 上的，而那张画布
     * 在片段 DOM 的**下面**（见 grid-draw.ts 的注释）。填充不透明的话波形就被
     * 整个盖住，看起来像一段纯色块——只有片段本身变半透明时才「忽然」露出来
     * （拖动被拒时的 0.7 透明度、轨道静音时的 0.5），这正是用户报的那个现象。
     * 视频/特效片段底下的画布没有内容，保持不透明即可。
     */
    'clip-audio-bg': 'rgba(228, 238, 233, 0.42)',
    'clip-audio-border': '#a3c1b1',
    'clip-audio-text': '#25402f',
  },
  dark: {
    'clip-source-bg': '#272c34',
    'clip-source-border': '#4b535f',
    'clip-source-text': '#d8dde4',
    'clip-effect-bg': '#2b2736',
    'clip-effect-border': '#5d5480',
    'clip-effect-text': '#ded7f5',
    'clip-audio-bg': 'rgba(35, 48, 41, 0.42)',
    'clip-audio-border': '#3f6455',
    'clip-audio-text': '#cfe6da',
  },
};

/* ------------------------------------------------------------ static
 *
 * 与 mode 和品牌都无关。**刻意不含任何 shadow token**——层次感只靠
 *  surface-0→3 的纯色深度 + 1px 实线边框，这是本项目的视觉纪律。
 */

export const STATIC: Record<string, string> = {
  'radius-sm': '4px',
  'radius-md': '6px',

  'fs-xs': '10px',
  'fs-sm': '11px',
  'fs-md': '12px',
  'icon-sm': '13px',
  'icon-md': '15px',

  'row-h': `${DENSITY.rowH}px`,
  'ruler-h': `${DENSITY.rulerH}px`,
  'control-h': `${DENSITY.controlH}px`,
  'topbar-h': `${DENSITY.topbarH}px`,
  'statusbar-h': `${DENSITY.statusbarH}px`,
  'rail-w': `${DENSITY.railW}px`,
  'tl-side-w': `${DENSITY.tlSideW}px`,

  /* Ribbon。注意**没有 --ribbon-w**：宽度随容器，是实例值，不进 token。 */
  'ribbon-tab-h': `${DENSITY.ribbonTabH}px`,
  'ribbon-body-h': `${DENSITY.ribbonBodyH}px`,
  'ribbon-h': `${DENSITY.ribbonTabH + DENSITY.ribbonBodyH}px`,
  // 注意：**没有 --drawer-w**。抽屉宽度是可拖的实例值，若放进来会被每次
  // 主题重写覆盖掉用户拖出来的宽度。它走元素内联样式，默认值取 DENSITY.drawerW。

  'sp-1': '2px',
  'sp-2': '4px',
  'sp-3': '6px',
  'sp-4': '8px',
  'sp-5': '12px',
  'sp-6': '16px',

  // z 层级。数值保持原有的相对关系（selected 盖住 edge），只是给了名字。
  'z-grid': '0',
  'z-clip': '1',
  'z-edge': '2',
  'z-clip-selected': '3',
  'z-playhead': '4',
  'z-ruler': '5',
  'z-popover': '20',
  'z-menu': '100',
  'z-modal': '150',
  'z-tooltip': '200',
};

/* ------------------------------------------------------------ component
 *
 * 组件绑定。值**必须**是 SemanticKey——想直接写 '--p-neutral-900' 会编译报错。
 * 这一层随组件落地逐步补齐；已经落地的都用它，避免组件 CSS 里散落 semantic
 * 名（那样改语义时组件是隐式跟随，看不出耦合点）。
 */

export const COMPONENT: Record<string, Record<string, SemanticKey>> = {
  tip: {
    bg: 'text-primary',
    fg: 'surface-0',
    border: 'text-primary',
  },
  popover: {
    bg: 'surface-3',
    border: 'border',
  },
  menu: {
    bg: 'surface-3',
    border: 'border',
    'item-hover': 'surface-hover',
    'item-fg': 'text-primary',
    'item-fg-muted': 'text-muted',
    'item-danger': 'danger',
    separator: 'border',
  },
  input: {
    bg: 'surface-3',
    border: 'border',
    'border-hover': 'border-strong',
    fg: 'text-primary',
    placeholder: 'text-muted',
  },
  field: {
    label: 'text-secondary',
    'label-muted': 'text-muted',
  },
  btn: {
    bg: 'surface-2',
    'bg-hover': 'surface-hover',
    border: 'border',
    fg: 'text-primary',
    'fg-hover': 'text-primary',
    'ghost-fg': 'text-secondary',
    'ghost-fg-hover': 'text-primary',
    disabled: 'text-disabled',
  },
  rail: {
    bg: 'surface-1',
    border: 'border',
    fg: 'text-secondary',
    'fg-hover': 'text-primary',
    'fg-active': 'accent',
  },
  bar: {
    bg: 'surface-1',
    border: 'border',
    fg: 'text-secondary',
    'fg-strong': 'text-primary',
    accent: 'accent',
  },
  drawer: {
    bg: 'surface-1',
    border: 'border',
  },
  tl: {
    'side-bg': 'surface-2',
    border: 'border',
    'name': 'text-secondary',
    'name-muted': 'text-disabled',
    'icon-on': 'accent',
    'icon-off': 'text-muted',
    gutter: 'border',
  },
  /*
   * Ribbon 面板。视觉纪律照旧：零阴影零渐变，层次靠 surface 深度 + 1px 实线；
   * 主题色只出现在「当前 Tab」「toggle 打开态」「contextual 标记」「图库选中」——
   * 全都是「选中/激活」语义。
   */
  ribbon: {
    bg: 'surface-1',
    border: 'border',
    'tab-fg': 'text-secondary',
    'tab-fg-hover': 'text-primary',
    'tab-fg-active': 'accent',
    'group-label': 'text-muted',
    separator: 'border',
    'btn-fg': 'text-secondary',
    'btn-fg-hover': 'text-primary',
    'btn-fg-active': 'accent',
    'btn-bg-hover': 'surface-hover',
    'btn-bg-active': 'accent-weak',
    'btn-fg-disabled': 'text-disabled',
    'gallery-border': 'border',
    'gallery-sel': 'accent',
  },
};

/* ------------------------------------------------------------ 颜色工具 */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 解析 `#rgb` / `#rrggbb`（大小写与 `#` 均可省）。失败返回 null。 */
export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]!;
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number): string =>
    Math.round(clamp01(v / 255) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
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

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hh = ((h % 360) + 360) % 360 / 360;
  const ss = clamp01(s);
  const ll = clamp01(l);
  if (ss === 0) {
    const v = ll * 255;
    return { r: v, g: v, b: v };
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const hue = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return { r: hue(hh + 1 / 3) * 255, g: hue(hh) * 255, b: hue(hh - 1 / 3) * 255 };
}

/** WCAG 相对亮度。 */
export function relativeLuminance(c: { r: number; g: number; b: number }): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG 对比度（1..21）。传 hex 字符串。无法解析时返回 1。 */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------ accent 派生 */

/** 正文级对比度门槛。accent 会出现在底栏工程名、选中描边旁的文字上，
 *  所以按正文标准（4.5:1）而不是图形标准（3:1）来要求。 */
export const ACCENT_MIN_CONTRAST = 4.5;

function rampFromHsl(h: number, s: number, l: number, mode: ThemeMode): AccentRamp {
  const base = hslToRgb(h, s, l);
  const hex = toHex(base.r, base.g, base.b);

  const strong = hslToRgb(h, clamp01(s * 1.02), clamp01(mode === 'light' ? l - 0.1 : l + 0.09));
  // weak 是「选中底」这类极淡填充：亮色下提亮降饱和，暗色下压暗降饱和。
  const weak =
    mode === 'light' ? hslToRgb(h, s * 0.55, 0.955) : hslToRgb(h, s * 0.42, 0.2);

  const onWhite = contrastRatio('#ffffff', hex);
  const onInk = contrastRatio(PRIMITIVES['neutral-1000']!, hex);

  return {
    accent: hex,
    accentStrong: toHex(strong.r, strong.g, strong.b),
    accentWeak: toHex(weak.r, weak.g, weak.b),
    accentBorder: hex,
    accentOn: onWhite >= onInk ? '#ffffff' : PRIMITIVES['neutral-1000']!,
  };
}

/**
 * 任意 hex → 一条完整色阶。
 *
 * 关键行为：**按对比度钳制明度**。用户给一个亮黄当主题色，直接用会在亮色
 * 背景上糊成一片；这里保持色相与饱和度，把明度二分到刚好满足
 * ACCENT_MIN_CONTRAST 的那一档，所以「可自定义」不会产出不可用主题。
 */
export function accentRampFromHex(hex: string, mode: ThemeMode): AccentRamp {
  const rgb = parseHex(hex);
  // 解析失败不抛错：主题色是用户输入，坏值应该退化成默认紫而不是整个应用起不来。
  if (!rgb) return rampFromHsl(260, 0.75, mode === 'light' ? 0.52 : 0.68, mode);

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const surface = SEMANTIC[mode]['surface-0'];

  // 饱和度兜底：全灰的输入也能出一条合法的 ramp（退化为灰阶强调色）。
  const sat = Math.max(s, 0.28);
  const hexAt = (ll: number): string => {
    const c = hslToRgb(h, sat, ll);
    return toHex(c.r, c.g, c.b);
  };

  const ok = (ll: number): boolean => contrastRatio(hexAt(ll), surface) >= ACCENT_MIN_CONTRAST;

  const target = mode === 'light' ? -1 : 1; // 亮色要更暗，暗色要更亮
  let lo = mode === 'light' ? 0 : l;
  let hi = mode === 'light' ? l : 1;
  let best = l;

  if (ok(l)) {
    best = l;
  } else {
    // 二分找一个刚好达标的明度；找不到就用端点（已是最有利的一侧）。
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) {
        best = mid;
        if (target < 0) lo = mid;
        else hi = mid;
      } else if (target < 0) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    if (!ok(best)) best = target < 0 ? 0 : 1;
  }

  return rampFromHsl(h, sat, best, mode);
}

export function accentRampOf(src: AccentSource, mode: ThemeMode): AccentRamp {
  if (src.kind === 'custom') return accentRampFromHex(src.hex, mode);
  return accentRampFromHex(ACCENT_PRESETS[src.id].hex, mode);
}

/* ------------------------------------------------------------ 解析 */

/** accent 组的 token 名。换品牌时**只应**这几个键变化——有单测钉住这条。
 *  `border-focus` 也在内，因为焦点环就是主题色，它是派生值不是独立语义。 */
export const ACCENT_TOKEN_KEYS = [
  'accent',
  'accent-strong',
  'accent-weak',
  'accent-border',
  'accent-on',
  'border-focus',
] as const;

function flatten(
  records: Record<string, string>[],
  out: Record<string, string>,
): Record<string, string> {
  for (const rec of records) {
    for (const [k, v] of Object.entries(rec)) out[`--${k}`] = v;
  }
  return out;
}

/** 全量扁平化：`resolveTokens(spec)` → `{ '--surface-0': '#ffffff', ... }`。 */
export function resolveTokens(spec: ThemeSpec): Record<string, string> {
  const ramp = accentRampOf(spec.accent, spec.mode);

  const semantic: Record<string, string> = { ...SEMANTIC[spec.mode] };
  semantic['accent'] = ramp.accent;
  semantic['accent-strong'] = ramp.accentStrong;
  semantic['accent-weak'] = ramp.accentWeak;
  semantic['accent-border'] = ramp.accentBorder;
  semantic['accent-on'] = ramp.accentOn;
  semantic['border-focus'] = ramp.accent;

  // component 层在这里解析成具体值——组件 CSS 拿到的是最终色，
  // 但耦合点仍然只有一处，且被类型锁在 semantic 上。
  const component: Record<string, string> = {};
  for (const [group, vars] of Object.entries(COMPONENT)) {
    for (const [name, key] of Object.entries(vars)) {
      const v = semantic[key];
      if (v !== undefined) component[`${group}-${name}`] = v;
    }
  }

  return flatten(
    [STATIC, semantic, CONTENT[spec.mode], component],
    {} as Record<string, string>,
  ) as Record<string, string>;
}

/* ------------------------------------------------------------ Canvas 调色板
 *
 * 时间轴 Canvas2D 的唯一颜色来源。网格线这类需要 alpha 的颜色没法直接复用
 * 不透明 token，所以在这里显式给成 rgba 字符串——但**只在这里给一次**。
 */

export interface CanvasPalette {
  rulerBg: string;
  rulerText: string;
  barLine: string;
  beatLine: string;
  gridBg: string;
  rowVisual: string;
  rowAudio: string;
  rowLine: string;
  waveBody: string;
  waveCenter: string;
  originLine: string;
}

/** 把不透明的 hex 套上 alpha，得到 Canvas 可用的 rgba 字符串。 */
export function withAlpha(hex: string, alpha: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}

export function canvasPalette(spec: ThemeSpec): CanvasPalette {
  const t = resolveTokens(spec);
  const light = spec.mode === 'light';
  // 时间轴底比 body 略深/略浅一档，让轨道区在视觉上「沉」下去。
  const gridBg = light ? t['--surface-0']! : t['--surface-1']!;

  return {
    rulerBg: light ? t['--surface-1']! : t['--surface-2']!,
    rulerText: t['--text-muted']!,
    // 拍线淡、小节线显著——读格靠这个层级，不靠颜色。
    barLine: withAlpha(t['--text-primary']!, light ? 0.26 : 0.24),
    beatLine: withAlpha(t['--text-primary']!, light ? 0.09 : 0.07),
    gridBg,
    rowVisual: withAlpha(t['--text-primary']!, light ? 0.022 : 0.05),
    rowAudio: withAlpha(t['--text-primary']!, light ? 0.05 : 0.09),
    rowLine: withAlpha(t['--text-primary']!, light ? 0.14 : 0.16),
    // 波形要能透过音频片段的半透明底色读出来，所以比网格线明显得多
    waveBody: withAlpha(t['--text-primary']!, light ? 0.62 : 0.68),
    waveCenter: withAlpha(t['--text-primary']!, light ? 0.2 : 0.22),
    // 工程起点线用主题色：它是「当前位置」类标记，与播放头同类，
    // 属于本设计里允许动用主题色的少数场景之一。
    originLine: withAlpha(t['--accent']!, 0.85),
  };
}
