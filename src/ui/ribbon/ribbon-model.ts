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
import type { SelectOption } from '../controls/select-model';

/**
 * 按钮尺寸档。
 *
 *  - `large`：icon 在上、文字在下（50×56）。给「一眼要认得出来」的主按钮。
 *  - `small`：icon + 短文字横排（32×24）。
 *  - `icon`：**纯图标**（26×24），只有 tooltip 说明它是什么。
 *
 * `icon` 这一档是 Office 字体区那种密集布局的前提：第二排十来个字形格式
 * 按钮，每个都带文字的话光这一组就能吃掉整条 Ribbon —— 而 B / I / U / S
 * 这些符号本身就是写法，配文字反而是噪声。
 */
export type RibbonItemSize = 'large' | 'small' | 'icon';

export interface RibbonItemBase {
  id: string;
  label: string;
  /**
   * 控件下方那行小字不渲染，`label` 只留作无障碍名。
   *
   * 给「控件自己已经说清了」的场合用：字体下拉里显示的就是字体名、字号框里
   * 显示的就是字号，各配一行「字体」「字号」纯属噪声（这些控件的宽度也因此
   * 不必再为小字留白）。只有 `select` / `number` / `segment` 渲染小字，
   * 其余 kind 本来就是拿 `label` 当 tooltip，传了也是空操作。
   */
  hideLabel?: boolean;
  testid?: string;
  disabled?: boolean;
  /** 按钮尺寸档。不传则按 kind 推断（select / number 偏 large）。 */
  size?: RibbonItemSize;
  /**
   * 布局宽度（px）。不传则按 kind 与 size 推断。
   *
   * 对 `button` 也生效（下发成 `--ribbon-btn-w`）：长标签在默认 50px 里会被
   * `text-overflow: ellipsis` 截断，给一个显式宽度是唯一的出路。
   * **预算与渲染同源**：这个值既进 `itemWidth()` 又进按钮自己的 CSS。
   */
  width?: number;
}

export interface RibbonButtonSpec extends RibbonItemBase {
  kind: 'button';
  icon: IconName;
  onselect: () => void;
  /**
   * 双击（在第一下之后的 `click` 之后触发）。
   *
   * 只给「双击 = 另一种模式」的按钮用 —— 目前只有格式刷 / 动画刷：单击刷一次、
   * 双击连续刷。按钮的常规语义仍然是单击，别把主操作挪到双击上。
   */
  ondblclick?: () => void;
}

export interface RibbonToggleSpec extends RibbonItemBase {
  kind: 'toggle';
  icon: IconName;
  active: boolean;
  onchange: (active: boolean) => void;
  /** 见 `RibbonButtonSpec.ondblclick`。 */
  ondblclick?: () => void;
}

export interface RibbonSelectSpec extends RibbonItemBase {
  kind: 'select';
  icon?: IconName;
  value: string;
  /** 与 `Select` 同一份选项类型：`fontFamily` 让字体下拉用族自己的字体画名字。 */
  options: SelectOption<string>[];
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
  /** 弹层顶部加一个筛选输入框（选项上百时必需，如字体）。 */
  filterable?: boolean;
  /** 筛选框的占位/无障碍名。 */
  filterPlaceholder?: string;
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
  /**
   * 当前文档的配色方案 id（取色卡的「主题颜色」网格的数据源）。
   *
   * 由 `ribbon-defs` 从文档上取 —— Ribbon 组件不认识 TypographyDocument，
   * 所以这里必须是**已经查好的值**，不能是「自己去文档里拿」的回调。
   */
  themeId?: string;
  /** 允许「无颜色」（高亮这类可以没有的颜色）。 */
  allowNone?: boolean;
  /** 当前值就是某个主题色时的显示形态由它决定（见 RibbonColor）。 */
  onchange: (value: string) => void;
}

/** 下拉菜单里的一项。 */
export interface RibbonMenuItemSpec {
  id: string;
  label: string;
  icon?: IconName;
  /** 当前生效项（打勾）。 */
  active?: boolean;
  disabled?: boolean;
  onselect: () => void;
}

/**
 * 带下拉的图标按钮（大小写转换、字符间距这类「点开是一组选项」的控件）。
 *
 * 与 `select` 的分工：那个是**显示当前值**的下拉（宽度大、要放得下文本），
 * 这个是**纯图标 + 一次性动作**（选项之间是并列的动作，不是同一个值的状态）。
 * 用 select 表达「全部大写 / 全部小写」会得到一个宽度随选项名变化的按钮 ——
 * 那不是 Office 的形态，也不稳定。
 */
export interface RibbonMenuSpec extends RibbonItemBase {
  kind: 'menu';
  icon: IconName;
  items: RibbonMenuItemSpec[];
  /**
   * 弹层底部的数值输入（字符间距的「自定义」）。
   *
   * 放在菜单底部而不是另开一个控件：预设与自定义是同一个属性的两种调法，
   * 分开摆会让人以为它们是两件事。
   */
  numeric?: RibbonMenuNumeric;
}

export interface RibbonMenuNumeric extends RibbonLiveHooks {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  suffix?: string;
  onchange: (value: number) => void;
}

/**
 * 配色方案图库（「设计」选项卡用）。
 *
 * 与 `gallery` 分开一个 kind：那个是「一张图 = 一个形状」，这个是
 * 「一排色块 = 一个配色方案」—— 卡片的构成完全不同（多色 vs 单色 path），
 * 硬塞进同一套渲染里会立刻长出两个 if 分支。
 */
