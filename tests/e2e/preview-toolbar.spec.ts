import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openDemo, buildStage } from './_stage';
import { zhCN } from '../../src/i18n/locales/zh-CN';

/**
 * 预览工具栏（PreviewToolbar）与轨道工具条里的「当前帧截图」。
 *
 * 独立成一个 spec（没有并进 ui-ux / m6）是刻意的：这一批改动的验收点
 * 集中在「四角定位」「档位持久化」「tooltip 换行」「截图落盘」四件事上，
 * 塞进别处只会让那两条长用例更难读。同文件内的用例互不共享状态。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

/* ------------------------------------------------- 工具栏贴画面右下角 */

test('预览工具栏贴在画面右下角，收起后的悬浮球也在角落', async ({ page }) => {
  await boot(page);
  await buildStage(page, { id: 'pv-corner', source: { type: 'solid', color: '#336699' } });

  const stage = (await page.locator('.preview').boundingBox())!;
  const bar = (await page.getByTestId('preview-toolbar').boundingBox())!;

  // 距右下角 = --sp-3 = 6px（留 2~10px 的容差覆盖亚像素舍入）。
  const rightGap = stage.x + stage.width - (bar.x + bar.width);
  const bottomGap = stage.y + stage.height - (bar.y + bar.height);
  expect(rightGap, `工具栏右边缘应贴住画面右边缘，实测间距 ${rightGap}`).toBeGreaterThanOrEqual(2);
  expect(rightGap).toBeLessThanOrEqual(10);
  expect(bottomGap, `工具栏下边缘应贴住画面下边缘，实测间距 ${bottomGap}`).toBeGreaterThanOrEqual(2);
  expect(bottomGap).toBeLessThanOrEqual(10);

  // 不再浮在正中：条的垂直中心必须落在画面的下半部。
  expect(bar.y + bar.height / 2).toBeGreaterThan(stage.y + stage.height / 2);

  // 收起后那颗球同样在角落（用户反馈的正是「球也挡画面」）。
  await page.getByTestId('preview-toolbar-collapse').click();
  await expect(page.getByTestId('preview-toolbar')).toHaveCount(0);
  const ball = (await page.getByTestId('preview-toolbar-ball').boundingBox())!;
  expect(stage.x + stage.width - (ball.x + ball.width)).toBeLessThanOrEqual(10);
  expect(stage.y + stage.height - (ball.y + ball.height)).toBeLessThanOrEqual(10);
  expect(ball.y + ball.height / 2).toBeGreaterThan(stage.y + stage.height / 2);
});

/* ------------------------------------------------- 吸附档位持久化 */

test('吸附档位跨会话保持，非法值回落到该形态的默认档', async ({ page }) => {
  await boot(page);
  const snap = page.getByTestId('snap-mode');
  // 默认「小节」：默认时间轴形态是节奏模式，它的吸附初值就是小节
  // （见 `defaultSnapForMode`）。
  await expect(snap).toContainText(zhCN['tl.snapBar']);

  // 改成「拍」→ 落进 UI 偏好
  await snap.click();
  await page.getByTestId('snap-mode-opt-beat').click();
  await expect(snap).toContainText(zhCN['tl.snapBeat']);

  // 重开页面（新会话）后仍是「拍」
  await page.reload();
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
  await expect(page.getByTestId('snap-mode')).toContainText(zhCN['tl.snapBeat']);

  // 手改 localStorage 成一个不存在的档位 → 读回时回落**该形态的默认值**（节奏 = 小节），
  // 而不是整条偏好作废、也不是一个不属于本形态的值。
  await page.evaluate(() => {
    const raw = localStorage.getItem('artmatic.ui');
    const p = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    p.snap = 'bogus-mode';
    localStorage.setItem('artmatic.ui', JSON.stringify(p));
  });
  await page.reload();
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
  await expect(page.getByTestId('snap-mode')).toContainText(zhCN['tl.snapBar']);
});

/* --------------------------------------------------- 当前帧截图 */

