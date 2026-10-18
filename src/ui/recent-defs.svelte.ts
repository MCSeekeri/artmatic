/**
 * recent-defs.svelte.ts — 「最近使用」的响应式镜像（模块级 `$state`）。
 *
 * 纯逻辑与存储 I/O 在 `recent-defs.ts`（可单测）。这里只负责：
 *   · 启动时读一次 localStorage；
 *   · 记住新用过的 id 时同步写回；
 *   · 让菜单/选择器在列表变化时自动重算。
 *
 * 为什么需要响应式：时间轴上「特效片段」的二级菜单是**打开时构造**的，
 * 而选择器（检查器里的「添加特效」）关掉之后菜单才下次打开 —— 看起来不需要。
 * 但将来若有「同一帧里两次打开菜单」或 lab 复用，非响应式版本会静默给出旧列表。
 * 加一层 `$state` 的成本几乎为零。
 */

import {
  RECENT_ALGOS_KEY,
  RECENT_EFFECTS_KEY,
  RECENT_STORE_LIMIT,
  pushRecent,
  readRecent,
  writeRecent,
} from './recent-defs';

/** `localStorage` 在非浏览器环境 / 隐私模式下可能抛，统一兜住。 */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let effectIds = $state<string[]>(readRecent(store(), RECENT_EFFECTS_KEY, RECENT_STORE_LIMIT));
let algoIds = $state<string[]>(readRecent(store(), RECENT_ALGOS_KEY, RECENT_STORE_LIMIT));

export function recentEffectIds(): readonly string[] {
  return effectIds;
}

export function recentAlgoIds(): readonly string[] {
  return algoIds;
}

/** 记一笔「用过这个特效」。重复的会被提到最前，不增加长度。 */
export function rememberRecentEffect(id: string): void {
  const next = pushRecent(effectIds, id, RECENT_STORE_LIMIT);
  if (next.length === effectIds.length && next.every((v, i) => v === effectIds[i])) return;
  effectIds = next;
  writeRecent(store(), RECENT_EFFECTS_KEY, next);
}

/** 记一笔「用过这个生成器」。 */
export function rememberRecentAlgo(id: string): void {
  const next = pushRecent(algoIds, id, RECENT_STORE_LIMIT);
  if (next.length === algoIds.length && next.every((v, i) => v === algoIds[i])) return;
  algoIds = next;
  writeRecent(store(), RECENT_ALGOS_KEY, next);
}
