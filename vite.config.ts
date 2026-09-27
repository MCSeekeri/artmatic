/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  // vitest 只收 tests/unit。不排除的话它会去跑 tests/e2e/*.spec.ts，
  // 报一句「Playwright Test did not expect test() to be called here」然后
  // 把「6 个文件失败」算进汇总——纯噪声，会淹掉真正的失败。
  test: { include: ['tests/unit/**/*.test.ts'] },
});
