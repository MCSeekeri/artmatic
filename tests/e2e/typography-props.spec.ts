import { expect, test, type Page } from '@playwright/test';
import { addTextClip, openDemo } from './_stage';

/**
 * M4 排版：右侧「元素属性」面板 + 填充的多色标 / 停靠位置 + 文本框背景。
 *
 * 与 typography-ribbon.spec.ts 同一条纪律：**能看见的状态就断言 DOM**，
 * store 断言只是补充。这里的四条用例各自钉住一个用户可见的行为：
 *   ① 几何输入框改的是画布上的真实位置 / 尺寸 / 旋转；
 *   ② 色标的增删与位置改完立刻反映到 SVG `<defs>` 的 `<stop>`；
 *   ③ 文本框背景画在外壳上、不碰字形（两层节点各管各的）；
 *   ④ 切换填充方式时 Ribbon 的**后续控件不再位移**（原先按类型条件展开，
 *      每切一次整条工具栏就重排一次）。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

interface DocShape {
  size: { w: number; h: number };
  elements: {
    id: string;
    kind: string;
    frame: { x: number; y: number; w: number; h: number; rot: number };
    fill?: {
      kind: string;
      color?: string;
      stops?: { offset: number; color: string }[];
      opacity?: number;
    };
    boxFill?: { kind: string; color?: string; opacity?: number };
    boxStroke?: { color: string; width: number; style?: string; paint?: { kind: string } };
    shadows?: { color: string; dx: number; dy: number; blur: number }[];
    blur?: number;
    glyphStroke?: { color: string; width: number };
    style?: { shadow?: { dx: number; dy: number; blur: number } | { dx: number; dy: number; blur: number }[] };
  }[];
}

interface Hooks {
  store: { project: { tracks: { clips: { id: string; source?: { type?: string; doc?: DocShape } }[] }[] } };
  appState: { activeTypoClipId: string | null };
}

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

/** 读**当前编辑**的排版文档（按 activeTypoClipId 取，不扫「第一个 text 片段」）。 */
async function readDoc(page: Page): Promise<DocShape> {
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

/** 选中第一个元素（走图层面板，与用户路径一致）。 */
async function selectFirst(page: Page): Promise<void> {
  await page.getByTestId('typo-layer-row').first().click();
  await expect(page.getByTestId('typo-selection')).toBeVisible();
}

/** 画布上第 index 个元素的 left / transform（「界面有没有跟着变」的来源）。 */
async function domBox(page: Page, index = 0) {
  return page.evaluate((i) => {
    const el = document.querySelectorAll<HTMLElement>('.paper [data-el-id]')[i];
    if (!el) return null;
    return { left: el.style.left, width: el.style.width, transform: el.style.transform };
  }, index);
}

/** 插入一个矩形（走插入选项卡的图形面板，与用户路径一致）。插完自动选中。 */
async function insertRect(page: Page): Promise<void> {
  await page.getByTestId('ribbon-tab-insert').click();
  await page.getByTestId('typo-shape').click();
  await page.getByTestId('typo-shape-card-rect').click();
}

/** 把窗口开宽：面板 + Ribbon 同时在场时，窄视口测的是滚动不是功能。 */
async function wide(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 900 });
}

test('元素属性面板：位置 / 大小 / 旋转落进文档，且画布实时跟随', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  await page.getByTestId('typo-tab-props').click();
  const x = page.getByTestId('prop-x');
  await expect(x).toBeVisible();

  const before = (await readDoc(page)).elements[0]!.frame.x;
  await x.fill(String(before + 40));
  await x.press('Enter');
  expect((await readDoc(page)).elements[0]!.frame.x).toBe(before + 40);
  // 断言 DOM：store 改了但界面没跟上的 bug 在这个文件族的上一轮出现过。
  expect((await domBox(page, 0))!.left).toBe(`${before + 40}px`);

  const w = page.getByTestId('prop-w');
  await w.fill('300');
  await w.press('Enter');
  expect((await readDoc(page)).elements[0]!.frame.w).toBe(300);
  expect((await domBox(page, 0))!.width).toBe('300px');

  const rot = page.getByTestId('prop-rot');
  await rot.fill('90');
  await rot.press('Enter');
  expect((await readDoc(page)).elements[0]!.frame.rot).toBeCloseTo(Math.PI / 2, 5);
  expect((await domBox(page, 0))!.transform).toContain('rotate(90deg)');
});

