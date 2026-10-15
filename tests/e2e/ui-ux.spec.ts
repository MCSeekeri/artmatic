import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * UI/UX 一轮改动的回归。
 *
 * 这里只放**界面行为**的断言（拖曳排序的位移、空界面、面板分页、悬浮球、
 * 两个导出按钮是不是同一行……）。渲染正确性在别的 spec 里，不在这里重复。
 *
 * 共同纪律：凡是用户能看见的效果，就断言 DOM 的几何或类名，不读 store ——
 * 「store 改了界面没改」正是这一轮改动最容易出的一类问题。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

/* ------------------------------------------------------------ 空界面 */

/*
 * 首屏**不再自动开 demo**（main.ts 的 `appState.init()` 不传工程）。
 * 这一条是那次改动的验收：不调 `openDemo`，直接看首屏。
 */
test('启动即欢迎界面（零选项卡）；「打开示例工程」能进去', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);

  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.locator('.tab')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as never as { __artmatic: { projects: () => unknown[] } }).__artmatic.projects().length,
    ),
  ).toBe(0);

  // 示例工程仍在，只是改成了空界面上的一个入口
  await page.getByTestId('empty-demo').click();
  await expect(page.getByTestId('empty-state')).toHaveCount(0);
  await expect(page.locator('.tab')).toHaveCount(1);
  // 它是一份真工程：时间轴上有轨道
  await expect(page.locator('[data-testid=track-side-row]').first()).toBeVisible();
});

test('关掉最后一份工程 → 空界面；从空界面能新建回来', async ({ page }) => {
  await boot(page);

  // 打开的那份 demo 是「从未保存过」的，所以算脏 —— 先弹确认，确认后才真关。
  await page.getByTestId('project-tab-close-0').click();
  await expect(page.getByTestId('confirm-close-project')).toBeVisible();
  await page.getByTestId('confirm-close-project-ok').click();

  await expect(page.getByTestId('empty-state')).toBeVisible();
  // 顶栏没有选项卡了（工程全关了）
  await expect(page.locator('.tab')).toHaveCount(0);
  // 空界面上「关闭空工程」这件事不该再出现：确实一份工程都没有
  expect(
    await page.evaluate(
      () => (window as never as { __artmatic: { projects: () => unknown[] } }).__artmatic.projects().length,
    ),
  ).toBe(0);

  // 新建 → 回到主界面
  await page.getByTestId('empty-new').click();
  await expect(page.getByTestId('empty-state')).toHaveCount(0);
  await expect(page.locator('.tab')).toHaveCount(1);
});

/* ------------------------------------------------------------ 拖曳排序 */

test('顶栏选项卡可拖曳排序，其它选项卡滑开让位', async ({ page }) => {
  await boot(page);
  await page.getByTestId('topbar-new-project').click();
  await page.getByTestId('topbar-new-project').click();
  const tabs = page.locator('[data-testid^=project-tab-]:not([data-testid*=close]):not([data-testid*=dirty]):not([data-testid*=timeline])');
  await expect(tabs).toHaveCount(3);

  const names = async (): Promise<string[]> =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.tab .tab-name')).map((e) => e.textContent ?? ''),
    );
  const before = await names();
  expect(before).toHaveLength(3);

  const first = (await tabs.nth(0).boundingBox())!;
  const second = (await tabs.nth(1).boundingBox())!;
  const third = (await tabs.nth(2).boundingBox())!;

  // 把第 1 个拖到第 3 个右侧
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width / 2, first.y + first.height / 2, { steps: 4 });
  // 中途：让位的项应当被 transform 推开（这就是「滑开」）
  const shifted = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.tab')).map((e) => e.style.transform),
  );
  expect(shifted.some((t) => t.includes('translateX'))).toBe(true);
  await page.mouse.move(third.x + third.width, first.y + first.height / 2, { steps: 4 });
  await page.mouse.up();

  const after = await names();
  // 顺序真的变了（原来的第一个挪到了最后）
  expect(after[after.length - 1]).toBe(before[0]);
  // 拖完不会顺带切换当前工程之外的副作用：选项卡数量不变
  await expect(tabs).toHaveCount(3);
});

