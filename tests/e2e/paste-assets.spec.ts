import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 剪贴板素材的粘贴，以及排版编辑页里的媒体池。
 *
 * 粘贴事件是**合成**的（`DataTransfer` 里装真的 `File`）：真实的 Ctrl+V 需要
 * 操作系统剪贴板，Playwright 驱动不了，而合成事件走的是**同一个 paste 处理
 * 函数**（连「没有素材时必须放行原生粘贴」那一步都不绕），所以仍然是在测
 * 真实路径 —— 与 media-pool.spec 合成拖拽事件是同一条取舍。
 *
 * 时间轴与排版页的粘贴**都要测**：它们共用一个入口，但落点完全不同
 * （一个弹询问框，一个直接置入画布），而「共用一个入口」正是这里最容易
 * 悄悄坏掉的地方。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

/** 现场造一张上红下蓝的 PNG（默认 64×64，不往仓库塞二进制）。 */
async function makePng(page: Page, w = 64, h = 64): Promise<number[]> {
  return page.evaluate(
    async ({ w, h }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, w, h >> 1);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, h >> 1, w, h - (h >> 1));
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : [];
    },
    { w, h },
  );
}

interface PasteFile {
  name: string;
  mime: string;
  bytes: number[];
}

/**
 * 在页面里合成一次 paste 事件，`DataTransfer` 里装真的 `File`。
 *
 * 派发到 `document.body`（真实按键时焦点不在输入框上就是这个 target），
 * 由它冒泡到 window —— 监听挂在那儿。`clipboardData` 优先走构造参数，
 * 构造器不吃它时补一个只读属性（两条路都要通，否则这个 spec 会静默地
 * 「什么都没粘贴」）。
 */
async function dispatchPaste(page: Page, files: PasteFile[]): Promise<void> {
  await page.evaluate((payload) => {
    const dt = new DataTransfer();
    for (const f of payload) {
      dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.mime }));
    }
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    if (!ev.clipboardData) Object.defineProperty(ev, 'clipboardData', { value: dt });
    document.body.dispatchEvent(ev);
  }, files);
}

interface ClipInfo {
  id: string;
  start: number;
  end: number;
  source?: { type?: string; assetId?: string };
}

async function clipsOf(page: Page): Promise<ClipInfo[]> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: { store: { project: { tracks: { clips: ClipInfo[] }[] } } } })
      .__artmatic;
    return A.store.project.tracks.flatMap((t) => t.clips);
  });
}

async function setPlayhead(page: Page, t: number): Promise<void> {
  await page.evaluate((tt) => {
    (window as never as { __artmatic: { appState: { playT: number } } }).__artmatic.appState.playT = tt;
  }, t);
}

/**
 * 清掉 demo 的全部片段，让**落点可预测**。
 *
 * 「粘贴到播放头」没有指定轨（`trackId: null`）时由 `insertAssetClip` 挑
 * 「第一条装得下的视觉轨」，而 `addClip` 在落点被占着时**顺延**到下一个空档
 * —— 那是导入片段的既有语义。demo 轨上本来就排满了，不清场的话 4s 的落点
 * 会被推到几十秒之后（实测 24s），断言就变成在测 demo 的排布。
 */
async function clearClips(page: Page): Promise<void> {
  await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: { commit: (label: string, fn: (p: { tracks: { clips: unknown[] }[] }) => void) => void };
      };
    }).__artmatic;
    A.store.commit('e2e: 清空片段', (p) => {
      for (const t of p.tracks) t.clips = [];
    });
  });
}

/* ------------------------------------------------------------------ 时间轴 */