test('填充色标：可加色标、改颜色与位置，SVG <defs> 同步', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await insertRect(page);

  await page.getByTestId('typo-tab-props').click();
  await page.getByTestId('prop-fill-kind').click();
  await page.getByTestId('prop-fill-kind-option-linear').click();

  const shapeId = (await readDoc(page)).elements[1]!.id;
  expect((await readDoc(page)).elements[1]!.fill!.kind).toBe('linear');
  expect((await readDoc(page)).elements[1]!.fill!.stops).toHaveLength(2);

  // 加一个色标：插在最大间隔的中点（0.5），颜色沿用左邻。
  await page.getByTestId('prop-fill-stop-add').click();
  const afterAdd = (await readDoc(page)).elements[1]!.fill!;
  expect(afterAdd.stops).toHaveLength(3);
  expect(afterAdd.stops![2]!.offset).toBeCloseTo(0.5, 5);
  expect(afterAdd.stops![2]!.color).toBe(afterAdd.stops![0]!.color);

  // 改位置 → SVG 的 <stop offset> 跟着变（渲染按 offset 排序）。
  const pos = page.getByTestId('prop-fill-stop-pos-2');
  await pos.fill('80');
  await pos.press('Enter');
  expect((await readDoc(page)).elements[1]!.fill!.stops![2]!.offset).toBeCloseTo(0.8, 5);
  const offsets = await page
    .locator(`[data-el-id="${shapeId}"] svg defs linearGradient stop`)
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('offset')));
  expect(offsets).toHaveLength(3);
  // 渲染按 offset 排序：新色标（文档里排第 3）落在中间，而不是原样躺在数组末尾。
  expect(offsets).toEqual(['0', '0.8', '1']);

  // 改颜色（第一个色标）→ 文档与 SVG 都要变。
  // 取色卡入口：点色块开面板，再从标准色里挑（纯红在标准色板里）。
  await page.getByTestId('prop-fill-stop-color-0').click();
  await page.getByTestId('prop-fill-stop-color-0-palette-std-ff0000').click();
  expect((await readDoc(page)).elements[1]!.fill!.stops![0]!.color).toBe('#ff0000');
  const first = await page
    .locator(`[data-el-id="${shapeId}"] svg defs linearGradient stop`)
    .first()
    .getAttribute('stop-color');
  expect(first).toBe('#ff0000');
});

test('文本框背景：画在外壳上，字形色与裁切不受影响', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  await page.getByTestId('typo-tab-props').click();
  // 默认是「无」→ 切到纯色（类型下拉的 none 也在选项里）。
  await page.getByTestId('prop-box-kind').click();
  await page.getByTestId('prop-box-kind-option-solid').click();
  // 取色卡入口：点色块 → 标准色里的纯红。
  await page.getByTestId('prop-box-color').click();
  await page.getByTestId('prop-box-color-palette-std-ff0000').click();

  const shell = await page.locator('.paper .typo-el').first().evaluate((el) => {
    const s = (el as HTMLElement).style;
    return { bg: s.backgroundColor, image: s.backgroundImage };
  });
  expect(shell.bg).toBe('rgb(255, 0, 0)');
  expect(shell.image).toBe('none');

  // 字形层（内层 .typo-text）不受影响：没有裁切、字形仍是不透明文字色。
  const text = await page.locator('.paper .typo-text').first().evaluate((el) => {
    const s = (el as HTMLElement).style;
    return { clip: s.getPropertyValue('background-clip'), color: s.color };
  });
  expect(text.clip).toBe('border-box');
  expect(text.color).not.toBe('transparent');

  expect((await readDoc(page)).elements[0]!.boxFill?.kind).toBe('solid');

  // 边框：宽度输入即生效（同一面板的「文本框边框」区）。
  const bw = page.getByTestId('prop-box-stroke-width');
  await bw.fill('3');
  await bw.press('Enter');
  expect((await readDoc(page)).elements[0]!.boxStroke?.width).toBe(3);
  const border = await page
    .locator('.paper .typo-el')
    .first()
    .evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(border).toBe('3px');
});

