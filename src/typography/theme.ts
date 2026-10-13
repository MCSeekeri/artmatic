/**
 * theme.ts — 排版片段的**配色方案**（纯数据 + 纯函数，不碰 DOM、可单测）。
 *
 * ## 是什么
 *
 * 一个配色方案 = 10 个**槽位**色（Office 主题色的可见部分）。取色卡里的
 * 「主题颜色」网格就是这 10 列 × 6 行：
 *
 *      第一行 = 原色槽（lt1 白 / dk1 黑 / lt2 / dk2 / accent1..6）
 *      下面 5 行 = 每个槽位的 5 个明暗变体
 *
 * 槽位顺序与 Office 取色卡**逐列一致**（白、黑、浅色 2、深色 2、强调色 1..6），
 * 这个顺序是用户的位置记忆，不能改。
 *
 * ## 颜色是「引用」而不是值
 *
 * 文档里存的颜色可以是 `@accent1`（或带变体的 `@accent1.l80`）。这样换配色方案
 * 时，**用了配色的元素自动跟着变**（Office 的招牌功能），而用户从「标准色 /
 * 最近使用 / 其他颜色」里挑的那些是裸 hex，**不跟着变** —— 这正是
 * 「仅限于那些使用了配色方案颜色的元素」的实现方式。
 *
 * 一切消费颜色的地方都要过 `resolveThemeColor()`（css.ts / render-dom.ts
 * 是仅有的两个渲染出口）。漏掉一处的表现是「换方案后舞台上变了、导出没变」。
 *
 * ## 变体算法（实测标定，不是拍脑袋）
 *
 * `scripts/extract-theme-colors.mjs` 从 Office 取色卡截图里逐格采样反解，
 * 结论分三支 —— 三条都有实测支撑：
 *
 *  1. **常规色（dk2 + 6 个强调色）**：保持 H/S 不动，只按 OOXML 的
 *     `lumMod/lumOff` 语义改亮度（Lighter 80/60/40%、Darker 25/50%）。
 *     实测 7 列 × 5 行与预测的**逐通道误差 ≤ 1**（只有截图量化噪声），
 *     色相漂移 ≤ 6°、饱和度漂移 ≤ 0.02 ⇒ **没有额外的饱和度补偿**。
 *     例：`#c830cc` 的 5 个变体预测值与实测**完全相等**。
 *  2. **端点（纯白 lt1 / 纯黑 dk1）**：`lumMod` 在这里完全退化（白恒白、
 *     黑恒黑，5 格会画成同一个颜色），Office 改用固定灰阶阶梯 ——
 *     白列向黑混 5/15/25/35/50%，黑列向白混 50/35/25/15/5%。
 *     实测：#f2f2f2 / #d8d8d8 / #bfbfbf / #a5a5a5 / #7f7f7f 与
 *     #7f7f7f / #595959 / #3f3f3f / #262626 / #0c0c0c。
 *  3. **极亮色（浅色槽 lt2 这类，l > 0.75）**：`lumMod` 会把前三个变体
 *     全挤在纯白附近（#d8d9dc → #f7f7f8 / #eff0f1 / #e8e8ea，肉眼分不出），
 *     实测用的是「亮度乘 0.9 / 0.75 / 0.5 / 0.25 / 0.1」的阶梯。
 *
 * 网格的明度是**自上而下递减**的（第 2 行最亮、第 6 行最暗），三支规则都
 * 满足这条：它才是「一眼看出这是一个调色板」的原因。
 */

import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl, type Rgb } from '../core/color';
import type { MessageKey } from '../i18n/locales';

/* ------------------------------------------------------------ 槽位 */

/**
 * 槽位 id。顺序**就是取色卡网格的列序**（Office 的位置记忆），不要重排 ——
 * `paletteGrid()` 与面板都直接按这个数组渲染。
 */
export const THEME_SLOTS = [
  'lt1',
  'dk1',
  'lt2',
  'dk2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
] as const;

