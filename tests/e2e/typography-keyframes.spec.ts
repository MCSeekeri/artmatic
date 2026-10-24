import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 关键帧面板（预览下方，与预览同宽）。
 *
 * 这里守的是三件事，它们各自都会**静默**失效：
 *  1. **一条动画 = 一个属性**：不同属性要异步就只能拆成多条，各带自己的
 *     `animation-delay`（断言读的是计算样式，不是文档字段）；
 *  2. **面板的改动真的到了文档与样式表**（`@keyframes` 里出现逐段缓动）；
 *  3. **手势 = 一笔撤销**：拖完一帧，Ctrl+Z 一次就回得去。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

interface Hooks {
  store: {
    project: {
      tracks: {
        clips: {
          id: string;
          start: number;
          end: number;
          source?: { type?: string; doc?: DocShape };
        }[];
      }[];
    };
  };
  appState: { activeTypoClipId: string | null; seek: (t: number) => void };
}

interface AnimShape {
  id: string;
  kind: string;
  prop?: string;
  delay: number;
  duration: number;
  keys?: { t: number; v: number | string; ease?: unknown }[];
}

interface DocShape {
  elements: { id: string; animations: AnimShape[] }[];
}

async function addTextClip(page: Page): Promise<string> {
  const ids = (): Promise<string[]> =>
    page.evaluate(() => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      const out: string[] = [];
      for (const t of A.store.project.tracks) {
        for (const c of t.clips) if (c.source?.type === 'text') out.push(c.id);
      }
      return out;
    });
  const before = await ids();
  await page.locator('[data-testid=track-side-row]').nth(0).getByTestId('track-menu').click();
  await page.getByTestId('add-text').click();
  const added = (await ids()).filter((id) => !before.includes(id));
  expect(added, '「+ 排版片段」没有新增片段').toHaveLength(1);
  return added[0]!;
}

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

async function readDoc(page: Page): Promise<DocShape> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks })
      .__artmatic;
    const id = A.appState.activeTypoClipId;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === id && c.source?.type === 'text' && c.source.doc) return c.source.doc;
      }
    }
    throw new Error(`找不到当前编辑的排版文档（activeTypoClipId=${id}）`);
  });
}

async function selectFirst(page: Page): Promise<void> {
  await page.getByTestId('typo-layer-row').first().click();
  await expect(page.getByTestId('typo-selection')).toBeVisible();
}

/** 面板里那条轨道的关键帧时刻（升序）。 */
async function keyTimes(page: Page): Promise<number[]> {
  return page
    .getByTestId('typo-kf-key')
    .evaluateAll((nodes) => nodes.map((n) => Number((n as HTMLElement).dataset.t)));
}

test('面板在预览下方、与预览同宽；只读的「动画」选项卡已经删掉', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  await expect(page.getByTestId('typo-tab-anim')).toHaveCount(0);

  const stage = (await page.getByTestId('typo-stage').boundingBox())!;
  const panel = (await page.getByTestId('typo-kf-panel').boundingBox())!;
  expect(panel.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
  expect(Math.abs(panel.width - stage.width)).toBeLessThanOrEqual(2);

  // 折叠后只剩 28px 的标题栏，展开回来高度恢复。
  await page.getByTestId('typo-kf-toggle').click();
  const folded = (await page.getByTestId('typo-kf-panel').boundingBox())!;
  expect(folded.height).toBeLessThan(40);
  await page.getByTestId('typo-kf-toggle').click();
  const again = (await page.getByTestId('typo-kf-panel').boundingBox())!;
  expect(again.height).toBeGreaterThan(100);

  // 元素列可折叠（折叠后不吃宽度）。
  const els = (await page.getByTestId('typo-kf-els').boundingBox())!;
  await page.getByTestId('typo-kf-aside-toggle').click();
  const elsFolded = (await page.getByTestId('typo-kf-els').boundingBox())!;
  expect(elsFolded.width).toBeLessThan(els.width);
  await page.getByTestId('typo-kf-aside-toggle').click();

  // ⌘/Ctrl + 滚轮缩放：内容变宽 ⇒ 可以横向滚动（标尺跟着一起走）。
  const lanes = page.getByTestId('typo-kf-lanes');
  const box = (await lanes.boundingBox())!;
  const width0 = await lanes.evaluate((el) => el.scrollWidth);
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect
    .poll(() => lanes.evaluate((el) => el.scrollWidth))
    .toBeGreaterThan(width0);

  // 普通滚轮 = 横向滚动（内容超出时），与 Ribbon / Transport 同款。
  const sl0 = await lanes.evaluate((el) => el.scrollLeft);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => lanes.evaluate((el) => el.scrollLeft)).toBeGreaterThan(sl0);

  // 滚到中段：属性列必须整列盖住（播放头不许从它下面露出来）。
  await lanes.evaluate((el) => {
    el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) * 0.6);
  });
  await page.getByTestId('typo-kf-panel').screenshot({
    path: '.codebuddy/tmp/2026-10-24/kf-zoom.png',
  });
});

