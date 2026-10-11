import { expect, test, type Page } from '@playwright/test';

/**
 * 媒体池（左侧素材抽屉）与「导入图片」这条新入口。
 *
 * 两条都是**真实路径**走到黑，不绕开任何一步：
 *   导入图片：轨道右键 → 菜单 → 文件选择器（`filechooser`）→ image 片段 → 画面
 *   媒体池：Rail 入口 → 抽屉列出素材 → 插入到时间轴
 *
 * 图片字节是**现场造的**（64×64，上红下蓝），不往仓库塞二进制。方向判据
 * （上红下蓝）同时抓两件事：上下翻转、以及压根没画出来 —— 两者都会让画面变空，
 * 而「非空」这种断言对它们无能为力。
 */

type Rgb = [number, number, number];

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

/**
 * 关掉 demo 的全部轨道，并建一条自己的空视觉轨（与 m6 同一套手法）。
 *
 * `addTrack` 是 push（新轨落在数组末尾 = 时间轴最下面一行），所以「最后一行」
 * 一定是我们这条 —— 用 `.last()` 定位轨道行时才不会摸到 demo 的音频轨。
 */
async function cleanStage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: {
          addTrack: (kind: 'visual', name?: string) => string;
          commit: (label: string, fn: (p: { tracks: { id: string; enabled: boolean }[] }) => void) => void;
        };
      };
    }).__artmatic;
    A.store.commit('e2e: 清空舞台', (p) => {
      for (const t of p.tracks) t.enabled = false;
    });
    const track = A.store.addTrack('visual', 'MP');
    A.store.commit('e2e: 只启用新轨', (p) => {
      for (const t of p.tracks) t.enabled = t.id === track;
    });
    return track;
  });
}

/** 现场造一张 64×64、上红下蓝的 PNG。 */
async function makePng(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 32, 64, 32);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : [];
  });
}

interface ClipInfo {
  id: string;
  kind: string;
  start: number;
  end: number;
  fit?: string;
  source?: { type?: string; assetId?: string };
}

/** 工程里所有轨上的片段（摊平）。 */
async function clipsOf(page: Page): Promise<ClipInfo[]> {
  return page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { clips: ClipInfo[] }[] } } };
    }).__artmatic;
    return A.store.project.tracks.flatMap((t) => t.clips);
  });
}

/** 逻辑素材表里那条 image 素材的 id（demo 工程里还有一条程序生成的音频素材）。 */
async function imageAssetId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { assets: Record<string, { kind: string }> } } };
    }).__artmatic;
    const hit = Object.entries(A.store.project.assets).find(([, a]) => a.kind === 'image');
    return hit ? hit[0] : null;
  });
  expect(id, '导入之后工程里应当有一条 image 素材').not.toBeNull();
  return id!;
}

/**
 * 整帧 + 上下半的三通道均值。
 * `readPixels` 的原点在**左下** → rows[0..h/2) 是画面下半，别按 DOM 的直觉读。
 */
async function halvesAt(page: Page, t: number): Promise<{ all: Rgb; bottom: Rgb; top: Rgb }> {
  return page.evaluate((tt) => {
    const A = (window as never as {
      __artmatic: {
        renderer: { onSeek: () => void };
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[]; w: number; h: number };
      };
    }).__artmatic;
    A.renderer.onSeek();
    A.renderFrame(tt);
    const { data, w, h } = A.readPixels();
    const region = (y0: number, y1: number): [number, number, number] => {
      const s = [0, 0, 0];
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = (y * w + x) * 4;
          s[0]! += data[i]!;
          s[1]! += data[i + 1]!;
          s[2]! += data[i + 2]!;
          n += 1;
        }
      }
      return [s[0]! / n, s[1]! / n, s[2]! / n] as [number, number, number];
    };
    const mid = Math.floor(h / 2);
    return { all: region(0, h), bottom: region(0, mid), top: region(mid, h) };
  }, t);
}

/**
 * 走**真实的导入路径**右键菜单导一张图片：右键轨道行 → 「导入图片…」→ 选文件。
 * 返回新登记的 assetId。
 */
async function importImage(page: Page, trackId: string, name: string): Promise<string> {
  const bytes = await makePng(page);
  expect(bytes.length, '现场造的 PNG 不该是空的').toBeGreaterThan(100);

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    (async () => {
      // x=30px ≈ 0.5s 处（默认 28px/拍 = 56px/s），吸附到拍后落在 0.5s
      await page
        .locator(`[data-testid=tl-row][data-track-id="${trackId}"]`)
        .click({ button: 'right', position: { x: 30, y: 14 } });
      await page.getByTestId('ctx-image').click();
    })(),
  ]);
  await chooser.setFiles({ name, mimeType: 'image/png', buffer: Buffer.from(bytes) });

  await expect
    .poll(async () => (await clipsOf(page)).filter((c) => c.source?.type === 'image').length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  return imageAssetId(page);
}

