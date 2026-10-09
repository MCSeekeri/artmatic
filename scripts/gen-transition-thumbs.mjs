/**
 * gen-transition-thumbs.mjs — 批量导出**转场缩略图**（静态 WebP）。
 *
 * ## 它做什么
 *
 * build → vite preview → 开 `/lab/` → 逐个转场调
 * `__lab.renderTransitionThumb(id, height)` → 把 WebP 字节写进
 * `src/assets/transition-thumbnails/<id>.webp`。
 *
 * 每张图是**两张不同的底图在 50% 进度**的过渡状态：渲染侧造一张最小工程
 * （`from` 源 → `to` 源，`transitionOut` 挂在 `from` 上），在剪切点渲一帧，
 * 于是 `progress` 恰好 0.5。细节见 `src/render/transition-thumb-renderer.ts`。
 *
 * ## 为什么是脚本而不是 lab 里的一个按钮
 *
 * 与 `gen-algo-thumbs.mjs` 同一条理由：素材**跟着代码走**，一条命令落盘、
 * 谁都能重放，中间没有「导出了但忘了解压 / 解压到别处」这一步。
 *
 * ## 两个必须注意的点
 *
 * 1. **转场是同步渲染，不需要重试**（不像 bake 型生成器有异步就绪）。一次调用
 *    拿一张图；拿不到（离屏上下文建不出来）就是硬失败，直接中止。
 * 2. **编译失败的条目要报错。** 某条转场的着色器编译不过时，`runner.ts` 会退化成
 *    内置 dissolve —— 那样导出的缩略图**不代表这条转场**。`__lab` 回传 `failed`
 *    标出来，脚本据此非零退出（与 `compileAllTransitions` 在 E2E 里守同一件事）。
 *
 * 用法：`node scripts/gen-transition-thumbs.mjs`（可选 `--height=360`）。
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const PORT = 4174;
const OUT_DIR = fileURLToPath(new URL('../src/assets/transition-thumbnails', import.meta.url));
const node = process.execPath;

const heightArg = process.argv.find((a) => a.startsWith('--height='));
const HEIGHT = heightArg ? Number(heightArg.slice('--height='.length)) : 360;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`))));
    p.on('error', reject);
  });
}

async function waitForPort(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* 还没起来 */
    }
    await delay(300);
  }
  throw new Error(`等待 ${url} 超时`);
}

/** `data:image/webp;base64,….` → Buffer。 */
function decodeDataUrl(url) {
  const comma = url.indexOf(',');
  if (comma < 0) throw new Error('不是 data URL');
  return Buffer.from(url.slice(comma + 1), 'base64');
}

let server = null;
let browser = null;
try {
  console.log('[tr-thumbs] vite build …');
  await run(node, ['node_modules/vite/bin/vite.js', 'build']);

  console.log('[tr-thumbs] 启动 vite preview …');
  server = spawn(
    node,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore' },
  );
  await waitForPort(`http://localhost:${PORT}/lab/`);

  await mkdir(OUT_DIR, { recursive: true });

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/lab/`);
  await page.waitForFunction(() => Boolean(window.__lab));

  // 探一次：`renderTransitionThumb` 在建不出上下文时返回 null，那会与「这条转场
  // 有问题」混在一起，先探一次把「上下文建不出来」这种情况排除掉。
  const jobs = await page.evaluate(() => window.__lab.transitionThumbJobs());
  const probe = await page.evaluate(
    ({ id, height }) => window.__lab.renderTransitionThumb(id, height),
    { id: jobs[0], height: HEIGHT },
  );
  if (!probe) {
    throw new Error('离屏渲染器没建起来（WebGL 上下文创建失败）—— 中止，免得写出一堆空文件');
  }

  console.log(`[tr-thumbs] ${jobs.length} 条转场（首条 ${jobs[0]}），高度 ${HEIGHT}`);

  const written = [];
  const failedRender = [];
  const failedCompile = [];
  /** 50% 恰好是纯色、改用邻近进度的那些（见渲染器的 PROGRESS_CANDIDATES）。 */
  const shifted = [];
  for (const id of jobs) {
    const r = await page.evaluate(
      ({ id, height }) => window.__lab.renderTransitionThumb(id, height),
      { id, height: HEIGHT },
    );
    if (!r) {
      failedRender.push(id);
      console.log(`  ×  ${id}`);
      continue;
    }
    if (r.failed) {
      // 编译失败 → 跑的是 dissolve 兜底，这张图不能代表这条转场。
      failedCompile.push(id);
      console.log(`  !  ${id}（编译失败，将是 dissolve 兜底 —— 不写盘）`);
      continue;
    }
    const buf = decodeDataUrl(r.dataUrl);
    await writeFile(`${OUT_DIR}/${id}.webp`, buf);
    written.push(id);
    if (Math.abs(r.progress - 0.5) > 1e-6) {
      shifted.push(`${id} @ ${r.progress}`);
      console.log(`  ~  ${id.padEnd(28)} ${(buf.length / 1024).toFixed(1)} KB  （50% 是纯色 → ${r.progress}）`);
    } else {
      console.log(`  ok ${id.padEnd(28)} ${(buf.length / 1024).toFixed(1)} KB`);
    }
  }

  // 清掉孤儿：对应的转场已经不在目录里了（上游更新删除条目时会走到）。
  const known = new Set(jobs);
  const stale = (await readdir(OUT_DIR)).filter(
    (f) => f.endsWith('.webp') && !known.has(f.replace(/\.webp$/, '')),
  );
  for (const f of stale) {
    await unlink(`${OUT_DIR}/${f}`);
    console.log(`  -  删除孤儿 ${f}`);
  }

  const files = await readdir(OUT_DIR);
  const sizes = await Promise.all(files.map((f) => stat(`${OUT_DIR}/${f}`)));
  const totalKb = sizes.reduce((a, s) => a + s.size, 0) / 1024;

  console.log(
    `\n[tr-thumbs] 写入 ${written.length} 张，删除孤儿 ${stale.length} 张，` +
      `目录共 ${totalKb.toFixed(0)} KB`,
  );
  if (shifted.length) {
    // 不算失败：中点本来就退化成纯色的那几条，换个进度才是它们真实的样子。
    console.log(`[tr-thumbs] ${shifted.length} 条在 50% 是纯色，改用邻近进度：\n  ${shifted.join('\n  ')}`);
  }
  if (failedRender.length) {
    console.error(`[tr-thumbs] 渲染失败 ${failedRender.length} 条：\n  ${failedRender.join('\n  ')}`);
  }
  if (failedCompile.length) {
    console.error(
      `[tr-thumbs] 编译失败 ${failedCompile.length} 条（会退化成 dissolve，缩略图不可用）：\n  ${failedCompile.join('\n  ')}`,
    );
  }
  if (failedRender.length || failedCompile.length) {
    process.exitCode = 1;
  } else {
    console.log('[tr-thumbs] 全部成功');
  }
} finally {
  await browser?.close();
  server?.kill();
}
