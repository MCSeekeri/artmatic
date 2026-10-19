import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
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

/**
 * demo 工程的结构**从运行时读**，不写死数字。
 *
 * 这里原来是 `DEMO_TRACKS = 5` / `DEMO_CLIPS = 5`（那时 demo 是「V4+V3+V2+V1+A1」）。
 * 写死的代价在调整 demo 时兑现：明明是被测行为没变，用例先红了，
 * 而改守卫的时候很容易顺手把要守的东西一起改松。用例真正要守的是
 * 「新建的轨/片段落在数组末尾」这一条，与 demo 有几层无关。
 *
 * 约定仍然成立：新轨由 `addTrack` **push**，所以它恒是最后一行 —— 下标 = 加之前的总轨数。
 */
async function demoShape(page: Page): Promise<{ tracks: number; clips: number }> {
  return page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { clips: unknown[] }[] } } };
    }).__artmatic;
    const tracks = A.store.project.tracks;
    return { tracks: tracks.length, clips: tracks.reduce((n, t) => n + t.clips.length, 0) };
  });
}

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
  const demo = await demoShape(page);
  expect(await trackCount(page)).toBe(demo.tracks);
  await page.getByTestId('add-visual-track').click();
  expect(await trackCount(page)).toBe(demo.tracks + 1);

  await addClipViaMenu(page, demo.tracks, 'add-solid');
  expect(await clipCount(page, demo.tracks)).toBe(1);
  await expect(page.locator('.clip')).toHaveCount(demo.clips + 1);
});

test('拖拽移动片段（reject 语义 + 拍吸附）', async ({ page }) => {
  await boot(page);
  // 这一条守的是「拍」吸附。默认形态是节奏模式的「小节」（2s 一格），显式切到拍。
  await page.evaluate(() => {
    (window as never as { __artmatic: { appState: { setSnap: (m: string) => void } } })
      .__artmatic.appState.setSnap('beat');
  });
  const demoTracks = await trackCount(page);
  await page.getByTestId('add-visual-track').click();
  await addClipViaMenu(page, demoTracks, 'add-solid');

  const before = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { clips: { start: number }[] }[] } } };
    }).__artmatic;
    const tracks = A.store.project.tracks;
    return tracks[tracks.length - 1]!.clips[0]!.start;
  });
  expect(before).toBe(0);

  const clip = page.locator('.clip').last(); // 新建的片段排在最后
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
  const demoTracks = await trackCount(page);
  await page.getByTestId('add-visual-track').click();
  await addClipViaMenu(page, demoTracks, 'add-solid');
  expect(await clipCount(page, demoTracks)).toBe(1);

  // 播放头移到 0.5s（片段 0..1s 内），点「在播放头切分」
  await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { appState: { seek: (t: number) => void } };
    }).__artmatic;
    A.appState.seek(0.5);
  });
  await page.getByTestId('split-at-playhead').click();
  expect(await clipCount(page, demoTracks)).toBe(2);

  // Ctrl+Z 撤销
  await page.keyboard.press('Control+z');
  expect(await clipCount(page, demoTracks)).toBe(1);
});

/* ---------------------------------------- 检查器取色卡（原生 input 已全量替换） */

test('检查器的纯色片段取色走取色卡：选标准色落库', async ({ page }) => {
  await boot(page);
  const demo = await demoShape(page);
  await page.getByTestId('add-visual-track').click();
  await addClipViaMenu(page, demo.tracks, 'add-solid');

  // 选中它 → 检查器自动展开，显示「颜色」字段（现在是取色卡入口）
  await page.locator('.clip').last().click();
  const field = page.getByTestId('clip-color');
  await expect(field).toBeVisible();

  // 点色块开面板 → 标准色里的纯红
  await field.click();
  await page.getByTestId('clip-color-palette-std-ff0000').click();

  expect(
    await page.evaluate(() => {
      const A = (window as never as {
        __artmatic: {
          store: {
            project: {
              tracks: {
                clips: { kind: string; source?: { type?: string; color?: string } }[];
              }[];
            };
          };
        };
      }).__artmatic;
      const clips = A.store.project.tracks.flatMap((t) => t.clips);
      return clips[clips.length - 1]!.source?.color;
    }),
  ).toBe('#ff0000');
});
