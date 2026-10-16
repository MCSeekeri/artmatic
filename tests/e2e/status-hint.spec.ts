import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';
import { zhCN } from '../../src/i18n/locales/zh-CN';

/**
 * 底栏提示（StatusBar 的提示段）。
 *
 * 这一段的三条契约（改造理由见 `src/ui/hints.ts` 的文件头）：
 *
 *   1. 有气泡的控件**不进底栏** —— 悬停一个带 tooltip 的控件时，底栏不该出现
 *      和气泡一样的文字（原来它俩共用一份文案，同一句话在屏幕上出现两次）。
 *   2. 没气泡的目标（片段 / 标尺 / 轨道行）与「下一步做什么」才是底栏的活。
 *      「空时间轴 → 右键新建片段」就是 Blender 在空场景里报 Shift+A 的那个位置。
 *   3. 手势期间（框选 / 拖片段）报的是「松开会怎样、Esc 会怎样」，松手即清。
 *
 * 判定逻辑本身在 `tests/unit/hints.test.ts` 里逐条钉着；这里只守**接线**：
 * 纯函数算得再对，`data-hint` 写错一个字母、事件委托挂错一层，界面就是空白。
 *
 * ⚠️ 打开示例工程是异步的（生成音频 → 解码 → 波形 → 拍网格），中途会闪一次性
 * 提示（优先级最高，**会把提示段整个顶掉**）。所以下面读提示段的断言一律走
 * `toPass` 重试，而不是「读一次就判」。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

/** 底栏提示段的文字（说明句 + 全部角标拼在一起，断言只关心「有没有说这件事」）。 */
async function statusText(page: Page): Promise<string> {
  return (await page.getByTestId('statusbar').innerText()).replace(/\s+/g, ' ');
}

/** 底栏里键位角标的文字列表（`<kbd>` + 紧跟的说明）。 */
async function keyChips(page: Page): Promise<string[]> {
  return (await page.getByTestId('statusbar-keys').allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
}

/** 断言底栏文字，允许一次性提示先过去（见文件头）。 */
async function expectStatus(page: Page, check: (text: string) => void): Promise<void> {
  await expect(async () => check(await statusText(page))).toPass({ timeout: 10_000 });
}

/**
 * 把指针移到时间轴之外。
 *
 * 不能省：`openDemo` 点的那颗「打开示例工程」按钮就在屏幕中间 —— 遮罩一消失，
 * 指针底下正好是**标尺**（浏览器会补发一次 pointerover）。那条悬停提示会压过
 * 场景层，于是「空时间轴该报什么」永远量不到。
 */
async function moveOffTimeline(page: Page): Promise<void> {
  const bar = (await page.getByTestId('statusbar').boundingBox())!;
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
}

/** 往工程末尾加一条空白轨 + 一个 [0,2s] 的纯色片段（框选用例需要一块确定的空地）。 */
async function addSoloClip(page: Page): Promise<void> {
  await page.evaluate(() => {
    const A = (
      window as never as {
        __artmatic: {
          store: { addTrack: (kind: 'visual') => string; addClip: (t: string, c: unknown) => void };
        };
      }
    ).__artmatic;
    const track = A.store.addTrack('visual');
    A.store.addClip(track, {
      kind: 'source',
      id: 'e2e-hint',
      start: 0,
      end: 2,
      label: 'e2e-hint',
      fadeSec: 0,
      curves: {},
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
      source: { type: 'solid', color: '#336699' },
      blend: 'normal',
      opacity: 1,
    });
  });
}

/* --------------------------------------------- ① 悬停控件不改变底栏 */

test('悬停带 tooltip 的控件：气泡照旧，那句话**不在**底栏里', async ({ page }) => {
  await boot(page);

  // 工程时长那段是一句长文案（见 preview-toolbar.spec）——正是原来会被抄进底栏的那种。
  const durationCtl = page.locator('.transport .ctl').filter({ has: page.getByTestId('duration-input') });
  await durationCtl.scrollIntoViewIfNeeded();
  await durationCtl.hover();

  const bubble = page.getByTestId('tip-bubble');
  await expect(bubble).toBeVisible();
  const bubbleText = (await bubble.innerText()).replace(/\s+/g, ' ').trim();

  // 这条不依赖上下文（一次性提示出现与否都成立）：气泡里那句话没有出现在底栏里。
  await expect(page.getByTestId('statusbar')).not.toContainText(bubbleText);
});

/* --------------------------------------------- ② 悬停片段 / 选中片段 */

test('悬停片段报「片段能做什么」，选中之后换成本地快捷键', async ({ page }) => {
  await boot(page);
  const clip = page.getByTestId('clip').first();

  await clip.hover();
  await expectStatus(page, (text) => {
    expect(text).toContain(zhCN['sc.moveClip']);
    expect(text).toContain(zhCN['sc.openClipEditor']);
    // 没选中时不能报 F2 / S / Del —— 它们作用于选中集，说了就是假话
    expect(text).not.toContain(zhCN['sc.renameClip']);
  });

  // 点一下（不移动）：选中的还是它，指针也还在它上面
  await clip.click();
  await expectStatus(page, (text) => {
    expect(text).toContain(zhCN['sc.renameClip']);
    expect(text).toContain(zhCN['sc.deleteClip']);
  });
  expect(await keyChips(page)).toContain(`${zhCN['sc.key.renameClip']} ${zhCN['sc.renameClip']}`);

  // 四枚角标（这是最长的一条提示）必须真的放得下：底栏只有一行，右边还压着 fps
  // 与播放时间。被挤掉时 `overflow: hidden` 会**静默**切掉半截说明。
  const clipped = await page.getByTestId('statusbar-keys').evaluateAll((els) =>
    els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
  );
  expect(clipped, '有角标被挤掉了').toEqual([]);
});

/* ------------------------------------------------- ③ 空时间轴 */

test('空时间轴：底栏报到新建片段的入口（「下一步做什么」）', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const A = (
      window as never as {
        __artmatic: {
          store: { commit: (label: string, fn: (p: { tracks: { clips: unknown[] }[] }) => void) => void };
          appState: { selectedClipIds: string[] };
        };
      }
    ).__artmatic;
    A.appState.selectedClipIds = [];
    A.store.commit('e2e: 清空片段', (p) => {
      for (const t of p.tracks) t.clips = [];
    });
  });
  await moveOffTimeline(page);

  await expectStatus(page, (text) => {
    expect(text).toContain(zhCN['sc.newClipAtCursor']);
    // 空时间轴上没有东西可选中，不能报删除 / 切分
    expect(text).not.toContain(zhCN['sc.deleteClip']);
  });
  expect(await keyChips(page)).toContain(`${zhCN['sc.key.rightClick']} ${zhCN['sc.newClipAtCursor']}`);
});

