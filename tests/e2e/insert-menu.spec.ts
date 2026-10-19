import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 时间轴「新建片段」菜单里的**特效 / 算法**二级菜单。
 *
 * 判据只有一条：**菜单只列最近用过的 5 个，其余走「全部…」弹窗**。
 * 这条规则最容易在两类地方坏掉，而且都不报错：
 *   1. 注册表里已经没有的 id（插件卸载 / 跨机器带来的工程）占着展示位；
 *   2. 从菜单里插入之后没有回写「最近使用」，于是下次打开顺序不变。
 *
 * 另外两个「全部…」入口要真的能建出片段 —— 它们复用检查器的选择器，
 * 接错参数（例如把 current 传成空串之外的东西、或忘记把选择结果写进 chain）
 * 只会得到一条空链，画面什么也不发生。
 */

interface ClipShape {
  kind: string;
  chain?: { defId: string }[];
  source?: { type: string; generator?: string };
}

const EFFECTS_KEY = 'artmatic.recentEffects';
const ALGOS_KEY = 'artmatic.recentAlgos';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as never as { __artmatic?: unknown }).__artmatic));
  await openDemo(page);
  // 新建一条干净的轨并用它的 ⋯ 菜单：demo 的轨道都在数组里（只是被禁用），
  // `.first()` 会把片段加到看不见的地方（tests/e2e/AGENTS.md 有记）。
  await page.getByTestId('add-visual-track').click();
  await page.locator('[data-testid=track-side-row]').last().getByTestId('track-menu').click();
}

/** 二级菜单里真正属于「最近使用」的项（排除「全部…」那一条）。 */
function recentEffectItems(page: Page) {
  return page.locator('[data-testid^="add-effect-"]:not([data-testid="add-effect-all"])');
}

async function lastTrackClips(page: Page): Promise<ClipShape[]> {
  return page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: {
          project: {
            tracks: {
              clips: {
                kind: string;
                chain?: { defId: string }[];
                source?: { type: string; generator?: string };
              }[];
            }[];
          };
        };
      };
    }).__artmatic;
    const tracks = A.store.project.tracks;
    return tracks[tracks.length - 1]!.clips.map((c) => ({
      kind: c.kind,
      chain: c.chain?.map((i) => ({ defId: i.defId })),
      source: c.source ? { type: c.source.type, generator: c.source.generator } : undefined,
    }));
  });
}

async function readRecents(page: Page, key: string): Promise<string[]> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]') as string[], key);
}

test('最近使用：最多 5 项、跳过失效 id、悬停有缩略图', async ({ page }) => {
  await page.addInitScript((key) => {
    // 7 条里含一条注册表里没有的 `missing`：它必须被跳过，而不是占掉一个位置。
    localStorage.setItem(
      key,
      JSON.stringify(['echo', 'bleach', 'missing', 'slices', 'grain', 'ascii', 'blur']),
    );
  }, EFFECTS_KEY);
  await boot(page);
  await page.getByTestId('add-effect').click();

  // 过滤后是 echo / bleach / slices / grain / ascii 五条；blur 是第 6 条，不展示。
  await expect(recentEffectItems(page)).toHaveCount(5);
  await expect(page.getByTestId('add-effect-echo')).toBeVisible();
  await expect(page.getByTestId('add-effect-missing')).toHaveCount(0);
  await expect(page.getByTestId('add-effect-ascii')).toBeVisible();
  await expect(page.getByTestId('add-effect-blur')).toHaveCount(0);
  // 「全部…」永远在最后（菜单项是数据，顺序就是构造顺序）
  await expect(page.getByTestId('add-effect-all')).toBeVisible();

  // 悬停预览：图真的挂在当前高亮项上
  await page.getByTestId('add-effect-echo').hover();
  const img = page.getByTestId('menu-preview').locator('img');
  await expect(img).toHaveAttribute('src', /echo/);

  // 点第三条 → 建出一个**带这个特效**的特效片段，并把它提到最近第一位
  await page.getByTestId('add-effect-slices').click();
  const clips = await lastTrackClips(page);
  expect(clips[0]?.kind).toBe('effect');
  expect(clips[0]?.chain?.map((i) => i.defId)).toEqual(['slices']);
  expect((await readRecents(page, EFFECTS_KEY))[0]).toBe('slices');
});

