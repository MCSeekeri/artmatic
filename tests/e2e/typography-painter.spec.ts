import { expect, test, type Page } from '@playwright/test';
import { addTextClip, openDemo } from './_stage';

/**
 * 格式刷 / 动画刷（「开始」与「动画」选项卡最左侧）。
 *
 * 守四件事，它们都只在**手势层**才看得出来：
 *  1. 单击 = 刷一个然后自动收起；
 *  2. **双击 = 连续刷**（刷完继续等下一个）；再点一下按钮才收起；
 *  3. 点空白 = 取消（与再点一下按钮同一个结局）；
 *  4. 刷子开着时选择框不吞点击（否则源元素盖住目标就永远刷不到）。
 *
 * 元素的初始外观用 `store.commit` 直接摆（**这不是被测行为**）：靠 Ribbon 的
 * 取色器把两个元素调成不同颜色会把这条用例变成「测取色器」。
 */

interface ElShape {
  id: string;
  kind: string;
  fill?: { kind: string; color?: string };
  stroke?: { color?: string; width?: number } | null;
  radius?: number;
  animations?: { id: string; prop?: string }[];
}

interface Hooks {
  store: {
    commit: (label: string, fn: (p: never) => void) => void;
    project: {
      tracks: {
        clips: {
          id: string;
          source?: { type?: string; doc?: { elements: ElShape[] } };
        }[];
      }[];
    };
  };
  appState: { activeTypoClipId: string | null };
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

async function insertShape(page: Page, key: string): Promise<void> {
  await page.getByTestId('ribbon-tab-insert').click();
  await page.getByTestId('typo-shape').click();
  await page.getByTestId(`typo-shape-card-${key}`).click();
}

async function docEls(page: Page): Promise<ElShape[]> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    const id = A.appState.activeTypoClipId;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === id && c.source?.doc) return c.source.doc.elements;
      }
    }
    return [];
  });
}

/** 摆初始外观（测试前置，不经过 Ribbon）。 */
async function setEl(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ id, patch }) => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      const clipId = A.appState.activeTypoClipId;
      A.store.commit('e2e: setup', (p) => {
        const project = p as unknown as Hooks['store']['project'];
        for (const t of project.tracks) {
          for (const c of t.clips) {
            if (c.id !== clipId || !c.source?.doc) continue;
            const el = c.source.doc.elements.find((e) => e.id === id);
            if (el) Object.assign(el, patch);
          }
        }
      });
    },
    { id, patch },
  );
}

/** 元素在舞台上的中心点。 */
async function centerOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator(`.paper [data-el-id="${id}"]`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 点空白处（画布左上角外面那圈 padding 里）。 */
async function clickEmpty(page: Page): Promise<void> {
  const stage = (await page.getByTestId('typo-stage').boundingBox())!;
  await page.mouse.click(stage.x + 6, stage.y + 6);
}

/**
 * 造「源（红底 + 绿虚线描边 + 圆角）+ N 个蓝底目标」，各自错开位置。
 * 返回全部 id（第一个是源）。
 */
async function makeStage(page: Page, targets: number): Promise<string[]> {
  const ids: string[] = [];
  await insertShape(page, 'rect');
  ids.push((await docEls(page)).at(-1)!.id);
  await setEl(page, ids[0]!, {
    frame: { x: 80, y: 100, w: 300, h: 260, rot: 0 },
    fill: { kind: 'solid', color: '#ff0000' },
    stroke: { color: '#00ff00', width: 8, style: 'dashed' },
    radius: 24,
  });
  for (let i = 0; i < targets; i++) {
    await insertShape(page, 'rect');
    const id = (await docEls(page)).at(-1)!.id;
    ids.push(id);
    await setEl(page, id, {
      frame: { x: 520 + i * 420, y: 100, w: 300, h: 260, rot: 0 },
      fill: { kind: 'solid', color: '#0000ff' },
      stroke: null,
      radius: 0,
    });
  }
  return ids;
}

test('格式刷（单击）：刷一个就收起，结果一笔撤销', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  const [src, tgt] = await makeStage(page, 1);

  // 选中源 → 「开始」页最左侧的格式刷
  await page.getByTestId('ribbon-tab-home').click();
  const p1 = await centerOf(page, src!);
  await page.mouse.click(p1.x, p1.y);
  const brush = page.getByTestId('typo-format-painter');
  await brush.click();
  await expect(brush).toHaveAttribute('aria-pressed', 'true');

  // 点目标：填充 / 描边 / 圆角都刷过去
  const p2 = await centerOf(page, tgt!);
  await page.mouse.click(p2.x, p2.y);
  const painted = (await docEls(page)).find((e) => e.id === tgt)!;
  expect(painted.fill).toMatchObject({ kind: 'solid', color: '#ff0000' });
  expect(painted.stroke).toMatchObject({ color: '#00ff00', width: 8 });
  expect(painted.radius).toBe(24);

  // 单击模式：刷完自动收起
  await expect(brush).toHaveAttribute('aria-pressed', 'false');

  // 一笔撤销回到刷之前
  await page.keyboard.press('Control+z');
  const back = (await docEls(page)).find((e) => e.id === tgt)!;
  expect(back.fill).toMatchObject({ kind: 'solid', color: '#0000ff' });
  expect(back.radius).toBe(0);
});

