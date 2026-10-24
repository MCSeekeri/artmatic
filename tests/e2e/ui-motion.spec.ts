import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 界面微动效：偏好、计算样式与系统降级。
 *
 * 这里不检查「看起来顺不顺眼」，只钉住三件会静默坏掉的事：
 * 1. 设置里的开关/速度真的落到了根节点变量上，而不只是 localStorage；
 * 2. 三个共用组件确实消费了变量（而不是各写一个时长）；
 * 3. 系统 reduced-motion 与关闭态都能让动画直接进入最终状态。
 */
async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

async function openAppearance(page: Page): Promise<void> {
  await page.getByTestId('rail-settings').click();
  await page.getByTestId('settings-nav-appearance').click();
  await expect(page.getByTestId('settings-pane-appearance')).toBeVisible();
}

/**
 * `--motion-distance` 是**负值**（`MOTION.distance = -2`）：消费处是
 * `translateY(--motion-distance)`，负数才是「从下方 2px 滑上来」。关闭档是 `0px`。
 */
const motionVars = (page: Page): Promise<Record<string, string>> =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      hover: cs.getPropertyValue('--motion-duration-hover').trim(),
      enter: cs.getPropertyValue('--motion-duration-enter').trim(),
      modal: cs.getPropertyValue('--motion-duration-modal').trim(),
      distance: cs.getPropertyValue('--motion-distance').trim(),
    };
  });

const animationOf = (page: Page, selector: string): Promise<{ name: string; ms: number }> =>
  page.locator(selector).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      name: cs.animationName,
      ms: Number.parseFloat(cs.animationDuration) * 1000,
    };
  });

