import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * Logo 的亮/暗映射回归。
 *
 * 资源文件名说的是「墨色」而不是「目标模式」：
 *   -dark  = 深墨 rgb(47,47,47)   → 配亮背景（亮色主题）
 *   -light = 浅墨 rgb(248,248,248) → 配暗背景（暗色主题）
 *
 * 搞反的后果不是「颜色不太对」而是 **logo 整块隐形**（只剩那点紫色），
 * 这种错盯屏幕很容易放过，所以用断言钉死：既查墨色的实际取值，也查它与底色的对比度。
 */

type ThemeApi = {
  setMode: (m: string) => void;
  setPreset: (p: string) => void;
  setCustomAccent: (h: string) => void;
  reset: () => void;
};

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

/**
 * 调主题 API。
 * 注意转型必须发生在**页面里**（`window` 只在页面上下文存在）——
 * 在 Node 侧写 `page.evaluate((a: AnyA) => a.theme.xxx)` 是拿不到东西的，
 * 那样只会把 undefined 传进去。
 */
function theme(page: Page, act: 'light' | 'dark' | 'reset' | 'custom', hex?: string): Promise<void> {
  return page.evaluate(
    ([action, value]) => {
      const t = (window as unknown as { __artmatic: { theme: ThemeApi } }).__artmatic.theme;
      if (action === 'light' || action === 'dark') t.setMode(action);
      else if (action === 'custom') t.setCustomAccent(value!);
      else t.reset();
    },
    [act, hex ?? ''] as [string, string],
  );
}

/**
 * WCAG 对比度。**必须能吃 hex**——`--surface-*` 这些 token 的原始值就是 hex，
 * 只按 rgb() 解析会把它当成黑色，然后断言「对比度 1.57、不达标」这种假失败（踩过）。
 */
function contrast(a: string, b: string): number {
  const parse = (s: string): [number, number, number] => {
    const rgb = s.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (rgb) return [+rgb[1]!, +rgb[2]!, +rgb[3]!];
    const hex = s.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const n = parseInt(hex[1]!, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    throw new Error(`无法解析颜色: ${s}`);
  };
  const lum = (c: [number, number, number]): number => {
    const f = (v: number): number => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const la = lum(parse(a));
  const lb = lum(parse(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 取某个 Brand 里所有内联 fill 解析后的实际颜色。 */
function inksOf(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [];
    const out = new Set<string>();
    for (const el of root.querySelectorAll('[style]')) {
      const fill = (el as HTMLElement).style.fill;
      if (!fill) continue;
      const probe = document.createElement('span');
      probe.style.color = fill;
      document.body.appendChild(probe);
      out.add(getComputedStyle(probe).color);
      probe.remove();
    }
    return [...out];
  }, selector);
}

const DARK_INK = 'rgb(47, 47, 47)';
const LIGHT_INK = 'rgb(248, 248, 248)';

test('logo 在两种主题下都用对墨色，且对比度足够', async ({ page }) => {
  await boot(page);

  const surface = (): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  /* ---------- 亮色主题：应当是深墨 ---------- */
  await theme(page, 'light');
  await page.waitForTimeout(250);

  const rail = await inksOf(page, '[data-testid=rail-logo] .brand');
  const word = await inksOf(page, '.app-mark .brand');
  expect(rail, '侧栏标记的墨色').toContain(DARK_INK);
  expect(word, '顶栏字标的墨色').toContain(DARK_INK);
  expect(rail, '亮色主题下不该出现浅墨').not.toContain(LIGHT_INK);

  const lightSurface = await surface();
  expect(contrast(DARK_INK, lightSurface), `亮色下标记 vs 底色 ${lightSurface}`).toBeGreaterThan(3);

  /* ---------- 暗色主题：应当是浅墨 ---------- */
  await theme(page, 'dark');
  await page.waitForTimeout(250);

  const railDark = await inksOf(page, '[data-testid=rail-logo] .brand');
  const wordDark = await inksOf(page, '.app-mark .brand');
  expect(railDark, '侧栏标记的墨色').toContain(LIGHT_INK);
  expect(wordDark, '顶栏字标的墨色').toContain(LIGHT_INK);
  expect(railDark, '暗色主题下不该出现深墨').not.toContain(DARK_INK);

  const darkSurface = await surface();
  expect(contrast(LIGHT_INK, darkSurface), `暗色下标记 vs 底色 ${darkSurface}`).toBeGreaterThan(3);

  await theme(page, 'reset');
});

test('标记按尺寸切换大小版，品牌紫跟随主题色', async ({ page }) => {
  await boot(page);

  const viewBoxes = (sel: string): Promise<string[]> =>
    page.evaluate(
      (s) => Array.from(document.querySelectorAll(s + ' svg')).map((el) => el.getAttribute('viewBox') ?? ''),
      sel,
    );

  // 侧栏 20px → 2×2 小标记
  const rail = await viewBoxes('[data-testid=rail-logo] .brand');
  expect(rail.length, '侧栏应有一个标记').toBe(1);
  expect(rail[0]).toMatch(/^-10 0 163 /);

  // 「关于」里 → 3×3 大标记 + 字标
  await page.getByTestId('rail-logo').click();
  await page.waitForTimeout(300);
  const hero = await viewBoxes('[data-testid=modal-about] .brand');
  expect(hero.some((v) => /^0 0 1280 /.test(v)), `关于里应有 3x3 大标记，实得 ${JSON.stringify(hero)}`).toBe(true);
  expect(hero.some((v) => /^0 0 1218 /.test(v)), '关于里应有字标').toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // 品牌紫跟随 --accent：换成自定义色后，标记里的紫色应当解析成**该 token 的实际值**。
  // 注意不能拿输入的 hex 直接比：accentRampFromHex 会为满足对比度钳制明度，
  // #ff2d9b 在亮色下实际落到 rgb(230,0,121)，不是 rgb(255,45,155)。
  await theme(page, 'custom', '#ff2d9b');
  await page.waitForTimeout(300);
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  );
  const toRgb = (hex: string): string => {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  };
  const inks = await inksOf(page, '[data-testid=rail-logo] .brand');
  expect(inks, `标记里的紫色应跟随 --accent(${accent})，实得 ${JSON.stringify(inks)}`).toContain(toRgb(accent));
  // 证明替换确实发生了：不再是资源里写死的那支紫
  expect(inks).not.toContain('rgb(111, 100, 239)');

  await theme(page, 'reset');
});
