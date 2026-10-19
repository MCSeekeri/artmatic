/**
 * recent-colors.ts — 「最近使用的颜色」的持久化（跨工程，localStorage）。
 *
 * 与 recent-fonts.ts 同一套约定：纯偏好、可丢、一律降级（隐私模式 / 坏数据 /
 * 配额满全部静默退化，绝不抛异常打断取色卡渲染）。
 *
 * **只记裸色**（hex），不记配色方案引用：引用是「跟方案走」的，它出现在
 * 主题网格里而不是「最近使用」里 —— 把 `@accent1` 混进最近色会让那一行
 * 在换方案后显示一堆和主题网格重复、但语义不同的格子。
 */

const KEY = 'artmatic.recentColors';

/** 最近颜色最多记几个（取色卡一行 10 格，留出余量）。 */
export const RECENT_COLOR_LIMIT = 8;

const HEX = /^#[0-9a-f]{6}$/i;

export function loadRecentColors(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === 'string' && HEX.test(x))
      .slice(0, RECENT_COLOR_LIMIT);
  } catch {
    return [];
  }
}

/** 记一次使用：去重（忽略大小写）、最新在前、截断到上限。只被同文件的 `rememberRecentColor` 调。 */
function rememberColor(color: string): void {
  const c = color.trim().toLowerCase();
  if (!HEX.test(c) || typeof localStorage === 'undefined') return;
  const next = [c, ...loadRecentColors().filter((x) => x !== c)].slice(0, RECENT_COLOR_LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存不进去就算了 —— 这是纯偏好，不是数据。 */
  }
}

/**
 * 同一次会话内同步「最近使用」的镜像。
 *
 * 取色卡是**打开时构造、关闭时销毁**的短生命周期组件，而 localStorage
 * 不是响应式的 —— 在同一次会话里连续打开两次取色卡，第二次拿到的还是
 * 缓存的旧列表。这个模块级镜像让 Ribbon 在下一次重建时读到新值。
 */
let session: string[] | null = null;

export function recentColors(): string[] {
  session ??= loadRecentColors();
  return session;
}

export function rememberRecentColor(color: string): void {
  rememberColor(color);
  session = loadRecentColors();
}
