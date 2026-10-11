import { defineConfig } from '@playwright/test';

// E2E 用系统 Chrome（channel: 'chrome'），不需要 playwright install。
// webServer 起 vite preview——vite 天生返回正确的 .mjs MIME，
// 不要换成 python http.server（它不返回 text/javascript，ESM import 会被拦）。
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    channel: 'chrome',
    headless: true,
    baseURL: 'http://localhost:4173',
  },
  // 注意：不用 webServer 配置。它经 shell spawn 长驻进程，在某些沙箱里
  // 整个进程树会收到 SIGTERM（test runner 零输出暴毙）。统一走
  // `bun run test:e2e`（scripts/e2e.mjs），由它负责 build + preview。
});