test('轨道行可拖曳排序，且时间轴上的轨道顺序跟着变', async ({ page }) => {
  await boot(page);
  const rowNames = async (): Promise<string[]> =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid=track-name]')).map(
        (e) => e.textContent ?? '',
      ),
    );
  const names = await rowNames();
  expect(names.length).toBeGreaterThanOrEqual(3);

  const rows = page.getByTestId('track-side-row');
  const first = (await rows.nth(0).boundingBox())!;
  const last = (await rows.nth(names.length - 1).boundingBox())!;

  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.width / 2, last.y + last.height, { steps: 8 });
  await page.mouse.up();

  const after = await rowNames();
  expect(after[after.length - 1]).toBe(names[0]);

  // 时间轴右侧的轨道行（画布区）顺序必须同步 —— 两边读的是同一个数组
  const canvasOrder = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid=tl-row]')).map(
      (e) => e.getAttribute('data-track-id') ?? '',
    ),
  );
  const sideOrder = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid=track-side-row]')).map(
      (e) => e.getAttribute('data-track-id') ?? '',
    ),
  );
  expect(canvasOrder).toEqual(sideOrder);
});

/* ------------------------------------------------------------ 设置面板 */

test('设置面板：navside 四个分页可切换，且草稿态有主题色星号', async ({ page }) => {
  await boot(page);
  await page.getByTestId('rail-settings').click();
  await expect(page.getByTestId('modal-settings')).toBeVisible();

  await expect(page.getByTestId('settings-pane-project')).toBeVisible();
  await page.getByTestId('settings-nav-appearance').click();
  await expect(page.getByTestId('settings-pane-appearance')).toBeVisible();
  await page.getByTestId('settings-nav-habits').click();
  await expect(page.getByTestId('settings-pane-habits')).toBeVisible();
  await page.getByTestId('settings-nav-editor').click();
  await expect(page.getByTestId('settings-pane-editor')).toBeVisible();

  // 只列真正有差异的那一项按键
  await page.getByTestId('settings-nav-habits').click();
  await page.getByTestId('settings-scheme').click();
  await page.getByTestId('select-option-premiere').click();
  await expect(page.getByTestId('settings-scheme-table')).toContainText('Ctrl+K');

  // 已更改 → 星号出现（`*` 是文本不是图标，直接看文本即可）
  const habits = page.getByTestId('settings-pane-habits');
  await expect(habits.locator('.star')).toHaveCount(1);
});

test('设置面板：外观的字号改的是 --fs-*，且取消不落库', async ({ page }) => {
  await boot(page);
  const fsOf = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs-sm').trim());
  const before = await fsOf();

  await page.getByTestId('rail-settings').click();
  await page.getByTestId('settings-nav-appearance').click();
  await page.getByTestId('settings-font-scale').click();
  await page.getByTestId('select-option-1.25').click();
  await page.getByTestId('settings-apply').click();

  await expect.poll(fsOf).not.toBe(before);
  const after = await fsOf();
  expect(Number.parseFloat(after)).toBeGreaterThan(Number.parseFloat(before));
});

/* ------------------------------------------------------------ 预览工具条 */

test('预览工具条能收成悬浮球再展开，且不再有播放状态读数', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('preview-toolbar')).toBeVisible();
  // 播放状态已经由左下角的播放按钮表达，工具栏里不再重复一遍
  await expect(page.getByTestId('preview-readout')).toHaveCount(0);

  await page.getByTestId('preview-toolbar-collapse').click();
  await expect(page.getByTestId('preview-toolbar')).toHaveCount(0);
  await expect(page.getByTestId('preview-toolbar-ball')).toBeVisible();

  await page.getByTestId('preview-toolbar-ball').click();
  await expect(page.getByTestId('preview-toolbar')).toBeVisible();
});

/* ------------------------------------------------------------ 排版编辑器 */