/*
 * 默认出口是**系统剪贴板**（截图是「拿去用」的动作，下载会在下载文件夹里堆一串
 * 带帧号的文件），下载保留为两条逃生通道：按住 Alt 点击、剪贴板不可用时自动回退。
 * 三条路径都要有用例 —— 「剪贴板写不进去就静默什么都不发生」是这类改动最容易
 * 漏掉的回归形态，而它在界面上只表现为「点了没反应」。
 */

test('复制当前帧（默认）：PNG 进系统剪贴板，尺寸是工程分辨率', async ({ page }) => {
  await boot(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await buildStage(page, { id: 'pv-copy', source: { type: 'solid', color: '#cc3366' } });

  await page.getByTestId('preview-snapshot').click();

  // 渲染 + 编码是异步的，等剪贴板里真的出现图片
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        try {
          const items = await navigator.clipboard.read();
          return items.some((i) => i.types.includes('image/png'));
        } catch {
          return false;
        }
      }),
    )
    .toBe(true);

  const shot = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((i) => i.types.includes('image/png'))!;
    const blob = await item.getType('image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // 解一次图，证明进去的是**画面**而不是一张空 PNG
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(bmp.width >> 1, bmp.height >> 1, 1, 1).data;
    return {
      magic: [...bytes.slice(0, 8)],
      w: view.getUint32(16),
      h: view.getUint32(20),
      px: [px[0]!, px[1]!, px[2]!],
    };
  });

  // PNG 幻数
  expect(shot.magic).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR 的宽 / 高（大端，偏移 16 / 20）= 工程分辨率，证明走的是工程分辨率而非预览缓冲
  expect(shot.w).toBe(1920);
  expect(shot.h).toBe(1080);
  // 画面内容：纯色源 #cc3366 = (204, 51, 102)（留 10 的容差给色彩管理）
  expect(Math.abs(shot.px[0] - 204)).toBeLessThanOrEqual(10);
  expect(Math.abs(shot.px[1] - 51)).toBeLessThanOrEqual(10);
  expect(Math.abs(shot.px[2] - 102)).toBeLessThanOrEqual(10);
});

test('导出当前帧（Alt 点击）：触发 PNG 下载，尺寸是工程分辨率', async ({ page }) => {
  await boot(page);
  await buildStage(page, { id: 'pv-snap', source: { type: 'solid', color: '#cc3366' } });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('preview-snapshot').click({ modifiers: ['Alt'] });
  const download = await downloadPromise;

  // 文件名含帧号（开机播放头为 0 → frame-00000）
  expect(download.suggestedFilename()).toMatch(/frame-\d{5}\.png$/);
  const path = await download.path();
  const bytes = new Uint8Array(await readFile(path!));

  // PNG 幻数
  expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR 的宽 / 高（大端，偏移 16 / 20）= 工程分辨率，证明走的是工程分辨率而非预览缓冲
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(16)).toBe(1920);
  expect(view.getUint32(20)).toBe(1080);
});

test('反馈类特效：截图按帧顺序重放，超出上限退回单帧并报出 truncated', async ({ page }) => {
  await boot(page);
  // echo 是反馈型（跨帧历史）：单帧取材在数学上不可能复现「顺序播放到该帧」的画面
  await buildStage(
    page,
    { id: 'pv-replay', source: { type: 'solid', color: '#ff8800' } },
    { id: 'pv-replay-fx', defId: 'echo', values: {} },
  );

  // 播放头拉到 2.5 s：目标帧号（fps 的 2.5 倍）必然高过下面压到 60 的重放上限
  const shot = await page.evaluate(async () => {
    const A = (window as never as { __artmatic: { appState: { playT: number; snapshotFrame: () => Promise<{ replayed: number; truncated: boolean; frame: number } | null> }; store: { project: { fps: number } } } }).__artmatic;
    A.appState.playT = 2.5;
    const first = await A.appState.snapshotFrame();
    // 把重放上限压到目标帧号以下 → 必须退回单帧并如实报出来
    (window as never as { __artmatic: { capacity: { set: (p: object) => void } } }).__artmatic.capacity.set({
      snapshotReplayMaxFrames: 60,
    });
    const capped = await A.appState.snapshotFrame();
    return {
      fps: A.store.project.fps,
      first: first && { replayed: first.replayed, truncated: first.truncated, frame: first.frame },
      capped: capped && { replayed: capped.replayed, truncated: capped.truncated },
    };
  });

  const target = Math.floor(2.5 * shot.fps + 1e-6);
  expect(target).toBeGreaterThan(60);
  expect(shot.first?.frame).toBe(target);
  expect(shot.first?.replayed).toBe(target + 1);
  expect(shot.first?.truncated).toBe(false);
  expect(shot.capped?.replayed).toBe(0);
  expect(shot.capped?.truncated).toBe(true);
});