export interface RibbonThemesSpec extends RibbonItemBase {
  kind: 'themes';
  options: {
    id: string;
    label: string;
    colors: string[];
    /**
     * 可移除（= 工程 `customThemes` 里的自定义方案）。内置方案是只读数据表，
     * 不传即是不可移除 —— 图库不会给它们挂右键菜单。
     */
    removable?: boolean;
  }[];
  /** 当前方案 id。 */
  value: string;
  onselect: (id: string) => void;
  /** 移除一份自定义方案（图库里右键它 → 「移除」）。 */
  onremove?: (id: string) => void;
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

/**
 * 纯布局元素：吃掉一行里的剩余空间，把它后面的项推到行尾。
 *
 * 用途是**让两排的右边缘对齐**（字体组：第一排是宽下拉、第二排是图标 +
 * 右侧的字体资源按钮）。没有它的话第二排会在半途结束，看起来像是没排完。
 *
 * 不继承 `RibbonItemBase`：它没有 label / testid / disabled 这些概念，
 * 硬塞一个空 label 只会让类型替调用方记一条没有内容的规则。
 */
export interface RibbonSpacerSpec {
  kind: 'spacer';
  id: string;
}

export type RibbonItemSpec =
  | RibbonButtonSpec
  | RibbonToggleSpec
  | RibbonSelectSpec
  | RibbonColorSpec
  | RibbonSegmentSpec
  | RibbonNumberSpec
  | RibbonGallerySpec
  | RibbonMenuSpec
  | RibbonThemesSpec
  | RibbonSpacerSpec;

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
   *
   * `'rows'` 用于**上下两排内容形态不同**的组（字体组：第一排是宽下拉，
   * 第二排是纯图标）。它不能用 grid 表达 —— grid 会按列等宽切，
   * 而这里第一排的字体下拉本身就占 148px。
   */
  layout?: 'row' | 'grid' | 'rows';
  items: RibbonItemSpec[];
  /**
   * `layout: 'rows'` 时逐行给出的项。给了它就**忽略 `items`**（两者表达同一件事，
   * 同时给只会有两处真源）。
   */
  rows?: RibbonItemSpec[][];
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
/** 纯图标按钮（`size: 'icon'`）的宽度。 */
export const ICON_ITEM_W = DENSITY.ribbonIconW;
/** 带下拉箭头的图标按钮（`menu` 的 icon 档）：多出一个箭头的位子。 */
export const MENU_ICON_W = DENSITY.ribbonIconW + 4;
export const SELECT_ITEM_W = 108;
export const COLOR_ITEM_W = DEFAULT_ITEM_W;
export const NUMBER_ITEM_W = 88;
/** 分段控件按选项数计费：每项 34px。 */
export const SEGMENT_OPTION_W = 34;

/**
 * 标签的估算宽度（px）。
 *
 * 为什么估算而不是量 DOM：**预算与渲染必须同一个数**。`itemWidth()` 在
 * `buildTypographyTabs` 里算组宽、`RibbonButton` 拿同一个值当 `--ribbon-btn-w`；
 * 若渲染交给浏览器去量、预算却靠常数，两者会慢慢错开（表现是组与组之间挤在一起）。
 *
 * 口径来自 `.lbl` 的 `--fs-xs`（10px）：中日韩按全角 10.2、其余按 5.8、空格 3。
 * 留 10px 给 `.rbtn` 的左右内边距与边框。
 */
export function labelWidthPx(label: string): number {
  let w = 0;
  for (const ch of label) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === ' ') w += 3;
    else if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xff60)
    ) {
      w += 10.2;
    } else {
      w += 5.8;
    }
  }
  return Math.ceil(w);
}

/**
 * 按 size 档推按钮宽度（`large` / `small` / `icon`）。
 *
 * `large` 接受标签：**按钮宽度跟着文字走**（下限仍是默认 50）。原来一律 50px，
 * 「插入生成器」这种五字标签会被截成「插入生…」—— 而 Ribbon 的设计前提就是
 * 「文字直接写在按钮上」，截断等于把功能藏起来。显式 `width` 仍然优先。
 */
function sizedWidth(size: RibbonItemSize | undefined, label?: string): number {
  if (size === 'icon') return ICON_ITEM_W;
  if (size === 'small') return SMALL_ITEM_W;
  if (!label) return DEFAULT_ITEM_W;
  return Math.max(DEFAULT_ITEM_W, labelWidthPx(label) + 10);
}

export function itemWidth(item: RibbonItemSpec): number {
  // 间隔占的是**剩余**空间，本身没有固定宽度（也就不占组宽预算）。
  if (item.kind === 'spacer') return 0;
  if (item.width !== undefined) return item.width;
  switch (item.kind) {
    case 'select':
      return SELECT_ITEM_W;
    case 'segment':
      return item.options.length * SEGMENT_OPTION_W;
    case 'number':
      return NUMBER_ITEM_W;
    case 'themes':
      return item.size === 'icon' ? ICON_ITEM_W : SMALL_ITEM_W;
    case 'menu':
      return item.size === 'icon' ? MENU_ICON_W : sizedWidth(item.size);
    case 'color':
    case 'gallery':
      return sizedWidth(item.size);
    // 这两档的文字写在按钮上，宽度必须容得下它。
    case 'toggle':
    case 'button':
      return sizedWidth(item.size, item.label);
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
