import { expect, test } from '@playwright/test';

/**
 * 确定性测试——本项目最有价值的一类测试（AGENTS.md §7）。
 * 逐像素断言在 page 内做完 reduce 再回传标量，不要把几 MB 像素传回 Node。
 */

test('同一工程同一 t，连续求值 100 次逐像素一致（M0 验收）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);

  const result = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
      };
    }).__artmatic;
    const t = 0.5;
    A.renderFrame(t);
    const first = A.readPixels().data;
    let maxDiff = 0;
    let diffPixels = 0;
    for (let round = 0; round < 100; round++) {
      A.renderFrame(t);
      const cur = A.readPixels().data;
      for (let i = 0; i < cur.length; i++) {
        const d = Math.abs(cur[i]! - first[i]!);
        if (d > 0) diffPixels++;
        if (d > maxDiff) maxDiff = d;
      }
    }
    return { diffPixels, maxDiff };
  });

  expect(result.diffPixels).toBe(0);
  expect(result.maxDiff).toBe(0);
});

test('不同 t 画面确实不同（防止断言在比两张黑图）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);

  const diff = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
      };
    }).__artmatic;
    A.renderFrame(0.5);
    const a = A.readPixels().data;
    A.renderFrame(99); // 超出所有片段：空画面
    const b = A.readPixels().data;
    let diffPixels = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffPixels++;
    return diffPixels;
  });
  expect(diff).toBeGreaterThan(0);
});
