/**
 * platform/index.ts — 宿主实现的**唯一选择点**。
 *
 * 内核只 import 这里的 `platform`，不直接 import `browser.ts` / `electron.ts`。
 * 理由与 `platform/types.ts` 的注入点相同：桌面版是同一份内核的另一个宿主，
 * 不该在业务代码里出现 `if (isElectron)`。
 *
 * `main.ts` 在装配前按能力检测调 `setPlatform()`；ES 模块的 live binding
 * 保证之后所有 `platform.xxx` 读到的都是新实例。
 */

import { browserPlatform } from './browser';
import type { Platform } from './types';

export let platform: Platform = browserPlatform;

export function setPlatform(next: Platform): void {
  platform = next;
}

export { browserPlatform };