test('时间轴粘贴图片：弹询问框列出素材；「放到播放头」建片段并落在播放头', async ({ page }) => {
  const errors: string[] = [];
  await boot(page);
  page.on('pageerror', (e) => errors.push(String(e)));

  const bytes = await makePng(page);
  await clearClips(page);
  const before = (await clipsOf(page)).map((c) => c.id);
  await setPlayhead(page, 4);

  await dispatchPaste(page, [
    { name: 'paste-a.png', mime: 'image/png', bytes },
    { name: 'paste-b.png', mime: 'image/png', bytes },
  ]);

  // 询问框：两条素材都列出来（名字就是用户能用来核对的判据）
  const modal = page.getByTestId('paste-assets');
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('paste-assets-list').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('paste-assets-list')).toContainText('paste-a.png');
  await expect(page.getByTestId('paste-assets-list')).toContainText('paste-b.png');

  await page.getByTestId('paste-assets-place').click();
  await expect(modal).toHaveCount(0);

  await expect
    .poll(async () => (await clipsOf(page)).filter((c) => c.source?.type === 'image').length, {
      timeout: 20_000,
    })
    .toBe(2);

  const images = (await clipsOf(page))
    .filter((c) => c.source?.type === 'image' && !before.includes(c.id))
    .sort((a, b) => a.start - b.start);
  expect(images, '应当新建两条 image 片段').toHaveLength(2);
  expect(images[0]!.start, `第一条应当落在播放头 4s，实测 ${images[0]!.start}`).toBeCloseTo(4, 1);
  // 两条首尾相接（多文件导入的既有语义）
  expect(images[1]!.start).toBeCloseTo(images[0]!.end, 2);

  expect(errors, `不该有未捕获异常：${errors.join(' | ')}`).toEqual([]);
});

test('时间轴粘贴：「仅加入媒体池」只登记素材、不建片段，并给一句回执', async ({ page }) => {
  await boot(page);
  const bytes = await makePng(page);
  const before = (await clipsOf(page)).length;

  await dispatchPaste(page, [{ name: 'pooled-paste.png', mime: 'image/png', bytes }]);
  await expect(page.getByTestId('paste-assets')).toBeVisible();
  await page.getByTestId('paste-assets-pool').click();

  // 回执（自动消失，所以先断它）
  await expect(page.getByTestId('notice')).toBeVisible();

  // 抽屉是条件渲染的 —— 先把它打开，素材行才会在 DOM 里
  await page.getByTestId('rail-media').click();
  await expect(page.getByTestId('media-drawer')).toBeVisible();

  // 闸门是「媒体池里出现了这条素材」——不是回执文本（文案会变，素材不会）
  await expect(page.locator('[data-testid=pool-item][data-kind=image]')).toHaveCount(1, {
    timeout: 20_000,
  });

  expect((await clipsOf(page)).length, '只进池子的路不该建片段').toBe(before);
});

test('粘贴不是素材时不接管：剪贴板里只有文本 → 不弹框', async ({ page }) => {
  await boot(page);
  await dispatchPaste(page, [{ name: 'notes.txt', mime: 'text/plain', bytes: [104, 105] }]);
  await expect(page.getByTestId('paste-assets')).toHaveCount(0);
});

/* ------------------------------------------------------------------ 排版页 */

