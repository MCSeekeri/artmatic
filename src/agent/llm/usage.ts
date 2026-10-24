/**
 * usage.ts — 把各家**互不相同的 usage 口径**归一成一本缓存账（纯函数，可单测）。
 *
 * 为什么值得单独一层：命中率的分子分母在不同家的含义完全不同，
 * 混着读会得出荒谬的结论（例如把 Anthropic 的 `input_tokens`（已排除缓存）
 * 当分母，命中率会超过 100%）。四家的官方口径（2026-10 核实）：
 *
 * | 家 | 命中 | 未命中 | 输入总数 |
 * |---|---|---|---|
 * | DeepSeek | `prompt_cache_hit_tokens` | `prompt_cache_miss_tokens` | `prompt_tokens`（= 两者之和） |
 * | 智谱 / Kimi / 阿里 / OpenAI | `prompt_tokens_details.cached_tokens` | 余下 | `prompt_tokens` |
 * | 阿里（部分模型 / 地域） | 顶层 `cached_tokens` | 余下 | `prompt_tokens` |
 * | Anthropic | `cache_read_input_tokens` | `input_tokens + cache_creation_input_tokens` | `input_tokens` **不含**缓存 |
 *
 * **没有字段 = 这家没上报**，返回 null（面板就不显示），绝不假装 0%。
 * 而「有字段且为 0」是真的 0%（第一次请求必然如此）—— 这两件事必须分清。
 */

import type { CacheStats, LlmUsage } from './types';

/** 只接受非负有限数：服务端偶尔给 `null` 或字符串，别让它变成 NaN 宽度。 */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/** 一次请求的缓存账；这家没上报任何缓存字段时返回 null。 */
export function cacheStatsOf(usage: LlmUsage | null | undefined): CacheStats | null {
  if (!usage) return null;
  const details = usage.prompt_tokens_details ?? {};

  const hit =
    num(usage.prompt_cache_hit_tokens) ??
    num(details.cached_tokens) ??
    num(usage.cached_tokens) ??
    num(usage.cache_read_input_tokens);
  const writes =
    num(details.cache_write_tokens) ??
    num(details.cache_creation_input_tokens) ??
    num(usage.cache_creation_input_tokens) ??
    0;

  /*
   * Anthropic 家族：`input_tokens` 只算「既没命中也没写入缓存」的那部分，
   * 所以总数要自己加回来。判据是「出现了缓存读/写字段」——
   * 只有这一家是这种减法口径。
   */
  const cacheSplit =
    num(usage.cache_read_input_tokens) !== undefined ||
    num(usage.cache_creation_input_tokens) !== undefined;

  if (hit === undefined && !cacheSplit) return null; // 这家不上报

  const total = cacheSplit
    ? (num(usage.input_tokens) ?? 0) + (num(usage.cache_read_input_tokens) ?? 0) + (num(usage.cache_creation_input_tokens) ?? 0)
    : (num(usage.prompt_tokens) ?? (hit !== undefined ? hit + (num(usage.prompt_cache_miss_tokens) ?? 0) : 0));

  if (total <= 0) return null;
  // 命中数不该超过总数（个别实现把「包含缓存的输入」也算进去），钳一下再算比率。
  const hitTokens = Math.min(hit ?? 0, total);
  return {
    hit: hitTokens,
    newTokens: total - hitTokens,
    total,
    writes,
    rate: hitTokens / total,
  };
}

/** 把一轮里多次请求的账相加（命中率按总量重算，不平均百分比）。 */
export function mergeCacheStats(
  a: CacheStats | null,
  b: CacheStats | null,
): CacheStats | null {
  if (!a) return b;
  if (!b) return a;
  const hit = a.hit + b.hit;
  const total = a.total + b.total;
  return {
    hit,
    newTokens: total - hit,
    total,
    writes: a.writes + b.writes,
    rate: total > 0 ? hit / total : 0,
  };
}
