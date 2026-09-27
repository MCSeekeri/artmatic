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

/** demo 工程：A1 音乐 + V1 底图 + V2 纹理 + V3 局部故障 + V4 全屏调色 = 5 轨 5 片段。 */
const DEMO_TRACKS = 5;
const DEMO_CLIPS = 5;

test('新建视觉轨与纯色片段', async ({ page }) => {
  await boot(page);
  expect(await trackCount(page)).toBe(DEMO_TRACKS);
  await page.getByTestId('add-visual-track').click();
  expect(await trackCount(page)).toBe(DEMO_TRACKS + 1);

  await page.locator('.side-row').nth(DEMO_TRACKS).getByTestId('add-solid').click();
  expect(await clipCount(page, DEMO_TRACKS)).toBe(1);
  await expect(page.locator('.clip')).toHaveCount(DEMO_CLIPS + 1);
});

test('拖拽移动片段（reject 语义 + 拍吸附）', async ({ page }) => {
  await boot(page);
  await page.getByTestId('add-visual-track').click();
  await page.locator('.side-row').nth(DEMO_TRACKS).getByTestId('add-solid').click();

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
  await page.locator('.side-row').nth(DEMO_TRACKS).getByTestId('add-solid').click();
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