/* ------------------------------------------------------------------ 拖进来 */

interface DropFile {
  name: string;
  mime: string;
  bytes: number[];
}

/**
 * 在页面里合成一次拖拽事件，`DataTransfer` 里装的是**真的 `File`**。
 *
 * 为什么不靠 Playwright 从桌面真的拖：`DataTransfer.files` 只有浏览器自己的
 * 拖拽才会带，而合成事件走的是**同一个 drop 处理函数**（连「dragover 期间读
 * `types`」那一步都一致），所以这仍然是在测真实路径，只是省掉了操作系统的参与。
 * 坐标按视口算 —— 与鼠标事件同一套（`clientX/clientY`）。
 */
async function dispatchFileDrag(
  page: Page,
  selector: string,
  type: 'dragenter' | 'dragover' | 'drop',
  files: DropFile[],
  at: { x: number; y: number },
): Promise<void> {
  await page.evaluate(
    ({ selector, type, files, at }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`找不到落点：${selector}`);
      const dt = new DataTransfer();
      for (const f of files) {
        dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.mime }));
      }
      el.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: at.x,
          clientY: at.y,
          dataTransfer: dt,
        }),
      );
    },
    { selector, type, files, at },
  );
}

/**
 * 轨道行上的落点：`dx` 是离行左边界的像素数（默认 28px/拍 @120BPM ⇒ 56px/s，
 * 所以 224px = 4s）。y 取行中线。
 */
async function rowDropPoint(
  page: Page,
  trackId: string,
  dx = 224,
): Promise<{ selector: string; x: number; y: number }> {
  const selector = `[data-testid=tl-row][data-track-id="${trackId}"]`;
  const box = (await page.locator(selector).boundingBox())!;
  return { selector, x: Math.round(box.x + dx), y: Math.round(box.y + box.height / 2) };
}

/** 一条素材在工程里的登记（时长 / 尺寸 / 字节数）。 */
async function assetInfo(
  page: Page,
  id: string,
): Promise<{ kind: string; name: string; durationSec?: number; size?: { w: number; h: number }; bytes: number }> {
  return page.evaluate((assetId) => {
    const A = (window as never as {
      __artmatic: {
        store: {
          project: {
            assets: Record<string, { kind: string; name: string; durationSec?: number; size?: { w: number; h: number } }>;
          };
        };
        assets: { get: (id: string) => Uint8Array | null };
      };
    }).__artmatic;
    return { ...A.store.project.assets[assetId]!, bytes: A.assets.get(assetId)?.byteLength ?? 0 };
  }, id);
}

/* ------------------------------------------------------------------ 导入图片 */

test('导入图片：右键菜单 → image 片段，且画面真的画得出来（上红下蓝）', async ({ page }) => {
  const errors: string[] = [];
  await boot(page);
  page.on('pageerror', (e) => errors.push(String(e)));

  const track = await cleanStage(page);
  const assetId = await importImage(page, track, 'e2e-pic.png');

  // demo 的片段还在（只是轨道被关掉），所以按类型数：image 片段恰好一条
  const clips = await clipsOf(page);
  const images = clips.filter((c) => c.source?.type === 'image');
  expect(images).toHaveLength(1);
  const clip = images[0]!;
  expect(clip.source?.assetId).toBe(assetId);
  // 图片默认 contain（照片不该被工程画幅裁掉一块），长度 4 拍 = 2s @120BPM
  expect(clip.fit).toBe('contain');
  expect(clip.end - clip.start).toBeCloseTo(2, 2);

  // 素材登记齐了吗：kind / 尺寸 / 字节都在
  const asset = await page.evaluate((id) => {
    const A = (window as never as {
      __artmatic: {
        store: { project: { assets: Record<string, { kind: string; name: string; size?: { w: number; h: number } }> } };
        assets: { get: (id: string) => Uint8Array | null };
      };
    }).__artmatic;
    return { ...A.store.project.assets[id]!, bytes: A.assets.get(id)?.byteLength ?? 0 };
  }, assetId);
  expect(asset.kind).toBe('image');
  expect(asset.name).toBe('e2e-pic.png');
  expect(asset.size).toEqual({ w: 64, h: 64 });
  expect(asset.bytes).toBeGreaterThan(100);

  // 画面：既有红又有蓝，且上半是红的、下半是蓝的
  const h = await halvesAt(page, clip.start + 0.2);
  expect(h.all[0], `整帧应当既有红又有蓝，实测 ${JSON.stringify(h.all)}`).toBeGreaterThan(40);
  expect(h.all[2]).toBeGreaterThan(40);
  const where = JSON.stringify(h);
  expect(h.top[0], `画面上半应当是红的，实测 ${where}`).toBeGreaterThan(h.top[2] + 40);
  expect(h.bottom[2], `画面下半应当是蓝的，实测 ${where}`).toBeGreaterThan(h.bottom[0] + 40);

  expect(errors, `不该有未捕获异常：${errors.join(' | ')}`).toEqual([]);
});

