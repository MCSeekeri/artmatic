import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 时间轴框选：在空白处拖出矩形，选中与它相交的多个片段。
 *
 * 断言一律走**真实指针输入**（page.mouse / .click），不直接写 appState ——
 * 手势层那几件容易悄悄坏掉的事（4px 单击阈值、矩形命中判定、Shift 加选、
 * Esc 回退）全在这一层，直接写状态会把它们整个绕过去。
 */

// 与 timeline-ui.spec.ts 同档：这台机器上时间轴的那套几何断言都与 dpr 相关。
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });

type AnyA = {
  store: {
    project: {
      duration: number;
      tracks: {
        id: string;
        name: string;
        kind: string;
        clips: { id: string; kind: string; start: number; end: number }[];
      }[];
    };
    addTrack: (k: 'visual' | 'audio', name?: string) => string;
    addClip: (t: string, c: unknown) => void;
    setOverlapBehavior: (b: string) => void;
  };
  appState: {
    selectedClipId: string | null;
    selectedClipIds: string[];
    pxPerBeat: number;
    waveforms: Record<string, unknown>;
  };
};

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

const MK = `(id, start, end) => ({ kind:'source', id, start, end, label:id, fadeSec:0, curves:{},
  source:{type:'solid', color:'#3a6ea5'}, blend:'normal', opacity:1,
  transform:{x:.5,y:.5,sx:1,sy:1,rot:0}, fit:'stretch' })`;

/**
 * 建一条 TEST 轨（A[1,2] + B[3,4]）与空轨 DROP，并把轨道区滚到底让它们都在视野里。
 *
 * A 刻意**不从 0 开始**：框选必须从空白起手，A 之前要留出几像素的落点
 * （A 贴着内容原点的话那里就直接是片段了）。
 */
async function seed(page: Page): Promise<void> {
  await page.evaluate((src) => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    const mk = eval(src) as (id: string, s: number, e: number) => unknown;
    const t = a.store.addTrack('visual', 'TEST');
    a.store.addClip(t, mk('A', 1, 2));
    a.store.addClip(t, mk('B', 3, 4));
    a.store.addTrack('visual', 'DROP');
    /*
     * 音频片段只为一条用例服务：「组里含音频就不许上下跨轨」。它待在一条**音频**
     * 轨上，于是整组平移一格时它会落到视觉轨 → `canHost` 拒绝 → 格数回退到 0。
     * 波形是合成的（素材不进仓库），走的是 grid-draw 的真实绘制路径。
     */
    const at = a.store.addTrack('audio', 'ATEST');
    a.appState.waveforms = {
      ...a.appState.waveforms,
      'e2e-au': { buckets: new Float32Array(40), bucketSec: 0.05, length: 20, duration: 2 },
    };
    a.store.addClip(at, {
      kind: 'audio',
      id: 'AU',
      start: 1,
      end: 2,
      label: 'AU',
      fadeSec: 0,
      curves: {},
      assetId: 'e2e-au',
      srcIn: 0,
    });
  }, MK);
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid=tl-scroll]');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

/** 当前选中集（按加入顺序）。 */
function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => [
    ...(window as never as { __artmatic: AnyA }).__artmatic.appState.selectedClipIds,
  ]);
}

/** 某条轨上的片段几何（`id:start-end`，按工程里的顺序 = 按 start 排序）。 */
function clipsOfTrack(page: Page, name: string): Promise<string[]> {
  return page.evaluate((n) => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    const t = a.store.project.tracks.find((x) => x.name === n);
    return (t?.clips ?? []).map((c) => `${c.id}:${+c.start.toFixed(2)}-${+c.end.toFixed(2)}`);
  }, name);
}

/** TEST 轨上的片段几何。 */
function testClips(page: Page): Promise<string[]> {
  return clipsOfTrack(page, 'TEST');
}

/** 用「单击 + Shift+单击」凑一个选中集（框选之外的第二条入口）。 */
async function selectGroup(page: Page, ids: readonly string[]): Promise<void> {
  await page.locator(`[data-clip-id="${ids[0]}"]`).click();
  for (const id of ids.slice(1)) {
    await page.locator(`[data-clip-id="${id}"]`).click({ modifiers: ['Shift'] });
  }
}