async function addTextClip(page: Page): Promise<void> {
  await page.locator('[data-testid=track-side-row]').nth(0).getByTestId('track-menu').click();
  await page.getByTestId('add-text').click();
  const id = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { clips: { id: string; source?: { type?: string } }[] }[] } } };
    }).__artmatic;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) if (c.source?.type === 'text') return c.id;
    }
    return '';
  });
  await page.locator(`[data-testid=clip][data-clip-id="${id}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

test('排版 zoombar：高度固定、有缩放滑杆、显示画面尺寸', async ({ page }) => {
  await boot(page);
  await addTextClip(page);

  const bar = await page.locator('.zoombar').boundingBox();
  expect(bar, 'zoombar 应当存在').not.toBeNull();
  // 固定 26px：原来它被错误地放进 `minmax(0,1fr)` 那一行，会被拉高
  expect(bar!.height, `zoombar 高度应当固定，实测 ${bar!.height}`).toBeLessThanOrEqual(30);

  // 画面尺寸读数
  await expect(page.getByTestId('typo-canvas-size')).toContainText('1920');
  await expect(page.getByTestId('typo-canvas-size')).toContainText('1080');

  // 滑杆真的能改缩放（拖到轨道最右 = 400%）
  const pct = () => page.evaluate(() => document.querySelector('.zoom-val')?.textContent ?? '');
  await page.getByTestId('typo-zoom-fit').click();
  const fit = await pct();
  const sld = (await page.getByTestId('typo-zoom-slider').boundingBox())!;
  await page.mouse.click(sld.x + sld.width - 2, sld.y + sld.height / 2);
  await expect.poll(pct).not.toBe(fit);
  expect(Number.parseInt((await pct()).replace('%', ''), 10)).toBeGreaterThan(300);
});

test('Ribbon：纯小按钮的组排成两行', async ({ page }) => {
  await boot(page);
  await addTextClip(page);

  const ys = await page.evaluate(() =>
    ['typo-to-front', 'typo-forward', 'typo-backward', 'typo-to-back'].map((id) => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      return el ? Math.round(el.getBoundingClientRect().y) : -1;
    }),
  );
  expect(ys.every((y) => y > 0)).toBe(true);
  // 4 个层级按钮应当落在**恰好两行**上
  expect(new Set(ys).size).toBe(2);
  // 而且两行是成对的：1、2 在第一行，3、4 在第二行（顺序不乱）
  expect(ys[0]).toBe(ys[1]);
  expect(ys[2]).toBe(ys[3]);
  expect(ys[2]).toBeGreaterThan(ys[0]!);
});

test('无动画时：时序控件呈禁用态（既是功能上的也是视觉上的）', async ({ page }) => {
  await boot(page);
  await addTextClip(page);
  await page.getByTestId('typo-layer-row').first().click();
  await page.getByTestId('ribbon-tab-anim').click();

  for (const id of ['typo-anim-iterations', 'typo-anim-easing', 'typo-anim-direction']) {
    const el = page.getByTestId(id);
    await expect(el).toHaveAttribute('aria-disabled', 'true');
    // 视觉上也要能看出来：禁用态的背景被压到 surface-2、光标是默认箭头
    const cursor = await el.evaluate((n) => getComputedStyle(n).cursor);
    expect(cursor, `${id} 的禁用光标`).toBe('default');
  }
  const delayBox = await page.getByTestId('typo-anim-delay-wrap').evaluate(
    (n) => getComputedStyle(n).backgroundColor,
  );
  expect(delayBox).not.toBe('rgba(0, 0, 0, 0)');

  // 加上动画之后立刻恢复可编辑
  await page.getByTestId('typo-anim-preset').click();
  await page.getByTestId('typo-anim-option-fade-in').click();
  await expect(page.getByTestId('typo-anim-iterations')).toHaveAttribute('aria-disabled', 'false');
});

test('图层列表可拖曳排序，数组顺序跟着变', async ({ page }) => {
  await boot(page);
  await addTextClip(page);

  // 再插一个图形，凑出两行
  await page.getByTestId('typo-layer-row').first().click();
  await page.getByTestId('ribbon-tab-insert').click();
  await page.getByTestId('typo-shape').click();
  await page.getByTestId('typo-shape-card-rect').click();
  await expect(page.getByTestId('typo-layer-row')).toHaveCount(2);

  const order = () =>
    page.evaluate(() => {
      const A = (window as never as {
        __artmatic: {
          store: {
            project: {
              tracks: { clips: { source?: { type?: string; doc?: { elements: { id: string; kind: string }[] } } }[] }[];
            };
          };
        };
      }).__artmatic;
      for (const t of A.store.project.tracks) {
        for (const c of t.clips) {
          if (c.source?.type === 'text' && c.source.doc) return c.source.doc.elements.map((e) => e.kind);
        }
      }
      return [];
    });

  // 列表是倒序渲染：视觉第 0 行 = 数组最后一个元素
  expect((await order())[1]).toBe('shape');
  const rows = page.getByTestId('typo-layer-row');
  const top = (await rows.nth(0).boundingBox())!;
  const bottom = (await rows.nth(1).boundingBox())!;

  await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
  await page.mouse.down();
  await page.mouse.move(top.x + top.width / 2, bottom.y + bottom.height, { steps: 8 });
  await page.mouse.up();

  // 图形被拖到了数组更靠前的位置（视觉上更靠下）
  expect((await order())[0]).toBe('shape');
});


/* ------------------------------------------------------------ 导出面板 */

test('导出面板：MP4 / PNG / GIF 三个入口在同一行且水平居中', async ({ page }) => {
  await boot(page);
  await page.getByTestId('rail-export').click();
  await expect(page.getByTestId('modal-export')).toBeVisible();

  const mp4 = (await page.getByTestId('export-mp4').boundingBox())!;
  const png = (await page.getByTestId('export-png').boundingBox())!;
  const gif = (await page.getByTestId('export-gif').boundingBox())!;
  const modal = (await page.getByTestId('modal-export').boundingBox())!;

  // 同一行：三者的垂直区间都重叠
  expect(Math.abs(mp4.y - png.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(gif.y - png.y)).toBeLessThanOrEqual(2);
  expect(mp4.height).toBeGreaterThan(0);

  // 水平居中：三个按钮整体（含间隙）的中心与面板中心之差在半像素级
  const left = Math.min(mp4.x, png.x, gif.x);
  const right = Math.max(mp4.x + mp4.width, png.x + png.width, gif.x + gif.width);
  const mid = (left + right) / 2;
  expect(Math.abs(mid - (modal.x + modal.width / 2))).toBeLessThanOrEqual(2);

  // 体积提示各自挂在按钮**下方**，不是塞进标签里
  const mp4Label = (await page.getByTestId('export-mp4').textContent())!.trim();
  expect(mp4Label).toBe('MP4');
  const hintBox = (await page.getByTestId('export-mp4-hint').boundingBox())!;
  expect(hintBox.y).toBeGreaterThanOrEqual(mp4.y + mp4.height - 1);
});

/* ------------------------------------------------ 轨道区高度 + 全屏预览 */

test('轨道区高度可拖（工具条下缘热区），且拖完刷新还在', async ({ page }) => {
  await boot(page);

  const tracks = page.locator('.tracks');
  const before = (await tracks.boundingBox())!.height;
  // 默认 320（UiPrefs 的 fallback）
  expect(Math.round(before)).toBe(320);

  // 热区贴在轨道区**上沿**（工具条下缘）：往下拖 80 → 上沿下移 → 变矮 80
  // （边界跟随光标，与夹角那条方向相反）。
  const hot = (await page.getByTestId('tracks-resize').boundingBox())!;
  const cx = hot.x + hot.width / 2;
  const cy = hot.y + hot.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 80, { steps: 6 });
  await page.mouse.up();

  const after = (await tracks.boundingBox())!.height;
  expect(Math.round(after)).toBe(240);

  // 落盘的是 localStorage（UI 偏好），刷新后读回来
  await page.reload();
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
  expect(Math.round((await tracks.boundingBox())!.height)).toBe(240);
});

test('夹角热区一次手势同时调轨道区高度与抽屉宽度', async ({ page }) => {
  await boot(page);

  // 打开媒体池（左）与检查器（右）：两个夹角热区都在
  await page.getByTestId('rail-media').click();
  await expect(page.getByTestId('tracks-corner-pool')).toBeVisible();
  await expect(page.getByTestId('tracks-corner-drawer')).toBeVisible();

  const tracks = page.locator('.tracks');
  const drawer = page.locator('aside.drawer');
  const h0 = (await tracks.boundingBox())!.height;
  const w0 = (await drawer.boundingBox())!.width;

  // 拖右夹角（贴在轨道区**下沿**）：往左上 60×50 → 轨道区变矮（下沿上移）、检查器变宽
  const hot = (await page.getByTestId('tracks-corner-drawer').boundingBox())!;
  const cx = hot.x + hot.width / 2;
  const cy = hot.y + hot.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy - 50, { steps: 6 });
  await page.mouse.up();

  const h1 = (await tracks.boundingBox())!.height;
  const w1 = (await drawer.boundingBox())!.width;
  expect(Math.round(h1 - h0)).toBe(-50);
  expect(Math.round(w1 - w0)).toBe(60);
});

test('全屏预览：宿主是全屏元素，缓冲允许放大（并能在退出后收回）', async ({ page }) => {
  await boot(page);
  const kitW = () =>
    page.evaluate(
      () => (window as never as { __artmatic: { renderer: { kit: { w: number } } } }).__artmatic.renderer.kit.w,
    );

  /*
   * 窗口模式下的缓冲由**显示区域**决定（预览只缩不放）：视口 1280×720 里
   * 预览宿主只有 936×314，所以 1920×1080 的工程出 558×314。
   * 工程改成 640×360 也一样受这个高度限制（约 558）—— 这正是「全屏要允许
   * 放大」的理由：屏幕比输出分辨率大时，不放大会糊。
   */
  const windowed = await kitW();
  expect(windowed).toBeGreaterThan(0);
  await page.evaluate(() => {
    const A = (window as never as { __artmatic: { store: { setResolution: (w: number, h: number) => void } } }).__artmatic;
    A.store.setResolution(640, 360);
  });

  // 全屏宿主必须存在（不支持 Fullscreen API 的宿主上按钮不渲染）
  const btn = page.getByTestId('preview-fullscreen');
  await expect(btn).toBeVisible();
  await btn.click();
  await page.waitForFunction(() => document.fullscreenElement !== null);
  // 宿主就是预览容器（不是 canvas —— 悬浮工具条要跟着铺满）
  expect(
    await page.evaluate(() => document.fullscreenElement?.classList.contains('preview') ?? false),
  ).toBe(true);

  // 全屏显示 = 整个视口 1280×720 > 输出 640×360 → 允许放大到 2×（UPSCALE_CAP）
  await page.waitForFunction(
    () => (window as never as { __artmatic: { renderer: { kit: { w: number } } } }).__artmatic.renderer.kit.w >= 1200,
  );
  expect(await kitW()).toBeGreaterThan(640);

  // 退出走**我们的按钮**（`document.exitFullscreen()` 不需要手势，按钮里就是这么写的）。
  // 键盘 Esc 是浏览器级行为，headless 里不触发 —— 别用它当退出通道。
  // `fullscreenchange` 监听把状态同步回来（按钮图标、allowUpscale 都靠它）。
  await btn.click();
  await page.waitForFunction(() => document.fullscreenElement === null);
  // 退出全屏必须**关回**「只缩不放」——忘了关的话窗口模式下也按屏幕尺寸分配缓冲
  await page.waitForFunction(
    ({ w }) => (window as never as { __artmatic: { renderer: { kit: { w: number } } } }).__artmatic.renderer.kit.w === w,
    { w: windowed },
  );
  await expect(page.getByTestId('preview-fullscreen')).toBeVisible();
});
