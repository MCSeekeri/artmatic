/**
 * provider.ts — DeepSeek（OpenAI 兼容）Chat Completions 的**流式客户端**。
 *
 * 手写 SSE 而不引 SDK：协议只有 `data: {...}` 与 `[DONE]` 两种帧，引一个库
 * 反而多一份许可与体积（`AGENTS §1.8` 的闸门）。
 *
 * ## 两条只有实测才会发现的事
 *
 * 1. **`tool_calls` 是分片到达的**：`delta.tool_calls[i].function.arguments` 是
 *    JSON 字符串的**片段**，要按 `index` 累积再拼。按到达顺序当完整 JSON 解析
 *    会在长参数上随机失败（而且只在参数跨 chunk 时）。
 * 2. **图片只能放 user 消息**（官方文档：system / assistant 带图 = 400）。
 *    所以 `provider` 不处理图片注入，那是 `session` 的事。
 *
 * ## 直连失败 → 同源代理
 *
 * 浏览器直连 `api.deepseek.com` 是否被 CORS 拦，各家说法与实测不一致。
 * 策略：先直连；**在收到第一个字节之前**失败就换 `proxyPath`（Vite 中间件
 * 转发，dev 与 preview 都注册）。已经吐过字之后再失败**不重试** —— 那会把
 * 半截回答重放一遍，用户看到的是重复内容。
 */

import {
  LlmError,
  type ChatResult,
  type LlmConfig,
  type LlmUsage,
  type ToolCallResult,
  type WireMessage,
  type WireToolCall,
} from './types';

/** 单次请求的超时（毫秒）。开思考的长回答 + 长工具循环需要留足。 */
export const LLM_TIMEOUT_MS = 300_000;

/* ------------------------------------------------------------------ SSE */

export interface SseParseState {
  buffer: string;
}

/** 新建一个 SSE 解析器（纯函数式：把分片喂进去，取出完整 data 帧）。 */
export function createSseParser(): { push(chunk: string): string[]; flush(): string[] } {
  let buffer = '';
  const events: string[] = [];

  const drain = (): void => {
    for (;;) {
      // 事件之间用空行分隔；兼容 \r\n。
      const m = /\r?\n\r?\n/.exec(buffer);
      if (!m) break;
      const raw = buffer.slice(0, m.index);
      buffer = buffer.slice(m.index + m[0].length);
      // 一个事件里可以有多行 `data:`，按规范用 \n 拼接。
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith(':')) continue; // 注释 / keep-alive
        if (!line.startsWith('data:')) continue;
        data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) events.push(data.join('\n'));
    }
  };

  return {
    push(chunk: string): string[] {
      buffer += chunk;
      drain();
      const out = events.splice(0, events.length);
      return out;
    },
    flush(): string[] {
      // 收尾：没有空行结尾的最后一条也要吐出来（部分实现会这样）。
      const rest = buffer.trim();
      buffer = '';
      if (!rest) return events.splice(0, events.length);
      const data: string[] = [];
      for (const line of rest.split(/\r?\n/)) {
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      const out = events.splice(0, events.length);
      if (data.length) out.push(data.join('\n'));
      return out;
    },
  };
}

/* --------------------------------------------------------------- 请求体 */

interface DeltaToolCall {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamChunk {
  choices?: {
    delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: DeltaToolCall[] };
    finish_reason?: string | null;
  }[];
  usage?: LlmUsage | null;
  error?: { message?: string; type?: string; code?: string };
}

export interface StreamHandlers {
  onText?(delta: string): void;
  onReasoning?(delta: string): void;
  /** 工具调用的参数**开始**到达时通知一次（面板可以立刻插一张卡）。 */
  onToolStart?(call: { index: number; id: string; name: string }): void;
}

function isRetryable(e: unknown): boolean {
  return e instanceof LlmError && (e.code === 'network' || e.code === 'server');
}

function statusToCode(status: number): LlmError['code'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'balance';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  return 'bad-response';
}

