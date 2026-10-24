import { expect, test, type Page } from '@playwright/test';
import { addTextClip, openDemo } from './_stage';

/**
 * 舞台上的「指哪选哪」。
 *
 * 这里守的是三件**只会静默出错**的事：
 *  1. **中空图形不该挡住下层**：命中框是外接矩形，圆环 / 方框中间那一大片其实
 *     什么都没画 —— 之前点在那里会选中圆环，下层元素永远点不到（只能 Alt 轮询）。
 *  2. **小元素要还能拖**：8 个把手的命中区（15px）在几十像素的框上会互相吃光，
 *     框内部不存在可按住的地方。Office 的做法是缩到四角 + 给一个移动握柄。
 *  3. **细线的可点区域不能只有一两像素**：严格按像素判定时，一条 8px 的横条要
 *     把指针精确压在墨迹上。模糊判定（探针 + 外接框容差）解决它，但**不许**变成
 *     「点哪都算」—— 离得远就该落空。
 */

interface Hooks {
  store: {
    project: {
      tracks: {
        clips: {
          id: string;
          source?: { type?: string; doc?: { elements: { id: string; kind: string; shape?: string }[] } };
        }[];
      }[];
    };
  };
  appState: { activeTypoClipId: string | null };
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

/** 当前排版文档里的元素（顺序即 z 序，末位 = 最前景）。 */
async function docEls(
  page: Page,
): Promise<{ id: string; kind: string; shape?: string }[]> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    const id = A.appState.activeTypoClipId;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === id && c.source?.doc) return c.source.doc.elements;
      }
    }
    return [];
  });
}

async function insertShape(page: Page, key: string): Promise<void> {
  await page.getByTestId('ribbon-tab-insert').click();
  await page.getByTestId('typo-shape').click();
  await page.getByTestId(`typo-shape-card-${key}`).click();
}

/** 选中集在图层列表里的那一行（`data-el-id` 是元素的稳定身份）。 */
const selectedRow = (page: Page) => page.locator('[data-testid="typo-layer-row"].selected');

test('中空图形的透明区域让位给下层元素，圆环自己那一圈仍可选中', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  // 先矩形（下层），再圆环（上层）。两者都落在画布中心、同尺寸 ⇒ 完全重叠。
  await insertShape(page, 'rect');
  await insertShape(page, 'ring');

  const els = await docEls(page);
  const rect = els.find((e) => e.shape === 'rect')!;
  const ring = els.find((e) => e.shape === 'ring')!;
  expect(rect, '矩形没插进来').toBeTruthy();
  expect(ring, '圆环没插进来').toBeTruthy();
  expect(els.indexOf(ring), '圆环必须在上层（后插入的 z 更高）').toBeGreaterThan(
    els.indexOf(rect),
  );

  // 清掉选择：圆环选中时它的选择框盖住整个外接框，指针根本到不了舞台。
  const stage = (await page.getByTestId('typo-stage').boundingBox())!;
  await page.mouse.click(stage.x + 6, stage.y + 6);
  await expect(page.getByTestId('typo-selection')).toHaveCount(0);

  const ringBox = (await page.locator(`.paper [data-el-id="${ring.id}"]`).boundingBox())!;

  // 圆心在洞上（透明）⇒ 命中下层的矩形。
  await page.mouse.click(ringBox.x + ringBox.width / 2, ringBox.y + ringBox.height / 2);
  await expect(selectedRow(page)).toHaveAttribute('data-el-id', rect.id);

  /*
   * 圆环的环带上（离左边 8px）⇒ 仍然是圆环。穿透不能把中空图形自己变成不可选。
   *
   * 先清空选择：矩形选中时它的选择框盖着这一片，pointerdown 落在框上就变成
   * 「拖整块选区」了（与 Office 一致 —— 框内是选区的地盘）。
   */
  await page.mouse.click(stage.x + 6, stage.y + 6);
  await expect(page.getByTestId('typo-selection')).toHaveCount(0);
  await page.mouse.click(ringBox.x + 8, ringBox.y + ringBox.height / 2);
  await expect(selectedRow(page)).toHaveAttribute('data-el-id', ring.id);
});

