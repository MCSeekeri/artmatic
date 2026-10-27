import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';
import { zhCN } from '../../src/i18n/locales/zh-CN';

/**
 * 段落标记。
 *
 * 段落带是标尺上方的**一条 DOM**（不是 canvas 上的 12px 条），所以这里的断言
 * 既能看数据（`store.project.sections`），也能看用户真正看到的东西
 * （色块的 left / 名字 / 改名输入框）—— 后者才是「文档改了但界面没改」那类
 * bug 的唯一防线。
 *
 * 手势一律走 `page.mouse`（策略结算、拖动阈值都在手势层）。
 */

type W = {
  __artmatic: {
    store: {
      project: {
        duration: number;
        sections: { id: string; name: string; start: number }[];
        tracks: { id: string; kind: string; clips: { id: string; start: number }[] }[];
      };
      addSection: (start: number, name?: string) => string;
      removeSection: (id: string) => void;
      addTrack: (kind: 'visual' | 'audio', name?: string) => string;
      addClip: (trackId: string, clip: unknown) => void;
      findClip: (id: string) => { clip: { start: number; fadeIn?: number } } | null;
      commit: (label: string, fn: (p: Record<string, unknown>) => void) => boolean;
    };
    appState: { pxPerBeat: number; playT: number };
    project: {
      useOpfs(name?: string): Promise<string>;
      save(): Promise<boolean>;
      open(name?: string): Promise<boolean>;
      wipe(name?: string): Promise<void>;
    };
  };
};

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as never as W).__artmatic));
  await openDemo(page);
}

const sections = (page: Page) =>
  page.evaluate(() => (window as never as W).__artmatic.store.project.sections.map((s) => ({ ...s })));

test('示例工程自带三段段落，带子按顺序铺开', async ({ page }) => {
  await boot(page);
  const chips = page.getByTestId('tl-section');
  await expect(chips).toHaveCount(3);
  await expect(chips.nth(0)).toContainText(zhCN['tl.demoSectionIntro']);
  await expect(chips.nth(1)).toContainText(zhCN['tl.demoSectionDevelop']);
  await expect(chips.nth(2)).toContainText(zhCN['tl.demoSectionOutro']);

  const all = await sections(page);
  expect(all.map((s) => s.start)).toEqual([0, 8, 16]);
});

test('拖动段落改位置：一笔撤销，色块跟着走', async ({ page }) => {
  await boot(page);
  const first = page.getByTestId('tl-section').first();
  const box = (await first.boundingBox())!;

  /*
   * 56 px/s（28 px/beat @120BPM）。从色块中间往右拖 56px = +1s，
   * bar 吸附（2s 一格）→ 落到 2s。拖动期间不该产生中间撤销。
   */
  await page.mouse.move(box.x + 200, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 256, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);

  expect((await sections(page))[0]!.start).toBe(2);
  // 界面必须跟着动（不是只有数据变了）
  const moved = (await first.boundingBox())!;
  expect(moved.x - box.x).toBeGreaterThan(100);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  expect((await sections(page))[0]!.start).toBe(0);
});

test('空白段落带上右键可以新建一段；双击可以改名', async ({ page }) => {
  await boot(page);
  // 色块铺满整条时间轴，所以先清空才有「空白带」。
  await page.evaluate(() => {
    const A = (window as never as W).__artmatic;
    for (const s of [...A.store.project.sections]) A.store.removeSection(s.id);
  });
  await expect(page.getByTestId('tl-section')).toHaveCount(0);

  const band = (await page.getByTestId('tl-section-band').boundingBox())!;
  await page.mouse.click(band.x + 120, band.y + band.height / 2, { button: 'right' });
  await expect(page.getByTestId('section-menu')).toBeVisible();
  await page.getByTestId('section-add').click();
  await expect(page.getByTestId('tl-section')).toHaveCount(1);

  const created = (await sections(page))[0]!;
  expect(created.start).toBeGreaterThan(0);

  await page.getByTestId('tl-section').first().dblclick();
  const input = page.getByTestId('section-rename-input');
  await expect(input).toBeVisible();
  await input.fill('副歌');
  await input.press('Enter');
  await expect(page.getByTestId('tl-section').first()).toContainText('副歌');
  expect((await sections(page))[0]!.name).toBe('副歌');
});

