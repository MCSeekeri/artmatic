import { expect, test, type Page } from '@playwright/test';
import { addTextClip, openDemo } from './_stage';

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
      fps: number;
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
  /** `Infinity` 过不了 evaluate 的序列化，读它要单独的布尔断言。 */
  iterations?: number;
  keys?: { t: number; v: number | string; ease?: unknown; color?: string }[];
}

interface DocShape {
  elements: { id: string; animations: AnimShape[] }[];
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

  /*
   * 滚到中段后，播放头 `left` 会变成负值 —— 它落在属性列底下。
   *
   * 让它「不露出来」的不是层叠（`.vscroll` 在 DOM 里排在 `.props` 之后，
   * 真要叠起来是播放头在上面），而是 `.vscroll` 的 overflow 裁剪。
   * 所以这里断的是裁剪本身：改成 `visible` 就会看到播放头从属性列上盖过去。
   * 原来的写法是截一张图、没有断言 —— 那种「只截图」的探针永远绿。
   */
  const overflowX = await page
    .getByTestId('typo-kf-lanes')
    .evaluate((el) => getComputedStyle(el).overflowX);
  // `auto` / `hidden` / `scroll` 都会裁剪；只有 `visible` 会把播放头漏出来。
  expect(overflowX, '改成 visible 后播放头会盖到属性列上').not.toBe('visible');
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

/** 当前编辑片段的起止（算「每秒多少像素」要用它）。 */
async function clipSpan(page: Page): Promise<{ start: number; end: number }> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    const id = A.appState.activeTypoClipId;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) if (c.id === id) return { start: c.start, end: c.end };
    }
    throw new Error(`找不到当前片段（activeTypoClipId=${id}）`);
  });
}

/** 加两条属性轨道（opacity + y），各带两根零变化帧。 */
async function addTwoTracks(page: Page): Promise<void> {
  await page.getByTestId('typo-kf-add-prop').click();
  await page.getByTestId('typo-kf-prop-select').click();
  await page.getByTestId('typo-kf-prop-y').click();
  await page.getByTestId('typo-kf-add-prop').click();
  await expect(page.getByTestId('typo-kf-lane')).toHaveCount(2);
}

test('框选之后拖任意一帧：整组一起走，一笔撤销', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);
  await addTwoTracks(page);

  // 框选整个轨道区 → 两条轨道共 4 帧全选中。
  const lanes = (await page.getByTestId('typo-kf-lanes').boundingBox())!;
  await page.mouse.move(lanes.x + 2, lanes.y + 2);
  await page.mouse.down();
  await page.mouse.move(lanes.x + lanes.width * 0.9, lanes.y + lanes.height - 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('[data-testid="typo-kf-key"].on')).toHaveCount(4);

  const count = async (): Promise<number[][]> =>
    (await readDoc(page)).elements[0]!.animations.map((a) => a.keys!.map((k) => k.t));
  const before = await count();

  /*
   * 按下的这一帧**已经在选择集里** ⇒ 拖着整组走。这条以前是坏的：按下会把
   * 选择重置成单帧，于是框选完只能一帧一帧挪。
   */
  const key = page.getByTestId('typo-kf-key').nth(1);
  const box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  const after = await count();
  const deltas = after.flatMap((ts, i) => ts.map((t, j) => t - before[i]![j]!));
  expect(deltas).toHaveLength(4);
  for (const d of deltas) expect(d).toBeCloseTo(deltas[0]!, 3);
  expect(deltas[0]!).toBeGreaterThan(0.05);
  // 相对间距不变（整组平移，不是各自夹到边界）。
  expect(after[0]![1]! - after[0]![0]!).toBeCloseTo(before[0]![1]! - before[0]![0]!, 3);

  // 一笔撤销回到拖动前（拖动中每帧都 commit 的形态是「按 60 次才回得去」）。
  await page.keyboard.press('Control+z');
  const undone = await count();
  for (let i = 0; i < before.length; i++) {
    for (let j = 0; j < before[i]!.length; j++) {
      expect(undone[i]![j]!).toBeCloseTo(before[i]![j]!, 3);
    }
  }
});

