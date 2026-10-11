/**
 * cli.mjs — CLI 的入口：**先路由，再按需打包**。
 *
 * ## 为什么要打包（不能直接 `node cli/main.ts`）
 *
 * `cli/main.ts` 会 import `core/schema.ts` → `i18n/index.svelte.ts`（用 runes 的
 * `.svelte.ts`），而 Runes 要靠 Svelte 编译器变成普通 JS。Node 的类型剥离做不到
 * 这一步，也解析不了全项目一致的**无扩展名相对 import**（`from './schema'`）。
 * 所以用 Vite 打一份 SSR 包再 import 它 —— 与仓库里其它一切共用同一套解析规则。
 *
 * 产物落 `node_modules/.cache/artmatic-cli/`：**不进仓库、不用改 .gitignore**，
 * 而且 `node_modules` 本来就是可丢弃的。
 *
 * ## 为什么 render 不走打包
 *
 * `render` 是**驱动器**（拉起浏览器 → 页面里的控制平面出图），它一行都不碰
 * `core/` —— 所以直接跑 `.mjs` 就够了，省掉一次构建。这也是这条命令与其它命令
 * 唯一的、本质上的区别。
 *
 * 用法：
 *   node scripts/cli.mjs new ./my-project
 *   node scripts/cli.mjs validate ./my-project
 *   node scripts/cli.mjs clip add ./my-project <trackId> 0 4 --generator mandelbrot
 *   node scripts/cli.mjs diff ./a ./b
 *   node scripts/cli.mjs render ./my-project --out out.mp4 --format mp4
 */

import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * 仓库根：从本文件反推 + `realpathSync.native` 规范化盘符大小写。
 * 后者不是洁癖 —— 见 `mcp/bridge.mjs` 里 REPO_ROOT 的注释（Windows 上盘符大小写
 * 不一致会让 `import.meta.glob('/node_modules/...')` 的相对路径算错，构建直接失败）。
 */
const REPO_ROOT = realpathSync.native(fileURLToPath(new URL('..', import.meta.url)));
const OUT_DIR = join(REPO_ROOT, 'node_modules', '.cache', 'artmatic-cli');

async function buildCli() {
  const { build } = await import('vite');
  const { svelte } = await import('@sveltejs/vite-plugin-svelte');
  await build({
    configFile: false,
    root: REPO_ROOT,
    // 只报 warn 以上：CLI 的输出不该被 Vite 的进度刷屏。
    logLevel: 'warn',
    plugins: [svelte()],
    build: {
      // SSR 构建 = 目标 Node，不碰 DOM。
      ssr: join(REPO_ROOT, 'cli', 'main.ts'),
      outDir: OUT_DIR,
      emptyOutDir: true,
      target: 'node20',
      minify: false,
      sourcemap: false,
      rollupOptions: { output: { entryFileNames: 'cli.mjs' } },
    },
  });
  return pathToFileURL(join(OUT_DIR, 'cli.mjs')).href;
}

const argv = process.argv.slice(2);
const command = argv[0];

if (command === 'render') {
  // 驱动器：不起 Vite 构建，直接跑 mjs（它会自己 build + preview + 起 Chrome）。
  process.argv = [process.argv[0], join(REPO_ROOT, 'mcp', 'render-driver.mjs'), ...argv.slice(1)];
  await import(pathToFileURL(join(REPO_ROOT, 'mcp', 'render-driver.mjs')).href);
} else {
  const href = await buildCli();
  const mod = await import(href);
  mod.runCli(argv);
}