/** 打开排版编辑器（Ribbon 只在那一页出现）。 */
async function openTypography(page: Page): Promise<void> {
  await page.locator('[data-testid=track-side-row]').nth(0).getByTestId('track-menu').click();
  await page.getByTestId('add-text').click();
  const id = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: { project: { tracks: { clips: { id: string; source?: { type?: string } }[] }[] } };
      };
    }).__artmatic;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) if (c.source?.type === 'text') return c.id;
    }
    return '';
  });
  await page.locator(`[data-testid=clip][data-clip-id="${id}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

test('标准档：Modal、Select、Ribbon 消费同一组动效 token', async ({ page }) => {
  await boot(page);
  expect(await motionVars(page)).toEqual({
    hover: '80ms',
    enter: '120ms',
    modal: '140ms',
    distance: '-2px',
  });

  await openAppearance(page);
  const backdrop = await animationOf(page, '[data-testid=modal-settings-backdrop]');
  expect(backdrop.name).not.toBe('none');
  expect(backdrop.ms).toBe(140);
  // 遮罩不能有 transform：它会让内部 fixed Select 的包含块变成遮罩。
  expect(
    await page
      .getByTestId('modal-settings-backdrop')
      .evaluate((el) => getComputedStyle(el).transform),
  ).toBe('none');

  const panel = await animationOf(page, '[data-testid=modal-settings]');
  expect(panel.ms).toBe(140);
  expect(
    await page.getByTestId('modal-settings').evaluate((el) => getComputedStyle(el).transform),
  ).toBe('none');

  await page.getByTestId('settings-motion-speed').click();
  const pop = page.getByTestId('settings-motion-speed-pop');
  await expect(pop).toBeVisible();
  expect((await animationOf(page, '[data-testid=settings-motion-speed-pop]')).ms).toBe(120);
  // 动画结束后不再保留 transform，避免弹层长期成为 fixed 后代的包含块。
  await expect
    .poll(() => pop.evaluate((el) => getComputedStyle(el).transform))
    .toBe('none');

  // 几何回归：Modal 内打开 Select，弹层仍贴在触发区左缘。
  // 祖先一旦有了 transform，fixed 弹层会被按祖先坐标解释，x 会偏出几百像素。
  const trigger = (await page.getByTestId('settings-motion-speed').boundingBox())!;
  const panelBox = (await pop.boundingBox())!;
  expect(
    Math.abs(panelBox.x - trigger.x),
    `Select 弹层横向偏移 ${Math.abs(panelBox.x - trigger.x)}px`,
  ).toBeLessThanOrEqual(2);
  await page.getByTestId('settings-motion-speed').click();
  await page.getByTestId('modal-settings-close').click();
  await expect(page.getByTestId('modal-settings')).toHaveCount(0);

  await openTypography(page);
  const ribbon = await page
    .locator('.rbtn')
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return { property: cs.transitionProperty, duration: cs.transitionDuration };
    });
  expect(ribbon.property).toContain('background-color');
  expect(ribbon.property).toContain('color');
  for (const ms of ribbon.duration.split(',').map((s) => Number.parseFloat(s) * 1000)) {
    expect(ms).toBe(80);
  }
});

test('速度：取消不生效；保存后刷新仍保留', async ({ page }) => {
  await boot(page);
  await openAppearance(page);

  await page.getByTestId('settings-motion-speed').click();
  await page.getByTestId('select-option-slow').click();
  await page.getByTestId('settings-cancel').click();
  await expect.poll(() => motionVars(page)).toEqual({
    hover: '80ms',
    enter: '120ms',
    modal: '140ms',
    distance: '-2px',
  });

  await openAppearance(page);
  await page.getByTestId('settings-motion-speed').click();
  await page.getByTestId('select-option-fast').click();
  await page.getByTestId('settings-apply').click();
  await expect.poll(() => motionVars(page)).toEqual({
    hover: '60ms',
    enter: '90ms',
    modal: '105ms',
    distance: '-2px',
  });

  await page.reload();
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await expect.poll(() => motionVars(page)).toEqual({
    hover: '60ms',
    enter: '90ms',
    modal: '105ms',
    distance: '-2px',
  });
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('artmatic.theme') ?? '{}')),
  ).toMatchObject({ motionEnabled: true, motionSpeed: 'fast' });
});

test('关闭：控件禁用且时长为 0；系统减少动态效果始终优先', async ({ page }) => {
  await boot(page);
  await openAppearance(page);

  await page.getByTestId('settings-motion').click();
  const speed = page.getByTestId('settings-motion-speed');
  await expect(speed).toHaveAttribute('aria-disabled', 'true');
  expect(await speed.evaluate((el) => getComputedStyle(el).cursor)).toBe('default');
  // aria-disabled 只影响可访问性，物理点击仍会被派发 —— 这里验证组件自己挡掉。
  await speed.click({ force: true });
  await expect(page.getByTestId('settings-motion-speed-pop')).toHaveCount(0);
  await page.getByTestId('settings-apply').click();

  await expect.poll(() => motionVars(page)).toEqual({
    hover: '0ms',
    enter: '0ms',
    modal: '0ms',
    distance: '0px',
  });
  await openAppearance(page);
  expect((await animationOf(page, '[data-testid=modal-settings]')).ms).toBe(0);
  await page.getByTestId('modal-settings-close').click();

  // 重新开启，再让系统偏好介入：动画没有被创建，而不是「0ms 播放完」。
  await openAppearance(page);
  await page.getByTestId('settings-motion').click();
  await page.getByTestId('settings-apply').click();
  await expect.poll(() => motionVars(page)).toEqual({
    hover: '80ms',
    enter: '120ms',
    modal: '140ms',
    distance: '-2px',
  });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openAppearance(page);
  expect(await animationOf(page, '[data-testid=modal-settings-backdrop]')).toMatchObject({
    name: 'none',
  });
  expect(await animationOf(page, '[data-testid=modal-settings]')).toMatchObject({ name: 'none' });

  await page.getByTestId('settings-motion-speed').click();
  expect(await animationOf(page, '[data-testid=settings-motion-speed-pop]')).toMatchObject({
    name: 'none',
  });
});