export type ThemeSlot = (typeof THEME_SLOTS)[number];

/** 槽位的无障碍名（取色卡格子的 tooltip）。 */
export const THEME_SLOT_LABEL: Record<ThemeSlot, MessageKey> = {
  lt1: 'rib.slot.lt1',
  dk1: 'rib.slot.dk1',
  lt2: 'rib.slot.lt2',
  dk2: 'rib.slot.dk2',
  accent1: 'rib.slot.accent1',
  accent2: 'rib.slot.accent2',
  accent3: 'rib.slot.accent3',
  accent4: 'rib.slot.accent4',
  accent5: 'rib.slot.accent5',
  accent6: 'rib.slot.accent6',
};

/* ------------------------------------------------------------ 明暗变体 */

export type ShadeId = 'l80' | 'l60' | 'l40' | 'd25' | 'd50';

/** 网格从上到下的 5 个变体行（越往下越暗）。 */
export const SHADE_IDS: readonly ShadeId[] = ['l80', 'l60', 'l40', 'd25', 'd50'];

/** 变体行的名字（tooltip / 菜单文案）。 */
export const SHADE_LABEL: Record<ShadeId, MessageKey> = {
  l80: 'rib.shade.l80',
  l60: 'rib.shade.l60',
  l40: 'rib.shade.l40',
  d25: 'rib.shade.d25',
  d50: 'rib.shade.d50',
};

/** OOXML 语义：Lighter 80/60/40% 是 `lumMod/lumOff`，Darker 25/50% 是纯 `lumMod`。 */
const LUM_MOD: Record<ShadeId, (l: number) => number> = {
  l80: (l) => l * 0.2 + 0.8,
  l60: (l) => l * 0.4 + 0.6,
  l40: (l) => l * 0.6 + 0.4,
  d25: (l) => l * 0.75,
  d50: (l) => l * 0.5,
};

/** 近白列的 5 个变体：向黑混合的比例（实测）。 */
const LIGHT_MIX: readonly number[] = [0.05, 0.15, 0.25, 0.35, 0.5];
/** 近黑列的 5 个变体：向白混合的比例（实测）。 */
const DARK_MIX: readonly number[] = [0.5, 0.35, 0.25, 0.15, 0.05];
/** 极亮色的 5 个变体：亮度乘数（实测）。 */
const PALE_FACTOR: readonly number[] = [0.9, 0.75, 0.5, 0.25, 0.1];

/** 「接近端点」的判据：`lumMod` 在这个范围内会退化到画不出层次。 */
const NEAR_WHITE = 0.97;
const NEAR_BLACK = 0.03;
/** 「极亮」的判据：`lumMod` 的 l80 会落到 0.95 以上（与纯白区分不开）。 */
const PALE = 0.75;

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

/**
 * 端点列的混合用**截断**而不是四舍五入。
 *
 * 实测数据支持这一点：255×95% = 242.25 → 实测 242、255×85% = 216.75 →
 * 实测 216、255×65% = 165.75 → 实测 165 —— 三个都是「截断」而不是「就近」。
 * （Office 那边大概是整数除法。）取色卡的每一格都是肉眼比对的，能逐位对上
 * 就没有理由留 1 的偏差。
 */
function mixTrunc(from: Rgb, toward: Rgb, t: number): Rgb {
  return {
    r: Math.floor(from.r + (toward.r - from.r) * t),
    g: Math.floor(from.g + (toward.g - from.g) * t),
    b: Math.floor(from.b + (toward.b - from.b) * t),
  };
}

/**
 * 一个槽位色的第 i 个明暗变体。非 hex 输入原样返回（坏值不该让渲染炸掉）。
 *
 * 三支规则的判据与实测依据见文件头。分支顺序有意义：**端点优先于极亮**，
 * 否则纯白会走「乘 0.9」得到 #e6e6e6，而实测是 #f2f2f2（向黑混 5%）。
 */
