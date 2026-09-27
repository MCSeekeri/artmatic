import { expect, test, type Page } from '@playwright/test';

/**
 * 时间轴交互回归：覆盖 2026-09-27 那批 MVP 反馈。
 *
 * 这些断言刻意走**真实指针输入**（page.mouse）而不是直接调 store——
 * 出问题的那几条（策略结算时序、跨轨、右键菜单）全都在手势层，
 * 直接调 store 会把它们整个绕过去。
 */

// 行数多（demo 5 轨 + 测试 2 轨）时轨道区会出滚动条，窗口给高一点
test.use({ viewport: { width: 1440, height: 900 } });

type AnyA = {
  store: {
    project: { duration: number; tracks: { id: string; name: string; kind: string; clips: { id: string; kind: string; start: number; end: number; label: string; opacity?: number }[] }[] };
    addTrack: (k: 'visual' | 'audio', name?: string) => string;
    addClip: (t: string, c: unknown) => void;
    removeTrack: (t: string) => void;
    setOverlapBehavior: (b: string) => void;
    findClip: (id: string) => { clip: { opacity: number } } | null;
    track: (t: string) => { clips: { id: string; start: number; end: number }[] } | null;
  };
  appState: { selectedClipId: string | null };
};

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

const MK = `(id, start, end) => ({ kind:'source', id, start, end, label:id, fadeSec:0, curves:{},
  source:{type:'solid', color:'#3a6ea5'}, blend:'normal', opacity:1,
  transform:{x:.5,y:.5,sx:1,sy:1,rot:0}, fit:'stretch' })`;

/** 建 TEST 轨（A[0,2] + B[3,5]）与空轨 DROP，并把轨道区滚到底让它们都在视野里。 */
async function seed(page: Page): Promise<void> {
  await page.evaluate((src) => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    const mk = eval(src) as (id: string, s: number, e: number) => unknown;
    const t = a.store.addTrack('visual', 'TEST');
    a.store.addClip(t, mk('A', 0, 2));
    a.store.addClip(t, mk('B', 3, 5));
    a.store.addTrack('visual', 'DROP');
  }, MK);
  await page.evaluate(() => {
    const el = document.querySelector('.scroll');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

/** 把 TEST / DROP 清掉重建：每个子用例从同一初始几何出发，互不污染。 */
async function reseed(page: Page): Promise<void> {
  await page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    for (const t of [...a.store.project.tracks]) {
      if (t.name === 'TEST' || t.name === 'DROP') a.store.removeTrack(t.id);
    }
  });
  await seed(page);
}

async function geom(page: Page): Promise<Record<string, { track: string; start: number; end: number }>> {
  return page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    const out: Record<string, { track: string; start: number; end: number }> = {};
    for (const t of a.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === 'A' || c.id === 'B') out[c.id] = { track: t.name, start: +c.start.toFixed(3), end: +c.end.toFixed(3) };
      }
    }
    return out;
  });
}

const policy = (page: Page, p: string) =>
  page.evaluate((v) => (window as never as { __artmatic: AnyA }).__artmatic.store.setOverlapBehavior(v), p);

async function drag(page: Page, id: string, dx: number, dy = 0, mid?: () => Promise<void>): Promise<void> {
  const box = (await page.locator(`[data-clip-id="${id}"]`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  if (mid) await mid();
  await page.mouse.up();
}

/** 拖右边缘（缩放的落点在右边缘，所以不能从中心起手）。 */
async function dragEnd(page: Page, id: string, dx: number): Promise<void> {
  const box = (await page.locator(`[data-clip-id="${id}"]`).boundingBox())!;
  const x = box.x + box.width - 3;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

test('检查器：增删特效实例立即刷新，不必重选片段', async ({ page }) => {
  await boot(page);
  const fxId = await page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    for (const t of a.store.project.tracks) {
      for (const c of t.clips) if (c.kind === 'effect') return c.id;
    }
    return null;
  });
  await page.locator(`[data-clip-id="${fxId}"]`).click();
  await expect(page.locator('.fx')).toHaveCount(2); // demo 的 V3 带两个实例

  await page.getByTestId('add-effect-instance').click();
  await expect(page.locator('.fx')).toHaveCount(3);
  await page.getByTestId('add-effect-instance').click();
  await expect(page.locator('.fx')).toHaveCount(4);

  await page.locator('.fx').first().locator('button[title="删除"]').click();
  await expect(page.locator('.fx')).toHaveCount(3);
});

test('检查器：拖滑杆时同行的数字输入框实时跟随', async ({ page }) => {
  await boot(page);
  const clipId = await page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    for (const t of a.store.project.tracks) {
      for (const c of t.clips) if (c.kind === 'source' && c.label.includes('Mandelbrot')) return c.id;
    }
    return null;
  }) as string;
  await page.locator(`[data-clip-id="${clipId}"]`).click();
  const row = page.locator('.kf', { has: page.locator('.lbl', { hasText: '不透明度' }) }).first();
  const range = row.locator('input[type=range]');
  const num = row.locator('input.num');
  await expect(num).toHaveValue('1');

  const box = (await range.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 4 });
  await page.waitForTimeout(80);
  const shown = Number(await num.inputValue());
  const stored = await page.evaluate(
    (id) => +(window as never as { __artmatic: AnyA }).__artmatic.store.findClip(id)!.clip.opacity.toFixed(3),
    clipId,
  );
  await page.mouse.up();
  expect(stored).toBeGreaterThan(0.3);
  expect(Math.abs(shown - stored)).toBeLessThan(1e-6);
});

