import { expect, test, type Page } from '@playwright/test';
import { addTextClip, openDemo } from './_stage';

/**
 * 「图片格式」Ribbon 的图片工具：色彩校正 / 滤镜 / 边框 / 裁剪 / 调整大小 /
 * 对齐画布 / 裁剪为形状。
 *
 * 判据分三层，缺一层就会出现「界面看着对、画面没变」这类静默失效：
 *  1. **文档**：字段真的写进去了（`adjust` / `filter` / `crop` / `border` / `kind`）；
 *  2. **DOM / CSS**：边框是 wrapper 的 inset 阴影，不是 `<img>` 上的样式；
 *  3. **像素**：滤镜走 canvas 路径（`<img>` 被替换）后，灰度的三通道必须相等。
 *
 * 底图现场画（绿底 + 红块），不往仓库塞二进制。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

interface DocElement {
  id: string;
  kind?: string;
  frame: { x: number; y: number; w: number; h: number; rot: number };
  fit?: string;
  crop?: { x: number; y: number; w: number; h: number };
  border?: { color: string; width: number };
  adjust?: { brightness: number; contrast: number; saturation: number; sharpen: number; soften: number };
  filter?: { id: string; amount: number };
  imageFill?: { assetId: string; fit: string };
}

/** 当前编辑中的排版文档里**那张图片元素**（或它在「裁剪为形状」之后的化身）。 */
async function readElement(page: Page): Promise<DocElement> {
  return page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: { project: { tracks: { clips: { id: string; source?: { type?: string; doc?: { elements: unknown[] } } }[] }[] } };
        appState: { activeTypoClipId: string | null };
      };
    }).__artmatic;
    const id = A.appState.activeTypoClipId;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id !== id || c.source?.type !== 'text' || !c.source.doc) continue;
        const els = c.source.doc.elements as DocElement[];
        // 图片 / 由图片裁成的形状都是「唯一一个带 imageFill 或 kind:image 的元素」。
        const found = els.find((e) => e.kind === 'image' || e.imageFill);
        if (found) return JSON.parse(JSON.stringify(found)) as DocElement;
      }
    }
    throw new Error('文档里没有图片元素');
  });
}

async function makePng(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(32, 32, 64, 64);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

/** 插入一张图并选中它，返回它在舞台上的外接框（后续拖 / 点都要用）。 */
async function insertAndSelectImage(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const clipId = await addTextClip(page);
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-stage')).toBeVisible();

  await page.getByTestId('ribbon-tab-insert').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    page.getByTestId('typo-add-image').click(),
  ]);
  await chooser.setFiles({ name: 'fx.png', mimeType: 'image/png', buffer: await makePng(page) });
  await expect(page.locator('.paper .typo-image img')).toHaveCount(1, { timeout: 15_000 });

  const shell = page.locator('.paper .typo-el', { has: page.locator('.typo-image') }).first();
  const box = (await shell.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId('ribbon-tab-image-format').click();
  return box;
}

test('图片格式：工具按钮齐全，色彩校正 / 滤镜走 canvas 且像素正确', async ({ page }) => {
  await boot(page);
  await insertAndSelectImage(page);

  for (const id of [
    'ribbon-image-key',
    'ribbon-image-quad',
    'ribbon-image-adjust',
    'ribbon-image-recolor',
    'ribbon-image-filter',
    'ribbon-image-crop',
    'ribbon-image-size',
    'ribbon-image-align',
    'ribbon-image-clip-shape',
  ]) {
    await expect(page.getByTestId(id), `缺少 ${id}`).toBeVisible();
  }

  // 色彩校正：拖动亮度滑杆到 75%（≈ +50）
  await page.getByTestId('ribbon-image-adjust').click();
  await expect(page.getByTestId('img-adjust-pop')).toBeVisible();
  const slider = page.getByTestId('img-adjust-brightness');
  const sb = (await slider.boundingBox())!;
  await page.mouse.click(sb.x + sb.width * 0.75, sb.y + sb.height / 2);

  await expect
    .poll(async () => (await readElement(page)).adjust?.brightness ?? 0, { timeout: 5000 })
    .toBeGreaterThan(0);
  // 有调整 ⇒ 必须走 canvas 路径（否则调整根本没生效）
  const canvas = page.locator('.paper .typo-image canvas[data-typo-fx]');
  await expect(canvas).toHaveCount(1, { timeout: 15_000 });

  // 滤镜：切到浮层 → 选「黑白」
  await page.getByTestId('ribbon-image-filter').click();
  await expect(page.getByTestId('img-filter-pop')).toBeVisible();
  await page.getByTestId('img-filter-grayscale').click();
  await expect.poll(async () => (await readElement(page)).filter?.id ?? '').toBe('grayscale');
  // 强度拉满：默认 60% 是与原图的混合，三通道不会完全相等。
  await page.getByTestId('img-filter-amount-num').fill('100');
  await page.getByTestId('img-filter-amount-num').press('Enter');
  await expect.poll(async () => (await readElement(page)).filter?.amount ?? 0).toBe(1);

  /*
   * 处理是**异步**的（去抖 50ms + 解码 + 逐像素），旧 canvas 会留到新位图就绪
   * （这是刻意的，避免闪空白）。所以这里轮询像素，而不是点完就断言 ——
   * 立刻读到的可能还是「只有亮度」的那一张。
   */
  await expect
    .poll(
      async () =>
        canvas.first().evaluate((cv) => {
          const el = cv as HTMLCanvasElement;
          const d = el.getContext('2d')!;
          const center = Array.from(d.getImageData(Math.floor(el.width / 2), Math.floor(el.height / 2), 1, 1).data);
          return Math.max(Math.abs(center[0]! - center[1]!), Math.abs(center[1]! - center[2]!));
        }),
      { timeout: 10_000 },
    )
    .toBeLessThanOrEqual(1);
});

