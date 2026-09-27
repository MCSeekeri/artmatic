import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

function clipCount(page: Page, trackIndex: number) {
  return page.evaluate((idx) => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { clips: unknown[] }[] } } };
    }).__artmatic;
    return A.store.project.tracks[idx]!.clips.length;
  }, trackIndex);
}

test('新建视觉轨与纯色片段', async ({ page }) => {
  await boot(page);
  // demo 自带 A1 + V1；新建一条视觉轨
  await page.getByTestId('add-visual-track').click();
  const tracks = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { kind: string }[] } } };
    }).__artmatic;
    return A.store.project.tracks.map((t) => t.kind);
  });
  expect(tracks).toEqual(['audio', 'visual', 'visual']);

  // 在新轨道（第 3 条）上建纯色片段
  await page.locator('.side-row').nth(2).getByTestId('add-solid').click();
  expect(await clipCount(page, 2)).toBe(1);
  // demo 音频片段 + demo 底色 + 新片段
  await expect(page.locator('.clip')).toHaveCount(3);
});

test('拖拽移动片段（reject 语义 + 拍吸附）', async ({ page }) => {
  await boot(page);
  await page.getByTestId('add-visual-track').click();
  await page.locator('.side-row').nth(2).getByTestId('add-solid').click();

  const before = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { clips: { start: number }[] }[] } } };
    }).__artmatic;
    return A.store.project.tracks[2]!.clips[0]!.start;
  });
  expect(before).toBe(0);

  const clip = page.locator('.clip').nth(2); // A1 音频片段、V1 底色之后的新片段
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
    return A.store.project.tracks[2]!.clips[0]!.start;
  });
  expect(Math.abs(after - 1)).toBeLessThan(0.05); // 吸附到第 2 拍（120bpm → 1s）
});

test('切分 + 撤销回到切分前', async ({ page }) => {
  await boot(page);
  await page.getByTestId('add-visual-track').click();
  await page.locator('.side-row').nth(2).getByTestId('add-solid').click();
  expect(await clipCount(page, 2)).toBe(1);

  // 播放头移到 0.5s（片段 0..1s 内），点「在播放头切分」
  await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { appState: { seek: (t: number) => void } };
    }).__artmatic;
    A.appState.seek(0.5);
  });
  await page.getByTestId('split-at-playhead').click();
  expect(await clipCount(page, 2)).toBe(2);

  // Ctrl+Z 撤销
  await page.keyboard.press('Control+z');
  expect(await clipCount(page, 2)).toBe(1);
});
