import { expect, test, type Page } from '@playwright/test';
import { buildStage, openDemo } from './_stage';

/**
 * 关键帧曲线编辑器（0.3 W3）。
 *
 * 这里守的是**界面与手势的接线**：呼出入口、插值切换真的写进 Project、
 * 贝塞尔手柄拖得动且一笔撤销、参数表能给没有曲线的参数新建曲线。
 * 求值本身的数值在 `tests/unit/curve.test.ts`；坐标映射在
 * `curve-geometry.test.ts` —— 三层各管一段，不重复堆同一条断言。
 *
 * 「改了插值，求值变了吗」用的是**检查器里那个数字框**（它读 `evalCurve`），
 * 不是读像素、也不是在测试里重算一遍：后者等于用测试证明测试。
 */

type Api = {
  __artmatic: {
    appState: {
      seek: (t: number) => void;
      drawerOpen: boolean;
      selectedClipId: string | null;
      selectClip: (id: string) => void;
    };
    store: {
      findClip: (id: string) => { clip: ClipView } | null;
    };
  };
};

interface ClipView {
  start: number;
  end: number;
  curves: Record<string, { keys: { t: number; v: number; interp: string; hOut?: [number, number]; hIn?: [number, number] }[] }>;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as never as Api).__artmatic));
  await openDemo(page);
}

async function stageWithCurve(page: Page, curve: ClipView['curves'] | null = null): Promise<void> {
  await buildStage(page, {
    id: 'curve-src',
    source: { type: 'solid', color: '#ffffff' },
    start: 0,
    end: 4,
    curves: curve ?? {},
  });
  await page.locator('[data-clip-id="curve-src"]').click();
  await page.evaluate(() => {
    const A = (window as never as Api).__artmatic;
    A.appState.drawerOpen = true;
    A.appState.seek(1);
  });
}

/** 读整条曲线（经 store，不是 UI 快照）。 */
const readCurve = (page: Page, key = 'opacity') =>
  page.evaluate((k) => {
    const A = (window as never as Api).__artmatic;
    return A.store.findClip('curve-src')?.clip.curves[k]?.keys ?? null;
  }, key);

/** 检查器里「不透明度」那一行的数字框（它的值就是 evalCurve 的结果）。 */
function opacityInput(page: Page) {
  return page
    .locator('[data-testid=param-row]')
    .filter({ hasText: '不透明度' })
    .locator('input')
    .first();
}

const LINEAR_CURVE = {
  opacity: {
    keys: [
      { t: 0, v: 0.2, interp: 'linear' },
      { t: 2, v: 0.8, interp: 'linear' },
    ],
  },
};

test('K 呼出编辑器；linear → step 让中点求值等于前一个键', async ({ page }) => {
  await boot(page);
  await stageWithCurve(page, LINEAR_CURVE);

  const input = opacityInput(page);
  await expect(input).toBeVisible();
  // 0→0.2、2→0.8，播放头在 1s：linear 中点 0.5
  await expect.poll(async () => Number(await input.inputValue())).toBeCloseTo(0.5, 2);

  await page.keyboard.press('k');
  const editor = page.getByTestId('curve-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('curve-node')).toHaveCount(2);

  await page.locator('[data-testid=curve-node][data-key-index="0"]').click();
  await page.getByTestId('curve-interp-step').click();

  await expect.poll(async () => (await readCurve(page))![0]!.interp).toBe('step');
  // step 在中点保持左值 —— 与 linear 的 0.5 明显不同
  await expect.poll(async () => Number(await input.inputValue())).toBeCloseTo(0.2, 2);
});

test('贝塞尔：切过去就补手柄；拖手柄是一笔撤销', async ({ page }) => {
  await boot(page);
  await stageWithCurve(page, LINEAR_CURVE);
  await page.keyboard.press('k');
  await page.locator('[data-testid=curve-node][data-key-index="0"]').click();
  await page.getByTestId('curve-interp-bezier').click();

  await expect.poll(async () => (await readCurve(page))![0]!.hOut !== undefined).toBe(true);
  const before = (await readCurve(page))!;
  expect(before[0]!.hOut).toBeDefined();
  expect(before[1]!.hIn).toBeDefined();

  const handle = page.getByTestId('curve-handle-out');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);

  const after = (await readCurve(page))!;
  expect(after[0]!.hOut![0]).toBeGreaterThan(before[0]!.hOut![0]);
  expect(after[0]!.hOut![1]).toBeGreaterThan(before[0]!.hOut![1]);

  // 手柄必须跟着手指走（原地改对象 + `$derived` 的 === 判等曾让它不动）
  const movedBox = (await handle.boundingBox())!;
  expect(movedBox.x).toBeGreaterThan(box.x + 10);

  // 整段拖动 = 一条撤销记录
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  const undone = (await readCurve(page))!;
  expect(undone[0]!.hOut![0]).toBeCloseTo(before[0]!.hOut![0], 6);
  expect(undone[0]!.hOut![1]).toBeCloseTo(before[0]!.hOut![1], 6);
});

