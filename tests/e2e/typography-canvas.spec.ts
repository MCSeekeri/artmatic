import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 排版片段「画幅 / 大小」的 E2E 守卫（画布尺寸弹层）。
 *
 * 三条判据，各自对应一个**会被误解的语义**：
 *
 * 1. **画布 = 文档像素**：点 1:1 预设后 `doc.size` 真的变成 1080×1080，
 *    且 zoombar 的读数跟着变。只断言读数的话，一个没写进文档的 UI 也能通过。
 * 2. **同比例改像素不改变上屏大小**（contain 的必然结果）：读数行给出
 *    「画面上 …」的真实占位，换画幅才会变小。这条钉的是**读数与渲染同源**。
 * 3. **缩放内容**：开着改画布 → 元素框按比例重排；关掉 → 元素留在原像素位置。
 *    两种都是真实需求，写错一边的表现是「改画幅之后版式全乱」或「改了没反应」。
 */

interface TextClipApi {
  store: {
    project: {
      tracks: {
        clips: {
          id: string;
          source?: { type?: string; doc?: { size: { w: number; h: number }; elements: { frame: { x: number; y: number; w: number; h: number } }[] } };
          transform?: { sx: number; sy: number };
        }[];
      }[];
    };
  };
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

/** 新建一个排版片段并双击进编辑器（与 ui-ux 的手势一致：双击 = 打开编辑器）。 */
async function addTextClip(page: Page): Promise<string> {
  await page.locator('[data-testid=track-side-row]').nth(0).getByTestId('track-menu').click();
  await page.getByTestId('add-text').click();
  const id = await page.evaluate(() => {
    const A = (window as never as { __artmatic: TextClipApi }).__artmatic;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) if (c.source?.type === 'text') return c.id;
    }
    return '';
  });
  expect(id, '应当新建出一个排版片段').not.toBe('');
  await page.locator(`[data-testid=clip][data-clip-id="${id}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
  return id;
}

function readDoc(page: Page, clipId: string) {
  return page.evaluate((id) => {
    const A = (window as never as { __artmatic: TextClipApi }).__artmatic;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === id) return c;
      }
    }
    return null;
  }, clipId);
}

/**
 * 打开画布尺寸浮层：入口在「设计」Ribbon 的「画布大小」。
 *
 * 这两步一起测，是因为「按钮在哪」本身是产品决定的一部分：它从画布下方的
 * 缩放条搬到了 Ribbon（缩放条上的读数已经删掉，见用例 1 的第一条断言）。
 */
async function openCanvasPanel(page: Page): Promise<void> {
  await page.getByTestId('ribbon-tab-design').click();
  await page.getByTestId('ribbon-canvas-size').click();
  await expect(page.getByTestId('typo-canvas-pop')).toBeVisible();
}

test('画幅预设：1:1 → 文档尺寸 1080×1080，读数与占位同步', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);

  // 缩放条上不再有尺寸读数（它现在住在「设计 → 画布大小」里）。
  await expect(page.getByTestId('typo-canvas-size')).toHaveCount(0);

  await openCanvasPanel(page);

  // 新片段沿工程分辨率
  await expect(page.getByTestId('typo-canvas-w')).toHaveValue('1920');
  await expect(page.getByTestId('typo-canvas-h')).toHaveValue('1080');

  await page.getByTestId('typo-canvas-ratio-1:1').click();

  await expect(page.getByTestId('typo-canvas-w')).toHaveValue('1080');
  await expect
    .poll(async () => (await readDoc(page, clipId))?.source?.doc?.size)
    .toEqual({ w: 1080, h: 1080 });

  /*
   * 上屏占位：1920×1080 工程里的 1080×1080 画布按 contain 装成 1080×1080，
   * 即宽占 56%、高占 100% —— 这正是「排版片段不占满全屏」的实际形态。
   */
  const foot = page.getByTestId('typo-canvas-footprint');
  await expect(foot).toContainText('1080');
  await expect(foot).toContainText('56%');
});

test('「画布大小」是开合：再点一次关掉', async ({ page }) => {
  await boot(page);
  await addTextClip(page);

  await openCanvasPanel(page);
  /*
   * 锚点也算「浮层里面」（否则 pointerdown 会先关掉、click 再打开，看起来是
   * 闪一下），所以关闭必须由按钮自己 toggle —— 这条钉的就是那个分支。
   */
  await page.getByTestId('ribbon-canvas-size').click();
  await expect(page.getByTestId('typo-canvas-pop')).toHaveCount(0);
});

test('上屏大小：缩放 50% 写进 transform.sx/sy，占位读数减半', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);

  await openCanvasPanel(page);
  await page.getByTestId('typo-canvas-scale-num').fill('50');
  await page.getByTestId('typo-canvas-scale-num').press('Enter');

  await expect
    .poll(async () => (await readDoc(page, clipId))?.transform)
    .toMatchObject({ sx: 0.5, sy: 0.5 });

  const foot = page.getByTestId('typo-canvas-footprint');
  await expect(foot).toContainText('960');
  await expect(foot).toContainText('50%');
});

test('缩放内容：开着按比例重排，关掉则元素留在原像素位置', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);

  const before = (await readDoc(page, clipId))!.source!.doc!.elements[0]!.frame;

  // 关掉「缩放内容」再换画幅：元素框一个像素都不该动
  await openCanvasPanel(page);
  await page.getByTestId('typo-canvas-scale-content').click();
  await page.getByTestId('typo-canvas-ratio-1:1').click();

  await expect
    .poll(async () => (await readDoc(page, clipId))?.source?.doc?.size)
    .toEqual({ w: 1080, h: 1080 });
  expect((await readDoc(page, clipId))!.source!.doc!.elements[0]!.frame).toEqual(before);

  // 勾回来，把 1080×1080 的画布砍到 540×540：元素框按 0.5 重排
  await page.getByTestId('typo-canvas-scale-content').click();
  await page.getByTestId('typo-canvas-w').fill('540');
  await page.getByTestId('typo-canvas-w').press('Enter');

  await expect
    .poll(async () => (await readDoc(page, clipId))?.source?.doc?.size)
    .toEqual({ w: 540, h: 540 });
  const after = (await readDoc(page, clipId))!.source!.doc!.elements[0]!.frame;
  expect(after.x).toBeCloseTo(before.x / 2, 1);
  expect(after.y).toBeCloseTo(before.y / 2, 1);
  expect(after.w).toBeCloseTo(before.w / 2, 1);
  expect(after.h).toBeCloseTo(before.h / 2, 1);
});
