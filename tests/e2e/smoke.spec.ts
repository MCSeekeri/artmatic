import { expect, test } from '@playwright/test';

test('应用启动：canvas 存在、画面非全黑、无 console 错误', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await expect(page.locator('#gl')).toBeVisible();
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);

  const mean = await page.evaluate(() => {
    const A = (window as never as { __artmatic: { readPixels: () => { data: number[] } } }).__artmatic;
    const { data } = A.readPixels();
    let sum = 0;
    const n = data.length;
    for (let i = 0; i < n; i += 4) sum += data[i]! + data[i + 1]! + data[i + 2]!;
    return sum / (n / 4) / 3; // 0..255
  });
  expect(mean).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
