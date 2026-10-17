/**
 * gen-effect-thumb.mjs — 导出**指定特效**的缩略图（静态 WebP）。
 *
 * ## 为什么需要它
 *
 * 仓库里那套 `src/assets/effect-thumbnails/*.webp` 是逐张手挑的，`lab` 的
 * 「批量导出」会打一个 zip，**需要人工解压再拷进仓库** —— 那是「导出了但忘了
 * 解压」「解压到别处」这类错误的温床。新加一个特效时，这里一条命令落盘。
 *
 * ## 为什么必须显式给 id
 *
 * 不给 id 就全量覆盖会把那套手挑的图换成一模一样的自动底图版本
 * （`src/assets/AGENTS.md` 明确写了「别当成重建同名资源直接覆盖」）。
 * 所以参数是**必填**的。
 *
 * 渲染走 `__lab.effectThumb` → `EffectThumbRenderer`，与选择器卡片、
 * 与 lab 的批量导出**同一个渲染器**。副作用是这条命令顺带验证了
 * 「这个特效在离屏上下文里渲得出来」。
 *
 * 用法：
 *   node scripts/gen-effect-thumb.mjs box-tracker
 *   node scripts/gen-effect-thumb.mjs box-tracker --height=360
 */
import { spawn } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const PORT = 4175;
const OUT_DIR = fileURLToPath(new URL('../src/assets/effect-thumbnails', import.meta.url));
const node = process.execPath;

const args = process.argv.slice(2);
const heightArg = args.find((a) => a.startsWith('--height='));
const HEIGHT = heightArg ? Number(heightArg.slice('--height='.length)) : 360;
const ids = args.filter((a) => !a.startsWith('--'));

if (ids.length === 0) {
  console.error('用法：node scripts/gen-effect-thumb.mjs <特效 id…> [--height=360]');
  process.exitCode = 1;
  process.exit();
}

function run(cmd, argv, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: 'inherit', ...opts });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${argv.join(' ')} exited ${code}`))));
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

function decodeDataUrl(url) {
  const comma = url.indexOf(',');
  if (comma < 0) throw new Error('不是 data URL');
  return Buffer.from(url.slice(comma + 1), 'base64');
}

let server = null;
let browser = null;
try {
  console.log('[fx-thumb] vite build …');
  await run(node, ['node_modules/vite/bin/vite.js', 'build']);

  console.log('[fx-thumb] 启动 vite preview …');
  server = spawn(
    node,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore' },
  );
  await waitForPort(`http://localhost:${PORT}/lab/`);
  await mkdir(OUT_DIR, { recursive: true });

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  // 离屏渲染器的诊断（上下文建不出来时会 console.warn）要能被看见。
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') console.log(`  [page] ${m.text()}`);
  });
  await page.goto(`http://localhost:${PORT}/lab/`);
  await page.waitForFunction(() => Boolean(window.__lab));

  let failed = 0;
  for (const id of ids) {
    const dataUrl = await page.evaluate(
      ({ id, height }) => window.__lab.effectThumb(id, height),
      { id, height: HEIGHT },
    );
    if (!dataUrl) {
      // 两种可能：id 拼错（目录里没有），或离屏 WebGL 上下文建不出来。
      console.error(`  ×  ${id}：渲不出来（id 拼错 / 上下文失败？）`);
      failed++;
      continue;
    }
    const buf = decodeDataUrl(dataUrl);
    await writeFile(`${OUT_DIR}/${id}.webp`, buf);
    const kb = ((await stat(`${OUT_DIR}/${id}.webp`)).size / 1024).toFixed(1);
    console.log(`  ok ${id.padEnd(28)} ${kb} KB  (${HEIGHT}p)`);
  }

  if (failed > 0) {
    console.error(`[fx-thumb] ${failed} 张失败`);
    process.exitCode = 1;
  } else {
    console.log('[fx-thumb] 完成');
  }
} finally {
  await browser?.close();
  server?.kill();
}