/**
 * 实时预览：拖动数字框（横向 scrub）时文档**每帧**跟着变，松手只结算一笔撤销。
 *
 * 旧行为是只在松手时写一次 —— 拖动过程中画面纹丝不动，用户没法靠眼睛对准数值。
 * 这里断言的是「还没松手就已经变了」，那是这轮改动的全部意义。
 */
test('拖动数字框实时改文档，松手才结算撤销', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);
  await page.getByTestId('typo-tab-props').click();

  const readX = (): Promise<number> => readDoc(page).then((d) => d.elements[0]!.frame.x);
  const before = await readX();

  const wrap = page.getByTestId('prop-x-wrap');
  const box = (await wrap.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // 4px = 1 step（scrub.ts 的 DEFAULT_PX_PER_STEP），拖 40px ⇒ +10 左右。
  await page.mouse.move(cx + 40, cy, { steps: 8 });

  // 关键：**还没松手**，文档与 DOM 都已经变了。
  await expect.poll(readX, { message: '拖动中数值没有实时跟随' }).toBeGreaterThan(before + 5);
  const left = await page
    .locator('.paper [data-el-id]')
    .first()
    .evaluate((el) => (el as HTMLElement).style.left);
  expect(left).not.toBe(`${before}px`);

  await page.mouse.up();
  const settled = await readX();
  expect(settled).toBeGreaterThan(before + 5);

  // 整段拖动 = 一笔撤销：一次 Ctrl+Z 必须**完全**回到起点。
  // 若中途每次 oninput 都入了栈，这里只会退一小步。
  await page.keyboard.press('Control+z');
  expect(await readX()).toBeCloseTo(before, 5);
});

/**
 * 元素阴影 / 虚化：多层、逐层可调、预设一键套上。
 *
 * 渲染是 `filter: blur() drop-shadow() drop-shadow()`（**不是** box-shadow：
 * 那个只会投一个矩形，星形 / 裸文字会得到方影子，见 document.ts::ElementShadow）。
 * 断言同时看文档与外壳的 inline filter —— 只改 store 不改 DOM 是这族的经典回归。
 */
