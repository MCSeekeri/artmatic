/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { llmProxy } from './scripts/llm-proxy.mjs';
import { PROXY_ROUTES } from './src/agent/llm/providers/registry';

/**
 * 版本号的**单一真源是 `package.json`**。这里读出来注入成编译期常量
 * （`__APP_VERSION__`），UI 直接用 —— 不要在组件里再写一遍字面量，
 * 那种副本必然会在某次升版本时漏掉。
 */
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

/**
 * `GET /__capacity.json` —— 把**这台机器**的真实内存 / 显存交给页面。
 *
 * ## 为什么走服务端
 *
 * 页面测不到容量（`navigator.deviceMemory` 粗到 GB、`performance.memory` 只是
 * JS 堆、WebGL 连显存大小都不说）。而 Node 侧 `os.freemem()` + `nvidia-smi` /
 * 注册表拿得到真实数字 —— 而且**必须由服务端在启动后探测**：这时用户的工作负载
 * （IDE、浏览器）已经在跑了，「可用内存」才是那个能用的判据。
 *
 * ## 为什么两边都注册
 *
 * 与 `labRedirect` 同一条理由：E2E 与 `bun run preview` 跑的是 preview 服务，
 * 只注册 dev 那侧等于让自动化测试永远拿不到真实容量（也就永远测不到「预算不足时
 * 的降级路径」）。
 *
 * ## 刻意不做的事
 *
 * **不在这里派生预算**，只给「机器事实」+ 配置文件里的显式覆盖。比例与夹取
 * 属于策略，必须与页面共用同一份（`src/core/capacity.ts`）—— 两处各算一遍
 * 「推荐值」是必然会漂的形态。纯静态部署（没有 Node）时这个路由不存在，
 * 页面 fetch 失败后退回保守默认。
 */
function capacityEndpoint(): Plugin {
  /** 探测要 spawn 外部命令，别每个请求都做；缓存 30 s（会话内够用且不吃 IO）。 */
  const TTL_MS = 30_000;
  let cached: { at: number; body: string } | null = null;

  const handler = (
    req: { url?: string; method?: string },
    res: { statusCode: number; setHeader(k: string, v: string): void; end(b?: string): void },
    next: () => void,
  ): void => {
    if (!req.url?.startsWith('/__capacity.json')) return next();
    void (async () => {
      try {
        const now = Date.now();
        if (!cached || now - cached.at > TTL_MS) {
          const { capacityPayload } = await import('./scripts/capacity.mjs');
          cached = { at: now, body: JSON.stringify(await capacityPayload()) };
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        // 同源、只读：显式禁掉缓存，免得浏览器把「启动那一刻」的可用内存缓存一整天。
        res.setHeader('Cache-Control', 'no-store');
        res.end(cached.body);
      } catch (e) {
        // 探测失败不是错误：页面那边会退回默认预算。这里只回一个空壳。
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ machine: null, overrides: null, error: String(e) }));
      }
    })();
  };

  return {
    name: 'artmatic:capacity',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

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
  plugins: [svelte(), labRedirect(), capacityEndpoint(), llmProxy({ routes: PROXY_ROUTES })],
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
