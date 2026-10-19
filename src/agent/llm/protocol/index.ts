/**
 * protocol/index.ts — 协议 id → 适配器。
 *
 * 只有两个：`openai` 覆盖 15 家，`anthropic` 是一家。第 17 家要是一门新协议
 * （比如 Cohere v2），加进这里并在注册表里指过去就行，`transport.ts` 不用动。
 */

import { anthropicAdapter } from './anthropic';
import { openAiAdapter } from './openai';
import type { ProtocolAdapter } from './types';
import type { ProtocolId } from '../providers/types';

const ADAPTERS: Record<ProtocolId, ProtocolAdapter> = {
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
};

export function adapterFor(protocol: ProtocolId): ProtocolAdapter {
  return ADAPTERS[protocol];
}

export { anthropicAdapter, openAiAdapter };
