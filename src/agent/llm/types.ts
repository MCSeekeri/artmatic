/**
 * llm/types.ts — 模型层的线格式与事件类型。
 *
 * 这里刻意**贴着 OpenAI Chat Completions 的线格式**（`role` / `content` /
 * `tool_calls` / `tool_call_id`），不另造一套抽象：DeepSeek 是 OpenAI 兼容的，
 * 换 baseUrl 就能接别的服务，多一层映射只会多一处 bug。
 *
 * 一条硬约束（来自官方文档）：**Chat Completions 下图片只能出现在 `user`
 * 消息里**。工具结果（`role:'tool'`）只能带文本，所以截图要在工具轮结束后
 * 以一条 user 消息注入 —— 见 `session.ts`。
 */

/* ------------------------------------------------------------------ 配置 */

/**
 * 思考强度（DeepSeek 原生 `reasoning_effort`）。
 *
 * 官方实际只有 **low / high / max** 三档（`minimal→low`、`medium→high`、
 * `xhigh→high`、`ultra→max`），`off` 走 `thinking:{type:'disabled'}`。
 * 这里直接用原生三档 + 关闭，不再把档位翻译成提示词。
 */
export type ReasoningEffort = 'off' | 'low' | 'high' | 'max';

export interface LlmConfig {
  /** `https://api.deepseek.com`（不带 `/chat/completions`）。 */
  baseUrl: string;
  apiKey: string;
  /** `deepseek-flash`（原生多模态）。 */
  model: string;
  /** 采样温度。**DeepSeek 忽略它**（不报错），保留给自定义兼容服务。 */
  temperature: number;
  /** 输出上限。省略 = 服务端默认。 */
  maxTokens?: number;
  /**
   * 思考强度。**原生参数**，不是提示词：`off` → `thinking:{type:'disabled'}`；
   * 其余 → `thinking:{type:'enabled'}` + `reasoning_effort: 'low'|'high'|'max'`。
   */
  effort: ReasoningEffort;
  /**
   * 直连失败时的同源兜底路径。`null` = 不兜底。
   *
   * 由 `vite.config.ts` 的 `llmProxy()` 中间件提供（dev 与 preview 都注册）。
   */
  proxyPath: string | null;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-flash',
  temperature: 0.3,
  effort: 'high',
  proxyPath: '/__llm',
};

/* ---------------------------------------------------------------- 线格式 */

export type WirePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | WirePart[] | null;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
  /**
   * 思维链。**携带 `tools` 的请求必须完整回传**（官方文档：漏传 = 400），
   * 即使该轮没有实际发起工具调用。`session` 在构造 assistant 消息时回填。
   */
  reasoning_content?: string;
  /** 部分兼容服务要求 tool 消息带函数名；DeepSeek 不要求，带上无害。 */
  name?: string;
}

export interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ToolCallResult {
  id: string;
  name: string;
  /** 原始 JSON 字符串（由模型生成，可能不合法）。 */
  arguments: string;
}

export interface ChatResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCallResult[];
  usage: LlmUsage | null;
  finishReason: string | null;
}

/* ------------------------------------------------------------------ 错误 */

export type LlmErrorCode =
  | 'no-key'
  | 'auth'
  | 'balance'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'bad-response'
  | 'server';

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/* ------------------------------------------------------------------ 事件 */

export type AgentStatus = 'idle' | 'thinking' | 'tool' | 'awaiting-approval' | 'awaiting-user' | 'error';

export interface ToolCallEvent {
  kind: 'tool';
  /** 工具调用 id（同一个 call 的 running / done 两条事件用它配对）。 */
  callId: string;
  name: string;
  args: unknown;
  status: 'running' | 'ok' | 'error';
  /** 结果文本（已截断）。 */
  text?: string;
  code?: string;
  ms?: number;
}

export type SessionEvent =
  | { kind: 'user'; text: string; images?: { base64: string; mimeType: string }[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'image'; base64: string; mimeType: string; caption: string }
  /** 模型通过 `ask_user` 主动暂停（面板弹一张问答卡）。 */
  | { kind: 'ask'; question: string; options: string[]; allowFreeText: boolean }
  /** 会话层自己的提示（重复调用提醒、上下文压缩等），不是模型的输出。 */
  | { kind: 'notice'; text: string }
  /** 上下文用量（面板的环形进度条）。`tokens` 优先取服务端 usage。 */
  | { kind: 'context'; tokens: number; limit: number }
  | ToolCallEvent
  | { kind: 'error'; message: string; code?: string }
  | { kind: 'turn-end'; writes: number; ms: number };

/* ------------------------------------------------------------------ 工具结果 */

export interface ToolOutcome {
  ok: boolean;
  /** 回给模型的文本（JSON 或一句话）。 */
  text: string;
  /** 需要注入成 user 消息的截图。 */
  images?: { base64: string; mimeType: string; caption: string }[];
  /** 机器可读的失败码（`needs-approval` 等）。 */
  code?: string;
  /** 失败的结构化细节（`needs-approval` 时带 pluginId / 源码体积）。 */
  detail?: unknown;
}