/** 从片段中心起手拖动。dy 用一行的行高就能落到相邻轨道上。 */
async function dragClip(page: Page, id: string, dx: number, dy = 0): Promise<void> {
  const box = (await page.locator(`[data-clip-id="${id}"]`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

/** 一行的高度（= 上下跨一格要拖的距离）。 */
async function rowHeight(page: Page): Promise<number> {
  const box = (await page.locator('[data-testid=tl-row]').first().boundingBox())!;
  return box.height;
}

/**
 * 某个片段所在那一行的上下边界（**从片段自身的外框推**，不依赖行序）。
 *
 * 原来按「倒数第二行」取 TEST —— 那只在轨道数量固定时成立：seed 后来加了 ATEST
 * 轨，行序一挪就取到隔壁那行，框选自然一个也框不到（而且看起来像框选坏了）。
 * 片段在行内有 3px 的上下 inset，所以 ±2px 仍然落在同一行里。
 */
async function rowSpanAt(page: Page, clipId: string): Promise<{ y0: number; y1: number }> {
  const box = (await page.locator(`[data-clip-id="${clipId}"]`).boundingBox())!;
  return { y0: box.y - 2, y1: box.y + box.height + 2 };
}

test('框选：从空白拖过两个片段，两个都选中', async ({ page }) => {
  await boot(page);
  await seed(page);
  const a = (await page.locator('[data-clip-id="A"]').boundingBox())!;
  const b = (await page.locator('[data-clip-id="B"]').boundingBox())!;
  const row = await rowSpanAt(page, 'A');

  await page.mouse.move(a.x - 16, row.y0);
  await page.mouse.down();
  await page.mouse.move(a.x - 8, row.y0 + 6, { steps: 3 });
  // 超过 4px 阈值就该看到框了
  await expect(page.locator('[data-testid=tl-marquee]')).toHaveCount(1);
  await page.mouse.move(b.x + b.width + 16, row.y1, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('[data-testid=tl-marquee]')).toHaveCount(0);
  expect(await selectedIds(page)).toEqual(['A', 'B']);
  await expect(page.locator('[data-testid=clip].selected')).toHaveCount(2);
});

test('框选：只框住 B 时 A 不被选中', async ({ page }) => {
  await boot(page);
  await seed(page);
  const a = (await page.locator('[data-clip-id="A"]').boundingBox())!;
  const b = (await page.locator('[data-clip-id="B"]').boundingBox())!;
  const row = await rowSpanAt(page, 'A');

  // 从 A 与 B 之间的空白起手（A 右边界与 B 左边界之间有 1 秒空档）
  await page.mouse.move(a.x + a.width + 8, row.y0);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 16, row.y1, { steps: 8 });
  await page.mouse.up();

  expect(await selectedIds(page)).toEqual(['B']);
});

test('点空白：取消选择（不画框、不动片段）', async ({ page }) => {
  await boot(page);
  await seed(page);
  await page.locator('[data-clip-id="A"]').click();
  expect(await selectedIds(page)).toEqual(['A']);

  const a = (await page.locator('[data-clip-id="A"]').boundingBox())!;
  const row = await rowSpanAt(page, 'A');
  await page.mouse.click(a.x - 16, (row.y0 + row.y1) / 2);

  expect(await selectedIds(page)).toEqual([]);
  expect(await testClips(page)).toEqual(['A:1-2', 'B:3-4']);
});

test('Shift+单击：加选与减选；无修饰键收敛成单选', async ({ page }) => {
  await boot(page);
  await seed(page);

  await page.locator('[data-clip-id="A"]').click();
  await page.locator('[data-clip-id="B"]').click({ modifiers: ['Shift'] });
  expect(await selectedIds(page)).toEqual(['A', 'B']);

  // 再点一次 = 从选择集里摘掉
  await page.locator('[data-clip-id="B"]').click({ modifiers: ['Shift'] });
  expect(await selectedIds(page)).toEqual(['A']);

  await page.locator('[data-clip-id="B"]').click();
  expect(await selectedIds(page)).toEqual(['B']);

  // 只是选择，片段一个都没动
  expect(await testClips(page)).toEqual(['A:1-2', 'B:3-4']);
});

test('Esc：中止框选，回到按下时的选择', async ({ page }) => {
  await boot(page);
  await seed(page);
  await page.locator('[data-clip-id="A"]').click();

  const a = (await page.locator('[data-clip-id="A"]').boundingBox())!;
  const b = (await page.locator('[data-clip-id="B"]').boundingBox())!;
  const row = await rowSpanAt(page, 'A');
  const y = (row.y0 + row.y1) / 2;

  await page.mouse.move(a.x + a.width + 8, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 16, y, { steps: 8 });
  expect(await selectedIds(page)).toEqual(['B']); // 拖动期间是实时结果
  await page.keyboard.press('Escape');
  await page.mouse.up();

  expect(await selectedIds(page)).toEqual(['A']);
});

test('Delete：删掉全部选中，Ctrl+Z 一次全回来', async ({ page }) => {
  await boot(page);
  await seed(page);
  await page.locator('[data-clip-id="A"]').click();
  await page.locator('[data-clip-id="B"]').click({ modifiers: ['Shift'] });

  await page.keyboard.press('Delete');
  expect(await testClips(page)).toEqual([]);
  expect(await selectedIds(page)).toEqual([]);

  // 一笔撤销（逐个删会在栈上留两条记录，一次 Ctrl+Z 只回来一个）
  await page.keyboard.press('Control+z');
  expect(await testClips(page)).toEqual(['A:1-2', 'B:3-4']);
});

/* ============================================================================
 * 整组拖动：拖已选中的多个片段之一 = 整组一起走
 * ========================================================================== */

test('整组拖动：水平移动，两个片段位移相同且是一笔撤销', async ({ page }) => {
  await boot(page);
  await seed(page);
  await selectGroup(page, ['A', 'B']);

  await dragClip(page, 'A', 56); // 56px @56px/s = 1s
  expect(await testClips(page)).toEqual(['A:2-3', 'B:4-5']);

  // 整组拖 = 一次事务：一次 Ctrl+Z 两个一起回去
  await page.keyboard.press('Control+z');
  expect(await testClips(page)).toEqual(['A:1-2', 'B:3-4']);
});

test('整组拖动：跨轨时整组一起搬，相对位置不变', async ({ page }) => {
  await boot(page);
  await seed(page);
  await selectGroup(page, ['A', 'B']);

  const h = await rowHeight(page);
  await dragClip(page, 'A', 0, h); // 下移一行 → DROP

  expect(await testClips(page)).toEqual([]); // TEST 轨空了
  expect(await clipsOfTrack(page, 'DROP')).toEqual(['A:1-2', 'B:3-4']); // 时间位置原封不动
});

test('整组拖动：组里含音频时只能水平移动（不跨轨）', async ({ page }) => {
  await boot(page);
  await seed(page);
  await selectGroup(page, ['A', 'AU']);

  const h = await rowHeight(page);
  await dragClip(page, 'A', 56, h); // 想下移一行，同时右移 1s

  // 音频片段平移后会落到视觉轨 ⇒ canHost 拒绝 ⇒ 整组停在原轨
  expect(await testClips(page)).toEqual(['A:2-3', 'B:3-4']);
  expect(await clipsOfTrack(page, 'ATEST')).toEqual(['AU:2-3']);
});

test('单选拖动：拖没选中的片段只动它自己（不会被整组带走）', async ({ page }) => {
  await boot(page);
  await seed(page);
  await selectGroup(page, ['A', 'B']);

  await page.locator('[data-clip-id="A"]').click(); // 收敛成单选
  expect(await selectedIds(page)).toEqual(['A']);

  await dragClip(page, 'A', 56);
  expect(await testClips(page)).toEqual(['A:2-3', 'B:3-4']);
});

test('整组拖动：reject 策略下只要有一个成员落不下，整组回退', async ({ page }) => {
  await boot(page);
  await seed(page);
  // TEST 轨上再放一个占位片段 C[6,8]
  await page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    const t = a.store.project.tracks.find((x) => x.name === 'TEST')!;
    a.store.addClip(t.id, {
      kind: 'source',
      id: 'C',
      start: 6,
      end: 8,
      label: 'C',
      fadeSec: 0,
      curves: {},
      source: { type: 'solid', color: '#3a6ea5' },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
    });
  });
  await page.evaluate(() =>
    (window as never as { __artmatic: AnyA }).__artmatic.store.setOverlapBehavior('reject'),
  );
  await selectGroup(page, ['A', 'B']);

  // +4s：A→5-6 合法，B→7-8 撞上 C[6,8] ⇒ 整次手势作废
  await dragClip(page, 'A', 224);
  expect(await testClips(page)).toEqual(['A:1-2', 'B:3-4', 'C:6-8']);
});