test('拖关键帧一笔撤销；Shift 加选后批量改插值', async ({ page }) => {
  await boot(page);
  await stageWithCurve(page, LINEAR_CURVE);
  await page.keyboard.press('k');

  const node = page.locator('[data-testid=curve-node][data-key-index="1"]');
  const box = (await node.boundingBox())!;
  const before = (await readCurve(page))!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 - 20, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);

  const after = (await readCurve(page))!;
  expect(after[1]!.t).toBeGreaterThan(before[1]!.t);
  expect(after[1]!.v).toBeGreaterThan(before[1]!.v);
  // 底部数字框读的是同一个原地改的 key —— 必须实时更新
  await expect
    .poll(async () => Number(await page.getByTestId('curve-key-time').inputValue()))
    .toBeCloseTo(after[1]!.t, 2);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(80);
  const undone = (await readCurve(page))!;
  expect(undone[1]!.t).toBeCloseTo(before[1]!.t, 2);
  expect(undone[1]!.v).toBeCloseTo(before[1]!.v, 2);

  // Shift 加选两个，再点一次「平滑」= 一批写入（两段都换插值）
  await page.locator('[data-testid=curve-node][data-key-index="0"]').click();
  await page.locator('[data-testid=curve-node][data-key-index="1"]').click({ modifiers: ['Shift'] });
  await page.getByTestId('curve-interp-smooth').click();
  await expect
    .poll(async () => (await readCurve(page))!.slice(0, 2).map((k) => k.interp).join(','))
    .toBe('smooth,smooth');
});