test('右键「在鼠标处切分」：只插一个新起点，左半保留名字与颜色', async ({ page }) => {
  await boot(page);
  const band = (await page.getByTestId('tl-section-band').boundingBox())!;
  // 56 px/s：10s 处的 x。落在「发展」（8..16）里面。
  const x = band.x + 10 * 56;

  await page.mouse.click(x, band.y + band.height / 2, { button: 'right' });
  await expect(page.getByTestId('section-menu')).toBeVisible();
  await page.getByTestId('section-split').click();

  const after = await sections(page);
  expect(after.map((s) => s.start)).toEqual([0, 8, 10, 16]);
  // 原名留给左半，新段拿到一个不撞名的默认名（来自 tl.sectionN）
  expect(after[1]!.name).toBe(zhCN['tl.demoSectionDevelop']);
  expect(after[2]!.name).not.toBe(after[1]!.name);

  await expect(page.getByTestId('tl-section')).toHaveCount(4);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  expect((await sections(page)).map((s) => s.start)).toEqual([0, 8, 16]);
});

test('右键已有段落可以删除，且是一笔撤销', async ({ page }) => {
  await boot(page);
  await page.getByTestId('tl-section').nth(1).click({ button: 'right' });
  await page.getByTestId('section-remove').click();
  await expect(page.getByTestId('tl-section')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('tl-section')).toHaveCount(3);
});

test('段落边界是吸附点：同样一段拖动，贴段落而不是贴小节线', async ({ page }) => {
  await boot(page);
  // 清掉 demo 的段落，只留一个非网格点（3s）——这样「贴上了」不可能是巧合。
  const clip = await page.evaluate(() => {
    const A = (window as never as W).__artmatic;
    for (const s of [...A.store.project.sections]) A.store.removeSection(s.id);
    A.store.addSection(3, '分界');
    const trackId = A.store.addTrack('visual', 'V-test');
    A.store.addClip(trackId, {
      kind: 'source',
      id: 'e2e-sec-clip',
      start: 0,
      end: 1,
      label: 'clippy',
      fadeSec: 0,
      curves: {},
      source: { type: 'solid', color: '#3a6ea5' },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
    });
    return { pxPerBeat: A.appState.pxPerBeat };
  });
  expect(clip.pxPerBeat).toBeGreaterThan(0);

  /** 把片段从 0 拖到约 3.1s，返回落点。 */
  async function dragTo31(): Promise<number> {
    const el = page.locator('[data-clip-id="e2e-sec-clip"]');
    const box = (await el.boundingBox())!;
    const pps = await page.evaluate(
      () => (window as never as W).__artmatic.appState.pxPerBeat / (60 / 120),
    );
    const dx = 3.1 * pps;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    return page.evaluate(
      () => (window as never as W).__artmatic.store.findClip('e2e-sec-clip')!.clip.start,
    );
  }

  // ① 有 3s 的段落：吸附到段落（bar 网格只有 2 / 4）。
  expect(await dragTo31()).toBe(3);

  // ② 回到 0，删掉段落再拖同样距离：只能落回小节线 4。
  await page.evaluate(() => {
    (window as never as W).__artmatic.store.commit('回家', (p) => {
      const c = (p as unknown as { tracks: { clips: { id: string; start: number; end: number }[] }[] })
        .tracks.flatMap((t) => t.clips)
        .find((c) => c.id === 'e2e-sec-clip');
      if (c) {
        c.start = 0;
        c.end = 1;
      }
    });
    const A = (window as never as W).__artmatic;
    for (const s of [...A.store.project.sections]) A.store.removeSection(s.id);
  });
  expect(await dragTo31()).toBe(4);
});

test('段落随工程保存 / 重开（数据走 project.json，不进 UI 偏好）', async ({ page }) => {
  const DIR = 'e2e-sections';
  await boot(page);
  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), DIR);
  await page.evaluate((d) => (window as never as W).__artmatic.project.useOpfs(d), DIR);
  await page.evaluate(() => {
    const A = (window as never as W).__artmatic;
    A.store.commit('改名', (p) => {
      const s = (p as unknown as { sections: { id: string; name: string }[] }).sections[0];
      if (s) s.name = '存档段落';
    });
  });
  await page.evaluate(() => (window as never as W).__artmatic.project.save());

  // 内存里改脏，证明 open 真的从磁盘读回来了
  await page.evaluate(() => {
    (window as never as W).__artmatic.store.commit('清空段落', (p) => {
      (p as unknown as { sections: unknown[] }).sections = [];
    });
  });
  expect(await sections(page)).toEqual([]);

  await page.evaluate((d) => (window as never as W).__artmatic.project.open(d), DIR);
  const after = await sections(page);
  expect(after).toHaveLength(3);
  expect(after[0]!.name).toBe('存档段落');
});