test('Shift 吸附的单位可选：0.1 秒 / 帧各自落在自己的刻度上', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);
  await page.getByTestId('typo-kf-add-prop').click();
  expect(await keyTimes(page)).toEqual([0, 0.6]);

  const span = await clipSpan(page);
  const lane = (await page.getByTestId('typo-kf-lane').first().boundingBox())!;
  const pxPerSec = lane.width / (span.end - span.start);
  const fps = await page.evaluate(
    () => (window as never as { __artmatic: Hooks }).__artmatic.store.project.fps,
  );

  /** 把第二帧（0.6s）往右拖到 0.664s 附近 —— 三档吸附的落点各不相同。 */
  const dragTo = async (target: number): Promise<void> => {
    const key = page.getByTestId('typo-kf-key').nth(1);
    const box = (await key.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + (target - 0.6) * pxPerSec,
      box.y + box.height / 2,
      { steps: 6 },
    );
    await page.mouse.up();
    await page.keyboard.up('Shift');
  };

  // 默认「拍」；换成「0.1 秒」。
  await expect(page.getByTestId('typo-kf-snap-unit')).toContainText('拍');
  await page.getByTestId('typo-kf-snap-unit').click();
  await page.getByTestId('typo-kf-snap-tenth').click();
  await expect(page.getByTestId('typo-kf-snap-unit')).toContainText('0.1 秒');
  await dragTo(0.664);
  expect((await keyTimes(page))[1]!).toBeCloseTo(0.7, 2);
  await page.keyboard.press('Control+z');

  // 换成「帧」：落在整帧上，且**不在** 0.1 秒的格点上（30fps 下 0.7s 也是整帧，
  // 所以必须两边都断，否则这条测试分不出「帧」与「0.1 秒」）。
  await page.getByTestId('typo-kf-snap-unit').click();
  await page.getByTestId('typo-kf-snap-frame').click();
  await dragTo(0.664);
  const t = (await keyTimes(page))[1]!;
  expect(Math.abs(t * fps - Math.round(t * fps))).toBeLessThan(1e-3);
  expect(Math.abs(t * 10 - Math.round(t * 10))).toBeGreaterThan(0.05);
});

test('轨道行可开关循环（iterations → infinite）', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);
  await page.getByTestId('typo-kf-add-prop').click();

  const loop = page.getByTestId('typo-kf-loop');
  await expect(loop).toHaveCount(1);
  await expect(loop).toHaveAttribute('aria-pressed', 'false');
  await loop.click();
  await expect(loop).toHaveAttribute('aria-pressed', 'true');

  const loops = async (): Promise<boolean> =>
    page.evaluate(() => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      const id = A.appState.activeTypoClipId;
      for (const t of A.store.project.tracks) {
        for (const c of t.clips) {
          if (c.id === id && c.source?.doc) return c.source.doc.elements[0]!.animations[0]!.iterations === Infinity;
        }
      }
      return false;
    });
  expect(await loops()).toBe(true);
  // 文档字段只是意图，真正生效的是计算样式。
  const count = await page
    .locator('.paper [data-anim-id]')
    .first()
    .evaluate((n) => getComputedStyle(n).animationIterationCount);
  expect(count).toBe('infinite');

  await loop.click();
  await expect(loop).toHaveAttribute('aria-pressed', 'false');
  expect(await loops()).toBe(false);
});

/**
 * 延迟只许算一遍。
 *
 * `delay` 已经写进 CSS 简写的 `animation-delay`（effect timing 的一部分），而
 * WAAPI 的 `currentTime` 时间轴**包含**它。seek 时再按 `localSec - delay` 换算
 * 就等于 2×delay —— 0.4s 才该开始的元素 0.8s 才动，且延迟期被 fill 停在首帧，
 * 不报错、不闪。这条断言读的是**舞台的计算 transform**（用户看到的那个）。
 *
 * 延迟取 0.4s 而不是秒级：`appState.seek()` 会把 t 夹进工程时长，而新建片段的
 * 起点在 demo 工程靠后处（2s 之后的时刻会被夹住，测出来的是夹取而不是求值）。
 */
