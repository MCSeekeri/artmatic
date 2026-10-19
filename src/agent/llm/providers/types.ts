/**
 * providers/types.ts — 提供商描述的结构。
 *
 * 设计判据只有一条：**凡是「同一家不同模型行为不同」的，都必须落在 `ModelRule`
 * 里，不能落在 `ProviderDef` 上。** 智谱既有能关思考的 glm-4.x，也有关不掉的
 * glm-5.3；OpenAI 既有能用 `max_tokens` 的老模型，也有只认 `max_completion_tokens`
 * 的推理模型。把它们写进 provider 级字段，换模型时就必然错。
 */

import type { MessageKey } from '../../../i18n/locales';
import type { ReasoningEffort } from '../types';
import type { ProviderId } from './ids';

export type ProtocolId = 'openai' | 'anthropic';

/**
 * 思考开关的原生形态。响应里读哪个字段是另一件事（`field`），两者刻意分开：
 * 豆包用 `thinking.type` 开、回 `reasoning_content`；OpenRouter 用 `reasoning.effort`
 * 开、回 `reasoning_details`。
 */
export type ReasoningStyle =
  /** `thinking:{type}` + `reasoning_effort:'low'|'high'|'max'`（DeepSeek） */
  | 'deepseek'
  /** 只有 `thinking:{type:'enabled'|'disabled'}`（智谱 / 豆包 / Kimi） */
  | 'toggle'
  /** `enable_thinking:bool` + `thinking_budget:int`（通义千问 / 硅基流动） */
  | 'budget'
  /** `reasoning_effort:'low'|'medium'|'high'`（OpenAI / Gemini / xAI / MiniMax） */
  | 'effort'
  /** `reasoning:{effort}`（OpenRouter） */
  | 'openrouter'
  /** `thinking:{type:'enabled',budget_tokens:N}`（Anthropic） */
  | 'anthropic';

/** 响应里思维链所在的位置。 */
export type ReasoningField =
  | 'reasoning_content'
  | 'reasoning'
  | 'reasoning_details'
  | 'thinking_blocks'
  | 'none';

/**
 * 下一轮请求要不要把思维链带回去。
 *
 *   required  DeepSeek（带 tools 时漏传 = 400）、Anthropic（signature 必须原样）
 *   optional  有就带（豆包 / Kimi / OpenRouter 的 `reasoning_details`）
 *   never     完全删掉（智谱官方明确不回传；OpenAI chat completions 不认这个字段）
 */
export type EchoPolicy = 'required' | 'optional' | 'never';

/** 模型级的例外。按 `prefix` 最长匹配，`registry.modelRule()` 负责查。 */
export interface ModelRule {
  /** 模型 id 前缀（大小写敏感）。空串 = 该 provider 的兜底规则。 */
  prefix: string;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /**
   * 采样温度。
   *   send 原样发（默认）
   *   omit 不发（推理模型只接受默认值）
   *   one  发 1
   */
  temperature?: 'send' | 'omit' | 'one';
  /** 该模型拒绝 `thinking:{type:'disabled'}`，传了直接 400。 */
  alwaysThinking?: boolean;
  /** 覆盖 provider 的上下文窗口（同家不同模型差一个数量级）。 */
  contextWindow?: number;
  /** 该模型不收图片。为 true 时 session 跳过截图注入，避免「凭空描述画面」。 */
  noImages?: boolean;
}

export interface ThinkingPolicy {
  style: ReasoningStyle;
  field: ReasoningField;
  echo: EchoPolicy;
  /** 默认能否关掉思考。模型级例外走 `ModelRule.alwaysThinking`。 */
  canDisable: boolean;
  /** UI 档位 → 原生值。缺省恒等。 */
  effortMap?: Partial<Record<Exclude<ReasoningEffort, 'off'>, string>>;
  /** 档位 → token 预算（`budget` / `anthropic` 用）。 */
  budgets?: Partial<Record<Exclude<ReasoningEffort, 'off'>, number>>;
}

export interface RequestPolicy {
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
  /** Anthropic 的 `max_tokens` 是必填项；`null` = 只在用户设置时才发。 */
  defaultMaxTokens: number | null;
  /** 服务端不支持 `stream_options` 时会 400（不是忽略）。 */
  streamUsage: boolean;
  temperature: 'send' | 'omit' | 'one';
}

export interface TransportPolicy {
  /**
   * **先试直连**，在收到第一个字节之前失败才退化到 `/__llm`。
   * `false` = 官方明确拒绝带 `Origin` 的请求（目前只有 OpenAI），只走代理。
   */
  browserDirect: boolean;
  /** 允许经 `/__llm/<id>/...` 转发。`custom` 为 false：目标不可信，不代转。 */
  proxy: boolean;
}

export interface ProviderDef {
  id: ProviderId;
  /** i18n 键 `agent.provider.<id>`（品牌名进语言表，`src/` 不许有中文）。 */
  labelKey: MessageKey;
  group: 'cn' | 'intl' | 'custom';
  protocol: ProtocolId;
  /** 不带尾斜杠、不含端点路径。 */
  baseUrl: string;
  /** `/chat/completions` 或 `/messages`。 */
  endpointPath: string;
  auth: 'bearer' | 'anthropic';
  /** 协议固定头（不含鉴权）。 */
  headers?: Readonly<Record<string, string>>;
  /**
   * 预设模型，**第一项是该家的默认**。可以是别名（`qwen-plus` 这类会随服务端前移）。
   * 值会腐烂 —— 所以 UI 里模型名必须可手填，预设只是省打字。
   */
  models: readonly string[];
  /**
   * 默认上下文窗口（token）。取**保守下界**：宁可早一点压缩，也不要在跑到一半时
   * 400（现有 400 自愈会清空历史，用户看到的是「聊着聊着失忆了」）。
   */
  contextWindow: number;
  thinking: ThinkingPolicy;
  request: RequestPolicy;
  transport: TransportPolicy;
  modelRules?: readonly ModelRule[];
}