test('元素阴影：预设 / 多层 / 逐层调参 / 虚化，外壳 filter 跟着变', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);
  await page.getByTestId('typo-tab-props').click();

  const filterOf = (): Promise<string> =>
    page.locator('.paper .typo-el').first().evaluate((el) => (el as HTMLElement).style.filter);

  // 默认没有任何 filter（显式写 none，就地同步才能把上一份复位）。
  expect(await filterOf()).toBe('none');

  await page.getByTestId('prop-shadow-preset').click();
  await page.getByTestId('prop-shadow-preset-option-soft').click();
  expect((await readDoc(page)).elements[0]!.shadows).toHaveLength(1);
  expect(await filterOf()).toContain('drop-shadow(');

  // 再加一层：链式 drop-shadow，DOM 里必须真的多一条。
  await page.getByTestId('prop-shadow-add').click();
  expect((await readDoc(page)).elements[0]!.shadows).toHaveLength(2);
  const two = await filterOf();
  expect(two.match(/drop-shadow\(/g)).toHaveLength(2);

  // 逐层改：第二层的 X（编号从 0 开始，与面板上的「阴影 2」对应）。
  const dx = page.getByTestId('prop-shadow-dx-1');
  await dx.fill('24');
  await dx.press('Enter');
  expect((await readDoc(page)).elements[0]!.shadows![1]!.dx).toBe(24);
  expect(await filterOf()).toContain('24px');

  // 删掉第一层：只剩一层，且剩下的是刚调过的那层。
  await page.getByTestId('prop-shadow-remove-0').click();
  const left = (await readDoc(page)).elements[0]!.shadows!;
  expect(left).toHaveLength(1);
  expect(left[0]!.dx).toBe(24);

  // 虚化与阴影共用一条 filter，且**虚化在前**（先糊再投影）。
  const blur = page.getByTestId('prop-blur');
  await blur.fill('6');
  await blur.press('Enter');
  expect((await readDoc(page)).elements[0]!.blur).toBe(6);
  expect((await filterOf()).startsWith('blur(6px) drop-shadow(')).toBe(true);

  await blur.fill('0');
  await blur.press('Enter');
  // 0 = 不虚化：字段被删掉（缺省语义），filter 里也不该再有 blur()。
  expect((await readDoc(page)).elements[0]!.blur).toBeUndefined();
  expect(await filterOf()).not.toContain('blur(');
});

/** 文字阴影只作用于文本框，且可以是多层（text-shadow 的逗号列表）。 */
test('文字阴影：多层落到内层的 text-shadow 上', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);
  await page.getByTestId('typo-tab-props').click();

  const textShadow = (): Promise<string> =>
    page.locator('.paper .typo-text').first().evaluate((el) => getComputedStyle(el).textShadow);
  // 每条阴影以颜色开头；不能按逗号数 —— `rgb(0, 0, 0)` 自己就带两个逗号。
  const count = (css: string): number => (css.match(/rgb\(/g) ?? []).length;

  expect(await textShadow()).toBe('none');

  // 「光晕」预设 = 两层同色、模糊半径不同。
  await page.getByTestId('prop-text-shadow-preset').click();
  await page.getByTestId('prop-text-shadow-preset-option-neon').click();
  const shadows = (await readDoc(page)).elements[0]!.style!.shadow;
  expect(Array.isArray(shadows) ? shadows.length : 0).toBe(2);
  expect(count(await textShadow())).toBe(2);

  // 再加一层 → 三条。
  await page.getByTestId('prop-text-shadow-add').click();
  const after = (await readDoc(page)).elements[0]!.style!.shadow;
  expect(Array.isArray(after) ? after.length : 0).toBe(3);
  expect(count(await textShadow())).toBe(3);

  // 删掉一层 → 回到两条。
  await page.getByTestId('prop-text-shadow-remove-0').click();
  const back = (await readDoc(page)).elements[0]!.style!.shadow;
  expect(Array.isArray(back) ? back.length : 0).toBe(2);
  expect(count(await textShadow())).toBe(2);
});

/**
 * 字形描边（`-webkit-text-stroke`）：单个可调宽度，不是四向阴影叠。
 *
 * 除了内联样式，还要证明**光栅化路径**也真的画了 —— 描边是 snapDOM 最容易
 * 丢掉的一类效果（它靠内联样式，丢的时候不报错）。
 */
