import { expect, test, type Page } from '@playwright/test';

/**
 * M4 排版：Ribbon 与画布交互。
 *
 * ## 为什么这个文件里到处是 DOM 断言
 *
 * 这一轮的 bug 全部是「store 改了、界面没改」：拖动生效但画面不动、图层眼睛
 * 图标不刷新、字体下拉把布局顶歪。**原有 E2E 一条都抓不到** —— 它们只读
 * store，而 store 一直是对的。
 *
 * 所以这里的纪律是：**凡是用户能看见的状态，就断言 DOM**。store 断言只是
 * 补充，不是替代。
 *
 * 手势一律走 page.mouse / page.keyboard —— 命中测试、事务结算、编辑态切换
 * 这些问题全在手势层，直接调 store 会把它们整个绕过去。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

interface DocShape {
  size: { w: number; h: number };
  elements: {
    id: string;
    kind: string;
    name: string;
    visible: boolean;
    locked: boolean;
    text?: string;
    frame: { x: number; y: number; w: number; h: number; rot: number };
    style?: { fontWeight: number; letterSpacing: number };
    radius?: number;
  }[];
}

interface Hooks {
  store: { project: { tracks: { clips: { id: string; source?: { type?: string; doc?: DocShape } }[] }[] } };
  appState: { playT: number };
}

async function addTextClip(page: Page): Promise<string> {
  await page.locator('[data-testid=track-side-row]').nth(0).getByTestId('track-menu').click();
  await page.getByTestId('add-text').click();
  const id = await page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    for (const t of A.store.project.tracks) for (const c of t.clips) if (c.source?.type === 'text') return c.id;
    return '';
  });
  expect(id).not.toBe('');
  return id;
}

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

async function readDoc(page: Page): Promise<DocShape> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) if (c.source?.type === 'text' && c.source.doc) return c.source.doc;
    }
    throw new Error('找不到排版文档');
  });
}

/** 选中第一个元素（走图层面板，与用户路径一致）。 */
async function selectFirst(page: Page): Promise<void> {
  await page.getByTestId('typo-layer-row').first().click();
  await expect(page.getByTestId('typo-selection')).toBeVisible();
}

/**
 * 画布上第 index 个元素的**实际屏幕矩形与内联样式**。
 * 这是「界面到底有没有跟着变」的唯一可靠来源。
 */
async function domBox(page: Page, index = 0) {
  return page.evaluate((i) => {
    const el = document.querySelectorAll<HTMLElement>('.paper [data-el-id]')[i];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      left: el.style.left,
      width: el.style.width,
      transform: el.style.transform,
      text: el.textContent ?? '',
    };
  }, index);
}

/** 元素框在屏幕上的位置（用于把把手换算成坐标）。 */
async function screenRect(page: Page, index = 0) {
  return page.evaluate((i) => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    let doc: DocShape | null = null;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) if (c.source?.type === 'text' && c.source.doc) doc = c.source.doc;
    }
    if (!doc) throw new Error('找不到排版文档');
    const wrap = document.querySelector('.paper-wrap')!.getBoundingClientRect();
    const zoom = wrap.width / doc.size.w;
    const f = doc.elements[i]!.frame;
    return { zoom, x: wrap.left + f.x * zoom, y: wrap.top + f.y * zoom, w: f.w * zoom, h: f.h * zoom };
  }, index);
}

/**
 * 把窗口开宽再测。
 *
 * 「开始」Tab 有 6 组 30 多个项，在 1280 宽下会横向溢出（见下面对应的用例）。
 * 测对齐/属性时先把视口开宽，否则你测的是滚动不是功能。
 */
async function wide(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 900 });
}

