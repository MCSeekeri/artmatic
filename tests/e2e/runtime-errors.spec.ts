import { expect, test } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 全局错误兜底（W4）：未捕获异常 / 未处理 rejection 必须能在底栏看见，
 * 点开能看到消息与可复制的诊断信息，且不打断编辑。
 */
test('未捕获错误落到运行错误面板，可清空', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as never as { __artmatic?: unknown }).__artmatic));
  await openDemo(page);

  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e-runtime-boom');
    }, 0);
  });

  const banner = page.getByTestId('runtime-error');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('运行错误');

  await banner.click();
  const modal = page.getByTestId('runtime-error-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('e2e-runtime-boom');
  await expect(modal).toContainText('运行错误');
  await expect(page.getByTestId('runtime-error-copy')).toBeVisible();

  await page.getByTestId('runtime-error-clear').click();
  await expect(modal).toHaveCount(0);
  await expect(banner).toHaveCount(0);
});

test('未处理的 Promise rejection 也会记录', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as never as { __artmatic?: unknown }).__artmatic));
  await openDemo(page);

  await page.evaluate(() => {
    void Promise.reject(new Error('e2e-reject-boom'));
  });

  const banner = page.getByTestId('runtime-error');
  await expect(banner).toBeVisible();
  await banner.click();
  await expect(page.getByTestId('runtime-error-modal')).toContainText('e2e-reject-boom');
});
