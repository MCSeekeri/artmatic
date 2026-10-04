import { expect, test, type Page } from '@playwright/test';

/**
 * M4 排版：编辑器页宿主的生命周期与交互。
 *
 * 走**真实手势**（page.mouse / page.keyboard）而不是直接调 store ——
 * 分页、命中测试、事务结算这些问题全在手势层，直接调 store 会把它们整个绕过去。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

interface Hooks {
  store: {
    project: {
      tracks: {
        id: string;
        clips: { id: string; start: number; end: number; source?: { type?: string; doc?: DocShape } }[];
      }[];
    };
  };
  renderer: {
    renderFrame: (p: unknown, t: number) => void;
    readPixels: () => { data: Uint8Array; w: number; h: number };
    kit: { gl: WebGL2RenderingContext };
  };
  appState: { playT: number };
  renderFrame: (t: number) => void;
}

interface DocShape {
  size: { w: number; h: number };
  elements: { id: string; frame: { x: number; y: number; w: number; h: number; rot: number } }[];
}

/**
 * 取**当前正在编辑**的那个排版片段。
 *
 * 不能再用「工程里第一个 text 片段」：开箱 demo 自己就带一个标题排版片段，
 * 于是「第一个」永远是 demo 的，新加的那个根本读不到 ——
 * 拖拽用例会表现成「元素纹丝不动」，而真因完全指不到这里。
 * 编辑页有 `activeTypoClipId`，直接用它。
 */
async function readGeom(page: Page) {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks & { appState: { activeTypoClipId: string | null } } })
      .__artmatic;
    const id = A.appState.activeTypoClipId;
    let doc: DocShape | null = null;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === id && c.source?.type === 'text' && c.source.doc) doc = c.source.doc;
      }
    }
    if (!doc) throw new Error(`找不到当前编辑的排版文档（activeTypoClipId=${id}）`);
    const wrap = document.querySelector('.paper-wrap')!.getBoundingClientRect();
    const zoom = wrap.width / doc.size.w;
    const f = doc.elements[0]!.frame;
    return { zoom, left: wrap.left, top: wrap.top, frame: { ...f } };
  });
}

/** 读回第一个元素的 frame.x。 */
async function readFrameX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks & { appState: { activeTypoClipId: string | null } } })
      .__artmatic;
    const id = A.appState.activeTypoClipId;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === id && c.source?.type === 'text' && c.source.doc) return c.source.doc.elements[0]!.frame.x;
      }
    }
    throw new Error(`找不到当前编辑的排版文档（activeTypoClipId=${id}）`);
  });
}

/** 工程里全部排版片段的 id。 */
async function textClipIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    const out: string[] = [];
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) if (c.source?.type === 'text') out.push(c.id);
    }
    return out;
  });
}

/** 通过轨道 ⋯ 菜单新建一个排版片段，返回它的 id（= 差集里多出来的那一个）。 */
async function addTextClip(page: Page): Promise<string> {
  const before = await textClipIds(page);
  await page.locator('[data-testid=track-side-row]').nth(0).getByTestId('track-menu').click();
  await page.getByTestId('add-text').click();
  const added = (await textClipIds(page)).filter((id) => !before.includes(id));
  expect(added, '「+ 排版片段」没有新增片段（落点可能被重叠策略挡了）').toHaveLength(1);
  return added[0]!;
}

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

test('双击排版片段打开编辑页；关闭后回到时间轴', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);

  // 双击 = 打开（不再是切分）
  await openEditor(page, clipId);
  // 排版视图不是独立的 tab —— 顶栏的 tab 是工程，这里出现的是「回到时间轴」。
  await expect(page.getByTestId('project-tab-timeline-0')).toBeVisible();

  // 主界面只是被隐藏，没有卸载
  await expect(page.getByTestId('tl-scroll')).toBeHidden();

  // 回到时间轴
  await page.getByTestId('project-tab-timeline-0').click();
  await expect(page.getByTestId('typo-editor')).toHaveCount(0);
  await expect(page.getByTestId('tl-scroll')).toBeVisible();
});

test('切页不丢 WebGL 上下文，也不动播放头', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);

  const before = await page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    A.appState.playT = 3.25;
    return A.appState.playT;
  });

  await openEditor(page, clipId);
  await page.getByTestId('project-tab-timeline-0').click();
  await expect(page.getByTestId('tl-scroll')).toBeVisible();

  const after = await page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    // 这是本用例的核心：切页若卸载了 <canvas>，上下文会丢，
    // kit 里所有 Program / Target / 纹理一起失效，且无法恢复。
    const lost = A.renderer.kit.gl.isContextLost();
    A.renderer.renderFrame(A.store.project, A.appState.playT);
    const px = A.renderer.readPixels();
    let ink = 0;
    for (let i = 0; i < px.data.length; i += 4) if (px.data[i]! > 8) ink += 1;
    return { lost, ink, playT: A.appState.playT };
  });

  expect(after.lost).toBe(false);
  expect(after.ink).toBeGreaterThan(0); // demo 有四层画面，不该是全黑
  expect(after.playT).toBe(before);
});

test('编辑器里拖拽元素：落库、可撤销、且是一笔', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  const geom = await readGeom(page);

  const startX = geom.left + (geom.frame.x + geom.frame.w / 2) * geom.zoom;
  const startY = geom.top + (geom.frame.y + geom.frame.h / 2) * geom.zoom;
  const dxDoc = 200;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dxDoc * geom.zoom, startY, { steps: 12 });
  await page.mouse.up();

  const moved = await readFrameX(page);
  expect(Math.abs(moved - (geom.frame.x + dxDoc))).toBeLessThan(3);

  // 整段拖拽应当是**一笔**撤销，而不是几十笔逐帧记录
  await page.keyboard.press('Control+z');
  const restored = await readFrameX(page);
  expect(Math.abs(restored - geom.frame.x)).toBeLessThan(0.001);
});

test('按住 Alt 可临时关吸附', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  const geom = await readGeom(page);

  const startX = geom.left + (geom.frame.x + geom.frame.w / 2) * geom.zoom;
  const startY = geom.top + (geom.frame.y + geom.frame.h / 2) * geom.zoom;

  await page.keyboard.down('Alt');
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 只挪 4 文档像素：开着吸附时这点距离会被拉回对齐位置，关了才留得住。
  await page.mouse.move(startX + 4 * geom.zoom, startY, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');

  const moved = await readFrameX(page);
  expect(Math.abs(moved - (geom.frame.x + 4))).toBeLessThan(1.5);
});

test('时间轴快捷键在编辑页失效（S 不切分、Alt+↑↓ 不移轨）', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);

  const snapshot = (id: string) => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    const all: { i: number; j: number; start: number; end: number }[] = [];
    for (let i = 0; i < A.store.project.tracks.length; i++) {
      const t = A.store.project.tracks[i]!;
      for (let j = 0; j < t.clips.length; j++) {
        const c = t.clips[j]!;
        if (c.id === id) all.push({ i, j, start: c.start, end: c.end });
      }
    }
    let total = 0;
    for (const t of A.store.project.tracks) total += t.clips.length;
    return { self: all, total };
  };

  const before = await page.evaluate(snapshot, clipId);

  await openEditor(page, clipId);
  await page.keyboard.press('s');
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowDown');

  const after = await page.evaluate(snapshot, clipId);

  // 片段总数不变（S 没切分）、位置不变（Alt+↑↓ 没换轨）、时间区间不变。
  expect(after.total).toBe(before.total);
  expect(after.self).toEqual(before.self);
});