test('格式刷（双击）：连续刷多个，再点按钮才收起', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  const [src, a, b, c] = await makeStage(page, 3);

  await page.getByTestId('ribbon-tab-home').click();
  const ps = await centerOf(page, src!);
  await page.mouse.click(ps.x, ps.y);
  const brush = page.getByTestId('typo-format-painter');
  // 双击 = 连续模式。两次 click 会先开关一遍，dblclick 再把它落成 sticky。
  await brush.dblclick();
  await expect(brush).toHaveAttribute('aria-pressed', 'true');

  for (const id of [a!, b!]) {
    const p = await centerOf(page, id);
    await page.mouse.click(p.x, p.y);
    const el = (await docEls(page)).find((e) => e.id === id)!;
    expect(el.fill).toMatchObject({ kind: 'solid', color: '#ff0000' });
    // 刷完一个还开着
    await expect(brush).toHaveAttribute('aria-pressed', 'true');
  }

  // 再点一下 = 收起；之后的点击不再刷
  await brush.click();
  await expect(brush).toHaveAttribute('aria-pressed', 'false');
  const pc = await centerOf(page, c!);
  await page.mouse.click(pc.x, pc.y);
  expect((await docEls(page)).find((e) => e.id === c)!.fill).toMatchObject({
    kind: 'solid',
    color: '#0000ff',
  });
});

test('点空白处取消刷子（与再点一下按钮同一个结局）', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  const [src, tgt] = await makeStage(page, 1);

  await page.getByTestId('ribbon-tab-home').click();
  const ps = await centerOf(page, src!);
  await page.mouse.click(ps.x, ps.y);
  const brush = page.getByTestId('typo-format-painter');
  await brush.click();
  await expect(brush).toHaveAttribute('aria-pressed', 'true');

  await clickEmpty(page);
  await expect(brush).toHaveAttribute('aria-pressed', 'false');
  // 取消之后点目标只是普通选择，不改外观
  const pt = await centerOf(page, tgt!);
  await page.mouse.click(pt.x, pt.y);
  expect((await docEls(page)).find((e) => e.id === tgt)!.fill).toMatchObject({
    kind: 'solid',
    color: '#0000ff',
  });
});

test('动画刷：把源元素的动画整份刷给目标（不动它的填充）', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  const [src, tgt] = await makeStage(page, 1);

  // 给源加一条 fade-in（走 Ribbon 的真实路径）
  const ps = await centerOf(page, src!);
  await page.mouse.click(ps.x, ps.y);
  await page.getByTestId('ribbon-tab-anim').click();
  await page.getByTestId('typo-anim-preset').click();
  await page.getByTestId('typo-anim-option-fade-in').click();
  await expect(page.getByTestId('typo-kf-track')).toHaveCount(1);

  // 动画刷在「动画」页最左侧
  const brush = page.getByTestId('typo-anim-painter');
  await brush.click();
  await expect(brush).toHaveAttribute('aria-pressed', 'true');
  const pt = await centerOf(page, tgt!);
  await page.mouse.click(pt.x, pt.y);

  const els = await docEls(page);
  const a = els.find((e) => e.id === src)!.animations ?? [];
  const b = els.find((e) => e.id === tgt)!.animations ?? [];
  expect(a).toHaveLength(1);
  expect(b).toHaveLength(1);
  expect(b[0]!.prop).toBe(a[0]!.prop);
  // 重新发号：两条动画必须各有自己的 id（否则 CSS 规则绑成一份）
  expect(b[0]!.id).not.toBe(a[0]!.id);
  // 舞台上有两层动画节点（各自一套 `[data-anim-id]`）
  await expect(page.locator('.paper [data-anim-id]')).toHaveCount(2);
  // 动画刷不碰外观
  expect(els.find((e) => e.id === tgt)!.fill).toMatchObject({ kind: 'solid', color: '#0000ff' });
});
