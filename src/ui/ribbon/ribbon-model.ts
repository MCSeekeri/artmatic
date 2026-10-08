/**
 * ribbon-model.ts — Ribbon 的描述模型与纯函数（**不碰 DOM**）。
 *
 * 核心解耦：Tab 是**数据**（`RibbonTabDef[]`），Ribbon 组件不认识
 * `TypographyDocument`，也不认识任何业务动作。编辑器负责把「文档 + 选择集」
 * 编译成描述数组。于是换文档模型、加新 Tab，Ribbon 一行都不用动。
 *
 * 关于「装不下怎么办」：**用一条细的横向滚动条**，不做溢出按钮。
 * 曾经做过「更多」popover 的版本，两个问题：① 它开在 `.ribbon-body` 里，
 * 而那个容器为了固定高度必须裁剪，于是弹层根本看不见（用户反馈「更多按钮
 * 没有用」）；② 藏起来的按钮等于功能消失。Office 的做法就是横向滚动，
 * 照做。
 */

import { DENSITY } from '../tokens';
import type { IconName } from '../icons';

export interface RibbonItemBase {
  id: string;
  label: string;
  testid?: string;
  disabled?: boolean;
  /** 按钮尺寸档。不传则按 kind 推断（select / number 偏 large）。 */
  size?: 'large' | 'small';
  /** 布局宽度（px）。不传则按 kind 与 size 推断。 */
  width?: number;
}

export interface RibbonButtonSpec extends RibbonItemBase {
  kind: 'button';
  icon: IconName;
  onselect: () => void;
}

export interface RibbonToggleSpec extends RibbonItemBase {
  kind: 'toggle';
  icon: IconName;
  active: boolean;
  onchange: (active: boolean) => void;
}

export interface RibbonSelectSpec extends RibbonItemBase {
  kind: 'select';
  icon?: IconName;
  value: string;
  options: { value: string; label: string }[];
  onchange: (value: string) => void;
  /** 选项 testid 前缀，实际为 `${prefix}-${value}`。 */
  optionTestidPrefix?: string;
  /** 弹层最小宽度。 */
  minWidth?: number;
  /**
   * 可编辑：触发区变成一个输入框，可以直接打字（PPT 的字号就是这样：
   * 能直接输数，也能点箭头选预设）。数值型控件用 `numeric: true`
   * 让「输入的值不在选项里」也能通过（字号允许 37 这种预设之外的值）。
   */
  editable?: boolean;
  /** editable 时：输入非预设值也按数字提交。 */
  numeric?: boolean;
}

/** 数值输入的可选实时预览回调（详见 NumberInput 的 `oninput` / `onliveend`）。 */
export interface RibbonLiveHooks {
  /** 拖动过程中的实时值。 */
  oninput?: (value: number) => void;
  /** 拖动结束（含 Esc 取消）。 */
  onliveend?: () => void;
}

export interface RibbonColorSpec extends RibbonItemBase {
  kind: 'color';
  icon?: IconName;
  value: string;
  onchange: (value: string) => void;
}

/**
 * 分段控件（互斥的二选一 / 三选一）。
 * 用在「对齐到：画布 | 选区」这类地方 —— 下拉太重，两个并排的按钮刚好。
 */
export interface RibbonSegmentSpec extends RibbonItemBase {
  kind: 'segment';
  value: string;
  options: { value: string; label: string }[];
  onchange: (value: string) => void;
}

/**
 * 数值输入（字距 / 行高 / 描边宽度）。
 * 复用 controls 的 NumberInput：白拿拖拽调值、Pointer Lock、方向键、Esc 取消。
 */
export interface RibbonNumberSpec extends RibbonItemBase, RibbonLiveHooks {
  kind: 'number';
  value: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  suffix?: string;
  onchange: (value: number) => void;
}

/** 「预览图面板」里的一张卡。 */
export interface GalleryCard {
  id: string;
  label: string;
  /** 预览用的 SVG path 的 `d`，坐标系是 `viewBox`。 */
  d: string;
  viewBox: string;
  /** 带洞的图形（圆环 / 方框）要 evenodd。 */
  evenOdd?: boolean;
  /**
   * 这个图形**没有面积**，只能描边（目前只有直线一条线段）。
   *
   * 其余一律实心填充。描边在这里有两个叠加的毛病：
   *  ① 线宽是**屏幕**像素（`non-scaling-stroke`），卡片只有 34px ⇒ 看着像
   *     一圈极粗的框；
   *  ② 图形顶点本来就在 viewBox 的边界上，线宽的一半落在框外被裁掉 ——
   *     多边形的尖角看起来是平的（八边形、菱形、扇形都中招）。
   */
  outline?: boolean;
}

/**
 * 预览图面板（插入形状用）。
 *
 * 与 `select` 的区别是**每项自带一张图**：形状靠名字挑不出来，必须看见。
 * 也不用文字说明 —— 图本身就是说明（用户原话：「预览 icon 直接使用形状本身，
 * 不需要文字说明」）。`label` 只留作 tooltip / 无障碍名。
 */