/** 通过轨道 ⋯ 菜单新建一个排版片段并打开编辑页。 */
async function openTypographyEditor(page: Page): Promise<void> {
  await page.locator('[data-testid=track-side-row]').nth(0).getByTestId('track-menu').click();
  const ids = () =>
    page.evaluate(() => {
      const A = (window as never as { __artmatic: { store: { project: { tracks: { clips: { id: string; source?: { type?: string } }[] }[] } } } })
        .__artmatic;
      const out: string[] = [];
      for (const t of A.store.project.tracks) {
        for (const c of t.clips) if (c.source?.type === 'text') out.push(c.id);
      }
      return out;
    });
  const before = await ids();
  await page.getByTestId('add-text').click();
  const added = (await ids()).filter((id) => !before.includes(id));
  expect(added, '「+ 排版片段」没有新增片段').toHaveLength(1);
  await page.locator(`[data-testid=clip][data-clip-id="${added[0]}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

interface DocElement {
  id: string;
  kind: string;
  assetId?: string;
  name?: string;
  fit?: string;
  frame: { x: number; y: number; w: number; h: number; rot: number };
}

/** 当前编辑中的排版文档尺寸（落点断言要 CSS px ↔ 文档坐标互换）。 */
async function docSizeOf(page: Page): Promise<{ w: number; h: number }> {
  return page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        appState: { activeTypoClipId: string | null };
        store: {
          project: {
            tracks: { clips: { id: string; source?: { type?: string; doc?: { size: { w: number; h: number } } } }[] }[];
          };
        };
      };
    }).__artmatic;
    const id = A.appState.activeTypoClipId;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === id && c.source?.type === 'text' && c.source.doc) return c.source.doc.size;
      }
    }
    throw new Error(`找不到当前编辑的排版文档（activeTypoClipId=${id}）`);
  });
}

/** 当前编辑中的排版文档元素（读的是工程里的真副本）。 */
async function docElements(page: Page): Promise<DocElement[]> {
  return page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        appState: { activeTypoClipId: string | null };
        store: {
          project: {
            tracks: { clips: { id: string; source?: { type?: string; doc?: { elements: DocElement[] } } }[] }[];
          };
        };
      };
    }).__artmatic;
    const id = A.appState.activeTypoClipId;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === id && c.source?.type === 'text' && c.source.doc) return c.source.doc.elements;
      }
    }
    throw new Error(`找不到当前编辑的排版文档（activeTypoClipId=${id}）`);
  });
}

test('排版页粘贴图片：直接置入画布中心（多张阶梯错开），并真的渲染出来', async ({ page }) => {
  const errors: string[] = [];
  await boot(page);
  page.on('pageerror', (e) => errors.push(String(e)));

  await openTypographyEditor(page);
  const before = await docElements(page);
  // 2:1 的图：正方块 + cover 会裁掉两侧 —— 那正是用户报的「置入默认被裁切」
  const bytes = await makePng(page, 128, 64);

  await dispatchPaste(page, [
    { name: 'typo-a.png', mime: 'image/png', bytes },
    { name: 'typo-b.png', mime: 'image/png', bytes },
  ]);

  // 排版页**不弹询问框**：那边只有一种合理解释
  await expect(page.getByTestId('paste-assets')).toHaveCount(0);
  await expect.poll(async () => (await docElements(page)).length, { timeout: 20_000 }).toBe(before.length + 2);

  const added = (await docElements(page)).filter((e) => e.kind === 'image');
  expect(added).toHaveLength(2);
  expect(added.every((e) => e.assetId)).toBe(true);

  const doc = await docSizeOf(page);

  // 第一张在画布正中；第二张错开（全都叠在中心的话只看得见最后一张）
  const centerOf = (e: DocElement) => ({ x: e.frame.x + e.frame.w / 2, y: e.frame.y + e.frame.h / 2 });
  const c0 = centerOf(added[0]!);
  const c1 = centerOf(added[1]!);
  expect(Math.abs(c0.x - doc.w / 2), `第一张应当在水平中线上，实测 ${c0.x}`).toBeLessThan(2);
  expect(Math.abs(c0.y - doc.h / 2)).toBeLessThan(2);
  expect(c1.x, '第二张应当错开（否则完全重叠）').toBeGreaterThan(c0.x + 4);
  expect(c1.y).toBeGreaterThan(c0.y + 4);

  // 默认框按**原图比例**，且 fit 是 contain —— 「置入 = 原图完整可见」
  for (const e of added) {
    expect(e.fit, '图片元素默认不裁切').toBe('contain');
    const ratio = e.frame.w / e.frame.h;
    expect(Math.abs(ratio - 2), `应当保持 2:1 的原比例，实测 ${e.frame.w}×${e.frame.h}`).toBeLessThan(0.05);
  }

  // 舞台 DOM 里真的出现了 <img>，且图已经解码（naturalWidth > 0）
  const img = page.locator('[data-testid=typo-stage] img').first();
  await expect(img).toBeVisible();
  await expect
    .poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);

  expect(errors, `不该有未捕获异常：${errors.join(' | ')}`).toEqual([]);
});

test('排版页媒体池：Ribbon 开合、拖图片到画布落点；关掉后舞台还在', async ({ page }) => {
  const errors: string[] = [];
  await boot(page);
  page.on('pageerror', (e) => errors.push(String(e)));

  // ① 先在时间轴用粘贴把一张图收进池子（同一个 spec 里的既有路径）
  const bytes = await makePng(page);
  await dispatchPaste(page, [{ name: 'canvas-src.png', mime: 'image/png', bytes }]);
  await page.getByTestId('paste-assets-pool').click();
  await expect(page.getByTestId('notice')).toBeVisible();

  // ② 进排版页：抽屉此时是收起的
  await openTypographyEditor(page);
  await expect(page.getByTestId('media-drawer')).toHaveCount(0);

  // Ribbon 的「媒体池」开合按钮（在「插入」页里）：开了抽屉，舞台还在
  //（栅格列显式定位的回归守卫）
  await page.getByTestId('ribbon-tab-insert').click();
  await page.getByTestId('typo-media-pool').click();
  await expect(page.getByTestId('media-drawer')).toBeVisible();
  const stageOpen = (await page.getByTestId('typo-stage').boundingBox())!.width;
  expect(stageOpen, '舞台应当还在（媒体池不该把画面挤没）').toBeGreaterThan(200);

  // ① 里那条素材确实在池子里（回执之外的实据），且它真的是一张图片
  const rowSel = '[data-testid=pool-item][data-kind=image]';
  await expect(page.locator(rowSel)).toHaveCount(1);
  const before = await docElements(page);

  // ③ 拖池子里的行到画布上的某一点 —— 落点就是元素中心
  const wrap = (await page.locator('.paper-wrap').boundingBox())!;
  const at = { x: Math.round(wrap.x + 120), y: Math.round(wrap.y + 90) };
  await page.evaluate(
    ({ rowSel, x, y }) => {
      const src = document.querySelector(rowSel);
      const dst = document.querySelector('.paper-wrap');
      if (!src || !dst) throw new Error('拖拽两端有一个不在');
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      for (const type of ['dragover', 'drop'] as const) {
        dst.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }),
        );
      }
    },
    { rowSel, x: at.x, y: at.y },
  );

  await expect.poll(async () => (await docElements(page)).length, { timeout: 10_000 }).toBe(before.length + 1);
  const added = (await docElements(page)).find((e) => !before.some((b) => b.id === e.id))!;
  expect(added.kind).toBe('image');

  // 落点：CSS px → 文档坐标（除以 zoom），元素中心应当落在鼠标位置上
  const zoom = wrap.width / (await docSizeOf(page)).w;
  const docX = 120 / zoom;
  const docY = 90 / zoom;
  expect(Math.abs(added.frame.x + added.frame.w / 2 - docX), `落点 x 偏差过大（实测中心 ${added.frame.x + added.frame.w / 2}，期望 ${docX}）`).toBeLessThan(2);
  expect(Math.abs(added.frame.y + added.frame.h / 2 - docY)).toBeLessThan(2);

  // ④ 关掉抽屉：舞台不能掉进 0 宽的那一列（AGENTS：条件渲染的栅格子项必须显式定位）
  await page.getByTestId('typo-media-pool').click();
  await expect(page.getByTestId('media-drawer')).toHaveCount(0);
  const stageClosed = (await page.getByTestId('typo-stage').boundingBox())!.width;
  expect(stageClosed, '关掉媒体池之后舞台应当把宽度拿回来').toBeGreaterThan(stageOpen + 100);

  expect(errors, `不该有未捕获异常：${errors.join(' | ')}`).toEqual([]);
});
