/**
 * background-preview.spec.ts — 排版「背景预览」：半透明底图 + 局部播放 + 进度条。
 *
 * 三条断言对应需求的三个要点：
 *  1. **底图**：打开开关后，画幅框里出现一张 `blob:` 的 `<img>`，正好占满画幅、
 *     不透明度是设定的值；关掉即消失。
 *  2. **进度条同时驱动动画**：拖动进度条（键盘 Home / End 精确落点）后，舞台动画层
 *     被 seek 到对应时刻 —— 证明「seek 到 localSec」这一条路径真的改到了动画，
 *     而不只是底图。
 *  3. **播放**：点播放后局部时间推进（底图与动画跟着走），再点一次暂停。
 *
 * 取帧本身发生在 WebGL 里，headless 也能跑（排版 E2E 已在用同一台 renderer）。
 */

import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

async function addTextClip(page: Page): Promise<string> {
  const ids = (): Promise<string[]> =>
    page.evaluate(() => {
      const A = (
        window as never as {
          __artmatic: { store: { project: { tracks: { clips: { id: string; source?: { type?: string } }[] }[] } } };
        }
      ).__artmatic;
      const out: string[] = [];
      for (const t of A.store.project.tracks) for (const c of t.clips) if (c.source?.type === 'text') out.push(c.id);
      return out;
    });
  const before = await ids();
  await page.locator('[data-testid=track-side-row]').nth(0).getByTestId('track-menu').click();
  await page.getByTestId('add-text').click();
  const added = (await ids()).filter((id) => !before.includes(id));
  expect(added, '「+ 排版片段」没有新增片段').toHaveLength(1);
  return added[0]!;
}

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

/** 当前编辑片段的 [start, end]（秒）。 */
function clipSpan(page: Page, clipId: string): Promise<{ start: number; end: number }> {
  return page.evaluate((id) => {
    const A = (
      window as never as {
        __artmatic: { store: { project: { tracks: { clips: { id: string; start: number; end: number }[] }[] } } };
      }
    ).__artmatic;
    for (const t of A.store.project.tracks)
      for (const c of t.clips) if (c.id === id) return { start: c.start, end: c.end };
    throw new Error(`找不到片段 ${id}`);
  }, clipId);
}

/** 给当前选中的元素绑一个 fade-in 预设动画。 */
async function applyFadeIn(page: Page): Promise<void> {
  await page.getByTestId('ribbon-tab-anim').click();
  await page.getByTestId('typo-anim-preset').click();
  await page.getByTestId('typo-anim-option-fade-in').click();
}

/** 舞台上那个动画层被 seek 到的毫秒（WAAPI currentTime）。没有动画层时返回 null。 */
function animCurrentMs(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const el = document.querySelector('.paper [data-anim-id]');
    if (!el) return null;
    const a = (el as HTMLElement).getAnimations()[0];
    return a && typeof a.currentTime === 'number' ? a.currentTime : null;
  });
}

