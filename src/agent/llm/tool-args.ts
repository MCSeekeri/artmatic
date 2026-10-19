/**
 * llm/tool-args.ts — 把模型给的 JSON 字符串变成参数对象。
 *
 * 单独一个文件是因为 `session` 与 `executor` 都要它，而它跟网络毫无关系 ——
 * 之前放在 `provider.ts` 里，测试要 import 一个会 `fetch` 的模块才能拿到一个
 * 纯函数。
 */

import type { ToolCallResult, WireToolCall } from './types';

export function parseToolArguments(call: ToolCallResult | WireToolCall): Record<string, unknown> {
  const raw = 'arguments' in call ? call.arguments : call.function.arguments;
  if (!raw || !raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('arguments must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}