test('元素很小时把手缩成四角，并长出一个能拖的移动握柄', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await insertShape(page, 'rect');

  const id = (await docEls(page)).at(-1)!.id;
  const node = page.locator(`.paper [data-el-id="${id}"]`);

  // 大元素：8 个缩放把手，没有握柄（握柄常驻会让每个元素都长出一条尾巴）。
  for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    await expect(page.getByTestId(`typo-handle-${h}`)).toHaveCount(1);
  }
  await expect(page.getByTestId('typo-handle-move')).toHaveCount(0);

  // 拖右下角几乎压到左上角 ⇒ 一个比把手还小的框。
  const se = (await page.getByTestId('typo-handle-se').boundingBox())!;
  const nw = (await page.getByTestId('typo-handle-nw').boundingBox())!;
  await page.keyboard.down('Alt'); // Alt = 关吸附，免得把手被网格拽住
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(nw.x + nw.width / 2 + 6, nw.y + nw.height / 2 + 6, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');

  const small = (await page.getByTestId('typo-selection').boundingBox())!;
  expect(small.width).toBeLessThan(30);
  // 四角留着，四边中点收起（它们在这个尺寸上互相压住，谁也点不准）。
  for (const h of ['nw', 'ne', 'se', 'sw']) {
    await expect(page.getByTestId(`typo-handle-${h}`)).toHaveCount(1);
  }
  for (const h of ['n', 'e', 's', 'w']) {
    await expect(page.getByTestId(`typo-handle-${h}`)).toHaveCount(0);
  }
  await expect(page.getByTestId('typo-handle-move')).toHaveCount(1);

  // 拖握柄 = 移动（不是缩放）：元素在屏幕上正好跟指针走 60 / 40px，尺寸不变。
  const before = (await node.boundingBox())!;
  const grip = (await page.getByTestId('typo-handle-move').boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + grip.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');

  const after = (await node.boundingBox())!;
  // 指针坐标是整数 ⇒ 给 1px 的余量（Alt 关掉吸附后不该再有别的偏差来源）。
  expect(Math.abs(after.x - before.x - 60)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y - 40)).toBeLessThanOrEqual(1);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.height).toBeCloseTo(before.height, 0);
});

test('细线：框外 2px 仍可点中，离远了就落空（模糊判定不能变成粘住）', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await insertShape(page, 'rect');

  const id = (await docEls(page)).at(-1)!.id;
  const node = page.locator(`.paper [data-el-id="${id}"]`);

  // 压成一条又宽又薄的横条：只动下边（横向不动，宽度不变）。
  const se = (await page.getByTestId('typo-handle-se').boundingBox())!;
  const nw = (await page.getByTestId('typo-handle-nw').boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + se.width / 2, nw.y + nw.height / 2 + 8, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');

  const bar = (await node.boundingBox())!;
  expect(bar.height).toBeLessThan(20);
  // 只是要「够宽」：点击点落在水平中段，离两个角上的把手很远（它们的命中区 ±7.5px）。
  expect(bar.width).toBeGreaterThan(60);

  // 指针在条**上方 2px**（外接框外）：仍算挂在它旁边。
  await page.mouse.click(bar.x + bar.width / 2, bar.y - 2);
  await expect(selectedRow(page)).toHaveAttribute('data-el-id', id);

  // 清空后点上方 40px：太远，必须落空（否则整块画布都「粘」着它）。
  const stage = (await page.getByTestId('typo-stage').boundingBox())!;
  await page.mouse.click(stage.x + 6, stage.y + 6);
  await expect(page.getByTestId('typo-selection')).toHaveCount(0);
  await page.mouse.click(bar.x + bar.width / 2, bar.y - 40);
  await expect(page.getByTestId('typo-selection')).toHaveCount(0);
});
