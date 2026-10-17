import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 排版 → 插入生成器（SVG 素材生成器一期）。
 *
 * 五处「坏掉不报错、只在界面上看得出来」的地方，所以断言都落在文档 / DOM：
 *  - **选择器按组列出全部生成器**：漏一组就是「某些素材找不到」；
 *  - **插入即烘焙**：`path` 必须已经是一条真路径，`gen` 只是「怎么再生成一次」；
 *  - **换类型**：`gen.id` 与路径都要变，带洞的生成器要置 `evenOdd`；
 *  - **调参一次拖动 = 一笔撤销**：否则撤销栈会被几十笔中间值塞满；
 *  - **转为路径 = 脱离生成器**：`gen` 清掉，生成器区消失，路径不变。
 */

interface GenDoc {
  size: { w: number; h: number };
  elements: {
    id: string;
    kind: string;
    name: string;
    shape?: string;
    path?: string;
    evenOdd?: boolean;
    fill?: { kind: string };
    stroke?: { color: string; width: number } | null;
    frame: { x: number; y: number; w: number; h: number; rot: number };
    gen?: { id: string; seed: number; params: Record<string, number | string> };
  }[];
}

interface Hooks {
  store: {
    project: { tracks: { clips: { id: string; source?: { type?: string; doc?: GenDoc } }[] }[] };
  };
  appState: { activeTypoClipId: string | null };
}

async function boot(page: Page): Promise<void> {
  // 宽一点：「插入」组在 1280 宽下会横向溢出，测到的是滚动而不是按钮。
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
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
  expect(added, '「+ 排版片段」没有新增片段（落点可能被重叠策略挡了）').toHaveLength(1);
  return added[0]!;
}

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

async function readDoc(page: Page): Promise<GenDoc> {
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

async function lastShape(page: Page) {
  const doc = await readDoc(page);
  const el = doc.elements[doc.elements.length - 1];
  expect(el?.kind, '文档末尾不是图形元素').toBe('shape');
  return el!;
}

async function openGenPicker(page: Page, clipId: string): Promise<void> {
  await openEditor(page, clipId);
  await page.getByTestId('ribbon-tab-insert').click();
  await page.getByTestId('typo-insert-generator').click();
  await expect(page.getByTestId('typo-gen-picker')).toBeVisible();
}

/** 右侧栏切到「元素属性」（默认停在「图层」，与用户路径一致）。 */
async function openProps(page: Page): Promise<void> {
  await page.getByTestId('typo-tab-props').click();
  await expect(page.getByTestId('typo-props')).toBeVisible();
}

test('选择器：六组 · 22 张卡 · 单击插入并选中', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await page.getByTestId('ribbon-tab-insert').click();

  // Ribbon 按钮的文字**不被截断**（宽度跟着标签走，见 ribbon-model::labelWidthPx）
  const lbl = page.getByTestId('typo-insert-generator').locator('.lbl');
  expect(await lbl.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);

  await page.getByTestId('typo-insert-generator').click();
  await expect(page.getByTestId('typo-gen-picker')).toBeVisible();

  // 六组分区（网格 / 径向 / 线 / 轮廓 / 伪 3D / 编码）
  await expect(page.locator('[data-testid^="typo-gen-group-"]')).toHaveCount(6);
  // 22 张卡（一期 20 + 二期 motif / contour），每张都有真实路径（不是占位白块）
  await expect(page.locator('[data-testid^="typo-gen-card-"]')).toHaveCount(22);
  await expect(page.locator('[data-testid^="typo-gen-card-"] path')).toHaveCount(22);

  /*
   * 预览盒必须与生成器的 aspect 严格同比例 —— 歪一点就是「圆被横向拉成椭圆」
   * （`preserveAspectRatio="none"` 会照着盒子拉伸）。
   */
  const square = (await page.getByTestId('typo-gen-card-tenprint').locator('.gen-art').boundingBox())!;
  expect(Math.abs(square.width - square.height)).toBeLessThan(1.5);
  const bar = (await page.getByTestId('typo-gen-card-barcode').locator('.gen-art').boundingBox())!;
  expect(bar.width / bar.height).toBeCloseTo(4, 0);

  await page.getByTestId('typo-gen-card-tenprint').click();
  await expect(page.getByTestId('typo-gen-picker')).toHaveCount(0);

  const el = await lastShape(page);
  expect(el.shape).toBe('svg');
  expect(el.gen?.id).toBe('tenprint');
  expect(el.path?.startsWith('M')).toBe(true);
  expect(el.path).not.toContain('NaN');
  // 线族：只有线宽没有面积 ⇒ 无填充 + 描边
  expect(el.fill?.kind).toBe('none');
  expect(el.stroke?.width).toBeGreaterThan(0);
  // 参数表落库（合并了默认值的全量值）
  expect(el.gen?.params['cols']).toBe(16);

  // 插入即选中 → 右侧「元素属性」出现生成器区
  await openProps(page);
  await expect(page.getByTestId('prop-gen-type')).toBeVisible();
  await expect(page.getByTestId('prop-gen-seed')).toBeVisible();
  await expect(page.getByTestId('prop-gen-reseed')).toBeVisible();
});

