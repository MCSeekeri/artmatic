import { expect, test, type Page } from '@playwright/test';
import { buildStage, openDemo } from './_stage';

/**
 * 取色卡 × 非排版颜色参数的回归。
 *
 * 取色卡对所有颜色入口都提供**主题色引用**（`@accent1`），而只有排版文档会在
 * 渲染时调用 `resolveThemeColor`。算法参数 / 特效参数 / 纯色片段的颜色直接进
 * `hexToRgba()` —— 引用在那里是坏颜色，回退成**品红**。
 *
 * 用户看到的是：在检查器里挑一个主题色，画面（生命游戏 / 牛顿分形 / 双色调…）
 * 整片变成品红，而参数表里存的是一串 `@accent1`。从界面上完全看不出因果。
 *
 * 判据取两条，缺一不可：
 *   1. **落库的是 hex**（`@` 开头说明写入时没解析）；
 *   2. **画面里没有品红**，且有该主题色的像素（只查 1 的话，一个「存对了但
 *      渲染路径仍然读坏值」的版本能通过）。
 */

interface Api {
  store: {
    findClip: (id: string) => { clip: { source?: { params?: Record<string, unknown>; color?: string } } } | null;
  };
  appState: { selectedClipId: string | null; playT: number };
  renderer: { onSeek: () => void };
  renderFrame: (t: number) => void;
  readPixels: () => { data: number[]; w: number; h: number };
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as never as { __artmatic?: unknown }).__artmatic));
  await openDemo(page);
}

/** 渲一帧后统计：品红像素数 / 接近目标色的像素数。 */
async function countColors(page: Page, target: [number, number, number]): Promise<{ magenta: number; near: number }> {
  return page.evaluate((rgb) => {
    const A = (window as never as { __artmatic: Api }).__artmatic;
    A.renderer.onSeek();
    A.renderFrame(0.5);
    const { data } = A.readPixels();
    let magenta = 0;
    let near = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      // 品红：R、B 都高而 G 极低。给量化留余量（渲染/合成不保证逐位相等）。
      if (r > 200 && b > 200 && g < 80) magenta++;
      if (Math.abs(r - rgb[0]!) < 6 && Math.abs(g - rgb[1]!) < 6 && Math.abs(b - rgb[2]!) < 6) near++;
    }
    return { magenta, near };
  }, target);
}

test('算法参数选主题色：落库是 hex，画面不变品红', async ({ page }) => {
  await boot(page);
  await buildStage(page, { id: 'life', source: { type: 'algo', generator: 'game-of-life' } });
  await page.evaluate(() => {
    const A = (window as never as { __artmatic: Api }).__artmatic;
    A.appState.selectedClipId = 'life';
    A.appState.playT = 0.5;
  });

  await page.getByTestId('algo-param-colorLive').click();
  await page.getByTestId('algo-param-colorLive-palette-theme-@accent1').click();

  const stored = await page.evaluate(() => {
    const A = (window as never as { __artmatic: Api }).__artmatic;
    return A.store.findClip('life')?.clip.source?.params?.colorLive;
  });
  // 「Office」方案的强调色 1 —— 与取色卡上那一格显示的颜色必须一致。
  expect(stored, '参数里存的应当已经解析成裸 hex').toBe('#156082');

  const { magenta, near } = await countColors(page, [21, 96, 130]);
  expect(magenta, '画面里出现了品红 —— 说明渲染读到的是坏颜色').toBe(0);
  expect(near, '画面里应当有该主题色的格子（否则这条用例没有覆盖面）').toBeGreaterThan(0);
});

test('特效参数与纯色片段选主题色：同样落成 hex', async ({ page }) => {
  await boot(page);
  // 双色调会把整个画面压成两个颜色 —— 参数一旦是坏颜色，整幅都是品红。
  await buildStage(
    page,
    { id: 'pic', source: { type: 'solid', color: '#ffffff' } },
    { id: 'duo', defId: 'duotone', values: {} },
  );
  await page.evaluate(() => {
    (window as never as { __artmatic: Api }).__artmatic.appState.selectedClipId = 'duo';
  });

  await page.getByTestId('effect-param-shadowColor').click();
  await page.getByTestId('effect-param-shadowColor-palette-theme-@accent2').click();

  const stored = await page.evaluate(() => {
    const A = (window as never as { __artmatic: Api }).__artmatic;
    const clip = A.store.findClip('duo');
    const chain = (clip?.clip as unknown as { chain?: { values: Record<string, unknown> }[] }).chain;
    return chain?.[0]?.values.shadowColor;
  });
  expect(stored).toMatch(/^#[0-9a-f]{6}$/i);

  // 纯色片段：同一张取色卡，同一套写法。
  await page.evaluate(() => {
    (window as never as { __artmatic: Api }).__artmatic.appState.selectedClipId = 'pic';
  });
  await page.getByTestId('clip-color').click();
  await page.getByTestId('clip-color-palette-theme-@accent3').click();
  const solid = await page.evaluate(() => {
    const A = (window as never as { __artmatic: Api }).__artmatic;
    return A.store.findClip('pic')?.clip.source?.color;
  });
  expect(solid).toMatch(/^#[0-9a-f]{6}$/i);
});
