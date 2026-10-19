/**
 * format-time.ts — 界面用的相对时间。
 *
 * `Date.now()` 在这里是合规的：它是**界面显示**，不是渲染求值 ——
 * 硬约束 1.1 管的是「任何渲染函数不得读 Date.now()」，这条路径不参与出帧。
 *
 * 从 EmptyState 与 Rail 各一份的 `ago()` 收口而来（两份逐字相同）。
 * 放在 `ui/` 而不是 `core/`，因为文案要走 `tr()`（依赖 locale 的 `$state`）。
 */

import { tr } from '../i18n/index.svelte';

/** 时间戳 → 「刚刚 / N 分钟前 / N 小时前 / N 天前」。0 / 缺省 → `—`。 */
export function ago(ts: number): string {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return tr('common.justNow');
  if (s < 3600) return tr('common.minutesAgo', { n: Math.floor(s / 60) });
  if (s < 86400) return tr('common.hoursAgo', { n: Math.floor(s / 3600) });
  return tr('common.daysAgo', { n: Math.floor(s / 86400) });
}