export function shadeColor(hex: string, shade: ShadeId): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  const i = Math.max(0, SHADE_IDS.indexOf(shade));

  if (hsl.l >= NEAR_WHITE) return rgbToHex(mixTrunc(rgb, BLACK, LIGHT_MIX[i]!));
  if (hsl.l <= NEAR_BLACK) return rgbToHex(mixTrunc(rgb, WHITE, DARK_MIX[i]!));
  if (hsl.l > PALE) return rgbToHex(hslToRgb(hsl.h, hsl.s, hsl.l * PALE_FACTOR[i]!));
  return rgbToHex(hslToRgb(hsl.h, hsl.s, LUM_MOD[shade](hsl.l)));
}

/* ------------------------------------------------------------ 配色方案数据
 *
 * 8 个可变槽（dk2 / lt2 / accent1..6）的色值**全部来自
 * `scripts/extract-theme-colors.mjs schemes <截图>` 的采样**，不是手抄 ——
 * 手抄一个 hex 错一位看不出来，而它会一路错到导出。
 *
 * 抽样验证（与公开的 Office 主题 XML 完全一致，说明采样可信）：
 *   office-2013  #44546a #e7e6e6 #4472c4 #ed7d31 #a5a5a5 #ffc000 #5b9bd5 #70ad47
 *   office-2007  #1f497d #eeece1 #4f81bd #c0504d #9bbb59 #8064a2 #4bacc6 #f79646
 *
 * `lt1` / `dk1` 所有内置方案都是纯白 / 纯黑（Office 的约定），所以不逐个写。
 */

export interface TypographyTheme {
  id: string;
  labelKey: MessageKey;
  colors: Record<ThemeSlot, string>;
}

