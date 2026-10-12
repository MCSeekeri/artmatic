/**
 * recent-fonts.ts — 「最近使用的字体」的持久化（跨工程，localStorage）。
 *
 * 字体下拉在本机字体加载后有几百项，扫不动。把最近用过的几个**置顶**能省掉
 * 绝大多数翻找。只存 family 名 —— 它与字体字节无关，换个工程照样有意义。
 *
 * 上限是模块常量。「上限可在设置里调整」需要动 `UiPrefs` 与设置面板，
 * 留作后续；这里先把「最近使用」这条做出来。
 *
 * 一律降级：localStorage 不可用（隐私模式 / Node 测试环境）、内容坏掉、
 * 配额满 —— 全部静默退化，绝不抛异常打断 Ribbon 渲染。
 */

const KEY = 'artmatic.recentFonts';

/** 最近字体最多记几个。 */
export const RECENT_FONT_LIMIT = 8;

export function loadRecentFonts(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .slice(0, RECENT_FONT_LIMIT);
  } catch {
    return [];
  }
}

/** 记一次使用：去重、最新在前、截断到上限。 */
export function rememberFont(family: string): void {
  const f = family.trim();
  if (!f || typeof localStorage === 'undefined') return;
  const next = [f, ...loadRecentFonts().filter((x) => x !== f)].slice(0, RECENT_FONT_LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存不进去就算了 —— 这是纯偏好，不是数据。 */
  }
}

/**
 * 把 `recent` 里出现过的族排到最前（保持 recent 的顺序），其余维持原顺序。
 * `recent` 里但已不在候选集里的（字体被删了）自然被丢掉。
 */
export function orderByRecent(families: readonly string[], recent: readonly string[]): string[] {
  const present = new Set(families);
  // 去重：`recent` 理论上已由 rememberFont 去重，但这里是纯函数，不该依赖调用方。
  const head = [...new Set(recent)].filter((f) => present.has(f));
  const headSet = new Set(head);
  return [...head, ...families.filter((f) => !headSet.has(f))];
}