/* --------------------------------------------- 预览服务的 canvas 身份 */

/*
 * 「偶发黑屏」查实的一条：`Kit` 把 canvas 存死，而 Preview 卸载重挂（dev 的组件级
 * hot-update）会带来一块新 canvas —— 旧服务继续画在已经脱离 DOM 的那块上，
 * 屏幕上永久空白且没有任何报错。判据是「服务绑到了新 canvas + 新 canvas 上真的
 * 画出了东西」，不是「没抛异常」。
 */
test('换掉预览 canvas：渲染服务整体重建，新画布上照常出画面', async ({ page }) => {
  await boot(page);
  await buildStage(page, { id: 'pv-swap', source: { type: 'solid', color: '#336699' } });

  const info = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        appState: {
          renderer: { kit: { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } };
          attachPreview: (c: HTMLCanvasElement, h: Element) => void;
        };
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[]; w: number; h: number };
      };
    }).__artmatic;

    const old = A.appState.renderer.kit.canvas;
    const host = old.parentElement!;
    const fresh = document.createElement('canvas');
    host.appendChild(fresh);

    A.appState.attachPreview(fresh, host);
    A.renderFrame(0);
    const d = A.readPixels().data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i]! + d[i + 1]! + d[i + 2]!;
    return {
      bound: A.appState.renderer.kit.canvas === fresh,
      lost: A.appState.renderer.kit.gl.isContextLost(),
      oldLost: (old.getContext('webgl2') as WebGL2RenderingContext | null)?.isContextLost() ?? null,
      meanRgb: sum / (d.length / 4) / 3,
    };
  });

  expect(info.bound).toBe(true);
  expect(info.lost).toBe(false);
  // 旧上下文被显式释放（否则每重建一次就多占一份显存）
  expect(info.oldLost).toBe(true);
  // #336699 → 均值 102；判据只要求「不是黑屏」
  expect(info.meanRgb).toBeGreaterThan(20);
});

/* ------------------------------------------------- tooltip 超长换行 */

test('超长 tooltip 换行显示，且钳在视口内不横向溢出', async ({ page }) => {
  await boot(page);
  await page.setViewportSize({ width: 900, height: 600 });

  const bubble = page.getByTestId('tip-bubble');
  // durationTip 是一句长文案（工程时长那段），换行前它会溢出 280px 的盒子。
  const durationCtl = page.locator('.transport .ctl').filter({ has: page.getByTestId('duration-input') });
  // 900px 宽下工具条改为横向滚动（见 Transport.svelte），这个控件可能在视口外。
  // hover 前先滚进来 —— 不滚的话 hover 落在滚动容器里的错误位置上，tooltip 不出现。
  await durationCtl.scrollIntoViewIfNeeded();
  await durationCtl.hover();
  await expect(bubble).toBeVisible();

  const m = await bubble.evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return {
      clientW: el.clientWidth,
      scrollW: el.scrollWidth,
      h: el.offsetHeight,
      left: r.left,
      right: r.right,
    };
  });
  // 换行后内容不再横向溢出（现在是 nowrap 的话 scrollW 会明显大于 clientW）
  expect(m.scrollW, `气泡横向溢出：scrollW=${m.scrollW} clientW=${m.clientW}`).toBeLessThanOrEqual(
    m.clientW + 1,
  );
  // 至少两行
  expect(m.h, `气泡应当换行成多行，实测高度 ${m.h}`).toBeGreaterThan(20);
  // 贴边钳位仍然成立（Tip.svelte 按 offsetWidth/Height 算，换行后要能钳进视口）
  expect(m.left).toBeGreaterThanOrEqual(0);
  expect(m.right).toBeLessThanOrEqual(900 + 1);
});