test('动画延迟只算一遍：0.4s 起的轨道在 0.65s 已走一半（不是 1.05s）', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  /*
   * 造一条与手工拖出来同形的轨道：0.4s 有第一帧、0.9s 到末帧（delay = 0.4s）。
   * 走控制平面而不是直接改文档 —— `delay` / `duration` 由写入路径从 keys 派生，
   * 那正是被算两遍的值。
   */
  const { start } = await page.evaluate(async (id) => {
    const A = (window as never as {
      __artmatic: {
        store: {
          project: {
            tracks: {
              clips: { id: string; start: number; source?: { doc?: { elements: { id: string }[] } } }[];
            }[];
          };
        };
        control: {
          setTypographyAnimation: (
            clipId: string,
            elementId: string,
            input: unknown,
          ) => Promise<{ ok: boolean; error?: { message?: string } }>;
        };
      };
    }).__artmatic;
    let clip: { start: number; source?: { doc?: { elements: { id: string }[] } } } | undefined;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) if (c.id === id) clip = c;
    }
    const elementId = clip?.source?.doc?.elements[0]?.id;
    if (!clip || !elementId) throw new Error('当前排版文档里没有元素');
    const r = await A.control.setTypographyAnimation(id, elementId, {
      prop: 'y',
      keys: [
        { t: 0.4, v: 0 },
        { t: 0.9, v: -100 },
      ],
      easing: 'linear',
    });
    if (!r.ok) throw new Error(`typo_set_animation 失败：${r.error?.message ?? ''}`);
    return { start: clip.start };
  }, clipId);

  await expect(page.locator('.paper [data-anim-id]')).toHaveCount(1);

  /** seek 到片段内 localSec，读舞台上那层动画的 translateY。 */
  const translateYAt = (localSec: number): Promise<number> =>
    page.evaluate(
      ({ t }) =>
        new Promise<number>((resolve, reject) => {
          const A = (window as never as { __artmatic: { appState: { seek: (t: number) => void } } })
            .__artmatic;
          A.appState.seek(t);
          requestAnimationFrame(() => {
            const layer = document.querySelector<HTMLElement>('.paper [data-anim-id]');
            if (!layer) return reject(new Error('舞台上没有动画层'));
            const tf = getComputedStyle(layer).transform;
            resolve(tf === 'none' ? 0 : new DOMMatrixReadOnly(tf).m42);
          });
        }),
      { t: start + localSec },
    );

  // 延迟期停在首帧（fill: backwards）。
  expect(await translateYAt(0.35)).toBeCloseTo(0, 1);
  /*
   * 关键一条：延迟过半时必须**已经走了一半**。老实现再减一次 delay
   * （`currentTime = (localSec − delay)·1000`），这里会读到 0 —— 起点被推到 2×delay。
   */
  expect(await translateYAt(0.65)).toBeCloseTo(-50, 0);
  expect(await translateYAt(0.9)).toBeCloseTo(-100, 0);
  // 老实现「翻倍」后的落点：修复后必须早就是末帧。
  expect(await translateYAt(1.65)).toBeCloseTo(-100, 0);
});

/** 把播放头挪到「片段内第 sec 秒」。 */
async function seekLocal(page: Page, sec: number): Promise<void> {
  await page.evaluate(
    ({ s }) => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      const id = A.appState.activeTypoClipId;
      for (const t of A.store.project.tracks) {
        for (const c of t.clips) {
          if (c.id === id) {
            A.appState.seek(c.start + s);
            return;
          }
        }
      }
      throw new Error('找不到当前片段');
    },
    { s: sec },
  );
}

/** 舞台上那份动画样式表（`<style>` 的唯一注入点）。 */
function animSheet(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.paper style'))
      .map((s) => s.textContent ?? '')
      .join('\n'),
  );
}

/**
 * 动画预设图库：**在播放头处增量插入**，先前排好的关键帧一帧不丢。
 *
 * 旧实现是「按 (prop, target) 替换」—— 在 1s 处再加一个淡出会把 0~0.6s 的淡入
 * 整条删掉，而界面上只会看到「轨道还在、动画变了」。这条用例断两件事：
 * 轨道**没有变多**（同属性合并成一条，不是两条互相覆盖的动画），
 * 且旧的时刻 / 值原样留在前面。
 */
