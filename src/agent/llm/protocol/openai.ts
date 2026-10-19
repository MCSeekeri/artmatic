/**
 * protocol/openai.ts — OpenAI Chat Completions 适配器。
 *
 * 覆盖 15 家（DeepSeek / 通义千问 / 智谱 / Kimi / 豆包 / 混元 / 千帆 / 星火 /
 * 阶跃 / MiniMax / 硅基流动 / OpenAI / Gemini 兼容层 / OpenRouter / xAI）。
 * 差异全部来自 `providers/` 的数据，这里只有**一份**序列化逻辑。
 *
 * ## 键序是契约
 *
 * `tests/unit/fixtures/deepseek-request.golden.json` 钉住 DeepSeek 的请求体**逐字节**。
 * 所以要新增可选字段就往 `buildBody` 里按顺序追加，不要重排现有字段 ——
 * 重排本身不改语义，但会让 golden 失效，而失效的 golden 通常被「更新一下就好」
 * 地处理掉，那这个守卫就白设了。
 */

import { openAiTools } from '../../tools';
import { classifyHttpError } from '../providers/errors';
import {
  maxTokensFieldFor,
  outputTokensFor,
  temperatureFor,
  thinkingParamsFor,
} from '../providers/reasoning';
import type { ProviderDef } from '../providers/types';
import type { LlmConfig, LlmError, WireMessage } from '../types';
import { createOpenAiReducer } from './openai-stream';
import type { BuildBodyArgs, ProtocolAdapter, StreamHandlers, StreamReducer } from './types';

/* --------------------------------------------------------------- 消息序列化 */

/** 去掉内部字段。没有 `providerMeta` 时**返回同一引用**（DeepSeek 的字节基线靠这个）。 */
export function stripProviderMeta(m: WireMessage): WireMessage {
  if (!m.providerMeta) return m;
  const { providerMeta: _drop, ...rest } = m;
  return rest;
}

/**
 * assistant 消息 → 该 provider 能接受的形状。
 *
 * `echo` 决定思维链是否出现：
 *   required  字段**必须在**（DeepSeek 带 tools 时漏传 = 400），缺了写空串；
 *             换过 provider 的话旧文本也不该带（那是别家的推理）
 *   optional  有才带（OpenRouter 的 `reasoning_details` 原数组回传）
 *   never     一律删（智谱明确不回传；OpenAI 不认这个字段）
 */
function assistantOut(m: WireMessage, def: ProviderDef): Record<string, unknown> {
  const echo = def.thinking.echo;
  const field = def.thinking.field;
  const meta = m.providerMeta;
  const sameProvider = !meta || meta.providerId === def.id;

  const out: Record<string, unknown> = { role: 'assistant', content: m.content ?? null };

  if (echo !== 'never' && sameProvider) {
    if (field === 'reasoning_content' || field === 'reasoning') {
      const text = m.reasoning_content ?? '';
      if (echo === 'required' || text) out[field] = text;
    } else if (field === 'reasoning_details' && meta?.reasoning?.kind === 'openrouter-details') {
      out.reasoning_details = meta.reasoning.details;
    }
  } else if (echo === 'required') {
    // 字段必须存在，内容为空。写 `''` 是官方接受的形状（「没有思维链」）。
    out[field === 'reasoning' ? 'reasoning' : 'reasoning_content'] = '';
  }

  if (m.tool_calls?.length) out.tool_calls = m.tool_calls;
  return out;
}

export function serializeOpenAiMessages(
  messages: readonly WireMessage[],
  def: ProviderDef,
): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role !== 'assistant') return stripProviderMeta(m) as unknown as Record<string, unknown>;
    return assistantOut(m, def);
  });
}

/* ---------------------------------------------------------------- 请求组装 */

function endpointOf(baseUrl: string, def: ProviderDef): string {
  return `${baseUrl.replace(/\/+$/, '')}${def.endpointPath}`;
}

export function buildOpenAiBody({ config, provider, messages, tools }: BuildBodyArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: serializeOpenAiMessages(messages, provider),
    stream: true,
  };

  if (provider.request.streamUsage) body.stream_options = { include_usage: true };

  const temperature = temperatureFor(provider, config.effort, config.model, config.temperature);
  if (temperature !== undefined) body.temperature = temperature;

  const maxTokens = outputTokensFor(provider, config);
  if (maxTokens) body[maxTokensFieldFor(provider, config.model)] = maxTokens;

  if (tools?.length) {
    body.tools = openAiTools(tools);
    body.tool_choice = 'auto';
  }

  // 思考参数永远最后追加：各家字段名不同，但都是「顶层附加」。
  Object.assign(body, thinkingParamsFor(provider, config.effort, config.model));
  return body;
}

/* ------------------------------------------------------------------ 适配器 */

export const openAiAdapter: ProtocolAdapter = {
  id: 'openai',

  endpoint: endpointOf,

  headers(config: LlmConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    };
  },

  buildBody: buildOpenAiBody,

  createReducer(def: ProviderDef, handlers: StreamHandlers): StreamReducer {
    return createOpenAiReducer(def, handlers);
  },

  classify(status: number, bodyText: string): LlmError {
    return classifyHttpError(status, bodyText);
  },
};
