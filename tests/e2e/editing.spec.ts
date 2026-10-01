import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

function trackCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: unknown[] } } };
    }).__artmatic;
    return A.store.project.tracks.length;
  });
}

function clipCount(page: Page, trackIndex: number): Promise<number> {
  return page.evaluate((idx) => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { clips: unknown[] }[] } } };
    }).__artmatic;
    return A.store.project.tracks[idx]!.clips.length;
  }, trackIndex);
}

/** demo 工程：V4 + V3 + V2 + V1 + A1 = 5 轨 5 片段（视觉轨在前景到背景排列，音频在最后）。 */
const DEMO_TRACKS = 5;
const DEMO_CLIPS = 5;

/**
 * 轨道行的「新建片段」按钮已收进 ⋯ 菜单（一行 4 个小按钮区分度不够，且素材类型
 * 变多会挤爆）。菜单是一级平铺：+ 纯色片段 / + 特效片段 / + 算法片段（算法再展开
 * 一级列具体生成器）。所以测试走「开 ⋯ → 点目标项」。
 */
async function addClipViaMenu(page: Page, trackIndex: number, item: string): Promise<void> {
  await page.locator('[data-testid=track-side-row]').nth(trackIndex).getByTestId('track-menu').click();
  await page.getByTestId(item).click();
}

test('新建视觉轨与纯色片段', async ({ page }) => {
  await boot(page);
  expect(await trackCount(page)).toBe(DEMO_TRACKS);
  await page.getByTestId('add-visual-track').click();
  expect(await trackCount(page)).toBe(DEMO_TRACKS + 1);

  await addClipViaMenu(page, DEMO_TRACKS, 'add-solid');
  expect(await clipCount(page, DEMO_TRACKS)).toBe(1);
  await expect(page.locator('.clip')).toHaveCount(DEMO_CLIPS + 1);
});

test('拖拽移动片段（reject 语义 + 拍吸附）', async ({ page }) => {
  await boot(page);
  await page.getByTestId('add-visual-track').click();
  await addClipViaMenu(page, DEMO_TRACKS, 'add-solid');

  const before = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { clips: { start: number }[] }[] } } };
    }).__artmatic;
    const tracks = A.store.project.tracks;
    return tracks[tracks.length - 1]!.clips[0]!.start;
  });
  expect(before).toBe(0);

  const clip = page.locator('.clip').nth(DEMO_CLIPS); // 新建的片段排在最后
  await clip.scrollIntoViewIfNeeded();
  const box = (await clip.boundingBox())!;
  // 向右拖 ~2 拍（pxPerBeat 默认 28，120bpm 下 2 拍 = 1s = 56px）
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 56, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  const after = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { clips: { start: number }[] }[] } } };
    }).__artmatic;
    const tracks = A.store.project.tracks;
    return tracks[tracks.length - 1]!.clips[0]!.start;
  });
  expect(Math.abs(after - 1)).toBeLessThan(0.05); // 吸附到第 2 拍（120bpm → 1s）
});

test('切分 + 撤销回到切分前', async ({ page }) => {
  await boot(page);
  await page.getByTestId('add-visual-track').click();
  await addClipViaMenu(page, DEMO_TRACKS, 'add-solid');
  const newIdx = DEMO_TRACKS;
  expect(await clipCount(page, newIdx)).toBe(1);

  // 播放头移到 0.5s（片段 0..1s 内），点「在播放头切分」
  await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { appState: { seek: (t: number) => void } };
    }).__artmatic;
    A.appState.seek(0.5);
  });
  await page.getByTestId('split-at-playhead').click();
  expect(await clipCount(page, newIdx)).toBe(2);

  // Ctrl+Z 撤销
  await page.keyboard.press('Control+z');
  expect(await clipCount(page, newIdx)).toBe(1);
});