test('加属性 = 一条轨道两根帧；双击轨道补帧；三样都进文档', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  await page.getByTestId('typo-kf-add-prop').click();
  await expect(page.getByTestId('typo-kf-track')).toHaveCount(1);
  await expect(page.getByTestId('typo-kf-key')).toHaveCount(2);

  /*
   * 属性行与轨道必须**同排**：这是把属性搬进独立一列的唯一理由
   * （早期版本把属性行嵌在元素列表里，元素一多就错位）。
   */
  const propBox = (await page.getByTestId('typo-kf-track').first().boundingBox())!;
  const laneBox = (await page.getByTestId('typo-kf-lane').first().boundingBox())!;
  expect(Math.abs(propBox.y - laneBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(propBox.height - laneBox.height)).toBeLessThanOrEqual(1);

  // 删除轨道 / 播放重播都在顶栏（不再吊在面板最右侧）。
  await expect(page.getByTestId('typo-kf-remove-track')).toBeVisible();
  await expect(page.getByTestId('typo-kf-play')).toBeVisible();
  await expect(page.getByTestId('typo-kf-rewind')).toBeVisible();

  // 「双击轨道加点」这条提示不再写在面板上，改由底栏在指针落到轨道区时说。
  await page.getByTestId('typo-kf-lanes').hover();
  await expect(page.getByTestId('statusbar-hint')).toHaveText('双击轨道加点');

  let doc = await readDoc(page);
  const anim = doc.elements[0]!.animations[0]!;
  expect(anim.kind).toBe('tracks');
  expect(anim.prop).toBe('opacity');
  expect(anim.keys!.map((k) => k.t)).toEqual([0, 0.6]);

  // 双击轨道右半边 = 在那一刻补一帧。
  const lane = (await page.getByTestId('typo-kf-lane').boundingBox())!;
  await page.mouse.dblclick(lane.x + lane.width * 0.8, lane.y + lane.height / 2);
  await expect(page.getByTestId('typo-kf-key')).toHaveCount(3);

  doc = await readDoc(page);
  expect(doc.elements[0]!.animations[0]!.keys).toHaveLength(3);

  await page.screenshot({ path: '.codebuddy/tmp/2026-10-24/kf-panel.png' });
  await page.getByTestId('typo-kf-panel').screenshot({ path: '.codebuddy/tmp/2026-10-24/kf-panel-crop.png' });
});

test('关键帧自由拖曳（Shift 才吸附）；框选多帧；一笔撤销；改值', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);
  await page.getByTestId('typo-kf-add-prop').click();

  const before = await keyTimes(page);
  expect(before).toEqual([0, 0.6]);

  // **默认自由拖曳**：不按任何修饰键，位移与像素换算一致（不是 0.5s 一跳）。
  const second = page.getByTestId('typo-kf-key').nth(1);
  const box = (await second.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  const after = await keyTimes(page);
  expect(after[1]!).toBeGreaterThan(before[1]!);
  // 自由拖曳的落点一般**不在**拍上（0.5s 的整数倍）。
  expect(Math.abs(after[1]! * 2 - Math.round(after[1]! * 2))).toBeGreaterThan(0.01);

  // 一笔撤销退回原来的时刻（拖动中不许每帧一条撤销记录）。
  await page.keyboard.press('Control+z');
  expect((await keyTimes(page))[1]!).toBeCloseTo(before[1]!, 3);

  // Shift 拖动 = 吸附到拍。
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const snappedT = (await keyTimes(page))[1]!;
  expect(Math.abs(snappedT * 2 - Math.round(snappedT * 2))).toBeLessThan(0.01);
  await page.keyboard.press('Control+z');

  // 框选：在轨道上拖一个矩形 → 两帧都选中（与片段编辑器同款手势）。
  const lane = (await page.getByTestId('typo-kf-lane').first().boundingBox())!;
  await page.mouse.move(lane.x + 2, lane.y + 4);
  await page.mouse.down();
  await page.mouse.move(lane.x + lane.width * 0.9, lane.y + lane.height - 4, { steps: 8 });
  await page.mouse.up();
  // 注意用 `.on` 而不是 `[class*="on"]` —— `diamond` 里就有 "on"。
  await expect(page.locator('[data-testid="typo-kf-key"].on')).toHaveCount(2);

  // 再点空白取消选择（顶栏回落到「没有选中关键帧」才算数）。
  await page.mouse.click(lane.x + lane.width * 0.95, lane.y + 12);
  await expect(page.getByTestId('typo-kf-panel')).toContainText('没有选中关键帧');
  await expect(page.locator('[data-testid="typo-kf-key"].on')).toHaveCount(0);

  // 改值：选中第二帧 → 浮层里的数值框改。
  await page.getByTestId('typo-kf-key').nth(1).click();
  await page.getByTestId('typo-kf-key-value').fill('0.25');
  await page.getByTestId('typo-kf-key-value').press('Enter');
  const doc = await readDoc(page);
  expect(doc.elements[0]!.animations[0]!.keys![1]!.v).toBeCloseTo(0.25, 3);
});

