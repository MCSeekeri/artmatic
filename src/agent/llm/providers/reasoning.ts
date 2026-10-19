/**
 * providers/reasoning.ts — 思考参数 / 输出上限 / 温度的**纯换算**。
 *
 * 这一层存在的理由：同一件事在三家是三种字段名，而且「关不掉思考」是**模型级**
 * 而不是厂商级的。把这些判断散进两个适配器，第 17 家进来时必然只改了一边。
 *
 * 所有导出都是纯函数：不读时钟、不碰 DOM、不发请求 —— 所以能直接单测，
 * 也能被 `test:mutate` 验证。
 */

import type { LlmConfig, ReasoningEffort } from '../types';
import { modelRule } from './registry';
import type { ProviderDef } from './types';

/** 该 (provider, model) 是否属于「思考关不掉」的那一类。 */
function alwaysThinking(def: ProviderDef, model: string): boolean {
  return modelRule(def, model)?.alwaysThinking === true;
}

/**
 * 思考开关 + 强度的原生参数（**这是唯一一处**把 UI 档位翻译成各家字段的地方）。
 *
 * UI 档位固定四档 `off / low / high / max`：`off` 在 DeepSeek 是
 * `thinking:{type:'disabled'}`，在 OpenAI 是「干脆不发 `reasoning_effort`」
 * （由服务端默认值决定），在 Anthropic 是不发 `thinking`。
 *
 * `alwaysThinking` 的模型（GLM 5.3 / MiniMax M3.1）在 `off` 档**绝不能**出现
 * `type:'disabled'` —— 那是 400，不是降级。
 */
export function thinkingParamsFor(
  def: ProviderDef,
  effort: ReasoningEffort,
  model: string,
): Record<string, unknown> {
  const policy = def.thinking;

  if (effort === 'off') {
    if (alwaysThinking(def, model)) {
      // 关不掉：不发开关（服务端默认就是开），budget 形态显式 true 保证别被默认关掉。
      return policy.style === 'budget' ? { enable_thinking: true } : {};
    }
    switch (policy.style) {
      case 'deepseek':
      case 'toggle':
        return { thinking: { type: 'disabled' } };
      case 'budget':
        return { enable_thinking: false };
      default:
        return {};
    }
  }

  const level = policy.effortMap?.[effort] ?? effort;
  switch (policy.style) {
    case 'deepseek':
      return { thinking: { type: 'enabled' }, reasoning_effort: level };
    case 'toggle':
      return { thinking: { type: 'enabled' } };
    case 'budget': {
      const budget = policy.budgets?.[effort];
      return { enable_thinking: true, ...(budget ? { thinking_budget: budget } : {}) };
    }
    case 'effort':
      return { reasoning_effort: level };
    case 'openrouter':
      return { reasoning: { effort: level } };
    case 'anthropic':
      return { thinking: { type: 'enabled', budget_tokens: policy.budgets?.[effort] ?? 2_048 } };
  }
}

/** UI 上「关闭思考」这一档是否可选。 */
export function canDisableThinking(def: ProviderDef, model: string): boolean {
  return def.thinking.canDisable && !alwaysThinking(def, model);
}

/** 该档位实际花在思考上的预算（只有 `budget` / `anthropic` 形态有）。 */
export function thinkingBudgetFor(def: ProviderDef, effort: ReasoningEffort): number {
  if (effort === 'off') return 0;
  return def.thinking.budgets?.[effort] ?? 0;
}

/**
 * 采样温度。三种情况必须**不发**：
 *   1. 模型规则 `omit`（OpenAI 推理模型只接受默认值）
 *   2. Anthropic 开着思考（官方明确：开 thinking 时传 temperature 会 400）
 *   3. 其余按 provider 默认
 */
export function temperatureFor(
  def: ProviderDef,
  effort: ReasoningEffort,
  model: string,
  value: number,
): number | undefined {
  if (def.thinking.style === 'anthropic' && effort !== 'off') return undefined;
  const mode = modelRule(def, model)?.temperature ?? def.request.temperature;
  if (mode === 'omit') return undefined;
  if (mode === 'one') return 1;
  return value;
}

/** 输出上限该写进哪个字段（OpenAI 推理模型只认 `max_completion_tokens`）。 */
export function maxTokensFieldFor(def: ProviderDef, model: string): string {
  return modelRule(def, model)?.maxTokensField ?? def.request.maxTokensField;
}

/**
 * 输出上限的**有效值**。
 *
 * Anthropic 的 `max_tokens` 必填，而且必须大于 `budget_tokens`，否则 400 ——
 * 错误体是 `thinking.budget_tokens`，用户完全看不懂。这里统一夹一道下界。
 * 其余协议用户没设就不发（沿用服务端默认）。
 */
export function outputTokensFor(
  def: ProviderDef,
  config: LlmConfig,
): number | undefined {
  const budget = def.thinking.style === 'anthropic' ? thinkingBudgetFor(def, config.effort) : 0;
  if (def.request.defaultMaxTokens === null) return config.maxTokens;
  return Math.max(config.maxTokens ?? def.request.defaultMaxTokens, budget + 1_024);
}