test('字形描边：宽度 / 颜色落到 -webkit-text-stroke，光栅化墨迹变多', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);
  await page.getByTestId('typo-tab-props').click();

  const strokeOf = (): Promise<{ w: string; c: string }> =>
    page.locator('.paper .typo-text').first().evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        w: s.getPropertyValue('-webkit-text-stroke-width'),
        c: s.getPropertyValue('-webkit-text-stroke-color'),
      };
    });

  /** 用当前文档在光栅化路径上渲一张，返回墨迹数。 */
  const inkNow = async (): Promise<number> => {
    const doc = await readDoc(page);
    return page.evaluate(async (d) => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic as unknown as {
        typoRasterize: (doc: unknown, w: number, h: number, t: number) => Promise<{ ink: number }>;
      };
      const shot = await A.typoRasterize(d, 640, 360, 0);
      return shot.ink;
    }, doc);
  };

  expect((await strokeOf()).w).toBe('0px');
  const inkOff = await inkNow();

  const width = page.getByTestId('prop-glyph-stroke-width');
  await width.fill('6');
  await width.press('Enter');
  expect((await readDoc(page)).elements[0]!.glyphStroke?.width).toBe(6);
  expect((await strokeOf()).w).toBe('6px');
  // 描边色默认白（先在面板上挑色再调宽度也走得通）。
  expect((await strokeOf()).c).toBe('rgb(255, 255, 255)');

  await page.getByTestId('prop-glyph-stroke-color').click();
  await page.getByTestId('prop-glyph-stroke-color-palette-std-ff0000').click();
  expect((await readDoc(page)).elements[0]!.glyphStroke?.color).toBe('#ff0000');
  expect((await strokeOf()).c).toBe('rgb(255, 0, 0)');

  // 居中描边会向外扩 ⇒ 墨迹变多（这也顺带证明 snapDOM 画了它）。
  expect(await inkNow()).toBeGreaterThan(inkOff);

  // 宽度 0 = 关掉：就地同步靠这份声明复位。
  await width.fill('0');
  await width.press('Enter');
  expect((await strokeOf()).w).toBe('0px');
  expect(await inkNow()).toBe(inkOff);
});

/** 描边填充：渐变 / 纹理走 border-image，纯色仍是 border-color。 */
test('文本框边框的填充方式：渐变走 border-image', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);
  await page.getByTestId('typo-tab-props').click();

  // 纯色阶段：没有 border-image。
  const bw = page.getByTestId('prop-box-stroke-width');
  await bw.fill('6');
  await bw.press('Enter');
  const readBorder = (): Promise<{ src: string; slice: string; width: string }> =>
    page.locator('.paper .typo-el').first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { src: s.borderImageSource, slice: s.borderImageSlice, width: s.borderTopWidth };
    });
  expect((await readBorder()).src).toBe('none');

  await page.getByTestId('prop-box-stroke-paint-kind').click();
  await page.getByTestId('prop-box-stroke-paint-kind-option-linear').click();
  expect((await readDoc(page)).elements[0]!.boxStroke?.paint?.kind).toBe('linear');

  const after = await readBorder();
  expect(after.src).toContain('linear-gradient');
  // slice 序列化各浏览器可能带四边（`1` / `1 1 1 1`），只要求含 1。
  expect(after.slice).toContain('1');
  // 宽度仍然是边框宽度那一格决定的（border-image 只在有宽度时画得出来）。
  expect(after.width).toBe('6px');

  // 回到纯色：border-image 必须复位成 none（就地同步没有删除语义）。
  await page.getByTestId('prop-box-stroke-paint-kind').click();
  await page.getByTestId('prop-box-stroke-paint-kind-option-none').click();
  expect((await readDoc(page)).elements[0]!.boxStroke?.paint).toBeUndefined();
  expect((await readBorder()).src).toBe('none');
});

/**
 * 光栅化路径（snapDOM）也要出图 —— 阶段与导出走的是**同一份声明表**，
 * 但「DOM 里有 inline filter」不等于「截图里真的画了」：snapDOM 丢效果时
 * 不报错，只会安静地少画一层（与 3D 那次排查同源）。
 *
 * 断言走结构量（墨迹数 / 平均通道），不做逐像素相等（AGENTS §7 的 flaky 区）。
 */
