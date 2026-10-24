import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 外观的四套模式（亮 / 暗 / 灰 / 高对比度）。
 *
 * 这里只测**灰色与高对比度**：亮暗两套是既有行为，回归在 brand.spec / m6.spec。
 *
 * 两条纪律照旧：
 *   1. 断言 DOM（计算样式），不读 token 表 —— 「store 改了界面没改」正是这轮
 *      改动最容易出的问题（`data-paper` 少挂一个容器，token 全对、画面全错）。
 *   2. 灰色模式的纸面（弹窗 / 菜单 / Ribbon）必须**真的**反相，不能只看
 *      `--surface-*`：纸面是另一套 `--paper-*`，看错一层就会「以为测到了」。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

/** 从设置→外观改模式（草稿 + 保存并应用）。 */
async function setMode(page: Page, mode: 'light' | 'dark' | 'gray' | 'contrast'): Promise<void> {
  await page.getByTestId('rail-settings').click();
  await expect(page.getByTestId('modal-settings')).toBeVisible();
  await page.getByTestId('settings-nav-appearance').click();
  await page.getByTestId('settings-mode').click();
  await page.getByTestId(`select-option-${mode}`).click();
  await page.getByTestId('settings-apply').click();
  await expect(page.getByTestId('modal-settings')).toHaveCount(0);
}

const token = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/**
 * 某个元素的计算颜色属性（背景 / 边框 / 文字）。
 *
 * 属性名必须是 **kebab-case**：`getPropertyValue()` 不认 camelCase，
 * 传 `backgroundColor` 会静默返回空串（`element.style.xxx` 才认驼峰）。
 */
const cssOf = (
  page: Page,
  selector: string,
  prop: 'background-color' | 'border-top-color' | 'color',
): Promise<string | null> =>
  page.evaluate(
    ([s, p]) => {
      const el = document.querySelector(s);
      if (!el) return null;
      return getComputedStyle(el).getPropertyValue(p);
    },
    [selector, prop],
  );

test('灰色模式：面板 #525252，弹窗与下拉走浅灰纸面 + 黑字', async ({ page }) => {
  await boot(page);
  await setMode(page, 'gray');

  // ① 深色 chrome：面板正色就是需求里的 #525252，白字
  expect(await token(page, '--surface-1')).toBe('#525252');
  expect(await token(page, '--text-primary')).toBe('#ffffff');
  expect(await cssOf(page, 'aside.rail', 'background-color')).toBe('rgb(82, 82, 82)');

  // ② 纸面：设置面板本身就是一个 Modal —— 浅灰底 + 黑字
  await page.getByTestId('rail-settings').click();
  await expect(page.getByTestId('modal-settings')).toBeVisible();
  expect(await cssOf(page, '[data-testid=modal-settings]', 'background-color')).toBe(
    'rgb(189, 189, 189)',
  );
  expect(await cssOf(page, '[data-testid=modal-settings] h2', 'color')).toBe('rgb(20, 20, 20)');

  // ③ 下拉浮层同样在纸面里（surface-3 在纸面内是白）
  await page.getByTestId('settings-nav-appearance').click();
  await page.getByTestId('settings-mode').click();
  await expect(page.getByTestId('settings-mode-pop')).toBeVisible();
  expect(await cssOf(page, '[data-testid=settings-mode-pop]', 'background-color')).toBe(
    'rgb(255, 255, 255)',
  );
});

test('rail 的明暗按钮不提供灰色 / 高对比度：按它就是回到亮暗', async ({ page }) => {
  await boot(page);
  await setMode(page, 'gray');

  // 灰模式是深底 → 图标此刻是太阳；按一下回到标准亮色（不是「第三档」）
  await page.getByTestId('theme-toggle').click();
  await expect.poll(() => token(page, '--surface-1')).toBe('#f8f9fa');

  // 再按一下回暗色 —— 两态切换本身没被改坏
  await page.getByTestId('theme-toggle').click();
  await expect.poll(() => token(page, '--surface-1')).toBe('#131518');
});

test('高对比度模式：纯黑底白字，可点容器有青色边界', async ({ page }) => {
  await boot(page);

  // 亮色下图标按钮没有边界（这是常规三套的视觉纪律，作为对照）
  expect(await cssOf(page, '[data-testid=theme-toggle]', 'border-top-color')).toBe(
    'rgba(0, 0, 0, 0)',
  );

  await setMode(page, 'contrast');

  expect(await token(page, '--surface-0')).toBe('#000000');
  expect(await token(page, '--surface-1')).toBe('#000000');
  expect(await token(page, '--text-primary')).toBe('#ffffff');
  expect(await cssOf(page, 'aside.rail', 'background-color')).toBe('rgb(0, 0, 0)');

  // 图标按钮原来是无框的，这里是它唯一有边界的一档
  expect(await cssOf(page, '[data-testid=theme-toggle]', 'border-top-color')).toBe(
    'rgb(0, 229, 255)',
  );

  // 普通按钮同一条：可点容器一律是「黑底 + 彩色边」
  await page.getByTestId('rail-settings').click();
  await expect(page.getByTestId('modal-settings')).toBeVisible();
  expect(await cssOf(page, '[data-testid=modal-settings]', 'background-color')).toBe(
    'rgb(0, 0, 0)',
  );
  // 拿普通按钮比：`settings-apply` 是主操作（accent 填充），边框本来就是主题色。
  expect(await cssOf(page, '[data-testid=settings-cancel]', 'border-top-color')).toBe(
    'rgb(0, 229, 255)',
  );
});

test('排版编辑器：Ribbon 在灰色模式下也是纸面', async ({ page }) => {
  await boot(page);
  await setMode(page, 'gray');

  // 建一个文字片段并进入排版编辑器（Ribbon 只在那里出现）
  await page.locator('[data-testid=track-side-row]').nth(0).getByTestId('track-menu').click();
  await page.getByTestId('add-text').click();
  const id = await page.evaluate(() => {
    const A = (
      window as never as {
        __artmatic: {
          store: { project: { tracks: { clips: { id: string; source?: { type?: string } }[] }[] } };
        };
      }
    ).__artmatic;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) if (c.source?.type === 'text') return c.id;
    }
    return '';
  });
  await page.locator(`[data-testid=clip][data-clip-id="${id}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();

  expect(await cssOf(page, '[data-testid=ribbon]', 'background-color')).toBe('rgb(189, 189, 189)');
  // 非当前 Tab 的文字是黑字（纸面里的 text-secondary #333）。默认 Tab 是 home，
  // 所以 design 这一颗一定是未激活态 —— 别拿当前 Tab 断言，那是主题色。
  expect(await cssOf(page, '[data-testid=ribbon-tab-design]', 'color')).toBe('rgb(51, 51, 51)');
});
