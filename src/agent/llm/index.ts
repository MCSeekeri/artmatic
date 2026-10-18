/**
 * llm/index.ts — 模型层的对外入口（UI 只 import 这里）。
 *
 * 分层：`provider`（网络 + SSE）→ `session`（工具循环）→ `executor`（控制平面）。
 * UI 不需要知道线格式，只消费 `SessionEvent` 与 `AgentStatus`。
 */

export {
  AgentSession,
  MAX_STEPS,
  MAX_STEPS_LIMIT,
  repeatAction,
  trimMessages,
  type SessionOptions,
  type SessionSnapshot,
} from './session';
export { createToolExecutor, type ToolExecutor } from './executor';
export { streamChat, createSseParser, resetTransportPreference } from './provider';
export { SYSTEM_PROMPT } from './prompt';
export { DEFAULT_LLM_CONFIG } from './types';
export type {
  AgentStatus,
  ChatResult,
  LlmConfig,
  LlmErrorCode,
  LlmUsage,
  SessionEvent,
  ToolCallEvent,
  ToolOutcome,
  WireMessage,
  WirePart,
  WireToolCall,
} from './types';
export { LlmError } from './types';
