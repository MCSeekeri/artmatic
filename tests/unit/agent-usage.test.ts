import { describe, expect, it } from 'vitest';
import { cacheStatsOf, mergeCacheStats } from '../../src/agent/llm/usage';
import type { LlmUsage } from '../../src/agent/llm/types';

describe('缓存账：各家 usage 口径归一', () => {
  it('DeepSeek：命中 / 未命中各一个字段，prompt_tokens 是两者之和', () => {
    const usage: LlmUsage = {
      prompt_tokens: 10_000,
      completion_tokens: 200,
      prompt_cache_hit_tokens: 8_000,
      prompt_cache_miss_tokens: 2_000,
    };
    const stats = cacheStatsOf(usage)!;
    expect(stats.hit).toBe(8_000);
    expect(stats.newTokens).toBe(2_000);
    expect(stats.total).toBe(10_000);
    expect(stats.rate).toBeCloseTo(0.8);
  });

  it('OpenAI 兼容家族：prompt_tokens_details.cached_tokens', () => {
    const stats = cacheStatsOf({
      prompt_tokens: 1_075,
      completion_tokens: 12,
      prompt_tokens_details: { cached_tokens: 1_024 },
    })!;
    expect(stats.hit).toBe(1_024);
    expect(stats.newTokens).toBe(51);
    expect(stats.rate).toBeCloseTo(1024 / 1075);
  });

  it('阿里部分模型：顶层的 cached_tokens 也认', () => {
    const stats = cacheStatsOf({ prompt_tokens: 2_000, cached_tokens: 1_500 })!;
    expect(stats.hit).toBe(1_500);
    expect(stats.total).toBe(2_000);
  });

  it('Anthropic：input_tokens **不含**缓存读，分母要自己加回来', () => {
    const stats = cacheStatsOf({
      input_tokens: 82,
      cache_read_input_tokens: 1_536,
      cache_creation_input_tokens: 0,
      prompt_tokens: 1_618,
      output_tokens: 14,
    })!;
    expect(stats.hit).toBe(1_536);
    expect(stats.total).toBe(1_618);
    expect(stats.rate).toBeCloseTo(1536 / 1618);
  });

  it('Anthropic 缓存写入计入分母（它不是命中，但确实被计费）', () => {
    const stats = cacheStatsOf({
      input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 5_000,
      prompt_tokens: 5_000,
    })!;
    expect(stats.hit).toBe(0);
    expect(stats.newTokens).toBe(5_000);
    expect(stats.writes).toBe(5_000);
    expect(stats.rate).toBe(0);
  });

  it('这家不上报缓存 → null（不是 0%）', () => {
    expect(cacheStatsOf({ prompt_tokens: 900, completion_tokens: 30 })).toBeNull();
    expect(cacheStatsOf(null)).toBeNull();
  });

  it('上报了但命中 0 → 真的 0%（第一次请求必然如此）', () => {
    const stats = cacheStatsOf({ prompt_tokens: 900, prompt_tokens_details: { cached_tokens: 0 } })!;
    expect(stats).not.toBeNull();
    expect(stats.rate).toBe(0);
    expect(stats.total).toBe(900);
  });

  it('命中数超过总数时钳住（个别实现把「含缓存的输入」也报进来）', () => {
    const stats = cacheStatsOf({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 400 } })!;
    expect(stats.hit).toBe(100);
    expect(stats.rate).toBe(1);
  });

  it('脏值（负数 / NaN / 字符串）不产生 NaN 宽度', () => {
    const stats = cacheStatsOf({
      prompt_tokens: 500,
      prompt_tokens_details: { cached_tokens: Number.NaN },
    });
    // 命中字段不可用 → 当这家没上报
    expect(stats).toBeNull();
  });
});

describe('缓存账：一轮多次请求求和', () => {
  it('命中率按总量重算，不平均百分比', () => {
    const a = cacheStatsOf({ prompt_tokens: 10_000, prompt_tokens_details: { cached_tokens: 0 } })!;
    const b = cacheStatsOf({ prompt_tokens: 10_000, prompt_tokens_details: { cached_tokens: 9_000 } })!;
    const merged = mergeCacheStats(a, b)!;
    expect(merged.total).toBe(20_000);
    expect(merged.hit).toBe(9_000);
    // 平均百分比会得 45%，真实成本是 45%… 这里两者恰好相同，用不等权再看一例
    expect(merged.rate).toBeCloseTo(0.45);
  });

  it('不等权：小请求不会把命中率拉平', () => {
    const big = cacheStatsOf({ prompt_tokens: 100_000, prompt_tokens_details: { cached_tokens: 90_000 } })!;
    const small = cacheStatsOf({ prompt_tokens: 1_000, prompt_tokens_details: { cached_tokens: 0 } })!;
    const merged = mergeCacheStats(big, small)!;
    expect(merged.rate).toBeCloseTo(90_000 / 101_000);
  });

  it('一侧缺席时保留另一侧（这家某一步没带 usage）', () => {
    const a = cacheStatsOf({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 50 } })!;
    expect(mergeCacheStats(null, a)).toEqual(a);
    expect(mergeCacheStats(a, null)).toEqual(a);
    expect(mergeCacheStats(null, null)).toBeNull();
  });
});