test('靠右的右键菜单：二级菜单左翻时预览不盖住任何菜单', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('artmatic.recentEffects', JSON.stringify(['slices', 'pixelate'])),
  );
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as never as { __artmatic?: unknown }).__artmatic));
  await openDemo(page);

  // 在时间轴靠右的位置右键（一级菜单会被钳到右边，二级菜单必须左翻）。
  // x 取滚动容器的右边缘，不要写死像素 —— 抽屉开着时时间轴宽度随窗口变。
  const scroll = (await page.getByTestId('tl-scroll').boundingBox())!;
  const box = (await page.getByTestId('tl-row').first().boundingBox())!;
  await page.mouse.click(scroll.x + scroll.width - 36, box.y + box.height / 2, {
    button: 'right',
  });
  await expect(page.getByTestId('ctx-effect')).toBeVisible();
  await page.getByTestId('ctx-effect').hover();
  const slices = page.getByTestId('ctx-effect-slices');
  await expect(slices).toBeVisible();
  await slices.hover();

  const preview = page.getByTestId('menu-preview');
  await expect(preview).toBeVisible();
  // 预览矩形与任何一层菜单面板都不能有面积交集
  const overlaps = await page.evaluate(() => {
    const p = document.querySelector('[data-testid=menu-preview]')!.getBoundingClientRect();
    return [...document.querySelectorAll('.menu')].map((el) => {
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(p.right, r.right) - Math.max(p.left, r.left));
      const h = Math.max(0, Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top));
      return w * h;
    });
  });
  expect(overlaps.every((n) => n === 0)).toBe(true);
});

test('没有最近项时只显示「全部特效…」', async ({ page }) => {
  await page.addInitScript((key) => localStorage.removeItem(key), EFFECTS_KEY);
  await boot(page);
  await page.getByTestId('add-effect').click();

  await expect(recentEffectItems(page)).toHaveCount(0);
  await expect(page.getByTestId('add-effect-all')).toBeVisible();
});

test('全部特效…：打开选择器，多选按顺序入链', async ({ page }) => {
  await page.addInitScript((key) => localStorage.removeItem(key), EFFECTS_KEY);
  await boot(page);
  await page.getByTestId('add-effect').click();
  await page.getByTestId('add-effect-all').click();

  const modal = page.getByTestId('modal-effect-picker');
  await expect(modal).toBeVisible();
  // 它是从**时间轴**（不在抽屉的层叠上下文里）打开的：确认没有被抽屉 / 时间轴盖住。
  const onTop = await modal.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 16);
    return hit === el || el.contains(hit);
  });
  expect(onTop, '时间轴打开的 modal 被别的层盖住了').toBe(true);

  await page.locator('[data-testid=effect-picker-item][data-effect-id="channel-split"]').click();
  await page.locator('[data-testid=effect-picker-item][data-effect-id="bleach"]').click();
  await page.getByTestId('effect-picker-confirm').click();

  const clips = await lastTrackClips(page);
  expect(clips[0]?.kind).toBe('effect');
  expect(clips[0]?.chain?.map((i) => i.defId)).toEqual(['channel-split', 'bleach']);
  // 后选的排在最前（最近使用的语义：最后用过的第一）
  expect(await readRecents(page, EFFECTS_KEY)).toEqual(['bleach', 'channel-split']);
});

test('全部算法片段…：打开生成器选择器，插入新生成器', async ({ page }) => {
  await page.addInitScript((key) => localStorage.removeItem(key), ALGOS_KEY);
  await boot(page);
  await page.getByTestId('add-algo').click();
  // 没有最近项：子菜单里只有「全部算法片段…」
  await expect(
    page.locator('[data-testid^="add-algo-"]:not([data-testid="add-algo-all"])'),
  ).toHaveCount(0);
  await page.getByTestId('add-algo-all').click();

  await expect(page.getByTestId('modal-algo-picker')).toBeVisible();
  // 顺带盖住「彩条已进主应用」：它以前只存在于试炼场。
  await page.locator('[data-testid=algo-picker-item][data-algo-id="bars"]').click();
  await page.getByTestId('algo-picker-confirm').click();

  const clips = await lastTrackClips(page);
  expect(clips[0]?.kind).toBe('source');
  expect(clips[0]?.source?.type).toBe('algo');
  expect(clips[0]?.source?.generator).toBe('bars');
  expect((await readRecents(page, ALGOS_KEY))[0]).toBe('bars');
});
