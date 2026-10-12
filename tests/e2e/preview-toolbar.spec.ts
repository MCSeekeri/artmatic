import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { buildStage } from './_stage';
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

test('吸附档位跨会话保持，非法值回落 beat', async ({ page }) => {
  await boot(page);
  const snap = page.getByTestId('snap-mode');
  // 默认「拍」
  await expect(snap).toContainText(zhCN['tl.snapBeat']);

  // 改成「小节」→ 落进 UI 偏好
  await snap.click();
  await page.getByTestId('snap-mode-opt-bar').click();
  await expect(snap).toContainText(zhCN['tl.snapBar']);

  // 重开页面（新会话）后仍是「小节」
  await page.reload();
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await expect(page.getByTestId('snap-mode')).toContainText(zhCN['tl.snapBar']);

  // 手改 localStorage 成一个不存在的档位 → 读回时回落「拍」，而不是整条偏好作废
  await page.evaluate(() => {
    const raw = localStorage.getItem('artmatic.ui');
    const p = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    p.snap = 'bogus-mode';
    localStorage.setItem('artmatic.ui', JSON.stringify(p));
  });
  await page.reload();
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await expect(page.getByTestId('snap-mode')).toContainText(zhCN['tl.snapBeat']);
});

/* --------------------------------------------------- 当前帧截图落盘 */

test('导出当前帧：触发 PNG 下载，尺寸是工程分辨率', async ({ page }) => {
  await boot(page);
  await buildStage(page, { id: 'pv-snap', source: { type: 'solid', color: '#cc3366' } });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('preview-snapshot').click();
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

/* ------------------------------------------------- tooltip 超长换行 */

test('超长 tooltip 换行显示，且钳在视口内不横向溢出', async ({ page }) => {
  await boot(page);
  await page.setViewportSize({ width: 900, height: 600 });

  const bubble = page.getByTestId('tip-bubble');
  // durationTip 是一句长文案（工程时长那段），换行前它会溢出 280px 的盒子。
  const durationCtl = page.locator('.transport .ctl').filter({ has: page.getByTestId('duration-input') });
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