test('背景预览：半透明底图 + 进度条驱动动画 + 局部播放', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  const { start, end } = await clipSpan(page, clipId);

  // 选中最上面的元素并绑 fade-in（0.6s，delay 0）—— 它的 seek 结果是可读的。
  const el = (await page.locator('.paper [data-el-id]').first().boundingBox())!;
  await page.mouse.click(el.x + el.width / 2, el.y + el.height / 2);
  await expect(page.getByTestId('typo-selection')).toBeVisible();
  await applyFadeIn(page);
  await expect(page.locator('.paper [data-anim-id]')).toHaveCount(1);

  // ---------------------------------------------------------------- 底图
  // 默认关：不应有底图。
  await expect(page.getByTestId('typo-bg-frame')).toHaveCount(0);

  await page.getByTestId('typo-bg-toggle').click();
  const img = page.getByTestId('typo-bg-frame');
  await expect(img).toBeVisible();

  // 必须是 blob（来自 canvas.toBlob 的真实截图，不是占位）。
  const src = await img.getAttribute('src');
  expect(src, '底图必须是 blob URL').toMatch(/^blob:/);

  // 已解码出像素。
  await page.waitForFunction(() => {
    const i = document.querySelector('[data-testid="typo-bg-frame"]') as HTMLImageElement | null;
    return !!i && i.naturalWidth > 0;
  });

  // 正好占满画幅框：与 .paper 的矩形一致。
  const frameBox = (await page.locator('.paper').boundingBox())!;
  const imgBox = (await img.boundingBox())!;
  expect(Math.abs(imgBox.width - frameBox.width)).toBeLessThan(2);
  expect(Math.abs(imgBox.height - frameBox.height)).toBeLessThan(2);

  // 默认不透明度 0.3。
  const opacity = await img.evaluate((i) => Number(getComputedStyle(i).opacity));
  expect(opacity).toBeGreaterThan(0.29);
  expect(opacity).toBeLessThan(0.31);

  // ------------------------------------------------- 进度条同时驱动动画
  // 用键盘落到精确端点（Home / End）—— Slider 的 pointerdown 会 preventDefault
  // 抢掉焦点，所以显式 focus() 再按键，走的是与拖动**同一个** oninput 路径。
  const scrub = page.getByTestId('typo-bg-scrub');
  await scrub.focus();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => {
    const el = document.querySelector('.paper [data-anim-id]');
    const a = el ? (el as HTMLElement).getAnimations()[0] : null;
    return !!a && typeof a.currentTime === 'number' && a.currentTime < 1;
  });

  await page.keyboard.press('End');
  const atEnd = await page.waitForFunction(() => {
    const el = document.querySelector('.paper [data-anim-id]');
    const a = el ? (el as HTMLElement).getAnimations()[0] : null;
    return !!a && typeof a.currentTime === 'number' && a.currentTime > 100 ? a.currentTime : null;
  });
  expect(await atEnd.jsonValue()).toBeGreaterThan(100);

  // 进度条读数跟着动（用户看得见的状态）。
  const labelAtEnd = await page.getByTestId('typo-bg-time').textContent();
  expect(Number.parseFloat(labelAtEnd ?? '0')).toBeGreaterThan(0);

  // **拖动**进度条：底图要跟着换一张（同一帧时间变了 → 新截图的 blob URL 不同）。
  const srcAtEnd = await img.getAttribute('src');
  const box = (await scrub.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(
    (prev) => {
      const i = document.querySelector('[data-testid="typo-bg-frame"]');
      return !!i && i.getAttribute('src') !== prev;
    },
    srcAtEnd,
  );

  // ---------------------------------------------------------------- 播放
  // 先回到片段起点，再播 —— 这样一定能观察到时间的推进。
  await page.keyboard.press('Home');
  const t0 = Number.parseFloat((await page.getByTestId('typo-bg-time').textContent()) ?? '0');
  expect(t0).toBeLessThan(0.05);

  const playBtn = page.getByTestId('typo-bg-play');
  // 播放前的标签就是「播放排版预览」；播放中必须换成另一个（暂停）。
  const playLabel = (await playBtn.getAttribute('aria-label'))!;
  await playBtn.click();
  await expect(playBtn).not.toHaveAttribute('aria-label', playLabel);
  await page.waitForFunction((prev) => {
    const el = document.querySelector('[data-testid="typo-bg-time"]');
    const v = el ? Number.parseFloat(el.textContent ?? '0') : 0;
    return v > prev + 0.1;
  }, t0);
  await page.waitForFunction((prev) => {
    const anim = document.querySelector('.paper [data-anim-id]');
    const a = anim ? (anim as HTMLElement).getAnimations()[0] : null;
    return !!a && typeof a.currentTime === 'number' && a.currentTime > prev + 50;
  }, 0);

  // 暂停：回到播放态之外（图标变回 play 的那个标签）。
  await playBtn.click();
  await expect(playBtn).toHaveAttribute('aria-label', playLabel);
  const tPaused = Number.parseFloat((await page.getByTestId('typo-bg-time').textContent()) ?? '0');
  await page.waitForTimeout(200);
  const tPaused2 = Number.parseFloat((await page.getByTestId('typo-bg-time').textContent()) ?? '0');
  expect(Math.abs(tPaused2 - tPaused), '暂停后时间不再推进').toBeLessThan(0.01);

  // 夹一个边界断言：读到的进度始终落在片段区间内。
  expect(tPaused).toBeGreaterThanOrEqual(0);
  expect(tPaused).toBeLessThanOrEqual(end - start + 0.01);

  // ------------------------------------------------------------ 关开关
  await page.getByTestId('typo-bg-toggle').click();
  await expect(page.getByTestId('typo-bg-frame')).toHaveCount(0);
});
