/**
 * Stryker 配置 —— 变异测试。
 *
 * 目的：自动回答「这条守卫是不是假测试」。与 Google 的实践对齐 ——
 * 只变异**本次改动**涉及的文件，而不是整个代码库（见 AGENTS §6 的守卫一节）。
 *
 * 用法：
 *   pnpm exec stryker run --mutate src/core/bitmask.ts # 探针
 *   pnpm exec stryker run                              # 走本文件的 mutate 范围
 *
 * 注意：`coverageAnalysis: 'perTest'` 是关键 —— 它让每个 mutant 只跑
 * 「覆盖到它的那几个测试」，而不是整套（官方数据 5–10× 提速）。
 */
const changed = process.env.STRYKER_MUTATE;

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vite.config.ts' },
  // 默认只扫核心纯函数层；传 STRYKER_MUTATE 或 --mutate 覆盖成本次 diff 的文件。
  mutate: changed ? changed.split(',').map((s) => s.trim()) : ['src/core/**/*.ts'],
  coverageAnalysis: 'perTest',
  // clear-text = 人看的，json = 给 agent 只读的标量（survived/total），html = 逐行浏览。
  reporters: ['clear-text', 'json', 'html'],
  jsonReporter: { fileName: '.stryker-report.json' },
  htmlReporter: { fileName: '.stryker-reports/mutation.html' },
  concurrency: 4,
  timeoutMS: 20000,
  tempDirName: '.stryker-tmp',
  thresholds: { high: 90, low: 70, break: null },
};
