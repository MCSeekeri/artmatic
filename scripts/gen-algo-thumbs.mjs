/**
 * gen-algo-thumbs.mjs — 批量导出**算法生成器的预览缩略图**（静态 WebP）。
 *
 * ## 它做什么
 *
 * build → vite preview → 开 `/lab/` → 逐个生成器调 `__lab.renderThumb()`
 * → 把 WebP 字节写进 `src/assets/algo-thumbnails/<id>.webp`。
 *
 * ## 为什么是脚本而不是 lab 里的一个按钮
 *
 * lab 里那条「批量导出缩略图」（特效的那套）打完 zip 还要**人工解压**进
 * `src/assets/`。素材是**跟着代码走**的，多一步人工就多一次「导出了但忘了
 * 解压 / 解压到别处」的机会。这里直接落盘，一条命令跑完，而且能被 CI 或
 * 任何人在任何机器上重放。
 *
 * ## 三个必须注意的点
 *
 * 1. **每个生成器要重试到非空。** bake 型是 Worker 里异步烘的，第一次调用时
 *    它还没好，`renderFrame` 会渲出空帧。所以这里轮询（并且**从 Node 侧**
 *    轮询 —— 在 page 里自旋会把主线程占住，Worker 的消息永远排不上）。
 * 2. **采样时刻由 `algos/catalog.ts` 给**，脚本不自己定：元胞自动机 / 反应扩散 /
 *    沙堆 / 雪花在第 0 秒是空屏，一刀切必然导出一堆黑图。
 * 3. **产物目录与 `src/ui/algo-thumb-assets.ts` 的 glob 是一对**，
 *    覆盖 / 孤儿由 `tests/unit/algo-thumb-assets.test.ts` 挡。
 *
 * 用法：`node scripts/gen-algo-thumbs.mjs`（可选 `--height=360`）。
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const PORT = 4173;
const OUT_DIR = fileURLToPath(new URL('../src/assets/algo-thumbnails', import.meta.url));
const node = process.execPath;

const heightArg = process.argv.find((a) => a.startsWith('--height='));
const HEIGHT = heightArg ? Number(heightArg.slice('--height='.length)) : 360;

/**
 * 单个生成器最多重试多少次（每次间隔 `RETRY_MS`）。
 *
 * 20 × 300ms = 6 秒。bake 型的 Worker 烘焙在建好工程后的几十毫秒内就开始跑，
 * 640×360 的 L-system 实测远低于一秒；给到 6 秒是给「机器很忙」留余量。
 */
const MAX_TRIES = 20;
const RETRY_MS = 300;

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
    } catch { /* 还没起来 */ }
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
  console.log('[thumbs] vite build …');
  await run(node, ['node_modules/vite/bin/vite.js', 'build']);

  console.log('[thumbs] 启动 vite preview …');
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
  // 等 WebGL 就绪：`renderThumb` 会在建不出上下文时返回 null，那会与
  // 「还没长出来」混在一起，先探一次把这种情况排除掉。
  const probe = await page.evaluate(() =>
    window.__lab.renderThumb('mandelbrot', 360, 0),
  );
  if (!probe) {
    throw new Error('离屏渲染器没建起来（WebGL 上下文创建失败）—— 中止，免得写出一堆空文件');
  }

  const jobs = await page.evaluate(() => window.__lab.thumbJobs());
  console.log(`[thumbs] ${jobs.length} 个生成器，高度 ${HEIGHT}`);

  const written = [];
  const failed = [];
  for (const { id, t } of jobs) {
    let dataUrl = null;
    let lit = 0;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const r = await page.evaluate(
        ({ id, height, t }) => window.__lab.renderThumb(id, height, t),
        { id, height: HEIGHT, t },
      );
      if (!r) {
        failed.push(`${id}: 渲染器返回 null`);
        break;
      }
      lit = r.lit;
      if (r.dataUrl) {
        dataUrl = r.dataUrl;
        break;
      }
      // 还没长出来（bake 未就绪 / 采样时刻太早）—— 等一下再来
      await delay(RETRY_MS);
    }
    if (!dataUrl) {
      if (!failed.some((f) => f.startsWith(`${id}:`))) {
        failed.push(`${id}: 重试 ${MAX_TRIES} 次仍是空帧（lit=${lit}, t=${t}）`);
      }
      console.log(`  ×  ${id}`);
      continue;
    }
    const buf = decodeDataUrl(dataUrl);
    await writeFile(`${OUT_DIR}/${id}.webp`, buf);
    written.push(id);
    console.log(`  ok ${id.padEnd(20)} ${(buf.length / 1024).toFixed(1)} KB  t=${t}`);
  }

  // 清掉孤儿：对应的生成器已经不存在了（否则会一直躺在构建产物里）。
  const known = new Set(jobs.map((j) => j.id));
  const stale = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.webp') && !known.has(f.replace(/\.webp$/, '')));
  for (const f of stale) {
    await unlink(`${OUT_DIR}/${f}`);
    console.log(`  -  删除孤儿 ${f}`);
  }

  const files = await readdir(OUT_DIR);
  const sizes = await Promise.all(files.map((f) => stat(`${OUT_DIR}/${f}`)));
  const totalKb = sizes.reduce((a, s) => a + s.size, 0) / 1024;

  console.log(
    `\n[thumbs] 写入 ${written.length} 张，删除孤儿 ${stale.length} 张，` +
      `目录共 ${totalKb.toFixed(0)} KB`,
  );
  if (failed.length) {
    console.error(`[thumbs] 失败 ${failed.length} 个：\n  ${failed.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log('[thumbs] 全部成功');
  }
} finally {
  await browser?.close();
  server?.kill();
}