export interface RibbonGallerySpec extends RibbonItemBase {
  kind: 'gallery';
  icon?: IconName;
  cards: GalleryCard[];
  columns?: number;
  onselect: (id: string) => void;
}

export type RibbonItemSpec =
  | RibbonButtonSpec
  | RibbonToggleSpec
  | RibbonSelectSpec
  | RibbonColorSpec
  | RibbonSegmentSpec
  | RibbonNumberSpec
  | RibbonGallerySpec;

export interface RibbonGroupDef {
  id: string;
  /** 组底标签（PPT 风格：字体 / 段落 / 对齐 / 层级…）。 */
  label: string;
  /**
   * 组内排布。
   *
   * `'grid'` 用于**整组都是小按钮**的场合（对齐、垂直对齐、层级）：
   * 一字排开时那一行只有 20 多个像素高却横着占掉两三百像素，
   * 改成两行之后同样多的按钮只占一半宽度，省下的横向空间留给真正需要宽度的组
   * （字体、字号、下拉）。列的条数由 Ribbon 按 `ceil(项数 / 2)` 推出来。
   */
  layout?: 'row' | 'grid';
  items: RibbonItemSpec[];
}

export interface RibbonTabDef {
  id: string;
  label: string;
  /** true = 只在选中了对应类型的元素时才出现的 Tab。 */
  contextual?: boolean;
  order: number;
  groups: RibbonGroupDef[];
}

/* ------------------------------------------------------------ 布局常量
 *
 * 这些宽度不只是给 CSS 用的，也是「一个组占多宽」的唯一口径。
 * 值与 RibbonItem.svelte 里的 CSS 变量一一对应，改一处要改两处 ——
 * 所以两边都从这里取（CSS 变量由组件内联设置）。
 */
export const DEFAULT_ITEM_W = DENSITY.ribbonBtnW;
export const SMALL_ITEM_W = DENSITY.ribbonBtnSmallW;
export const SELECT_ITEM_W = 108;
export const COLOR_ITEM_W = DEFAULT_ITEM_W;
export const NUMBER_ITEM_W = 88;
/** 分段控件按选项数计费：每项 34px。 */
export const SEGMENT_OPTION_W = 34;

export function itemWidth(item: RibbonItemSpec): number {
  if (item.width !== undefined) return item.width;
  switch (item.kind) {
    case 'select':
      return SELECT_ITEM_W;
    case 'color':
      return COLOR_ITEM_W;
    case 'segment':
      return item.options.length * SEGMENT_OPTION_W;
    case 'number':
      return NUMBER_ITEM_W;
    case 'gallery':
      return item.size === 'small' ? SMALL_ITEM_W : DEFAULT_ITEM_W;
    case 'toggle':
    case 'button':
      return item.size === 'small' ? SMALL_ITEM_W : DEFAULT_ITEM_W;
  }
}

/* ------------------------------------------------------------ Contextual */

export interface TabResolution {
  visible: RibbonTabDef[];
  /** 当前应当激活的 Tab（原 activeId 若已不可见则回落）。 */
  activeId: string;
}

/**
 * 决定「哪些 Tab 可见、哪个是当前 Tab」。
 *
 * 回落的必要性：选中图形时会出现「图形格式」Tab，取消选择后它必须消失 ——
 * 如果它当时正被激活，activeId 就指向了一个不存在的 Tab，界面会白屏。
 * 回落目标一律是**第一个非 contextual Tab**（「开始」），而不是「上一个」——
 * 后者在连续切换时会让用户失去方位感。
 */
export function resolveVisibleTabs(
  tabs: RibbonTabDef[],
  contextualActive: ReadonlySet<string>,
  activeId: string,
): TabResolution {
  const visible = tabs
    .filter((t) => !t.contextual || contextualActive.has(t.id))
    .sort((a, b) => a.order - b.order);

  const stillThere = visible.some((t) => t.id === activeId);
  const fallback = visible.find((t) => !t.contextual)?.id ?? visible[0]?.id ?? '';
  return { visible, activeId: stillThere ? activeId : fallback };
}

/** 由选择集推出应当出现的 contextual Tab。 */
export function contextualTabIds(
  selection: readonly { kind: string }[],
  opts: { soleGroup?: boolean } = {},
): Set<string> {
  const out = new Set<string>();
  if (selection.some((e) => e.kind === 'shape')) out.add('shape-format');
  if (selection.some((e) => e.kind === 'image')) out.add('image-format');
  // 组合格式是**排他**的：整组选中时给的是组自己的外观，
  // 此时再并列一个「图形格式」会让人分不清改的到底是组还是组里的图。
  if (opts.soleGroup) {
    out.clear();
    out.add('group-format');
  }
  return out;
}
