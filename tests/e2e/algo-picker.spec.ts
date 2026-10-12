/**
 * algo-picker.spec.ts — 检查器里「更换算法艺术」的端到端验证。
 *
 * 断言分两层（AGENTS §6.3）：**DOM**（按钮点得动、弹层开合、警告条在）+
 * **store**（源被整体替换、旧参数没被带过去）。少任何一层都可能是「界面对了但没改数据」
 * 或「数据改了但用户看不见」。
 */

import { expect, test, type Page } from '@playwright/test';
import { buildStage } from './_stage';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

/** 选中某个片段，让检查器渲染出它的参数。 */
async function selectClip(page: Page, clipId: string): Promise<void> {
  await page.evaluate((id) => {
    (window as never as { __artmatic: { appState: { selectedClipId: string | null } } }).__artmatic.appState.selectedClipId = id;
  }, clipId);
}

type Api = {
  __artmatic: {
    appState: { selectedClipId: string | null };
    store: {
      /** ⚠️ `findClip` 返回 `{ track, clip }` 包，不是 clip 本身。 */
      findClip: (id: string) => {
        clip: { source: { generator?: string; params?: Record<string, unknown> } };
      } | null;
    };
  };
};

function sourceOf(page: Page, clipId: string): Promise<{ generator?: string; params?: Record<string, unknown> } | null> {
  return page.evaluate((id) => {
    const found = (window as never as Api).__artmatic.store.findClip(id);
    return found ? found.clip.source : null;
  }, clipId);
}

test('更换算法艺术：按钮开选择器，选中后整体替换源且不保留旧参数', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'algo-swap',
    source: { type: 'algo', generator: 'rule110', params: { width: 128, height: 64, rule: 30 } },
    end: 8,
  });
  await selectClip(page, 'algo-swap');

  // rule110 有自己的 rule 参数；换掉之后这个键必须消失（「不保留参数」的判据）。
  expect((await sourceOf(page, 'algo-swap'))?.params?.rule).toBe(30);

  await expect(page.getByTestId('insp-change-algo')).toBeVisible();
  await page.getByTestId('insp-change-algo').click();

  const modal = page.getByTestId('modal-algo-picker');
  await expect(modal).toBeVisible();
  await expect(page.getByTestId('algo-picker-warn'), '弹层里必须提示旧参数不保留').toBeVisible();

  // 搜索按 id / 名字模糊过滤
  await page.getByTestId('algo-picker-search').fill('mandel');
  const item = page.locator('[data-testid="algo-picker-item"][data-algo-id="mandelbrot"]');
  await expect(item).toBeVisible();
  await item.click();
  await page.getByTestId('algo-picker-confirm').click();
  await expect(modal).toHaveCount(0);

  const after = await sourceOf(page, 'algo-swap');
  expect(after?.generator, '源被换成新生成器').toBe('mandelbrot');
  expect(after?.params?.rule, '旧生成器的参数不该被带过来').toBeUndefined();
});

test('弹层把当前生成器标成 current，且选它时确认按钮不可用', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'algo-cur',
    source: { type: 'algo', generator: 'rule110', params: { width: 128, height: 64 } },
    end: 8,
  });
  await selectClip(page, 'algo-cur');

  await page.getByTestId('insp-change-algo').click();
  const modal = page.getByTestId('modal-algo-picker');
  await expect(modal).toBeVisible();

  const current = page.locator('[data-testid="algo-picker-item"][data-algo-id="rule110"]');
  await expect(current.locator('[data-testid="algo-picker-current"]')).toHaveCount(1);

  // 选中当前那份 ⇒ 确认按钮禁用（「已是当前生成器」）
  await current.click();
  await expect(page.getByTestId('algo-picker-confirm')).toBeDisabled();

  await page.getByTestId('algo-picker-cancel').click();
  await expect(modal).toHaveCount(0);
});
