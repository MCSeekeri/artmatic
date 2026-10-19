import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 音频淡变（0.3 W2.3）。
 *
 * 这里守的是**手势与界面**：三角手柄拖得动、拖出来的值落进 `Project`
 * （一笔撤销）、片段 DOM 上的手柄位置跟着走。包络本身的逐点数值在
 * `tests/unit/audio-envelope.test.ts`，导出混流的接线在 `mixdown.test.ts`
 * —— 三条各自负责一层，不重复堆同一条断言。
 */

type W = {
  __artmatic: {
    store: {
      project: { tracks: { kind: string; clips: { id: string }[] }[] };
      findClip: (id: string) => { clip: { start: number; end: number; fadeIn?: number; fadeOut?: number } } | null;
    };
    appState: { pxPerBeat: number };
  };
};

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as never as W).__artmatic));
  await openDemo(page);
}

async function audioClipId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const p = (window as never as W).__artmatic.store.project;
    const track = p.tracks.find((t) => t.kind === 'audio')!;
    return track.clips[0]!.id;
  });
}

const fadeOf = (page: Page, id: string) =>
  page.evaluate(
    (clipId) => {
      const found = (window as never as W).__artmatic.store.findClip(clipId);
      return found ? { fadeIn: found.clip.fadeIn, fadeOut: found.clip.fadeOut } : null;
    },
    id,
  );

test('拖淡入手柄：fadeIn 落进工程，一笔撤销；色块位置跟着走', async ({ page }) => {
  await boot(page);
  const id = await audioClipId(page);
  // demo 的音频片段自带一个淡出（演示用），拖淡入不该动它。
  const before = (await fadeOf(page, id))!;
  const handle = page.locator(`[data-clip-id="${id}"] [data-testid=clip-fade-in]`);
  const box = (await handle.boundingBox())!;

  // 56 px/s（28 px/beat @120BPM）：往右拖 56px ≈ 1s。
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 56, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);

  const after = (await fadeOf(page, id))!;
  expect(after.fadeIn).toBeGreaterThan(0.7);
  expect(after.fadeIn).toBeLessThan(1.4);
  expect(after.fadeOut).toBe(before.fadeOut); // 另一个手柄不受影响

  // 手柄自己必须挪到淡入边界（不是只改了数据）
  const moved = (await handle.boundingBox())!;
  expect(moved.x - box.x).toBeGreaterThan(40);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  expect((await fadeOf(page, id))!.fadeIn).toBeUndefined();
});

test('检查器对音频给的是「渐入 / 渐出」，写回同一份数据', async ({ page }) => {
  await boot(page);
  const id = await audioClipId(page);
  await page.locator(`[data-clip-id="${id}"]`).click();

  // 检查器的输入框与时间轴手柄是两组 testid（同名的 `clip-fade-in` 会撞在一起）
  const fadeIn = page.getByTestId('insp-fade-in');
  await expect(fadeIn).toBeVisible();
  await expect(page.getByTestId('insp-fade-out')).toBeVisible();
  // 通用的「淡变」（fadeSec）对音频不再出现 —— 两个同义输入框会让人猜哪个在起作用
  await expect(page.getByTestId('clip-fade')).toHaveCount(0);

  await fadeIn.fill('2');
  await fadeIn.press('Enter');
  await expect
    .poll(async () => (await fadeOf(page, id))!.fadeIn)
    .toBeCloseTo(2, 2);

  // 与手柄是同一份数据：时间轴上的三角跟着走
  const handle = page.locator(`[data-clip-id="${id}"] [data-testid=clip-fade-in]`);
  const box = (await handle.boundingBox())!;
  const clipBox = (await page.locator(`[data-clip-id="${id}"]`).boundingBox())!;
  expect(box.x - clipBox.x).toBeGreaterThan(2 * 56 - 12); // 56px/s
});

test('拖淡出手柄：往左拖变长，且两个淡区不相交（钳到片段长度内）', async ({ page }) => {
  await boot(page);
  const id = await audioClipId(page);
  const before = (await fadeOf(page, id))!;
  expect(before.fadeOut ?? 0).toBeGreaterThan(0); // demo 带着一段收束淡出

  /*
   * 淡出手柄在 24s 片段的右端（宽 1344px），而时间轴视口只有 ~780px。
   * 不先滚过去的话，鼠标落点会被 scroll 容器裁掉 —— 表现是「拖了但什么都没发生」
   * （手势被静默吞掉，界面不报错）。
   */
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid=tl-scroll]') as HTMLElement;
    el.scrollLeft = el.scrollWidth;
  });
  await page.waitForTimeout(120);

  const handle = page.locator(`[data-clip-id="${id}"] [data-testid=clip-fade-out]`);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 84, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);

  const after = (await fadeOf(page, id))!;
  expect(after.fadeOut).toBeGreaterThan(before.fadeOut! + 1.0);
  expect(after.fadeOut).toBeLessThan(before.fadeOut! + 2.0);

  const dur = await page.evaluate((clipId) => {
    const c = (window as never as W).__artmatic.store.findClip(clipId)!.clip;
    return c.end - c.start;
  }, id);
  expect((after.fadeIn ?? 0) + (after.fadeOut ?? 0)).toBeLessThanOrEqual(dur + 1e-6);
});