/** [id, 名称, dk2, lt2, accent1..6] */
const RAW_THEMES: readonly (readonly string[])[] = [
  ['office', 'rib.theme.office', '#0e2841', '#e8e8e8', '#156082', '#e97132', '#196b24', '#0f9ed5', '#a02b93', '#4ea72e'],
  ['office-2013', 'rib.theme.office2013', '#44546a', '#e7e6e6', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'],
  ['office-2007', 'rib.theme.office2007', '#1f497d', '#eeece1', '#4f81bd', '#c0504d', '#9bbb59', '#8064a2', '#4bacc6', '#f79646'],
  ['grayscale', 'rib.theme.grayscale', '#000000', '#f8f8f8', '#dddddd', '#b2b2b2', '#969696', '#808080', '#5f5f5f', '#4d4d4d'],
  ['blue-warm', 'rib.theme.blueWarm', '#242852', '#accbf9', '#4a66ac', '#629dd1', '#297fd5', '#7f8fa9', '#5aa2ae', '#9d90a0'],
  ['blue', 'rib.theme.blue', '#17406d', '#dbeff9', '#0f6fc6', '#009dd9', '#0bd0d9', '#10cf9b', '#7cca62', '#a5c249'],
  ['blue-ii', 'rib.theme.blueII', '#335b74', '#dfe3e5', '#1cade4', '#2683c6', '#27ced7', '#42ba97', '#3e8853', '#62a39f'],
  ['blue-green', 'rib.theme.blueGreen', '#373545', '#cedbe6', '#3494ba', '#58b6c0', '#75bda7', '#7a8c8e', '#84acb6', '#2683c6'],
  ['green', 'rib.theme.green', '#455f51', '#e3ded1', '#549e39', '#8ab833', '#c0cf3a', '#029676', '#4ab5c4', '#0989b1'],
  ['yellow-green', 'rib.theme.yellowGreen', '#455f51', '#e2dfcc', '#99cb38', '#63a537', '#37a76f', '#44c1a3', '#4eb3cf', '#51c3f9'],
  ['yellow', 'rib.theme.yellow', '#39302a', '#e5dedb', '#ffca08', '#f8931d', '#ce8d3e', '#ec7016', '#e64823', '#9c6a6a'],
  ['yellow-orange', 'rib.theme.yellowOrange', '#4e3b30', '#fbeec9', '#f0a22e', '#a5644e', '#b58b80', '#c3986d', '#a19574', '#c17529'],
  ['orange', 'rib.theme.orange', '#637052', '#ccddea', '#e48312', '#bd582c', '#865640', '#9b8357', '#c2bc80', '#94a088'],
  ['orange-red', 'rib.theme.orangeRed', '#696464', '#e9e5dc', '#d34817', '#9b2d1f', '#a28e6a', '#956251', '#918485', '#855d5d'],
  ['red-orange', 'rib.theme.redOrange', '#505046', '#eeece1', '#e84c22', '#ffbd47', '#b64926', '#ff8427', '#cc9900', '#b22600'],
  ['red', 'rib.theme.red', '#323232', '#e5c243', '#a5300f', '#d55816', '#e19825', '#b19c7d', '#7f5f52', '#b27d49'],
  ['magenta', 'rib.theme.magenta', '#454551', '#d8d9dc', '#e32d91', '#c830cc', '#4ea6dc', '#4775e7', '#8971e1', '#d54773'],
  ['violet', 'rib.theme.violet', '#373545', '#dcd8dc', '#ad84c6', '#8784c7', '#5d739a', '#6997af', '#84acb6', '#6f8183'],
  ['violet-ii', 'rib.theme.violetII', '#632e62', '#eae5eb', '#92278f', '#9b57d3', '#755dd9', '#665eb8', '#45a5ed', '#5982db'],
  ['median', 'rib.theme.median', '#775f55', '#ebddc3', '#94b6d2', '#dd8047', '#a5ab81', '#d8b25c', '#7ba79d', '#968c8c'],
  ['paper', 'rib.theme.paper', '#444d26', '#fefac9', '#a5b592', '#f3a447', '#e7bc29', '#d092a7', '#9c85c0', '#809ec2'],
  ['caption', 'rib.theme.caption', '#5e5e5e', '#dddddd', '#418ab3', '#a6b727', '#f69200', '#838383', '#fec306', '#df5327'],
  ['slipstream', 'rib.theme.slipstream', '#212745', '#b4dcfa', '#4e67c8', '#5eccf3', '#a7ea52', '#5dceaf', '#ff8021', '#f14124'],
];

/** 纯白 / 纯黑是所有内置方案共有的两个端点槽。 */
const LT1 = '#ffffff';
const DK1 = '#000000';

export const BUILTIN_THEMES: readonly TypographyTheme[] = RAW_THEMES.map((row) => ({
  id: row[0]!,
  labelKey: row[1]! as MessageKey,
  colors: {
    lt1: LT1,
    dk1: DK1,
    lt2: row[3]!,
    dk2: row[2]!,
    accent1: row[4]!,
    accent2: row[5]!,
    accent3: row[6]!,
    accent4: row[7]!,
    accent5: row[8]!,
    accent6: row[9]!,
  },
}));

export const DEFAULT_THEME_ID = 'office';

const THEME_BY_ID = new Map(BUILTIN_THEMES.map((t) => [t.id, t]));

/** 按 id 取方案。未知 / 缺省一律回落默认方案 —— **绝不抛错**（老工程、坏数据都要能打开）。 */
export function themeById(id: string | null | undefined): TypographyTheme {
  return (id ? THEME_BY_ID.get(id) : undefined) ?? THEME_BY_ID.get(DEFAULT_THEME_ID)!;
}

/** 方案是否内置（数据表里没有的 id 是坏数据，检查器会据此提示）。 */
export function isKnownTheme(id: string): boolean {
  return THEME_BY_ID.has(id);
}

/* ------------------------------------------------------------ 颜色引用 */

const REF_PREFIX = '@';

/** `@accent1` / `@accent1.l80`。 */
export function themeRef(slot: ThemeSlot, shade?: ShadeId | null): string {
  return `${REF_PREFIX}${slot}${shade ? `.${shade}` : ''}`;
}

/**
 * 解析颜色引用。不是引用（裸 hex / rgb() / 命名色）返回 null。
 *
 * **严格**：槽位与变体都必须在白名单里。宽松解析会让 `@foo` 这种手改坏的
 * 值静默变成一个「看起来像颜色但渲染不出来」的东西，那是更难查的坏法。
 */
export function parseThemeRef(color: string): { slot: ThemeSlot; shade: ShadeId | null } | null {
  if (typeof color !== 'string' || !color.startsWith(REF_PREFIX)) return null;
  const body = color.slice(REF_PREFIX.length);
  const dot = body.indexOf('.');
  const slot = (dot < 0 ? body : body.slice(0, dot)) as ThemeSlot;
  if (!(THEME_SLOTS as readonly string[]).includes(slot)) return null;
  if (dot < 0) return { slot, shade: null };
  const shade = body.slice(dot + 1) as ShadeId;
  if (!(SHADE_IDS as readonly string[]).includes(shade)) return null;
  return { slot, shade };
}

export function isThemeRef(color: string): boolean {
  return parseThemeRef(color) !== null;
}

/**
 * 颜色 → 真实 hex。**渲染路径上一切颜色的唯一出口**。
 *
 * 不是引用就原样返回（可能是 `rgb()` / 命名色 / 已有 hex），所以这个函数
 * 可以无脑包在任何颜色外面。`theme` 可以给 id、给方案对象、或什么都不给
 * （缺省 = 默认方案），后两种写法让 css.ts 的调用点不必每次都查表。
 */
export function resolveThemeColor(
  color: string,
  theme?: TypographyTheme | string | null,
): string {
  const ref = parseThemeRef(color);
  if (!ref) return color;
  const t = typeof theme === 'object' && theme !== null ? theme : themeById(theme);
  const base = t.colors[ref.slot];
  return ref.shade ? shadeColor(base, ref.shade) : base;
}

/* ------------------------------------------------------------ 取色卡数据 */

export interface PaletteGrid {
  /** 10 个槽位（列序 = THEME_SLOTS）。 */
  slots: readonly ThemeSlot[];
  /** 第一行：原色槽的色值。 */
  base: string[];
  /** 后 5 行：变体，行序 = SHADE_IDS。 */
  variants: string[][];
  /** 每列的槽位引用（点击后写进文档的值）。 */
  refs: string[];
}

/**
 * 取色卡「主题颜色」网格的**全部数据**（10 列 × 6 行）。
 *
 * 放纯函数里而不是组件里：网格是配色方案的函数，与渲染无关，这样它能被
 * 单测钉住（「第一行必须是原色」「第二行必须比第一行亮」）。
 */
export function paletteGrid(theme: TypographyTheme): PaletteGrid {
  const base = THEME_SLOTS.map((s) => theme.colors[s]);
  return {
    slots: THEME_SLOTS,
    base,
    variants: SHADE_IDS.map((shade) => base.map((c) => shadeColor(c, shade))),
    refs: THEME_SLOTS.map((s) => themeRef(s)),
  };
}

/**
 * 「标准色」—— 与配色方案无关的 10 个固定色（Office 的标准色板）。
 * 值是实测采样（`extract-theme-colors.mjs probe ... --row 500`）。
 */
export const STANDARD_COLORS: readonly string[] = [
  '#c00000',
  '#ff0000',
  '#ffc000',
  '#ffff00',
  '#92d050',
  '#00b050',
  '#00b0f0',
  '#0070c0',
  '#002060',
  '#7030a0',
];

/** 文档里用到的方案 id 列表（「设计」面板的图库按它高亮当前项）。 */
export function themeIds(): string[] {
  return BUILTIN_THEMES.map((t) => t.id);
}