/* ------------------------------------------------------------------ 媒体池 */

test('媒体池：Rail 入口 → 抽屉按类型列出已导入素材（缺字节的不算缺失）', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  await importImage(page, track, 'e2e-pic.png');

  // 默认收起：抽屉不在 DOM 里
  await expect(page.getByTestId('media-drawer')).toHaveCount(0);

  await page.getByTestId('rail-media').click();
  await expect(page.getByTestId('media-drawer')).toBeVisible();

  // 图片组：就是我们刚导的那张，缩略图是真的 <img>
  const imageGroup = page.locator('[data-testid=pool-group][data-kind=image]');
  await expect(imageGroup).toBeVisible();
  await expect(imageGroup.getByTestId('pool-name')).toHaveText('e2e-pic.png');
  await expect(imageGroup).toHaveCount(1);
  await expect(page.getByTestId('pool-thumb')).toHaveCount(1);

  // 音频组：demo 的节拍素材是**程序生成**的（没有字节，但随时可重建）——
  // 它绝不能被打上「素材缺失」。
  const audioGroup = page.locator('[data-testid=pool-group][data-kind=audio]');
  await expect(audioGroup.getByTestId('pool-item')).toHaveCount(1);
  await expect(audioGroup.locator('.warn')).toHaveCount(0);

  // 视频组还在（demo 工程没有视频素材），空组不渲染
  await expect(page.locator('[data-testid=pool-group][data-kind=video]')).toHaveCount(0);

  // 收起按钮真的收起
  await page.getByTestId('media-drawer-toggle').click();
  await expect(page.getByTestId('media-drawer')).toHaveCount(0);
});

test('从媒体池插入：点 + → 时间轴多一条片段，落在播放头上', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  await importImage(page, track, 'e2e-pic.png');

  await page.getByTestId('rail-media').click();
  await expect(page.getByTestId('media-drawer')).toBeVisible();

  const row = page.locator('[data-testid=pool-item][data-kind=image]');
  const assetId = await row.getAttribute('data-asset-id');
  expect(assetId).toBeTruthy();

  // 播放头挪到 4s，插入应当落在那里（吸附档位是「拍」）
  await page.evaluate(() => {
    (window as never as { __artmatic: { appState: { playT: number } } }).__artmatic.appState.playT = 4;
  });

  const before = (await clipsOf(page)).map((c) => c.id);
  await row.getByTestId('pool-insert').click();

  await expect
    .poll(async () => (await clipsOf(page)).length, { timeout: 10_000 })
    .toBe(before.length + 1);

  const after = await clipsOf(page);
  const added = after.find((c) => !before.includes(c.id))!;
  expect(added.source?.assetId).toBe(assetId);
  expect(added.start, `应当落在播放头 4s 上，实测 ${added.start}`).toBeCloseTo(4, 1);
  // 插完就选中它 —— 接下来大概率要立刻拖它 / 调它的参数
  const selected = await page.evaluate(
    () => (window as never as { __artmatic: { appState: { selectedClipId: string | null } } }).__artmatic.appState.selectedClipId,
  );
  expect(selected).toBe(added.id);
});

test('双击条目也能插入（同一条池子里的素材可以重复用）', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  await importImage(page, track, 'e2e-pic.png');

  await page.getByTestId('rail-media').click();
  const before = (await clipsOf(page)).length;
  await page.locator('[data-testid=pool-item][data-kind=image]').dblclick();
  await expect.poll(async () => (await clipsOf(page)).length, { timeout: 10_000 }).toBe(before + 1);
});

