/**
 * shots.mjs — 从**跑起来的主应用**截取官网用的界面图。
 *
 * 用法：先在仓库根跑 `bun run dev`（5173），再跑 `bun run shots`。
 * 产物写进 src/assets/shots/，跟着仓库走 —— 官网自己不启动应用。
 *
 * 为什么要脚本而不是手截：这些图会随界面变化过期，有脚本至少「重跑一次」是
 * 一条命令。所有取景框都按 DOM 的实际位置算，不写死坐标。
 */
import { chromium } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const APP = process.env.APP_URL ?? 'http://localhost:5173/';
const outDir = fileURLToPath(new URL('../src/assets/shots/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });

async function openDemo({ width = 1600, height = 1000, theme = 'dark', dpr = 2 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    ([mode]) => localStorage.setItem('artmatic.theme', JSON.stringify({ mode })),
    [theme],
  );
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__artmatic);
  const demo = page.getByTestId('empty-demo');
  if (await demo.count()) await demo.click();
  await page.waitForFunction(() => window.__artmatic?.appState?.hasProject);
  // 等首帧与缩略图懒加载都落定
  await page.waitForTimeout(2600);
  return { ctx, page };
}

const boxOf = async (page, selector) => {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible' });
  return el.boundingBox();
};

/* ------------------------------------------- 时间轴（含轨道名与片段） */

{
  const { ctx, page } = await openDemo();
  const wrap = await boxOf(page, '[data-testid="tl-canvas-wrap"]');
  const status = await boxOf(page, '[data-testid="statusbar"]').catch(() => null);
  const clip = {
    x: Math.max(0, wrap.x - 190),
    y: wrap.y - 34,
    width: Math.min(wrap.width + 190, 1600 - Math.max(0, wrap.x - 190)),
    height: Math.min(wrap.height + 34, (status?.y ?? 1000) - (wrap.y - 34)),
  };
  await page.screenshot({ path: `${outDir}detail-timeline.png`, clip });
  await ctx.close();
  console.log('detail-timeline.png');
}

/* -------------------------------- 检查器参数（选一个算法片段，让滑杆出来） */

{
  const { ctx, page } = await openDemo();
  const clips = page.locator('[data-testid="clip"]');
  // 「Mandelbrot 推近」是带满参数的那个，比文本片段更能说明「一台仪器」
  const target = clips.filter({ hasText: 'Mandelbrot' }).first();
  await (await target.count() ? target : clips.nth(1)).click();
  await page.waitForTimeout(900);
  const drawer = await boxOf(page, '[data-testid="drawer"]');
  await page.screenshot({
    path: `${outDir}detail-params.png`,
    clip: { x: drawer.x, y: drawer.y, width: drawer.width, height: drawer.height },
  });
  await ctx.close();
  console.log('detail-params.png');
}

/* --------------------------------------------------------- 排版编辑器 */

{
  const { ctx, page } = await openDemo({ width: 1500, height: 940 });
  const textClip = page.locator('[data-testid="clip"]').filter({ hasText: '标题排版' }).first();
  await textClip.dblclick();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${outDir}detail-typography.png` });
  await ctx.close();
  console.log('detail-typography.png');
}

/* --------------------------------------------------- 画面本体（渲染结果） */

{
  // 这一张是 16:9 的渐变色块，2× 采样只会让它从 1MB 变成 4MB
  const { ctx, page } = await openDemo({ dpr: 1 });
  const canvas = await boxOf(page, 'canvas');
  // 只要中间一块：整张画面是 2.5:1，做成「并排对比」会被压得太扁
  const w = Math.min(canvas.width, 1040);
  const png = `${outDir}detail-frame.png`;
  await page.screenshot({
    path: png,
    clip: { x: canvas.x + (canvas.width - w) / 2, y: canvas.y, width: w, height: canvas.height },
  });
  // 分形画面全是细节，PNG 压不动（1.2MB）；这一步直接落 WebP
  await sharp(png).webp({ quality: 86 }).toFile(`${outDir}detail-frame.webp`);
  rmSync(png);
  await ctx.close();
  console.log('detail-frame.png');
}

await browser.close();
