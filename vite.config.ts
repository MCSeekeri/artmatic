/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * 版本号的**单一真源是 `package.json`**。这里读出来注入成编译期常量
 * （`__APP_VERSION__`），UI 直接用 —— 不要在组件里再写一遍字面量，
 * 那种副本必然会在某次升版本时漏掉。
 */
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

/**
 * `/lab`（无尾斜杠）会被 SPA fallback 静默端上**主应用** —— 页面看起来能开，
 * 其实是另一个页面，排查起来很费时间。dev 与 preview 两侧都要兜住：
 * openmosh 的 lab 只注册了 dev 那一侧，而我们的 E2E 跑的是 preview。
 *
 * E2E 一律访问 `/lab/`（带尾斜杠）：这个中间件是给手敲地址的人用的兜底。
 */
function labRedirect(): Plugin {
  const isLabBare = (url: string | undefined): boolean =>
    url === '/lab' || !!url?.startsWith('/lab?') || !!url?.startsWith('/lab#');

  const redirect = (
    req: { url?: string },
    res: { statusCode: number; setHeader(k: string, v: string): void; end(): void },
    next: () => void,
  ): void => {
    if (!isLabBare(req.url)) return next();
    res.statusCode = 302;
    res.setHeader('Location', `/lab/${req.url!.slice(4)}`);
    res.end();
  };

  return {
    name: 'artmatic:lab-redirect',
    configureServer(server) {
      server.middlewares.use(redirect);
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirect);
    },
  };
}

export default defineConfig({
  plugins: [svelte(), labRedirect()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    /*
     * 双入口：主应用 index.html + 试炼场 lab/index.html。
     *
     * lab 之所以**进 build**（而不是像 openmosh 那样 dev-only）：本项目的 E2E
     * 走 `scripts/e2e.mjs` 的 build → vite preview 管线，产物里没有它就没有
     * 任何自动化覆盖。试炼场会长期用来决定「下一个特效该不该进注册表、
     * 默认参数定多少」，这种工具恰恰最该有回归。
     *
     * Vite 配置是 ESM，没有 __dirname —— 必须 fileURLToPath(new URL(...))。
     */
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        lab: fileURLToPath(new URL('./lab/index.html', import.meta.url)),
      },
      output: {
        /**
         * 图标选择器的数据（`ui/typography/icon-library.ts` 对 lucide 图标源文件
         * 的 `?raw` 懒加载）：**按首字母分组**，不要「一个图标一个 chunk」。
         *
         * 逐图标成 chunk 在功能上没问题（每个 1~2 KB，确实只加载用得上的那几个），
         * 但每次 `vite build` 的 `prepareOutDir` 都要删掉两千个小文件 —— 实测会
         * 顶爆开发机的**批量删除保护**（`[safe-delete]` 阈值 500），于是第二次
         * 构建开始必然失败。dist 里两千个文件的复制/清理成本也不该被常态化。
         *
         * 分组之后：打开选择器 = 取列表头部那几个字母组（一个组一次请求），
         * 滚动 / 搜索到别的字母再取对应组 —— 请求数比逐图标还少。
         */
        manualChunks(id) {
          const m = /[/\\]@lucide[/\\]svelte[/\\]dist[/\\]icons[/\\]([a-z0-9])/.exec(id);
          return m ? `lucide-icon-${m[1]}` : undefined;
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  // vitest 只收 tests/unit。不排除的话它会去跑 tests/e2e/*.spec.ts，
  // 报一句「Playwright Test did not expect test() to be called here」然后
  // 把「6 个文件失败」算进汇总——纯噪声，会淹掉真正的失败。
  test: { include: ['tests/unit/**/*.test.ts'] },
});