test('抽屉宽度可拖（往右变宽），收起后画面把宽度拿回来', async ({ page }) => {
  await boot(page);
  const stageBox = async (): Promise<number> => (await page.locator('.stage').boundingBox())!.width;

  const closed = await stageBox();
  await page.getByTestId('rail-media').click();
  await expect(page.getByTestId('media-drawer')).toBeVisible();
  const open = await stageBox();
  expect(open, '抽屉占的是画面自己的宽度').toBeLessThan(closed - 100);

  const w0 = (await page.getByTestId('media-drawer').boundingBox())!.width;
  const hb = (await page.getByTestId('media-drawer-resize').boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2, { steps: 5 });
  await page.mouse.up();

  const w1 = (await page.getByTestId('media-drawer').boundingBox())!.width;
  expect(w1, '热区在右边缘 ⇒ 往右拖是变宽').toBeGreaterThan(w0 + 40);
  expect(await stageBox()).toBeLessThan(open - 40);

  await page.getByTestId('media-drawer-toggle').click();
  await expect(page.getByTestId('media-drawer')).toHaveCount(0);
  expect(await stageBox(), '关掉之后 0 宽列不留痕').toBeCloseTo(closed, 0);
});

/* ------------------------------------------------------- 从系统拖文件进来 */

test('从系统拖视频到时间轴：落在指针处，媒体池里还有它的缩略图', async ({ page }) => {
  const errors: string[] = [];
  await boot(page);
  page.on('pageerror', (e) => errors.push(String(e)));

  const track = await cleanStage(page);
  // 现场编一段测试视频（与 m6 用同一个 E2E 钩子：不往仓库塞二进制）
  const bytes = await page.evaluate(async () => {
    const A = (window as never as { __artmatic: { makeTestVideo: () => Promise<number[]> } }).__artmatic;
    return A.makeTestVideo();
  });
  expect(bytes.length).toBeGreaterThan(1000);

  const at = await rowDropPoint(page, track, 224); // 224px = 4s
  const files: DropFile[] = [{ name: 'dropped.mp4', mime: 'video/mp4', bytes }];

  // ① 拖动中：竖线出现，且落在**吸附后**的位置上（4s ⇒ 224px）
  await dispatchFileDrag(page, at.selector, 'dragover', files, at);
  const line = page.getByTestId('tl-drop-line');
  await expect(line).toHaveCount(1);
  const left = await line.evaluate((el) => Number.parseFloat((el as HTMLElement).style.left));
  expect(Math.abs(left - 224), `竖线应当在 4s（224px）上，实测 ${left}px`).toBeLessThan(2);

  // ② 松手：片段落地，素材登记齐（时长 / 尺寸来自 probe）
  await dispatchFileDrag(page, at.selector, 'drop', files, at);
  await expect(line).toHaveCount(0);
  await expect
    .poll(async () => (await clipsOf(page)).filter((c) => c.source?.type === 'video').length, {
      timeout: 20_000,
    })
    .toBe(1);

  const clip = (await clipsOf(page)).find((c) => c.source?.type === 'video')!;
  expect(clip.start, `应当落在 4s，实测 ${clip.start}`).toBeCloseTo(4, 1);
  expect(clip.end - clip.start).toBeCloseTo(2, 1); // 测试视频时长 2s
  const asset = await assetInfo(page, clip.source!.assetId!);
  expect(asset.kind).toBe('video');
  expect(asset.durationSec).toBeCloseTo(2, 1);
  expect(asset.size).toEqual({ w: 160, h: 90 });
  expect(asset.bytes).toBeGreaterThan(1000);

  // ③ 视频也有缩略图（惰性解一帧）——这是本用例最贵也最值钱的一条
  await page.getByTestId('rail-media').click();
  const videoRow = page.locator('[data-testid=pool-item][data-kind=video]');
  await expect(videoRow).toHaveCount(1);
  await expect(videoRow.getByTestId('pool-thumb')).toHaveCount(1, { timeout: 20_000 });

  expect(errors, `不该有未捕获异常：${errors.join(' | ')}`).toEqual([]);
});

test('一次拖两个文件进来：在时间轴上首尾相接', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  const bytes = await makePng(page);
  const at = await rowDropPoint(page, track, 112); // 112px = 2s
  await dispatchFileDrag(page, at.selector, 'drop', [
    { name: 'a.png', mime: 'image/png', bytes },
    { name: 'b.png', mime: 'image/png', bytes },
  ], at);

  await expect
    .poll(async () => (await clipsOf(page)).filter((c) => c.source?.type === 'image').length, {
      timeout: 20_000,
    })
    .toBe(2);

  const images = (await clipsOf(page))
    .filter((c) => c.source?.type === 'image')
    .sort((a, b) => a.start - b.start);
  expect(images[0]!.start, '第一条落在指针处（2s）').toBeCloseTo(2, 1);
  expect(images[0]!.end - images[0]!.start).toBeCloseTo(2, 1); // 图片默认 4 拍
  expect(images[1]!.start, '第二条接在第一条末尾').toBeCloseTo(images[0]!.end, 2);
});

