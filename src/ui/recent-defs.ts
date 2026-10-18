/**
 * recent-defs.ts — 「最近使用」的特效 / 算法生成器清单（纯函数 + 存储 I/O）。
 *
 * 用途只有一个：时间轴右键（与轨道行 ⋯）菜单里，「特效片段」「算法片段」
 * 的二级菜单**不再平铺全部选项**，只列最近用过的 5 个 + 一个「全部…」。
 *
 * 为什么不放进 `UiPrefs`（app-state.svelte.ts 那个 `artmatic.ui`）：
 * 它是**两个注册表 id 的列表**，与抽屉宽度 / 吸附档位那类标量偏好不是一类东西；
 * 塞进同一个 blob 会让「加一个最近项」变成改三处（fallback / normalize / persist），
 * 而且注册表相关的状态更容易被将来的宿主（mcp / lab）复用。所以单开两个键，
 * 与 `ui/typography/recent-fonts.ts` / `recent-colors.ts` 同一套模式。
 *
 * 这里刻意**不含 rune**：纯函数可单测，响应式镜像在 `recent-defs.svelte.ts`。
 */

/** 二级菜单里展示的最近项数量。改它之前先想清楚菜单高度 —— 5 项 + 分隔线 + 「全部」。 */
export const RECENT_LIMIT = 5;

/**
 * **存储**里保留的条数（比展示的多）。
 *
 * 为什么要多存：注册表里的 id 可能消失（插件卸载、工程从别的机器带来）。
 * 只存 5 条的话，一条失效 id 会永久占掉一个展示位，直到用户再用 5 个新东西；
 * 多存一些，菜单按注册表过滤后再截前 5 条，失效项自然被让过去。
 */
export const RECENT_STORE_LIMIT = 20;

export const RECENT_EFFECTS_KEY = 'artmatic.recentEffects';
export const RECENT_ALGOS_KEY = 'artmatic.recentAlgos';

/**
 * 把 `id` 提到列表最前，去重并裁到 `limit`。
 *
 * 返回新数组（不原地改）：`$state` 的数组在 Svelte 5 里是 proxy，原地
 * `unshift` 虽然也能触发，但会让「值没变」的判等失效 —— 菜单每次重建都
 * 以为列表变了。这里保持纯函数的形状，调用方可以安全比较。
 */
export function pushRecent(
  list: readonly string[],
  id: string,
  limit = RECENT_LIMIT,
): string[] {
  const clean = String(id ?? '').trim();
  if (!clean) return [...list];
  const out = [clean];
  for (const v of list) {
    if (v !== clean && !out.includes(v)) out.push(v);
    if (out.length >= limit) break;
  }
  return out.slice(0, Math.max(1, limit));
}

/**
 * 读一串 id。**永不抛**：localStorage 可能被手改、被别的版本写成对象、
 * 或在隐私模式下直接抛异常 —— 一律降级成空列表（菜单退回「只有全部」）。
 */
export function readRecent(
  storage: Pick<Storage, 'getItem'> | null,
  key: string,
  limit = RECENT_LIMIT,
): string[] {
  if (!storage) return [];
  try {
    const raw: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    for (const v of raw) {
      if (typeof v !== 'string') continue;
      const id = v.trim();
      if (!id || out.includes(id)) continue;
      out.push(id);
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function writeRecent(
  storage: Pick<Storage, 'setItem'> | null,
  key: string,
  list: readonly string[],
): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(list));
  } catch {
    /* 存不下不中断操作（与 UiPrefs 同一口径） */
  }
}
