import { expect, test, type Page } from '@playwright/test';

/**
 * 排版 → 插入图标（Lucide 全量选择器）。
 *
 * 三处「坏掉不报错、只在界面上看得出来」的地方，所以都断言 DOM：
 *  - **懒加载**：格子先渲染、进入视口才取图标数据 —— 坏了是一片空白；
 *  - **过滤**：搜索命中数与列表 —— 坏了是「搜了没反应」；
 *  - **事务粒度**：一次插入 = 一笔撤销 —— 坏了是「撤销要按 N 次」。
 */

interface IconDoc {
  size: { w: number; h: number };
  elements: {
    id: string;
    kind: string;
    name: string;
    shape?: string;
    path?: string;
    fill?: { kind: string };
    stroke?: { color: string; width: number } | null;
    frame: { x: number; y: number; w: number; h: number; rot: number };
  }[];
}

interface Hooks {
  store: { project: { tracks: { clips: { id: string; source?: { type?: string; doc?: IconDoc } }[] }[] } };
  appState: { activeTypoClipId: string | null };
}

async function boot(page: Page): Promise<void> {
  // 宽一点：Ribbon 的「插入」组在 1280 宽下会横向溢出，测到的是滚动不是按钮。
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

/** 与 typography-ribbon.spec.ts 同一套助手（那边是局部函数，这里按需复制）。 */
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
  expect(added, '「+ 排版片段」没有新增片段（落点可能被重叠策略挡了）').toHaveLength(1);
  return added[0]!;
}

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

async function readElements(page: Page): Promise<IconDoc> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    const id = A.appState.activeTypoClipId;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === id && c.source?.type === 'text' && c.source.doc) return c.source.doc;
      }
    }
    throw new Error(`找不到当前编辑的排版文档（activeTypoClipId=${id}）`);
  });
}

/** 打开「插入 → 图标」选择器。 */
async function openIconPicker(page: Page, clipId: string): Promise<void> {
  await openEditor(page, clipId);
  await page.getByTestId('ribbon-tab-insert').click();
  await page.getByTestId('typo-insert-icon').click();
  await expect(page.getByTestId('modal-icon-picker')).toBeVisible();
}

/** 命中数（「共 N 个图标」里的 N）。 */
async function hitCount(page: Page): Promise<number> {
  const text = (await page.getByTestId('icon-picker-hit').textContent()) ?? '';
  return Number(/\d+/.exec(text)?.[0] ?? 0);
}

test('图标选择器：全量清单 + 搜索过滤 + 无结果提示', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openIconPicker(page, clipId);

  const total = await hitCount(page);
  expect(total, '清单不是全量（懒加载清单没接上？）').toBeGreaterThan(1000);

  // 懒加载：初始只取可见（含 rootMargin 预取）的那一批，不是一上来就把全量拉下来。
  // 判据取总数的一半 —— 实测初始约 200 个，离界限很远，但足以抓住「全都加载了」。
  const loaded = await page.locator('.icp-cell svg').count();
  expect(loaded, '一个图标都没加载（懒加载彻底坏了）').toBeGreaterThan(0);
  expect(loaded, '图标被一次性全量加载了（懒加载没生效）').toBeLessThan(total / 2);

  // 往下滚 → 后面的格子才开始加载（既不是全量预载，也不是永远不加载）。
  await page.getByTestId('icon-picker-body').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(async () => page.locator('.icp-cell svg').count(), { timeout: 5000 })
    .toBeGreaterThan(loaded);

  await page.getByTestId('icon-picker-search').fill('arrow-up');
  const filtered = await hitCount(page);
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(total / 10);

  // 命中的格子确实渲染出来了，而且**内容已经懒加载完成**（格子里的 svg 就是证据：
  // 数据没到时那一格是空的）。
  const cell = page.getByTestId('icon-cell-arrow-up');
  await expect(cell).toBeVisible();
  await expect(cell.locator('svg')).toHaveCount(1);

  // 中文（图标名里不可能有）→ 明确提示「没有匹配」，而不是静默返回全量。
  await page.getByTestId('icon-picker-search').fill('不存在的图标');
  await expect(page.getByTestId('icon-picker-none')).toBeVisible();
  expect(await hitCount(page)).toBe(0);
});

test('多选插入：一次事务落进文档，撤销一笔整批回退', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  // `activeTypoClipId` 要编辑器打开后才指向这份文档 —— 读基线必须在它之后。
  await openIconPicker(page, clipId);
  const before = await readElements(page);

  // 选中第一个（等它的数据到齐再点 —— 没加载完的格子按设计不可选）
  await page.getByTestId('icon-picker-search').fill('star');
  const starCell = page.getByTestId('icon-cell-star');
  await expect(starCell.locator('svg')).toHaveCount(1);
  await starCell.click();
  await expect(page.getByTestId('icon-picker-count')).toContainText('1');

  // 选中第二个（换个关键词，验证过滤后仍然可选）
  await page.getByTestId('icon-picker-search').fill('heart');
  const heartCell = page.getByTestId('icon-cell-heart');
  await expect(heartCell.locator('svg')).toHaveCount(1);
  await heartCell.click();
  await expect(page.getByTestId('icon-picker-count')).toContainText('2');

  await page.getByTestId('icon-picker-confirm').click();
  await expect(page.getByTestId('modal-icon-picker')).toHaveCount(0);

  const doc = await readElements(page);
  const icons = doc.elements.filter((e) => e.kind === 'shape' && e.shape === 'svg');
  expect(doc.elements.length).toBe(before.elements.length + 2);
  expect(icons.map((e) => e.name).sort()).toEqual(['heart', 'star']);

  for (const el of icons) {
    // 以 SVG 形状落进文档：一条 0..100 authored 的真路径，不是空壳
    expect(el.path, `${el.name} 没有路径`).toBeTruthy();
    expect(el.path!.startsWith('M')).toBe(true);
    expect(el.path).not.toContain('NaN');
    // 图标语义 = 无填充 + 描边
    expect(el.fill?.kind).toBe('none');
    expect(el.stroke?.color).toBeTruthy();
    expect(el.stroke!.width).toBeGreaterThan(0);
    // 排在画布内（多选插入是自动网格排布的）
    expect(el.frame.x).toBeGreaterThanOrEqual(0);
    expect(el.frame.y).toBeGreaterThanOrEqual(0);
    expect(el.frame.x + el.frame.w).toBeLessThanOrEqual(doc.size.w);
    expect(el.frame.y + el.frame.h).toBeLessThanOrEqual(doc.size.h);
  }
  expect(icons[0]!.frame.w).toBe(icons[1]!.frame.w);

  // 插入完直接选中（接着就能拖走或改颜色）
  await expect(page.getByTestId('typo-selection')).toBeVisible();

  // 一笔撤销 = 整批消失
  await page.keyboard.press('Control+z');
  const after = await readElements(page);
  expect(after.elements.filter((e) => e.shape === 'svg')).toHaveLength(0);
  expect(after.elements.length).toBe(before.elements.length);
});