test('动画预设：在播放头增量插入，先前动画的关键帧一帧不丢', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  const span = await clipSpan(page);
  const dur = span.end - span.start;
  // 这条用例要在片段里放下两段 0.6s 的动画；片段变短了就该改这里而不是放宽断言。
  expect(dur, '新建排版片段太短，放不下两段动画').toBeGreaterThan(1.4);

  // 插入点就是播放头，所以先把播放头放到片段起点（打开编辑器时它在哪儿不确定）。
  await seekLocal(page, 0);
  await page.getByTestId('ribbon-tab-anim').click();
  // 图库是「示意图形 + 名字」的卡片，不是下拉。
  await page.getByTestId('typo-anim-preset').click();
  await expect(page.getByTestId('typo-anim-preset-pop')).toBeVisible();
  await page.getByTestId('typo-anim-preset-card-fade-in').click();
  await expect(page.getByTestId('typo-anim-preset-pop')).toHaveCount(0);

  await expect(page.getByTestId('typo-kf-track')).toHaveCount(1);
  let doc = await readDoc(page);
  expect(doc.elements[0]!.animations[0]!.keys!.map((k) => k.t)).toEqual([0, 0.6]);

  // 播放头挪到片段内 0.8s，再插一个淡出。
  await seekLocal(page, 0.8);
  await page.getByTestId('typo-anim-preset').click();
  await page.getByTestId('typo-anim-preset-card-fade-out').click();

  // 还是**一条** opacity 轨道（同一层里两条同属性动画会互相覆盖）。
  await expect(page.getByTestId('typo-kf-track')).toHaveCount(1);
  await expect(page.getByTestId('typo-kf-key')).toHaveCount(4);

  doc = await readDoc(page);
  const anim = doc.elements[0]!.animations[0]!;
  // 插入点 = 播放头绝对时间 − 片段起点，浮点余量取到毫秒。
  const times = anim.keys!.map((k) => Math.round(k.t * 1000) / 1000);
  expect(times).toEqual([0, 0.6, 0.8, 1.4]);
  expect(anim.keys!.map((k) => k.v)).toEqual([0, 1, 1, 0]);
  // 先前那一段（0 → 0.6）逐字未动 —— 这就是「增量插入」的判据。
  expect(anim.keys!.slice(0, 2).map((k) => k.v)).toEqual([0, 1]);
});

/**
 * 关键帧**标记色**：只给编辑器做记号，**不影响动画**。
 *
 * 断言两半：文档里存了颜色、轨道上的菱形真的换了填充（DOM 表现，不是只改了数据），
 * 而动画样式表**逐字没变** —— 它一旦混进 CSS，「标记色」就变成了改画面。
 */
test('关键帧标记色：只做记号，不动动画', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);
  await page.getByTestId('typo-kf-add-prop').click();

  const before = await animSheet(page);

  // 选中一帧 → 顶栏出现取色入口（没有选中帧时它不该占位置）。
  await page.getByTestId('typo-kf-key').first().click();
  await expect(page.getByTestId('typo-kf-key-color')).toBeVisible();
  await page.getByTestId('typo-kf-key-color').click();

  const swatch = page.locator('[data-testid^="typo-kf-key-color-palette-std-"]').first();
  const hex = (await swatch.getAttribute('data-testid'))!.split('-std-')[1]!;
  await swatch.click();

  const doc = await readDoc(page);
  expect(doc.elements[0]!.animations[0]!.keys![0]!.color).toBe(`#${hex}`);
  // 菱形真的换了填充色（只改文档不改 DOM 的话，用户什么都看不见）。
  await expect(page.getByTestId('typo-kf-key').first()).toHaveAttribute('style', /--key-c/);
  // 动画本身一个字都没动。
  expect(await animSheet(page)).toBe(before);

  // 一笔撤销退回无标记。
  await page.keyboard.press('Control+z');
  expect((await readDoc(page)).elements[0]!.animations[0]!.keys![0]!.color).toBeUndefined();
});