function endpoint(config: LlmConfig): string {
  return `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function proxyEndpoint(config: LlmConfig): string | null {
  if (!config.proxyPath) return null;
  // 代理写死了转发目标（api.deepseek.com）；自定义 baseUrl 时不冒充。
  if (!/api\.deepseek\.com/i.test(config.baseUrl)) return null;
  return `${config.proxyPath.replace(/\/+$/, '')}/chat/completions`;
}

/**
 * 思考开关 + 强度的原生参数（纯函数，单测覆盖）。
 *
 * 官方文档：OpenAI 格式下 `thinking:{type:'enabled'|'disabled'}`，
 * 强度是同级的 `reasoning_effort: 'low'|'high'|'max'`（`medium` 在服务端映射
 * 成 high，所以这里直接用原生三档）。**不要**把档位写成提示词 —— 那不是
 * DeepSeek 的行为来源。
 */
export function thinkingParams(effort: LlmConfig['effort']): Record<string, unknown> {
  if (effort === 'off') return { thinking: { type: 'disabled' } };
  return { thinking: { type: 'enabled' }, reasoning_effort: effort };
}

function requestBody(config: LlmConfig, messages: WireMessage[], tools: unknown[] | undefined): Record<string, unknown> {
  return {
    model: config.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: config.temperature,
    ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
    ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}),
    ...thinkingParams(config.effort),
  };
}

/* --------------------------------------------------------------- 单次请求 */

async function once(
  url: string,
  config: LlmConfig,
  messages: WireMessage[],
  tools: unknown[] | undefined,
  signal: AbortSignal | undefined,
  handlers: StreamHandlers,
): Promise<ChatResult> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, LLM_TIMEOUT_MS);
  const onAbort = (): void => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody(config, messages, tools)),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (timedOut) throw new LlmError('timeout', `timeout after ${LLM_TIMEOUT_MS} ms`);
      if (signal?.aborted) throw new LlmError('cancelled', 'aborted');
      // 浏览器把 CORS / DNS / 断网都报成 TypeError（没有可读的 status）。
      throw new LlmError('network', e instanceof Error ? e.message : String(e), undefined, url);
    }

    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 800);
      } catch {
        /* 读不出错误体也不影响归一 */
      }
      throw new LlmError(statusToCode(res.status), `HTTP ${res.status}`, res.status, detail);
    }
    if (!res.body) throw new LlmError('bad-response', 'response has no body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();

    let content = '';
    let reasoning = '';
    let usage: LlmUsage | null = null;
    let finishReason: string | null = null;
    const calls = new Map<number, ToolCallResult>();
    const started = new Set<number>();

    const handle = (data: string): boolean => {
      if (data === '[DONE]') return true;
      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(data) as StreamChunk;
      } catch {
        // 单个坏帧不该毁掉整段回答：跳过它。
        return false;
      }
      if (chunk.error) {
        throw new LlmError('server', chunk.error.message ?? 'stream error', undefined, chunk.error.code);
      }
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return false;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta;
      if (!delta) return false;
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        handlers.onText?.(delta.content);
      }
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        handlers.onReasoning?.(delta.reasoning_content);
      }
      for (const [i, tc] of (delta.tool_calls ?? []).entries()) {
        const index = typeof tc.index === 'number' ? tc.index : i;
        const entry = calls.get(index) ?? { id: '', name: '', arguments: '' };
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name = tc.function.name;
        if (typeof tc.function?.arguments === 'string') entry.arguments += tc.function.arguments;
        calls.set(index, entry);
        if (!started.has(index) && entry.name) {
          started.add(index);
          handlers.onToolStart?.({ index, id: entry.id || `call-${index}`, name: entry.name });
        }
      }
      return false;
    };

    let done = false;
    while (!done) {
      const { value, done: eof } = await reader.read();
      if (eof) break;
      const text = decoder.decode(value, { stream: true });
      for (const event of parser.push(text)) {
        if (handle(event)) {
          done = true;
          break;
        }
      }
    }
    if (!done) {
      for (const event of parser.flush()) {
        if (handle(event)) break;
      }
    }

    const toolCalls: ToolCallResult[] = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, c]) => ({ id: c.id || `call-${index}`, name: c.name, arguments: c.arguments }))
      .filter((c) => c.name);

    return { content, reasoning, toolCalls, usage, finishReason };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (timedOut) throw new LlmError('timeout', `timeout after ${LLM_TIMEOUT_MS} ms`);
    if (signal?.aborted) throw new LlmError('cancelled', 'aborted');
    throw new LlmError('network', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/* ------------------------------------------------------------------ 入口 */

/** 本次会话是否已经验证过代理可用（避免每次都先撞一次 CORS）。 */
let preferProxy = false;

/** 测试用：重置传输层记忆。 */
export function resetTransportPreference(): void {
  preferProxy = false;
}

export async function streamChat(
  config: LlmConfig,
  messages: WireMessage[],
  tools: unknown[] | undefined,
  signal: AbortSignal | undefined,
  handlers: StreamHandlers = {},
): Promise<ChatResult> {
  if (!config.apiKey.trim()) throw new LlmError('no-key', 'missing api key');

  const proxy = proxyEndpoint(config);
  if (preferProxy && proxy) return once(proxy, config, messages, tools, signal, handlers);

  let emitted = false;
  const tracked: StreamHandlers = {
    onText: (d) => {
      emitted = true;
      handlers.onText?.(d);
    },
    onReasoning: (d) => {
      emitted = true;
      handlers.onReasoning?.(d);
    },
    onToolStart: handlers.onToolStart,
  };

  try {
    return await once(endpoint(config), config, messages, tools, signal, tracked);
  } catch (e) {
    if (preferProxy || emitted || !proxy || !isRetryable(e)) throw e;
    // 直连在网络层失败（CORS / DNS / 证书）→ 换同源代理。
    preferProxy = true;
    return once(proxy, config, messages, tools, signal, tracked);
  }
}

/** 从 `WireToolCall` 读参数的便捷函数（session 用）。 */
export function parseToolArguments(call: ToolCallResult | WireToolCall): Record<string, unknown> {
  const raw = 'arguments' in call ? call.arguments : call.function.arguments;
  if (!raw || !raw.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('arguments must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}
