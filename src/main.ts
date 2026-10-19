/**
 * main.ts — 入口：宿主选择 → 能力闸门 → 装配。
 *
 * 装配代码整体在 `app-boot.ts`（原样搬迁，没有改动）。这一层只做两件事：
 * 1. 如果页面被 Electron 宿主加载（存在 `window.artmaticHost`），先换掉平台实现
 *    并注入「按范围读本机路径」的能力；
 * 2. 在加载主应用**之前**确认这台浏览器有 WebGL2 与目录选择能力
 *    （`ui/capability-gate.ts`）。
 *
 * 为什么用**动态 import**：能力不够的浏览器连主应用那份 chunk 都不该下载 ——
 * 而静态 import 会先拉全量再判断，闸门就只剩「不挂载」这一半作用。
 * 这也让闸门可以保持极小的依赖（只有 i18n）。
 */

import { detectCapabilityGap, renderCapabilityNotice } from './ui/capability-gate';

interface HostBridge {
  readRange(path: string, start: number, end: number): Promise<Uint8Array>;
}

const host = (window as unknown as { artmaticHost?: HostBridge }).artmaticHost;
if (host) {
  /*
   * 动态 import：这两个模块会把 project/ 的依赖图拉进来；普通浏览器
   * 不该为桌面宿主付一次下载（能力闸门的价值就在这里）。
   */
  const [{ setPlatform }, { createElectronPlatform }, { setAssetPathReader }] =
    await Promise.all([
      import('./platform/index'),
      import('./platform/electron'),
      import('./project/asset-store'),
    ]);
  setPlatform(createElectronPlatform(host as never));
  // 素材仓不 import platform：能力在这里注入，单测仍可只给一个假 reader。
  setAssetPathReader((path, start, end) => host.readRange(path, start, end));
}

const gap = detectCapabilityGap();
if (gap) {
  renderCapabilityNotice(gap);
} else {
  await import('./app-boot');
}