test('光栅化：阴影多出墨迹、虚化把边缘摊开、渐变描边不是白色', async ({ page }) => {
  await boot(page);

  const r = await page.evaluate(async () => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic as unknown as {
      typoRasterize: (
        doc: unknown,
        w: number,
        h: number,
        localSec: number,
      ) => Promise<{ ink: number; sum: number }>;
    };

    /** 320×180 里一块 80×50 的白方块（居中偏上）。 */
    const doc = (extra: Record<string, unknown>, stroke: unknown = null) => ({
      size: { w: 320, h: 180 },
      background: { kind: 'none' },
      fonts: [],
      groups: [],
      elements: [
        {
          id: 's1',
          name: '',
          kind: 'shape',
          shape: 'rect',
          frame: { x: 120, y: 50, w: 80, h: 50, rot: 0 },
          blend: 'normal',
          opacity: 1,
          visible: true,
          locked: false,
          animations: [],
          fill: { kind: 'solid', color: '#ffffff' },
          stroke,
          ...extra,
        },
      ],
    });

    const whiteStroke = { color: '#ffffff', width: 8, style: 'solid' };
    const gradientStroke = {
      ...whiteStroke,
      paint: {
        kind: 'linear',
        angle: 0,
        stops: [
          { offset: 0, color: '#00ff00' },
          { offset: 1, color: '#0000ff' },
        ],
      },
    };

    return {
      plain: await A.typoRasterize(doc({}), 320, 180, 0),
      shadow: await A.typoRasterize(
        doc({ shadows: [{ color: '#ff0000', dx: 0, dy: 30, blur: 0 }] }),
        320,
        180,
        0,
      ),
      blurred: await A.typoRasterize(doc({ blur: 6 }), 320, 180, 0),
      plainStroke: await A.typoRasterize(doc({}, whiteStroke), 320, 180, 0),
      gradientStroke: await A.typoRasterize(doc({}, gradientStroke), 320, 180, 0),
    };
  });

  // 硬阴影（dy=30、零模糊）是一条 80×30 的实心带。
  expect(r.shadow.ink - r.plain.ink).toBeGreaterThan(80 * 30 * 0.9);

  // 虚化把边缘摊开：墨迹变多，但中心仍是实心（不是整块被冲淡）。
  expect(r.blurred.ink).toBeGreaterThan(r.plain.ink);

  // 渐变描边：墨迹不能少（少 = `url(#…)` 没解析，描边整个没画），
  // 且平均通道明显低于白描边（低 = 渐变真的上色了）。
  expect(r.gradientStroke.ink).toBeGreaterThan(r.plainStroke.ink * 0.9);
  expect(r.gradientStroke.sum / r.gradientStroke.ink).toBeLessThan(
    r.plainStroke.sum / r.plainStroke.ink,
  );
});

test('切换填充方式不再让 Ribbon 重排（填充组是稳定控件集）', async ({ page }) => {
  await wide(page);
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await insertRect(page);
  await page.getByTestId('ribbon-tab-shape-format').click();

  // 取填充组**之后**的控件当探针：它一动，说明整条工具栏在重排。
  const probe = page.getByTestId('ribbon-stroke-width');
  const fillBtn = page.getByTestId('ribbon-shape-fill');
  const before = (await probe.boundingBox())!;
  const fillBefore = (await fillBtn.boundingBox())!;

  await page.getByTestId('ribbon-fill-kind').click();
  await page.getByTestId('ribbon-fill-kind-option-texture').click();
  await expect(fillBtn).toBeEnabled();
  const afterTexture = (await probe.boundingBox())!;
  expect(Math.abs(afterTexture.x - before.x)).toBeLessThan(1);

  await page.getByTestId('ribbon-fill-kind').click();
  await page.getByTestId('ribbon-fill-kind-option-radial').click();
  const afterRadial = (await probe.boundingBox())!;
  expect(Math.abs(afterRadial.x - before.x)).toBeLessThan(1);
  // 主色控件本身也不许动（它是组内的第二个控件，组宽恒定的另一半证据）。
  expect(Math.abs((await fillBtn.boundingBox())!.x - fillBefore.x)).toBeLessThan(1);
});
