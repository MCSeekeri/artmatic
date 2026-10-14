/**
 * restore.spec.ts — 「从 /lab 回来（= 重新进主应用）后恢复上次打开的工程」。
 *
 * 背景：`/lab` 是第二个 HTML 入口，离开主应用再回来时页面从零开始、boot 只会
 * 拿一份 demo 工程顶上。这条提示把上次打开着的工程一键恢复。
 *
 * 用 `useOpfs(DIR)` + `save()` 造一份带磁盘句柄的工程：它会走
 * `attachProjectDirectory` → 记下句柄（进 IndexedDB）+ 记下「打开着的工程」
 * （进 localStorage），与生产里保存过一份工程后的状态一致。
 */

import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

type W = {
  __artmatic: {
    project: {
      useOpfs(name?: string): Promise<string>;
      save(): Promise<boolean>;
      wipe(name?: string): Promise<void>;
    };
    projects(): { name: string; dir: string | null; active: boolean }[];
  };
};

const DIR = 'e2e-restore';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as W).__artmatic);
  await openDemo(page);
}

function projects(page: Page): Promise<{ name: string; dir: string | null; active: boolean }[]> {
  return page.evaluate(() => (window as never as W).__artmatic.projects());
}

/** 造一份「保存到磁盘、随后离开页面」的状态。 */
async function openAndSave(page: Page): Promise<void> {
  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), DIR);
  await page.evaluate((d) => (window as never as W).__artmatic.project.useOpfs(d), DIR);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());
  expect((await projects(page)).some((p) => p.dir === DIR)).toBe(true);
}

test('离开再回来：提示并一键恢复上次打开的工程', async ({ page }) => {
  await boot(page);
  await openAndSave(page);

  // 离开再回来
  await page.reload();
  await page.waitForFunction(() => (window as never as W).__artmatic);
  await openDemo(page);

  const banner = page.getByTestId('restore-project');
  await expect(banner).toBeVisible();
  await page.getByTestId('restore-do').click();
  await expect(banner).toHaveCount(0);

  // 工程真的回来了
  expect((await projects(page)).some((p) => p.dir === DIR)).toBe(true);
});

test('忽略后不再提示，且跨 reload 保持', async ({ page }) => {
  await boot(page);
  await openAndSave(page);

  await page.reload();
  await page.waitForFunction(() => (window as never as W).__artmatic);
  await openDemo(page);
  await expect(page.getByTestId('restore-project')).toBeVisible();

  await page.getByTestId('restore-dismiss').click();
  await expect(page.getByTestId('restore-project')).toHaveCount(0);

  await page.reload();
  await page.waitForFunction(() => (window as never as W).__artmatic);
  await openDemo(page);
  await expect(page.getByTestId('restore-project')).toHaveCount(0);
});
