/**
 * main.ts — 入口：能力闸门 → 装配。
 *
 * 装配代码整体在 `app-boot.ts`（原样搬迁，没有改动）。这一层只做一件事：
 * 在加载主应用**之前**确认这台浏览器有 WebGL2 与目录选择能力（`ui/capability-gate.ts`）。
 *
 * 为什么用**动态 import**：能力不够的浏览器连主应用那份 chunk 都不该下载 ——
 * 而静态 import 会先拉全量再判断，闸门就只剩「不挂载」这一半作用。
 * 这也让闸门可以保持极小的依赖（只有 i18n）。
 */

import { detectCapabilityGap, renderCapabilityNotice } from './ui/capability-gate';

const gap = detectCapabilityGap();
if (gap) {
  renderCapabilityNotice(gap);
} else {
  await import('./app-boot');
}
