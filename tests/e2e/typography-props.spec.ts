import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * M4 排版：右侧「元素属性」面板 + 填充的多色标 / 停靠位置 + 文本框背景。
 *
 * 与 typography-ribbon.spec.ts 同一条纪律：**能看见的状态就断言 DOM**，
 * store 断言只是补充。这里的四条用例各自钉住一个用户可见的行为：
 *   ① 几何输入框改的是画布上的真实位置 / 尺寸 / 旋转；
 *   ② 色标的增删与位置改完立刻反映到 SVG `<defs>` 的 `<stop>`；
 *   ③ 文本框背景画在外壳上、不碰字形（两层节点各管各的）；
 *   ④ 切换填充方式时 Ribbon 的**后续控件不再位移**（原先按类型条件展开，
 *      每切一次整条工具栏就重排一次）。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

interface DocShape {
  size: { w: number; h: number };
  elements: {
    id: string;
    kind: string;
    frame: { x: number; y: number; w: number; h: number; rot: number };
    fill?: {
      kind: string;
      color?: string;
      stops?: { offset: number; color: string }[];
      opacity?: number;
    };
    boxFill?: { kind: string; color?: string; opacity?: number };
    boxStroke?: { color: string; width: number; style?: string };
  }[];
}

interface Hooks {
  store: { project: { tracks: { clips: { id: string; source?: { type?: string; doc?: DocShape } }[] }[] } };
  appState: { activeTypoClipId: string | null };
}

async function addTextClip(page: Page): Promise<string> {
  const ids = (): Promise<string[]> =>
    page.evaluate(() => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      const out: string[] = [];
      for (const t of A.store.project.tracks) {
        for (const c of t.clips) if (c.source?.type === 'text') out.push(c.id);
      }
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

/** 读**当前编辑**的排版文档（按 activeTypoClipId 取，不扫「第一个 text 片段」）。 */
async function readDoc(page: Page): Promise<DocShape> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    const id = A.appState.activeTypoClipId;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === id && c.source?.type === 'text' && c.source.doc) return c.source.doc;
      }
    }
    throw new Error(`找不到当前编辑的排版文档（activeTypoClipId=${id}）`);
  });
}

/** 选中第一个元素（走图层面板，与用户路径一致）。 */
async function selectFirst(page: Page): Promise<void> {
  await page.getByTestId('typo-layer-row').first().click();
  await expect(page.getByTestId('typo-selection')).toBeVisible();
}

/** 画布上第 index 个元素的 left / transform（「界面有没有跟着变」的来源）。 */
async function domBox(page: Page, index = 0) {
  return page.evaluate((i) => {
    const el = document.querySelectorAll<HTMLElement>('.paper [data-el-id]')[i];
    if (!el) return null;
    return { left: el.style.left, width: el.style.width, transform: el.style.transform };
  }, index);
}

/** 插入一个矩形（走插入选项卡的图形面板，与用户路径一致）。插完自动选中。 */
async function insertRect(page: Page): Promise<void> {
  await page.getByTestId('ribbon-tab-insert').click();
  await page.getByTestId('typo-shape').click();
  await page.getByTestId('typo-shape-card-rect').click();
}

/** 把窗口开宽：面板 + Ribbon 同时在场时，窄视口测的是滚动不是功能。 */
async function wide(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 900 });
}

test('元素属性面板：位置 / 大小 / 旋转落进文档，且画布实时跟随', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  await page.getByTestId('typo-tab-props').click();
  const x = page.getByTestId('prop-x');
  await expect(x).toBeVisible();

  const before = (await readDoc(page)).elements[0]!.frame.x;
  await x.fill(String(before + 40));
  await x.press('Enter');
  expect((await readDoc(page)).elements[0]!.frame.x).toBe(before + 40);
  // 断言 DOM：store 改了但界面没跟上的 bug 在这个文件族的上一轮出现过。
  expect((await domBox(page, 0))!.left).toBe(`${before + 40}px`);

  const w = page.getByTestId('prop-w');
  await w.fill('300');
  await w.press('Enter');
  expect((await readDoc(page)).elements[0]!.frame.w).toBe(300);
  expect((await domBox(page, 0))!.width).toBe('300px');

  const rot = page.getByTestId('prop-rot');
  await rot.fill('90');
  await rot.press('Enter');
  expect((await readDoc(page)).elements[0]!.frame.rot).toBeCloseTo(Math.PI / 2, 5);
  expect((await domBox(page, 0))!.transform).toContain('rotate(90deg)');
});

