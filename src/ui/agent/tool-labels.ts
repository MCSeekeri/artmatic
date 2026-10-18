/**
 * tool-labels.ts — 工具 id → 界面显示名。
 *
 * 工具**描述**是给模型读的英文 API 文档（`src/agent/tools.ts`），界面标题不该
 * 跟着它走：用户看到的是「设置轨道」而不是 `set_track`。文案键是拼出来的
 * （`agent.toolName.<id>`），TS 覆盖不到，所以缺键时回落到 id —— 界面上出现
 * 一个英文 id 就是明确的漏登记信号，而 `tr()` 恰好按「缺键返回 key」的约定工作。
 */

import { tr } from '../../i18n/index.svelte';
import type { MessageKey } from '../../i18n/locales';

/**
 * 工具 id（snake_case）→ 文案键段（camelCase）。
 * i18n 守卫只允许 `[a-zA-Z0-9]` 的键段，所以 `ask_user` 不能直接当键。
 */
function camel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function toolLabel(name: string): string {
  if (!name) return '';
  const key = `agent.toolName.${camel(name)}` as MessageKey;
  const text = tr(key);
  return text === key ? name : text;
}