test('拖拽：trim 策略下邻居在松手前不被吃', async ({ page }) => {
  await boot(page);
  await seed(page);
  await policy(page, 'trim');
  let bDuring = 0;
  await drag(page, 'A', 140, 0, async () => {
    bDuring = (await geom(page)).B!.start;
  });
  expect(bDuring).toBe(3); // 拖动中 B 完好
  const after = await geom(page);
  expect(after.B!.start).toBeGreaterThan(3); // 松手才被吃
  expect(after.A!.start).toBeGreaterThan(2); // 被拖片段自由跟到了落点
});

test('拖拽：reject 策略下非法落点松手弹回，拖动中给出提示', async ({ page }) => {
  await boot(page);
  await seed(page);
  await policy(page, 'reject');
  let hinted = false;
  await drag(page, 'A', 140, 0, async () => {
    hinted = (await page.locator('.clip.illegal').count()) > 0;
  });
  expect(hinted).toBe(true);
  const after = await geom(page);
  expect([after.A!.start, after.A!.end]).toEqual([0, 2]);
});

test('缩放：三种重叠策略各自生效', async ({ page }) => {
  await boot(page);
  await seed(page);

  await policy(page, 'reject');
  await dragEnd(page, 'A', 140);
  expect((await geom(page)).A!.end).toBeCloseTo(3, 2); // 钳在 B 边界

  await reseed(page);
  await policy(page, 'push');
  await dragEnd(page, 'A', 140);
  const pushed = await geom(page);
  expect(pushed.A!.end).toBeGreaterThan(4); // 真的长过去了
  expect(pushed.B!.start).toBeCloseTo(pushed.A!.end, 2); // 邻居整体让位

  await reseed(page);
  await policy(page, 'trim');
  // 84px @56px/s = +1.5s → 吸附后 A.end = 3.5，压进 B 的头 0.5 秒
  await dragEnd(page, 'A', 84);
  const trimmed = await geom(page);
  expect(trimmed.A!.end).toBeGreaterThan(3);
  expect(trimmed.B!.start).toBeCloseTo(trimmed.A!.end, 2);
});

test('跨轨：拖到其它轨道 + Alt+↑↓', async ({ page }) => {
  await boot(page);
  await seed(page);
  await policy(page, 'reject');

  const rows = await page.locator('.tl .row').count();
  const drop = (await page.locator('.tl .row').nth(rows - 1).boundingBox())!;
  const box = (await page.locator('[data-clip-id="A"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, drop.y + drop.height / 2, { steps: 12 });
  await page.mouse.up();
  expect((await geom(page)).A!.track).toBe('DROP');

  await page.evaluate(() => {
    (window as never as { __artmatic: AnyA }).__artmatic.appState.selectedClipId = 'A';
  });
  await page.keyboard.press('Alt+ArrowUp');
  expect((await geom(page)).A!.track).toBe('TEST');

  await page.keyboard.press('Alt+ArrowDown');
  expect((await geom(page)).A!.track).toBe('DROP');
});

test('右键：自绘菜单在鼠标位置新建片段，原生菜单被禁用', async ({ page }) => {
  await boot(page);
  await seed(page);

  const preventedOnRow = await page.evaluate(() => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector('.tl .row')!.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(preventedOnRow).toBe(true);

  const rows = await page.locator('.tl .row').count();
  const row = (await page.locator('.tl .row').nth(rows - 1).boundingBox())!; // DROP 轨，空的
  await page.mouse.move(row.x + 224, row.y + row.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('.ctx')).toHaveCount(1);

  await page.getByTestId('ctx-solid').click();
  await expect(page.locator('.ctx')).toHaveCount(0);
  const created = await page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    const tr = a.store.project.tracks[a.store.project.tracks.length - 1]!;
    const c = tr.clips[tr.clips.length - 1]!;
    return { label: c.label, start: +c.start.toFixed(2) };
  });
  expect(created.label).toBe('纯色');
  expect(Math.abs(created.start - 4)).toBeLessThan(0.3); // 224px @56px/s = 4s，吸附到拍
});

test('时长：与素材长度解耦，可任意改也能被片段撑长', async ({ page }) => {
  await boot(page);
  const dur = () => page.evaluate(() => (window as never as { __artmatic: AnyA }).__artmatic.store.project.duration);
  const d0 = await dur();

  await page.getByTestId('duration-input').fill('30');
  await page.getByTestId('duration-input').press('Enter');
  await expect.poll(dur).toBe(30);
  const width30 = await page.evaluate(() => document.querySelector('.canvas-wrap')!.getBoundingClientRect().width);
  expect(width30).toBeGreaterThan(d0 * 50); // 30s @56px/s ≈ 1680px

  await page.getByTestId('fit-duration').click();
  const d2 = await dur();
  expect(d2).toBeLessThan(30);

  // 片段拖到内容末尾之外 → 工程跟着变长
  await seed(page);
  await policy(page, 'reject');
  const rows = await page.locator('.tl .row').count();
  const drop = (await page.locator('.tl .row').nth(rows - 1).boundingBox())!;
  const box = (await page.locator('[data-clip-id="A"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 960, drop.y + drop.height / 2, { steps: 14 });
  await page.mouse.up();
  expect(await dur()).toBeGreaterThan(d2);
});