test('换类型：id 与路径都变，带洞的生成器置 evenOdd', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openGenPicker(page, clipId);
  await page.getByTestId('typo-gen-card-tenprint').click();

  const before = await lastShape(page);

  await openProps(page);
  // 换类型走**缩略图弹窗**（与更换特效 / 转场同一套交互），不是下拉。
  await page.getByTestId('prop-gen-type').click();
  await expect(page.getByTestId('typo-gen-picker')).toBeVisible();
  await expect(page.getByTestId('typo-gen-card-tenprint')).toHaveAttribute('data-current', 'true');
  await page.getByTestId('typo-gen-card-rings').click();
  await expect(page.getByTestId('typo-gen-picker')).toHaveCount(0);

  const after = await lastShape(page);
  expect(after.shape).toBe('svg');
  expect(after.gen?.id).toBe('rings');
  expect(after.path).not.toBe(before.path);
  // 同心环靠 evenodd 挖洞：不置的话是一个实心圆盘
  expect(after.evenOdd).toBe(true);
  // 类型切换重置参数表（旧类型的键不该残留）
  expect(after.gen?.params['count']).toBe(8);
  expect(after.gen?.params['cols']).toBeUndefined();
  // 种子保留（同种子对比不同生成器是常见手法）
  expect(after.gen?.seed).toBe(before.gen?.seed);

  // 换回线族：evenOdd 必须跟着清掉，否则新路径会被按 evenodd 填
  await page.getByTestId('prop-gen-type').click();
  await page.getByTestId('typo-gen-card-hatch').click();
  const back = await lastShape(page);
  expect(back.gen?.id).toBe('hatch');
  expect(back.evenOdd).toBeUndefined();
});

test('调参：拖动实时改路径，一次改动只落一笔撤销', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openGenPicker(page, clipId);
  await page.getByTestId('typo-gen-card-tenprint').click();

  const before = await lastShape(page);
  await openProps(page);
  const slider = page.getByTestId('prop-gen-cols-slider');
  await expect(slider).toBeVisible();

  // End = 拉到最大值（Slider 的键盘契约），会走 oninput + onchange 两个回调。
  await slider.focus();
  await slider.press('End');

  const after = await lastShape(page);
  expect(after.gen?.params['cols']).toBe(36);
  expect(after.path).not.toBe(before.path);

  /*
   * 一笔撤销回到改动之前（不是「先回到中间某一帧」）。
   * 先让滑杆失焦：自研控件带 `data-exempt`，全局快捷键在它聚焦时**整段让路**
   * （否则方向键会同时被控件与画布消费）。这与用户点一下别处再撤销等价。
   */
  await slider.evaluate((el) => (el as HTMLElement).blur());
  await page.keyboard.press('Control+z');
  const undone = await lastShape(page);
  expect(undone.gen?.params['cols']).toBe(16);
  expect(undone.path).toBe(before.path);
});

test('换种子：种子与路径都变，且同一元素可继续摇', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openGenPicker(page, clipId);
  await page.getByTestId('typo-gen-card-tenprint').click();

  const before = await lastShape(page);
  await openProps(page);
  await page.getByTestId('prop-gen-reseed').click();
  const once = await lastShape(page);
  expect(once.gen?.seed).not.toBe(before.gen?.seed);
  expect(once.path).not.toBe(before.path);

  await page.getByTestId('prop-gen-reseed').click();
  const twice = await lastShape(page);
  expect(twice.gen?.seed).not.toBe(once.gen?.seed);
  expect(twice.path).not.toBe(once.path);
});

test('转为路径 = 脱离生成器：gen 清掉、参数区消失、路径不变', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openGenPicker(page, clipId);
  await page.getByTestId('typo-gen-card-rings').click();

  const before = await lastShape(page);
  expect(before.gen?.id).toBe('rings');

  await openProps(page);
  await expect(page.getByTestId('prop-gen-type')).toBeVisible();

  await page.getByTestId('ribbon-tab-shape-format').click();
  const toPath = page.getByTestId('typo-to-path');
  // 生成器元素的 path 虽已烘焙，但「转为路径」的语义是脱离生成器 —— 必须可点。
  await expect(toPath).toBeEnabled();
  await toPath.click();

  const after = await lastShape(page);
  expect(after.gen).toBeUndefined();
  expect(after.shape).toBe('svg');
  // 路径原样保留（脱离不该顺手改几何）
  expect(after.path).toBe(before.path);
  expect(after.evenOdd).toBe(true);

  // 生成器区消失（不会出现「改了参数把手改节点覆盖」）
  await expect(page.getByTestId('prop-gen-type')).toHaveCount(0);
});
