import { expect, test, type Page } from '@playwright/test';
import { openDemo, buildStage } from './_stage';
import { ALGO_CATALOG } from '../../src/algos/catalog';
import { LOCALES } from '../../src/i18n/locales';

/**
 * 「插入片段 → 算法片段」二级菜单的**悬停预览浮层**。
 *
 * 这个菜单有二十多项，名字（「李雅普诺夫分形」）不足以让人知道插进去长什么样，
 * 所以悬停时必须给出缩略图 + 一句话说明。三条判据：
 *
 * 1. **浮层出现，且图真的加载出来了**（`naturalWidth > 0`）。只断 `<img>`
 *    存在是不够的 —— 资源路径写错时 `<img>` 一样在，只是空白。
 * 2. **换一项就换一张图**（src 跟着变）。这条挡「浮层只认第一个高亮项」。
 * 3. **浮层不许盖住当前高亮的那一项**。它是 `position: fixed` 且与菜单同 z，
 *    位置算错时会正好压在菜单上 —— 那时用户点不到自己想点的那一项，
 *    而 DOM 断言、可见性断言全都正常。用 `elementFromPoint` 看那一处命中谁。
 */

const zh = LOCALES['zh-CN'] as Record<string, string>;

/**
 * 二级菜单只列**最近用过的 5 个**（见 `ui/recent-defs.ts`），所以这里先把
 * 本文件要用到的几条写进 localStorage。`addInitScript` 必须在下一次
 * `page.goto` 之前注册 —— 应用启动时就会读这张表。
 *
 * 顺序有意义：第一项 `rule110` 会在菜单打开时自动高亮，第一条用例断言的
 * 「一打开就有浮层」靠它。
 */
const SEED_ALGOS = ['rule110', 'mandelbrot', 'lyapunov', 'newton', 'kleinian'];

async function openAlgoMenu(page: Page): Promise<void> {
  await page.addInitScript((ids) => {
    localStorage.setItem('artmatic.recentAlgos', JSON.stringify(ids));
  }, SEED_ALGOS);
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as never as { __artmatic?: unknown }).__artmatic));
  await openDemo(page);
  await buildStage(page, { id: 'preview', source: { type: 'solid', color: '#404040' }, end: 8 });
  await page.locator('[data-testid=track-side-row]').first().getByTestId('track-menu').click();
  await page.getByTestId('add-algo').click();
  await expect(page.getByTestId('add-algo-mandelbrot')).toBeVisible();
}

/** 悬停二级菜单里的某一项，并等浮层里的图加载完。 */
async function hoverAlgo(page: Page, id: string): Promise<void> {
  await page.getByTestId(`add-algo-${id}`).hover();
  const img = page.getByTestId('menu-preview').locator('img');
  await expect(img).toBeVisible();
  await img.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        const im = el as HTMLImageElement;
        if (im.complete) return resolve();
        im.addEventListener('load', () => resolve(), { once: true });
        im.addEventListener('error', () => resolve(), { once: true });
      }),
  );
}

test('悬停算法项 → 出现预览浮层，图真的加载出来、说明非空', async ({ page }) => {
  await openAlgoMenu(page);
  const preview = page.getByTestId('menu-preview');

  // 二级菜单一打开就把高亮放在第一项，所以**浮层立刻就在** —— 不需要先晃一下
  // 鼠标。这是刻意的：菜单开着而右半边空着的话，第一屏的选项还是只能靠名字猜。
  await expect(preview, '打开二级菜单后浮层就该跟着第一项出现').toHaveCount(1);
  await expect(preview.locator('img')).toHaveAttribute('src', /rule110/);

  await hoverAlgo(page, 'mandelbrot');
  const img = preview.locator('img');
  const loaded = await img.evaluate((el) => {
    const im = el as HTMLImageElement;
    return { w: im.naturalWidth, h: im.naturalHeight, src: im.currentSrc };
  });
  expect(loaded.w, '缩略图没加载出来（资源路径或文件缺失）').toBeGreaterThan(0);
  expect(loaded.h).toBeGreaterThan(0);
  expect(loaded.src, '缩略图应当是导出的 WebP').toContain('.webp');

  const desc = await preview.locator('p').innerText();
  expect(desc, '浮层里的说明是空的').toBe(zh[ALGO_CATALOG['mandelbrot']!.descKey]);
});

test('换一项就换一张图（浮层跟着高亮项走）', async ({ page }) => {
  await openAlgoMenu(page);
  await hoverAlgo(page, 'mandelbrot');
  const first = await page.getByTestId('menu-preview').locator('img').evaluate((el) =>
    (el as HTMLImageElement).currentSrc.replace(/^.*\//, ''),
  );
  expect(first).toContain('mandelbrot');

  await hoverAlgo(page, 'lyapunov');
  const second = await page.getByTestId('menu-preview').locator('img').evaluate((el) =>
    (el as HTMLImageElement).currentSrc.replace(/^.*\//, ''),
  );
  expect(second, '换了高亮项但图没变 —— 浮层没跟着走').toContain('lyapunov');
  expect(second).not.toBe(first);
});

test('浮层不盖住当前高亮的那一项（否则那一项点不到）', async ({ page }) => {
  await openAlgoMenu(page);
  await hoverAlgo(page, 'newton');

  // 取那一行的中心，看这一处最上面命中的是谁。菜单项必须自己赢 ——
  // 浮层是 fixed + 同 z，位置算错时它会正好压在菜单上。
  const row = page.getByTestId('add-algo-newton');
  const hit = await row.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top === el || el.contains(top);
  });
  expect(hit, '浮层盖住了菜单项').toBe(true);

  // 另一面：浮层确实在菜单面板的**右侧**，且两者不相交
  const overlap = await page.evaluate(() => {
    const a = document.querySelector('[data-testid=add-algo]')?.getBoundingClientRect();
    const b = document.querySelector('[data-testid=menu-preview]')?.getBoundingClientRect();
    if (!a || !b) return 'missing';
    return b.left >= a.right - 1 ? 'ok' : 'overlap';
  });
  expect(overlap).toBe('ok');
});

test('关掉菜单后浮层一起消失（不留孤儿 fixed 元素）', async ({ page }) => {
  await openAlgoMenu(page);
  await hoverAlgo(page, 'kleinian');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu-preview')).toHaveCount(0);
  await expect(page.getByTestId('add-algo-mandelbrot')).toHaveCount(0);
});