/* ------------------------------------------------- ④ 手势：框选 */

test('框选期间报计数、松手即清（手势层压过其余层）', async ({ page }) => {
  await boot(page);
  await addSoloClip(page);

  /*
   * 用行里那个片段反查它的行（不能用 `.last()`）：`addTrack` 是 push，
   * 新轨道落在列表末尾，而它很可能**在可视区之外**（轨道区高度有限）——
   * 那样的坐标上按下鼠标，事件根本落不到行上。
   */
  const row = page.locator('[data-testid=tl-row]').filter({
    has: page.locator('[data-clip-id="e2e-hint"]'),
  });
  await expect(row).toHaveCount(1);
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;

  // 起手必须落在**空白处**（落在片段上起的是片段拖拽，不是框选）：
  // 片段占 [0,2s] ≈ 112px，所以从 300px 往左拖。
  await page.mouse.move(box.x + 300, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, y, { steps: 8 });

  await expect(page.getByTestId('statusbar-hint')).toHaveText(zhCN['hint.marquee'].replace('{n}', '1'));
  expect(await keyChips(page)).toContain(`${zhCN['sc.key.esc']} ${zhCN['hint.cancel']}`);

  await page.mouse.up();

  // 松手：手势层清掉，底栏接回上下文。指针停的 x+20 正好在片段上 →
  // 报的是**选中片段**能做什么（框选把它选上了）。
  await expectStatus(page, (text) => {
    expect(text).not.toContain(zhCN['hint.cancel']);
    expect(text).toContain(zhCN['sc.renameClip']);
  });

  // 指针移到同一行的**空白处** → 换行空白那一层（框选 / 新建 / 拖入文件）
  await page.mouse.move(box.x + 400, y);
  await expectStatus(page, (text) => expect(text).toContain(zhCN['hint.marqueeClips']));

  // 指针移开时间轴 → 场景层：刚框出来的那一个还选中着
  await moveOffTimeline(page);
  await expectStatus(page, (text) => expect(text).toContain(zhCN['sc.renameClip']));
});