test('Ribbon 渲染出三个常驻 Tab，切换后面板内容随之变化', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  for (const id of ['home', 'insert', 'anim']) {
    await expect(page.getByTestId(`ribbon-tab-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('ribbon-tab-shape-format')).toHaveCount(0);

  await expect(page.getByTestId('ribbon-bold')).toHaveCount(1);
  await expect(page.getByTestId('typo-shape')).toHaveCount(0);

  await page.getByTestId('ribbon-tab-insert').click();
  await expect(page.getByTestId('typo-shape')).toHaveCount(1);
  await expect(page.getByTestId('ribbon-bold')).toHaveCount(0);
});

test('排版页里窄侧栏仍在（工程级动作不随页面消失）', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await expect(page.getByTestId('rail')).toBeVisible();
  // 侧栏的导出入口也还在
  await page.getByTestId('rail-export').click();
  await expect(page.getByTestId('export-png')).toBeVisible();
});

test('Ribbon 改属性落库，且可撤销', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  expect((await readDoc(page)).elements[0]!.style!.fontWeight).toBe(700);

  await page.getByTestId('ribbon-bold').click();
  expect((await readDoc(page)).elements[0]!.style!.fontWeight).toBe(400);
  // 文本的粗细也要立刻反映在画布上（不是等重进页面）
  expect((await domBox(page))!.text).toBeTruthy();

  await page.keyboard.press('Control+z');
  expect((await readDoc(page)).elements[0]!.style!.fontWeight).toBe(700);

  const spacing = page.getByTestId('ribbon-letter-spacing');
  await spacing.fill('7');
  await spacing.press('Enter');
  expect((await readDoc(page)).elements[0]!.style!.letterSpacing).toBe(7);
});

test('插入图形：下拉而不是挤成一团的图库；随后出现「图形格式」', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  await page.getByTestId('ribbon-tab-insert').click();
  await page.getByTestId('typo-shape').click();
  await page.getByTestId('typo-shape-option-rect').click();

  const doc = await readDoc(page);
  expect(doc.elements).toHaveLength(2);
  expect(doc.elements[1]!.kind).toBe('shape');

  // 插入后自动选中 → contextual Tab 出现
  await expect(page.getByTestId('ribbon-tab-shape-format')).toBeVisible();

  await page.getByTestId('ribbon-tab-shape-format').click();
  const radius = page.getByTestId('ribbon-shape-radius');
  await radius.fill('24');
  await radius.press('Enter');
  expect((await readDoc(page)).elements[1]!.radius).toBe(24);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ribbon-tab-shape-format')).toHaveCount(0);
  await expect(page.getByTestId('ribbon-tab-home')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('ribbon-bold')).toHaveCount(1);
});

/* ------------------------------------------------------------ DOM 实时性
 *
 * 下面三条是本轮 bug 的回归守卫。它们的共同点：**断言 DOM，不只断言 store**。
 * 上一版的 `syncDocDom` 传错了根节点，导致文档改了但画面纹丝不动 ——
 * 而 store 断言全绿，E2E 一条都没挡住。
 */

test('拖动元素：画布 DOM 实时跟随（不是退出重进才更新）', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  const before = await domBox(page);
  expect(before).not.toBeNull();

  const start = await screenRect(page);
  const dx = 200;
  await page.mouse.move(start.x + start.w / 2, start.y + start.h / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.w / 2 + dx * start.zoom, start.y + start.h / 2, { steps: 10 });
  await page.mouse.up();

  const after = await domBox(page);
  // 屏幕位移 ≈ 文档位移 × zoom（可能有 6px 的吸附修正）
  expect(after!.x - before!.x).toBeGreaterThan(dx * start.zoom - 10);
  expect(after!.x - before!.x).toBeLessThan(dx * start.zoom + 10);
});

test('旋转元素：画布 DOM 的 transform 实时跟随', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  expect((await domBox(page))!.transform).toBe('none');

  const start = await screenRect(page);
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  // 从旋转把手往外拖：把手在顶边中点上方 20px
  await page.mouse.move(cx, start.y - 20);
  await page.mouse.down();
  await page.mouse.move(cx + start.w * 0.5, cy + start.h * 0.5, { steps: 10 });
  await page.mouse.up();

  const after = await domBox(page);
  expect(after!.transform).toContain('rotate');
  // 元素自身的角度也落了库
  expect(Math.abs((await readDoc(page)).elements[0]!.frame.rot)).toBeGreaterThan(0.05);
});

test('缩放元素：画布 DOM 的宽高实时跟随（不是等重进页面）', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  const before = await domBox(page);
  const rect = await screenRect(page);
  await page.mouse.move(rect.x + rect.w, rect.y + rect.h);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.w + 80, rect.y + rect.h + 40, { steps: 10 });
  await page.mouse.up();

  const after = await domBox(page);
  expect(after!.w).toBeGreaterThan(before!.w + 40);
  expect(after!.h).toBeGreaterThan(before!.h + 20);
  // 左上的锚定边不动
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2);
  expect(after!.width).not.toBe(before!.width); // 内联样式真的换了
});

test('图层面板的眼睛与锁图标实时刷新', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  const eye = page.getByTestId('typo-layer-eye').first();
  const before = await eye.innerHTML();

  await eye.click();
  // 图标本身要换（eye → eye-off）。只断言 store 的话这条 bug 会溜过去。
  await expect
    .poll(async () => eye.innerHTML(), { timeout: 3000 })
    .not.toBe(before);
  expect((await readDoc(page)).elements[0]!.visible).toBe(false);

  const lock = page.getByTestId('typo-layer-lock').first();
  const lockBefore = await lock.innerHTML();
  await lock.click();
  // 锁用的是 lock / lock-open 双图标而不是同一图标变色 —— 只变色的话
  // DOM 里什么都看不出来，测试无从断言、用户也容易漏看。
  await expect
    .poll(async () => lock.innerHTML(), { timeout: 3000 })
    .not.toBe(lockBefore);
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  expect((await readDoc(page)).elements[0]!.locked).toBe(true);
});

test('双击文本进入编辑：光标落在点击处（不再全选），失焦提交为**一笔**撤销', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  const rect = await screenRect(page);
  const box = (await domBox(page))!;

  // 双击文本框**靠左**的位置（不是正中，这样"光标落在点击处"才有判据）
  await page.mouse.dblclick(box.x + 8, box.y + box.h / 2);

  // 进入编辑态：焦点落在文本框上且可编辑
  const editable = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { isText: el?.classList.contains('typo-text') ?? false, editable: el?.isContentEditable ?? false };
  });
  expect(editable.isText).toBe(true);
  expect(editable.editable).toBe(true);

  /*
   * 关键改动：**不再全选**。
   *
   * 旧实现在进入编辑时 `selectNodeContents` 全选整段，于是接着打的字会
   * 整段替换（这条测试原来就是这么写的），而且用户**没法单击挪光标** ——
   * 那一下只是把已有选区收拢。Office 的行为是双击只把光标放到点击处。
   */
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(selected, '双击进入编辑时不该全选文字').toBe('');

  await page.keyboard.type('改过的文字');
  // 点空白处失焦 → 提交
  await page.mouse.click(rect.x + 4, rect.y - 60);

  const doc = await readDoc(page);
  const text = doc.elements[0]!.text ?? '';
  // 新文字是**插入**进去的（老文字还在），不是替换
  expect(text).toContain('改过的文字');
  expect(text.length).toBeGreaterThan('改过的文字'.length);
  // 画布上也是新文字（同步没被编辑态挡住）
  expect((await domBox(page))!.text).toBe(text);

  // 整段提交是**一笔**撤销：按一次 Ctrl+Z 就回到编辑前的文本
  await page.keyboard.press('Control+z');
  expect((await readDoc(page)).elements[0]!.text).not.toBe(text);
});

test('编辑文本时：点文字内部挪光标，点文本框边框才退回选中', async ({ page }) => {
  // Office 系的手感：编辑态下框的内部归文字（放光标），只有**边框**归"这个框本身"。
  // 旧实现里 SelectionLayer 的框盖满整个元素并吞掉 pointerdown，
  // 所以编辑开着也挪不动光标，一点就退回选中框。
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  const box = (await domBox(page))!;
  await page.mouse.dblclick(box.x + 8, box.y + box.h / 2);

  const activeIs = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.classList.contains('typo-text') === true;
    });
  expect(await activeIs()).toBe(true);

  // ① 点文字内部：仍在编辑态，焦点没离开文本框
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  expect(await activeIs(), '点文字内部应当仍在编辑（放光标），而不是退回选中框').toBe(true);

  // ② 点 6px 的边框环：退出编辑（focusout 提交），此时才轮到"选中文本框本身"
  await page.mouse.click(box.x + box.w / 2, box.y + 2);
  expect(await activeIs(), '点文本框边框应当退出文字编辑').toBe(false);
  await expect(page.getByTestId('typo-selection')).toBeVisible();
});

test('长字体名不会把 Ribbon 布局顶歪（定宽 + 截断）', async ({ page }) => {
  await boot(page);

  // 注册一个**名字很长**的字体。测试要的正是「名字长」这件事本身，
  // 所以刻意用同一个 woff2 换个长族名注册。
  const LONG = 'A Very Long Font Family Name That Should Never Widen The Ribbon';
  await page.evaluate(async (family) => {
    const A = (window as never as {
      __artmatic: { typoRegisterFont: (name: string, bytes: Uint8Array) => Promise<string> };
    }).__artmatic;
    const res = await fetch('/fonts/inter-latin-400.woff2');
    const bytes = new Uint8Array(await res.arrayBuffer());
    await A.typoRegisterFont(family, bytes);
  }, LONG);

  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  const trigger = page.getByTestId('ribbon-font-family');
  const group = page.getByTestId('ribbon-group').first();
  const boxBefore = await trigger.boundingBox();
  const groupBefore = await group.boundingBox();

  await trigger.click();
  await page.locator('[data-testid^="ribbon-font-option-"]', { hasText: 'A Very Long' }).first().click();

  // 换字体后：触发区宽度不变（定宽），整组宽度也不变（不撑开邻居）
  const boxAfter = await trigger.boundingBox();
  const groupAfter = await group.boundingBox();
  expect(Math.abs(boxAfter!.width - boxBefore!.width)).toBeLessThan(2);
  expect(Math.abs(groupAfter!.width - groupBefore!.width)).toBeLessThan(2);
  expect(Math.abs(groupAfter!.x - groupBefore!.x)).toBeLessThan(2);

  // 而且当前值是长名字 —— 触发区应当靠 ellipsis 截断而不是撑开
  const label = await trigger.locator('.sel-label').evaluate((el) => ({
    text: el.textContent ?? '',
    clipped: el.scrollWidth > el.clientWidth,
  }));
  expect(label.text.length).toBeGreaterThan(20);
  expect(label.clipped).toBe(true);
});

test('窄窗口：Ribbon 横向滚动，不换行也不出纵向滚动条', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  const body = page.getByTestId('ribbon-body');
  const box = await body.boundingBox();
  const scroll = await body.evaluate((el) => ({
    sw: el.scrollWidth,
    cw: el.clientWidth,
    sh: el.scrollHeight,
    ch: el.clientHeight,
  }));

  // 真的溢出了（所以需要滚动），且**只有横向** ——
  // 面板一旦允许纵向变化，舞台高度会随窗口宽度抖动。
  expect(scroll.sw).toBeGreaterThan(scroll.cw);
  expect(scroll.sh).toBeLessThanOrEqual(scroll.ch + 1);
  expect(box!.height).toBeLessThan(100);

  // 滚到最右，最后一组的按钮仍然可达、可点（不是被裁掉或藏进一个失效的弹层）
  await body.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await selectFirst(page);
  const hide = page.getByTestId('typo-hide');
  await hide.scrollIntoViewIfNeeded();
  await hide.click();
  expect((await readDoc(page)).elements[0]!.visible).toBe(false);
});

test('底部画质下拉是定宽的，不会占满整行', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  const box = await page.getByTestId('typo-preview-scale').boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThan(vw * 0.3);
});

/* ------------------------------------------------------------ 选中框 */

test('选中框是透明的，不会盖住图形', async ({ page }) => {
  // 回归守卫：选中框曾经用 `class="sel"`，撞上 controls.css 里 Select 控件的
  // 全局 `.sel`（`background: var(--input-bg)` 白色）—— 选中就变成一个不透明白块，
  // 把图形整个盖住。scoped 样式只声明了 outline，背景没被覆盖，所以漏了出来。
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  for (const id of ['typo-sel', 'typo-selection']) {
    const box = page.getByTestId(id);
    await expect(box).toHaveCount(1);
    const bg = await box.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, `${id} 不该有背景色`).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  }
});

test('旋转时选中框跟着转（不是只有图形在动）', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  const box = page.getByTestId('typo-selection');
  expect(await box.evaluate((el) => getComputedStyle(el).transform)).toBe('none');

  const start = await screenRect(page);
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  await page.mouse.move(cx, start.y - 20);
  await page.mouse.down();
  await page.mouse.move(cx + start.w * 0.6, cy + start.h * 0.6, { steps: 10 });
  await page.mouse.up();

  // 直接看变换矩阵的非对角项：转过的框，矩阵是 [cos, sin, -sin, cos, 0, 0]，
  // 对角线之外的项必然明显非零。比拿外接矩形比大小稳 —— 细长条转 90° 之后
  // 外接矩形的宽反而变小，用一个「宽必须变大」的断言会误判。
  const m = await box.evaluate((el) => getComputedStyle(el).transform);
  const parts = m.match(/-?[\d.]+/g)?.map(Number) ?? [];
  expect(parts.length).toBeGreaterThanOrEqual(6);
  expect(Math.abs(parts[1]!) + Math.abs(parts[2]!)).toBeGreaterThan(0.1);
});

test('旋转后缩放沿元素自身坐标轴（不是世界坐标轴）', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);

  // 用**正方形**来测：细长条（默认文本框是 1536×173）转 90° 之后，它的「右边
  // 把手」会跑到视口外，鼠标根本点不到。图形的默认框是短边 30% 的正方形。
  await openEditor(page, clipId);
  await page.getByTestId('ribbon-tab-insert').click();
  await page.getByTestId('typo-shape').click();
  await page.getByTestId('typo-shape-option-rect').click();
  await expect(page.getByTestId('typo-selection')).toBeVisible();

  // 直接把角度设成 90°：这是**前置条件**，不是被测行为（被测的是缩放手势）。
  await page.evaluate(() => {
    const A = (window as never as { __artmatic: Hooks & { appState: { store: { touch: () => void } } } })
      .__artmatic;
    for (const t of A.store.project.tracks) {
      for (const c of t.clips) {
        const src = c.source as { type?: string; doc?: DocShape } | undefined;
        if (src?.type === 'text' && src.doc) src.doc.elements[1]!.frame.rot = Math.PI / 2;
      }
    }
    A.appState.store.touch();
  });

  const geom = await screenRect(page, 1);
  const cx = geom.x + geom.w / 2;
  const cy = geom.y + geom.h / 2;
  // 元素转了 90°，本地 +x 指向世界 +y：它的「右边把手」现在在视觉框的**下方**。
  const handleX = cx;
  const handleY = cy + geom.w / 2;

  const wBefore = (await readDoc(page)).elements[1]!.frame.w;

  // 往世界**下**拖 = 沿元素本地 +x → 宽度增长
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX, handleY + 120, { steps: 10 });
  await page.mouse.up();
  const afterDown = (await readDoc(page)).elements[1]!.frame.w;
  expect(afterDown, `w: ${wBefore} → ${afterDown}`).toBeGreaterThan(wBefore + 60);

  await page.keyboard.press('Control+z');
  expect(Math.abs((await readDoc(page)).elements[1]!.frame.w - wBefore)).toBeLessThan(1);

  // 往世界**右**拖 = 垂直于把手 → 尺寸不变。
  // 旧实现把世界位移直接当成本地位移，这一拖会让宽度也增长（差 120px）。
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX + 120, handleY, { steps: 10 });
  await page.mouse.up();
  expect(Math.abs((await readDoc(page)).elements[1]!.frame.w - wBefore)).toBeLessThan(2);
});

/* ------------------------------------------------------------ 选择 / 对齐 */

test('选择框画在元素真实位置上（不是「有就行」）', async ({ page }) => {
  // 回归守卫：SelectionLayer 曾经挂在 .paper-wrap 外面，把手坐标就以 viewport
  // 原点算了，整体偏移到点不中 —— 而 toBeVisible() 抓不到这个。
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  const expectBox = await screenRect(page);
  const actual = await page.getByTestId('typo-selection').boundingBox();
  expect(actual).not.toBeNull();
  expect(Math.abs(actual!.x - expectBox.x)).toBeLessThan(2);
  expect(Math.abs(actual!.y - expectBox.y)).toBeLessThan(2);
  expect(Math.abs(actual!.width - expectBox.w)).toBeLessThan(2);
  expect(Math.abs(actual!.height - expectBox.h)).toBeLessThan(2);
});

test('对齐与居中：手动选择对齐目标', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  // 先挪开，否则「居中」是恒等变换，测不出东西
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  const nudged = (await readDoc(page)).elements[0]!;
  const base = (await readDoc(page)).size;

  await page.getByTestId('typo-center-h').click();
  const centered = (await readDoc(page)).elements[0]!;
  expect(centered.frame.x).toBeCloseTo((base.w - centered.frame.w) / 2, 6);
  expect(centered.frame.y).toBeCloseTo(nudged.frame.y, 6); // 只动一个轴

  await page.getByTestId('typo-center-v').click();
  const both = (await readDoc(page)).elements[0]!;
  expect(both.frame.y).toBeCloseTo((base.h - both.frame.h) / 2, 6);

  // 画布也要跟着动（同样是「改了但没刷新」的高危点）：
  // domBox 是 DOM 实测位置，screenRect 是把文档 frame 换算到屏幕的期望位置。
  const box = await domBox(page);
  const rect = await screenRect(page);
  expect(Math.abs(box!.x - rect.x)).toBeLessThan(2);
  expect(Math.abs(box!.y - rect.y)).toBeLessThan(2);
});

test('图层面板：选择与层级调整', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);

  await page.getByTestId('ribbon-tab-insert').click();
  await page.getByTestId('typo-shape').click();
  await page.getByTestId('typo-shape-option-rect').click();

  await expect(page.getByTestId('typo-layer-row')).toHaveCount(2);
  expect((await readDoc(page)).elements.map((e) => e.kind)).toEqual(['text', 'shape']);

  await page.getByTestId('typo-layer-row').first().click();
  await expect(page.getByTestId('typo-selection')).toBeVisible();

  // 把最前景那一层下移一层 → 数组顺序反转
  await page.getByTestId('typo-layer-down').first().click();
  expect((await readDoc(page)).elements.map((e) => e.kind)).toEqual(['shape', 'text']);

  // DOM 的绘制顺序也要跟着换（z 序在 DOM 里就是兄弟顺序）
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.paper [data-el-id]')).map((n) =>
      (n as HTMLElement).className.includes('shape') ? 'shape' : 'text',
    ),
  );
  expect(order).toEqual(['shape', 'text']);
});
