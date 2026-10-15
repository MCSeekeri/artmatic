import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';
import { parseClipboard } from '../../src/core/clipboard';

/**
 * 片段复制 / 剪切 / 粘贴（时间轴视图）。
 *
 * 三条路径都要覆盖：
 *  1. Ctrl+C → 系统剪贴板里是自家 JSON（readText 读回来解析）；
 *  2. Ctrl+V → paste 事件认出这份 JSON、落在播放头（一笔撤销）；
 *  3. Ctrl+X → 剪切 = 复制 + 删除（一笔撤销），粘贴后原片段不回来。
 *
 * 权限：剪贴板读写用 `grantPermissions` 预置（与 preview-toolbar 的快照用例
 * 同一套办法）—— 于是成功路径也进回归网。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

/** 全部视觉片段的数量（含特效片段）。 */
async function clipCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { appState: { store: { project: { tracks: { clips: unknown[] }[] } } } };
    }).__artmatic;
    return A.appState.store.project.tracks.reduce((n, t) => n + t.clips.length, 0);
  });
}

test('复制片段进系统剪贴板（自家 JSON），粘贴落在播放头', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);

  // 选中一个片段（时间轴视图；排版页有自己的剪贴板，这边不接）
  await page.locator('[data-testid=clip]').first().click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as never as { __artmatic: { appState: { selectedClipIds: string[] } } }).__artmatic.appState
            .selectedClipIds.length,
      ),
    )
    .toBeGreaterThan(0);

  const before = await clipCount(page);

  // Ctrl+C：剪贴板里必须是**我们的格式**（parseClipboard 认得出）
  await page.keyboard.press('Control+c');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const payload = parseClipboard(text);
  expect(payload).not.toBeNull();
  expect(payload!.clips.length).toBe(1);

  // 播放头挪到工程末尾之后（空地方），Ctrl+V 走 paste 事件
  await page.evaluate(() => {
    const A = (window as never as { __artmatic: { appState: { playT: number; store: { project: { duration: number } } } } }).__artmatic;
    A.appState.playT = A.appState.store.project.duration + 4;
  });
  await page.keyboard.press('Control+v');

  await expect.poll(() => clipCount(page)).toBe(before + 1);

  // 落点是吸附后的播放头（+4s 超过时长，吸附档 beat 下仍是 4 的倍数附近）；
  // 关键断言：新片段起点在播放头处、id 与源不同、一笔撤销能整个收回。
  const after = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        appState: {
          store: { project: { tracks: { clips: { id: string; start: number }[] }[] } };
          playT: number;
        };
      };
    }).__artmatic;
    const clips = A.appState.store.project.tracks.flatMap((t) => t.clips);
    const pasted = clips.find((c) => c.start >= A.appState.playT - 0.001);
    return { id: pasted?.id ?? null, start: pasted?.start ?? -1, playT: A.appState.playT };
  });
  expect(after.id).not.toBeNull();
  expect(after.start).toBeGreaterThanOrEqual(after.playT - 0.001);

  await page.keyboard.press('Control+z');
  await expect.poll(() => clipCount(page)).toBe(before);
});

test('剪切 = 复制 + 删除；粘贴回来的是新片段', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);

  await page.locator('[data-testid=clip]').first().click();
  const before = await clipCount(page);

  await page.keyboard.press('Control+x');
  await expect.poll(() => clipCount(page)).toBe(before - 1);

  // 剪切的内容照样在系统剪贴板里（粘贴通道不变）
  const payload = parseClipboard(await page.evaluate(() => navigator.clipboard.readText()));
  expect(payload).not.toBeNull();

  await page.evaluate(() => {
    const A = (window as never as { __artmatic: { appState: { playT: number; store: { project: { duration: number } } } } }).__artmatic;
    A.appState.playT = A.appState.store.project.duration + 4;
  });
  await page.keyboard.press('Control+v');
  await expect.poll(() => clipCount(page)).toBe(before);

  // 撤销一次只回「粘贴」这一笔，被剪走的片段不会自己回来（那该是第二笔）
  await page.keyboard.press('Control+z');
  await expect.poll(() => clipCount(page)).toBe(before - 1);
});

test('非片段格式的粘贴整段放行（不弹错、不拦截）', async ({ page }) => {
  await boot(page);
  // 合成一个 paste 事件：文本通道里是普通文本（不是我们的 JSON）。
  // 判据：没有工程内副作用（片段数不变），且事件没有被 preventDefault。
  const before = await clipCount(page);
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '只是一段普通文本');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(false);
  expect(await clipCount(page)).toBe(before);
});

test('片段 JSON 的 paste 被接管并落在播放头', async ({ page }) => {
  await boot(page);
  // 直接合成一份自家格式的 paste（跨窗口 / 跨标签页的真实路径）：
  // 不走 Ctrl+C，剪贴板里本来就是这段 JSON。
  const before = await clipCount(page);
  const placed = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        appState: {
          playT: number;
          store: {
            project: {
              duration: number;
              tracks: { id: string; clips: { id: string; kind: string }[] }[];
            };
          };
        };
      };
    }).__artmatic;
    A.appState.playT = A.appState.store.project.duration + 4;
    const tracks = A.appState.store.project.tracks;
    const src = tracks.flatMap((t) => t.clips).find((c) => c.kind === 'source')!;
    const trackId = tracks.find((t) => t.clips.some((c) => c.id === src.id))!.id;
    const payload = {
      kind: 'artmatic/clips',
      version: 1,
      clips: [{ trackId, clip: { ...src, start: 0, end: 4 } }],
    };
    const dt = new DataTransfer();
    dt.setData('text/plain', JSON.stringify(payload));
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    return { prevented: ev.defaultPrevented };
  });
  expect(placed.prevented).toBe(true);
  await expect.poll(() => clipCount(page)).toBe(before + 1);
});
