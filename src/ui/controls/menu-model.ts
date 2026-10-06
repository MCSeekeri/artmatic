/**
 * menu-model.ts — 菜单（含二级）的导航状态（纯函数，可单测）。
 *
 * 一份模型服务三类调用：轨道行的 ⋯ 菜单、时间轴右键菜单、侧栏与下拉的弹层。
 * 之所以要二级菜单：现在右键一次就把所有生成器列出来，等到特效与素材类型
 * 再增加就会被撑爆；二级把「类别」与「具体项」分开，长度可预期。
 *
 * 层级用「每层一个高亮下标」表示：`levels[0]` 是根层，`levels[1]` 是当前
 * 打开的子菜单……这样 Esc 退一级只是 pop 一下，不需要维护树路径。
 */

import type { IconName } from '../icons';

export interface MenuItem {
  id: string;
  label?: string;
  icon?: IconName;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** 分隔线：其余字段都会被忽略。 */
  separator?: boolean;
  testid?: string;
  onselect?: () => void;
  /** 有它就渲染子菜单指示箭头，右键/Enter 进入。 */
  children?: MenuItem[];
  /**
   * 预览图 URL。**有它就渲染悬停浮层**（图 + `desc`）。
   *
   * 只给「用户得先看看才知道要不要」的项用（算法生成器那一类：光看名字
   * 不知道它画什么）。浮层贴在**当前高亮项**右侧，跟着键盘导航一起走。
   */
  thumb?: string;
  /** 浮层里的一句话说明（已翻译的文本，不是文案键 —— 菜单是数据层，不认识 i18n）。 */
  desc?: string;
}

export interface MenuState {
  /** 每层的当前高亮项下标。length = 1 表示只开了根层。 */
  levels: number[];
}

export function initialMenuState(items: MenuItem[]): MenuState {
  return { levels: [edgeIndex(items, 'first')] };
}

export function isSelectable(it: MenuItem | undefined): boolean {
  return !!it && !it.separator && !it.disabled;
}

export function stepIndex(items: MenuItem[], from: number, delta: number): number {
  const n = items.length;
  if (n === 0) return -1;
  const dir = delta >= 0 ? 1 : -1;
  let i = from;
  for (let guard = 0; guard < n; guard += 1) {
    i = (i + dir + n) % n;
    if (isSelectable(items[i])) return i;
  }
  return from;
}

export function edgeIndex(items: MenuItem[], edge: 'first' | 'last'): number {
  if (items.length === 0) return -1;
  const idx = Array.from({ length: items.length }, (_, i) =>
    edge === 'first' ? i : items.length - 1 - i,
  );
  return idx.find((i) => isSelectable(items[i])) ?? -1;
}

/** 取某一层要渲染的项：根层是 `items`，更深层是父项（及其祖先）的 children。 */
export function itemsAtLevel(items: MenuItem[], level: number, state: MenuState): MenuItem[] {
  let cur = items;
  for (let l = 0; l < level; l += 1) {
    const parent = cur[state.levels[l]!];
    if (!parent?.children) return [];
    cur = parent.children;
  }
  return cur;
}

/** 当前高亮项若带 children，就进一层。返回新状态（不改原对象）。 */
export function openSubmenu(items: MenuItem[], state: MenuState): MenuState {
  const level = state.levels.length - 1;
  const list = itemsAtLevel(items, level, state);
  const cur = list[state.levels[level]!];
  if (!cur?.children?.length) return state;
  return { levels: [...state.levels, edgeIndex(cur.children, 'first')] };
}

/** 退一层。已在根层则返回 null，表示「该整个关掉了」。 */
export function backLevel(state: MenuState): MenuState | null {
  if (state.levels.length <= 1) return null;
  return { levels: state.levels.slice(0, -1) };
}

/** 改当前层的高亮。 */
export function moveLevel(
  items: MenuItem[],
  state: MenuState,
  delta: number,
): MenuState {
  const level = state.levels.length - 1;
  const list = itemsAtLevel(items, level, state);
  const next = stepIndex(list, state.levels[level]!, delta);
  const levels = [...state.levels];
  levels[level] = next;
  return { levels };
}

export function edgeLevel(
  items: MenuItem[],
  state: MenuState,
  edge: 'first' | 'last',
): MenuState {
  const level = state.levels.length - 1;
  const list = itemsAtLevel(items, level, state);
  const levels = [...state.levels];
  levels[level] = edgeIndex(list, edge);
  return { levels };
}

/* ------------------------------------------------------------ pointer */

/**
 * 鼠标划过某一层第 `index` 项时该怎么更新状态。
 *
 * **必须传 level**：指针事件来自某一份被渲染出来的列表，那份列表就对应一层。
 * 若只按「当前最深一层」推算，划过根层某项时会把根层的下标当成子层的，
 * 结果是既选不中、也收不起已展开的子菜单。
 */
export function hoverLevel(
  items: MenuItem[],
  state: MenuState,
  level: number,
  index: number,
): MenuState {
  const list = itemsAtLevel(items, level, state);
  if (!isSelectable(list[index])) return state;
  const trimmed = state.levels.slice(0, level + 1);
  trimmed[level] = index;
  const next: MenuState = { levels: trimmed };
  return list[index]?.children?.length ? openSubmenu(items, next) : next;
}

/* ------------------------------------------------------------ 键盘 */

export type MenuIntent =
  | 'next'
  | 'prev'
  | 'first'
  | 'last'
  | 'enter'
  | 'back'
  | 'close'
  | 'type';

export function keyIntent(key: string): MenuIntent | null {
  switch (key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'Enter':
    case ' ':
      return 'enter';
    case 'ArrowLeft':
      return 'back';
    case 'ArrowRight':
      return 'enter';
    case 'Escape':
    case 'Tab':
      return 'close';
    default:
      return key.length === 1 ? 'type' : null;
  }
}

/* ------------------------------------------------------------ 构造助手
 *
 * 菜单是数据不是组件树，构造点容易写出重复的样板，这里给两个小工具。
 */

export function separator(id: string): MenuItem {
  return { id, separator: true };
}

export function submenu(
  id: string,
  label: string,
  children: MenuItem[],
  icon?: IconName,
): MenuItem {
  return children.length ? { id, label, icon, children } : { id, label, icon, disabled: true };
}