test('填充色标：可加色标、改颜色与位置，SVG <defs> 同步', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await insertRect(page);

  await page.getByTestId('typo-tab-props').click();
  await page.getByTestId('prop-fill-kind').click();
  await page.getByTestId('prop-fill-kind-option-linear').click();

  const shapeId = (await readDoc(page)).elements[1]!.id;
  expect((await readDoc(page)).elements[1]!.fill!.kind).toBe('linear');
  expect((await readDoc(page)).elements[1]!.fill!.stops).toHaveLength(2);

  // 加一个色标：插在最大间隔的中点（0.5），颜色沿用左邻。
  await page.getByTestId('prop-fill-stop-add').click();
  const afterAdd = (await readDoc(page)).elements[1]!.fill!;
  expect(afterAdd.stops).toHaveLength(3);
  expect(afterAdd.stops![2]!.offset).toBeCloseTo(0.5, 5);
  expect(afterAdd.stops![2]!.color).toBe(afterAdd.stops![0]!.color);

  // 改位置 → SVG 的 <stop offset> 跟着变（渲染按 offset 排序）。
  const pos = page.getByTestId('prop-fill-stop-pos-2');
  await pos.fill('80');
  await pos.press('Enter');
  expect((await readDoc(page)).elements[1]!.fill!.stops![2]!.offset).toBeCloseTo(0.8, 5);
  const offsets = await page
    .locator(`[data-el-id="${shapeId}"] svg defs linearGradient stop`)
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('offset')));
  expect(offsets).toHaveLength(3);
  // 渲染按 offset 排序：新色标（文档里排第 3）落在中间，而不是原样躺在数组末尾。
  expect(offsets).toEqual(['0', '0.8', '1']);

  // 改颜色（第一个色标）→ 文档与 SVG 都要变。
  await page.getByTestId('prop-fill-stop-color-0').fill('#ff0000');
  expect((await readDoc(page)).elements[1]!.fill!.stops![0]!.color).toBe('#ff0000');
  const first = await page
    .locator(`[data-el-id="${shapeId}"] svg defs linearGradient stop`)
    .first()
    .getAttribute('stop-color');
  expect(first).toBe('#ff0000');
});

test('文本框背景：画在外壳上，字形色与裁切不受影响', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  await page.getByTestId('typo-tab-props').click();
  // 默认是「无」→ 切到纯色（类型下拉的 none 也在选项里）。
  await page.getByTestId('prop-box-kind').click();
  await page.getByTestId('prop-box-kind-option-solid').click();
  await page.getByTestId('prop-box-color').fill('#ff0000');

  const shell = await page.locator('.paper .typo-el').first().evaluate((el) => {
    const s = (el as HTMLElement).style;
    return { bg: s.backgroundColor, image: s.backgroundImage };
  });
  expect(shell.bg).toBe('rgb(255, 0, 0)');
  expect(shell.image).toBe('none');

  // 字形层（内层 .typo-text）不受影响：没有裁切、字形仍是不透明文字色。
  const text = await page.locator('.paper .typo-text').first().evaluate((el) => {
    const s = (el as HTMLElement).style;
    return { clip: s.getPropertyValue('background-clip'), color: s.color };
  });
  expect(text.clip).toBe('border-box');
  expect(text.color).not.toBe('transparent');

  expect((await readDoc(page)).elements[0]!.boxFill?.kind).toBe('solid');

  // 边框：宽度输入即生效（同一面板的「文本框边框」区）。
  const bw = page.getByTestId('prop-box-stroke-width');
  await bw.fill('3');
  await bw.press('Enter');
  expect((await readDoc(page)).elements[0]!.boxStroke?.width).toBe(3);
  const border = await page
    .locator('.paper .typo-el')
    .first()
    .evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(border).toBe('3px');
});

test('切换填充方式不再让 Ribbon 重排（填充组是稳定控件集）', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await insertRect(page);
  await page.getByTestId('ribbon-tab-shape-format').click();

  // 取填充组**之后**的控件当探针：它一动，说明整条工具栏在重排。
  const probe = page.getByTestId('ribbon-stroke-width');
  const fillBtn = page.getByTestId('ribbon-shape-fill');
  const before = (await probe.boundingBox())!;
  const fillBefore = (await fillBtn.boundingBox())!;

  await page.getByTestId('ribbon-fill-kind').click();
  await page.getByTestId('ribbon-fill-kind-option-texture').click();
  await expect(fillBtn).toBeEnabled();
  const afterTexture = (await probe.boundingBox())!;
  expect(Math.abs(afterTexture.x - before.x)).toBeLessThan(1);

  await page.getByTestId('ribbon-fill-kind').click();
  await page.getByTestId('ribbon-fill-kind-option-radial').click();
  const afterRadial = (await probe.boundingBox())!;
  expect(Math.abs(afterRadial.x - before.x)).toBeLessThan(1);
  // 主色控件本身也不许动（它是组内的第二个控件，组宽恒定的另一半证据）。
  expect(Math.abs((await fillBtn.boundingBox())!.x - fillBefore.x)).toBeLessThan(1);
});