test('拖到媒体池：只登记素材不建片段；认不出的文件只提示、不中断整批', async ({ page }) => {
  await boot(page);
  await cleanStage(page);
  await page.getByTestId('rail-media').click();
  const drawer = page.getByTestId('media-drawer');
  await expect(drawer).toBeVisible();
  const box = (await drawer.boundingBox())!;
  const at = {
    selector: '[data-testid=media-drawer]',
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
  const bytes = await makePng(page);
  const files: DropFile[] = [
    { name: 'pooled.png', mime: 'image/png', bytes },
    { name: 'notes.txt', mime: 'text/plain', bytes: [104, 105] },
  ];

  // 拖动中：覆盖层给出「松手会发生什么」
  await dispatchFileDrag(page, at.selector, 'dragenter', files, at);
  await dispatchFileDrag(page, at.selector, 'dragover', files, at);
  await expect(page.getByTestId('pool-drop-veil')).toHaveCount(1);

  await dispatchFileDrag(page, at.selector, 'drop', files, at);
  await expect(page.getByTestId('pool-drop-veil')).toHaveCount(0);

  // 好文件进池子，坏文件只说一句
  await expect(page.locator('[data-testid=pool-item][data-kind=image]')).toHaveCount(1);
  await expect(page.getByTestId('notice')).toContainText('notes.txt');
  // 而且一条片段都没建（拖到池子上只是「收进素材」）
  expect((await clipsOf(page)).filter((c) => c.source?.type === 'image')).toHaveLength(0);
});

test('从媒体池把素材拖到时间轴：落在指针处，并选中新片段', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  await importImage(page, track, 'e2e-pic.png');
  await page.getByTestId('rail-media').click();

  const rowSel = '[data-testid=pool-item][data-kind=image]';
  const assetId = await page.locator(rowSel).getAttribute('data-asset-id');
  const at = await rowDropPoint(page, track, 280); // 280px = 5s

  /*
   * 真实的拖拽三连：dragstart 在池子的行上（我们自己的 setData 在那里面），
   * 然后 dragover → drop 在轨道行上，全程共用同一个 DataTransfer ——
   * 这正是浏览器自己做的那一套。
   */
  await page.evaluate(
    ({ rowSel, targetSel, x, y }) => {
      const src = document.querySelector(rowSel);
      const dst = document.querySelector(targetSel);
      if (!src || !dst) throw new Error('拖拽两端有一个不在');
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      for (const type of ['dragover', 'drop'] as const) {
        dst.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }),
        );
      }
    },
    { rowSel, targetSel: at.selector, x: at.x, y: at.y },
  );

  await expect
    .poll(async () => (await clipsOf(page)).filter((c) => c.source?.type === 'image').length, {
      timeout: 10_000,
    })
    .toBe(2);

  const images = (await clipsOf(page))
    .filter((c) => c.source?.type === 'image')
    .sort((a, b) => a.start - b.start);
  expect(images[1]!.source?.assetId, '拖出来的是同一条素材').toBe(assetId);
  expect(images[1]!.start, `应当落在 5s，实测 ${images[1]!.start}`).toBeCloseTo(5, 1);

  const selected = await page.evaluate(
    () => (window as never as { __artmatic: { appState: { selectedClipId: string | null } } }).__artmatic.appState.selectedClipId,
  );
  expect(selected, '拖进来的那条应当被选中').toBe(images[1]!.id);
});

/* ------------------------------------------------------------------ 空状态 */

test('空工程：媒体池说「还没有素材」，不列出上一份工程的素材', async ({ page }) => {
  await boot(page);

  // Rail → 工程面板 → 新建空白工程（素材仓是**每份工程自己的**）
  await page.getByTestId('rail-project').click();
  await page.getByTestId('project-new').click();
  await expect(page.getByTestId('modal-project')).toHaveCount(0);

  await page.getByTestId('rail-media').click();
  await expect(page.getByTestId('media-drawer')).toBeVisible();
  await expect(page.getByTestId('pool-empty')).toBeVisible();
  await expect(page.getByTestId('pool-item')).toHaveCount(0);
});