test('选中关键帧弹浮层：值可改；curve / steps 都写进样式表（出向语义）', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);
  await page.getByTestId('typo-kf-add-prop').click();

  const sheet = (): Promise<string> =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('.paper style'))
        .map((s) => s.textContent ?? '')
        .join('\n'),
    );

  // 缓动是**出向**语义：只有第一帧后面还有一段，所以必须选它。
  await page.getByTestId('typo-kf-key').nth(0).click();
  await expect(page.getByTestId('typo-kf-pop')).toBeVisible();

  await page.getByTestId('typo-kf-ease-curve').click();
  let doc = await readDoc(page);
  expect(doc.elements[0]!.animations[0]!.keys![0]!.ease).toEqual([0.42, 0, 0.58, 1]);
  expect(await sheet()).toContain('animation-timing-function:cubic-bezier(0.42,0,0.58,1)');
  // 有曲线的帧画圆形（菱形 / 圆形 / 方形 = 三种缓动状态）。
  await expect(page.getByTestId('typo-kf-key').nth(0)).toHaveClass(/round/);

  await page.getByTestId('typo-kf-ease-step').click();
  doc = await readDoc(page);
  expect(doc.elements[0]!.animations[0]!.keys![0]!.ease).toEqual({ steps: 4, jump: 'end' });
  expect(await sheet()).toContain('animation-timing-function:steps(4,end)');
  await expect(page.getByTestId('typo-kf-key').nth(0)).toHaveClass(/square/);

  await page.getByTestId('typo-kf-step-n').fill('6');
  await page.getByTestId('typo-kf-step-n').press('Enter');
  expect(await sheet()).toContain('steps(6,end)');

  await page.screenshot({ path: '.codebuddy/tmp/2026-10-24/kf-ease.png' });
  await page.getByTestId('typo-kf-pop').press('Escape');
  await expect(page.getByTestId('typo-kf-pop')).toHaveCount(0);
});

test('不同属性 = 两条独立动画，各带自己的 animation-delay', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  // 透明度从 0s 起；把播放头挪到 60%（**标尺**拖动 = 播放头）再加一条「Y 位移」。
  await page.getByTestId('typo-kf-add-prop').click();
  const ruler = (await page.getByTestId('typo-kf-ruler').boundingBox())!;
  await page.mouse.click(ruler.x + ruler.width * 0.6, ruler.y + 10);
  await page.getByTestId('typo-kf-prop-select').click();
  await page.getByTestId('typo-kf-prop-y').click();
  await page.getByTestId('typo-kf-add-prop').click();

  await expect(page.getByTestId('typo-kf-track')).toHaveCount(2);
  await expect(page.getByTestId('typo-kf-lane')).toHaveCount(2);

  const info = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.paper [data-anim-id]')).map((el) => ({
      delay: getComputedStyle(el).animationDelay,
      name: getComputedStyle(el).animationName,
    })),
  );
  expect(info).toHaveLength(2);
  expect(new Set(info.map((i) => i.delay)).size, '两条动画必须各有自己的 delay').toBe(2);
  expect(new Set(info.map((i) => i.name)).size).toBe(2);

  const doc = await readDoc(page);
  expect(doc.elements[0]!.animations.map((a) => a.prop).sort()).toEqual(['opacity', 'y']);
  // 40% 处落点 ⇒ 第二条约 2s 起（片段多长由片段决定，所以只断「明显晚于 0」）。
  expect(doc.elements[0]!.animations.find((a) => a.prop === 'y')!.delay).toBeGreaterThan(0.5);
});