test('多开 / 侧栏折叠 / 缩放 / 阴影 / 片段迷你曲线', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'curve-a',
    source: { type: 'solid', color: '#3a6ea5' },
    start: 0,
    end: 4,
    curves: LINEAR_CURVE,
  });
  await buildStage(page, {
    id: 'curve-b',
    source: { type: 'solid', color: '#a53a6e' },
    start: 5,
    end: 9,
    curves: {
      'transform.x': {
        keys: [
          { t: 0, v: 0.2, interp: 'linear' },
          { t: 2, v: 0.8, interp: 'linear' },
        ],
      },
    },
  });

  await page.evaluate(() => {
    const A = (window as never as Api).__artmatic;
    A.appState.drawerOpen = true;
    A.appState.selectClip('curve-a');
  });
  await page.keyboard.press('k');
  await expect(page.locator('[data-curve-clip="curve-a"]')).toBeVisible();

  // 从检查器给另一个片段开第二个面板
  await page.evaluate(() => (window as never as Api).__artmatic.appState.selectClip('curve-b'));
  await page.getByTestId('curve-open').first().click();
  await expect(page.locator('[data-curve-clip="curve-b"]')).toBeVisible();
  await expect(page.getByTestId('curve-editor')).toHaveCount(2);

  // Esc 只关当前面板（B），不能把 A 一起关掉
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('curve-editor')).toHaveCount(1);
  await expect(page.locator('[data-curve-clip="curve-a"]')).toBeVisible();
  const panel = page.locator('[data-curve-clip="curve-a"]');

  expect(await panel.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');

  const graphBefore = (await panel.getByTestId('curve-graph').boundingBox())!;
  await panel.getByTestId('curve-toggle-sidebar').click();
  await expect(panel.getByTestId('curve-param-list')).toHaveCount(0);
  const graphAfter = (await panel.getByTestId('curve-graph').boundingBox())!;
  expect(graphAfter.width).toBeGreaterThan(graphBefore.width);
  await panel.getByTestId('curve-toggle-sidebar').click();
  await expect(panel.getByTestId('curve-param-list')).toBeVisible();

  const before = (await panel.boundingBox())!;
  const grip = (await panel.getByTestId('curve-resize').boundingBox())!;
  await page.mouse.move(grip.x + 8, grip.y + 8);
  await page.mouse.down();
  await page.mouse.move(grip.x + 88, grip.y + 58, { steps: 8 });
  await page.mouse.up();
  const after = (await panel.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 40);
  expect(after.height).toBeGreaterThan(before.height + 20);

  await panel.getByTestId('curve-close').click();
  // 退出编辑器后，片段上画的仍是刚才那条属性曲线
  await expect(
    page.locator('[data-clip-id="curve-a"] [data-testid=clip-curve-preview]'),
  ).toHaveAttribute('data-curve-key', 'opacity');
  await expect(
    page.locator('[data-clip-id="curve-b"] [data-testid=clip-curve-preview]'),
  ).toHaveAttribute('data-curve-key', 'transform.x');

  // 从片段右键重新打开时，显示的必须是片段上画的那条属性
  await page.locator('[data-clip-id="curve-a"]').click({ button: 'right' });
  await page.getByTestId('ctx-edit-curves').click();
  const reopened = page.locator('[data-curve-clip="curve-a"]');
  await expect(reopened).toBeVisible();
  expect(
    await reopened.locator('[data-curve-key="opacity"]').evaluate((el) => el.classList.contains('on')),
  ).toBe(true);
});

test('图内左键新增关键帧、双击关键帧删除', async ({ page }) => {
  await boot(page);
  await stageWithCurve(page, LINEAR_CURVE);
  await page.keyboard.press('k');

  const graph = (await page.getByTestId('curve-graph').boundingBox())!;
  await page.mouse.click(graph.x + graph.width * 0.7, graph.y + graph.height * 0.35);
  await expect.poll(async () => (await readCurve(page))?.length ?? 0).toBe(3);

  const keys = (await readCurve(page))!;
  const index = keys.findIndex((k) => k.t > 2.5);
  expect(index).toBeGreaterThanOrEqual(0);
  await page.locator(`[data-testid=curve-node][data-key-index="${index}"]`).dblclick();
  await expect.poll(async () => (await readCurve(page))?.length ?? 0).toBe(2);
});

test('右键片段进入；参数表能给没有关键帧的参数新建曲线', async ({ page }) => {
  await boot(page);
  await stageWithCurve(page);

  // 空曲线的片段：右键菜单里仍然有入口（编辑器自己给新建路径）
  await page.locator('[data-clip-id="curve-src"]').click({ button: 'right' });
  const item = page.getByTestId('ctx-edit-curves');
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByTestId('curve-editor')).toBeVisible();
  await expect(page.getByTestId('curve-node')).toHaveCount(0);

  await page.locator('[data-curve-key="opacity"]').click();
  await expect.poll(async () => (await readCurve(page))?.length ?? 0).toBe(1);
  await expect(page.getByTestId('curve-node')).toHaveCount(1);

  // 新建的第一个 key 在播放头处、值取当前基值（不透明度 1）
  const keys = (await readCurve(page))!;
  expect(keys[0]!.t).toBeCloseTo(1, 2);
  expect(keys[0]!.v).toBeCloseTo(1, 2);
});