test('图片格式：边框写进 wrapper 的 inset 阴影', async ({ page }) => {
  await boot(page);
  await insertAndSelectImage(page);

  // 点颜色控件之外的数字框：浮层（若有）先自关，然后写宽度
  await page.getByTestId('ribbon-image-border-width').fill('8');
  await page.getByTestId('ribbon-image-border-width').press('Enter');
  await expect.poll(async () => (await readElement(page)).border?.width ?? 0).toBe(8);

  const shadow = await page
    .locator('.paper .typo-image')
    .first()
    .evaluate((el) => getComputedStyle(el as HTMLElement).boxShadow);
  expect(shadow, `边框应画成 inset 阴影，实得 ${shadow}`).toContain('inset');
});

test('图片格式：裁剪预设 / 对齐画布 / 调整大小都写到 frame 与 crop', async ({ page }) => {
  await boot(page);
  await insertAndSelectImage(page);

  // 16:9：方图 → 横向铺满、纵向切到 9/16，并且 fit 提成 cover
  await page.getByTestId('ribbon-image-crop').click();
  await page.getByTestId('crop-16-9').click();
  await expect.poll(async () => (await readElement(page)).crop?.w ?? 0).toBeGreaterThan(0.99);
  const cropped = await readElement(page);
  expect(cropped.crop!.h).toBeCloseTo(9 / 16, 3);
  expect(cropped.fit).toBe('cover');

  // 调整大小：宽 400（锁比例 ⇒ 高也是 400，素材是方图）
  await page.getByTestId('ribbon-image-size').click();
  await expect(page.getByTestId('img-size-pop')).toBeVisible();
  await page.getByTestId('img-size-w').fill('400');
  await page.getByTestId('img-size-w').press('Enter');
  await expect.poll(async () => Math.round((await readElement(page)).frame.w)).toBe(400);
  expect(Math.round((await readElement(page)).frame.h)).toBe(400);

  // 对齐画布 → 居中
  await page.getByTestId('ribbon-image-align').click();
  await page.getByTestId('align-center').click();
  const centered = await readElement(page);
  const size = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { clips: { id: string; source?: { type?: string; doc?: { elements: { kind?: string; imageFill?: unknown }[]; size: { w: number; h: number } } } }[] }[] } }; appState: { activeTypoClipId: string | null } };
    }).__artmatic;
    const id = A.appState.activeTypoClipId;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === id && c.source?.type === 'text' && c.source.doc) return c.source.doc.size;
      }
    }
    return { w: 0, h: 0 };
  });
  expect(Math.round(centered.frame.x + centered.frame.w / 2)).toBe(Math.round(size.w / 2));
  expect(Math.round(centered.frame.y + centered.frame.h / 2)).toBe(Math.round(size.h / 2));
});

test('图片格式：裁剪为形状 = 图形 + imageFill，SVG 里真有 <image>', async ({ page }) => {
  await boot(page);
  await insertAndSelectImage(page);

  await page.getByTestId('ribbon-image-clip-shape').click();
  await page.getByTestId('ribbon-image-clip-shape-card-ellipse').click();

  const el = await readElement(page);
  expect(el.kind, '裁剪为形状之后元素应变成图形').toBe('shape');
  expect(el.imageFill?.fit).toBe('cover');

  // 渲染：<svg> 里一张 <image>（图片填充）+ 一条被 clip 的路径
  const image = page.locator('.paper .typo-el svg image');
  await expect(image).toHaveCount(1);
  const href = await image.getAttribute('href');
  expect(href, '图片填充的 <image> 没有 href').toBeTruthy();

  // 光栅化（导出那条路）不能因为 <image> + clipPath 而抛
  const ok = await page.evaluate(async () => {
    const A = (window as never as {
      __artmatic: {
        store: { project: { tracks: { clips: { id: string; source?: { type?: string; doc?: unknown } }[] }[] } };
        appState: { activeTypoClipId: string | null; textRaster: { rasterizeOnce: (d: unknown, w: number, h: number, t: number) => Promise<HTMLCanvasElement> } };
      };
    }).__artmatic;
    const id = A.appState.activeTypoClipId;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id !== id || c.source?.type !== 'text' || !c.source.doc) continue;
        const doc = c.source.doc as { size: { w: number; h: number } };
        const cv = await A.appState.textRaster.rasterizeOnce(doc, doc.size.w, doc.size.h, 0);
        return cv.width > 0 && cv.height > 0;
      }
    }
    return false;
  });
  expect(ok, '光栅化失败').toBe(true);
});
