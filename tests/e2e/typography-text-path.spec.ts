import { expect, test, type Page } from '@playwright/test';
import { addTextClip, openDemo } from './_stage';

/**
 * 「文字转路径」。
 *
 * 测三件事：
 *  1. 形状真的换成了 `pathUnit:'px'` 的自定义路径（不是把文本框藏起来）；
 *  2. 转出来的轮廓与浏览器渲染的**面积**在同一量级（抗锯齿边缘必然有差，
 *     但整块面积差超过 5% 就说明字形没对上）；
 *  3. 一步撤销能回到文本（多元素 / 多颜色时也是一笔）；
 *  4. 字体里没有这些字时**不给半成品**：只弹一条可照做的提示，文档原样。
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
          source?: { type?: string; doc?: DocShape };
        }[];
      }[];
    };
    commit: (label: string, fn: (p: unknown) => void) => void;
  };
  appState: { activeTypoClipId: string | null };
  typoRasterize: (
    doc: unknown,
    w: number,
    h: number,
    localSec: number,
  ) => Promise<{ w: number; h: number; ink: number; sum: number; hash: string }>;
}

interface DocShape {
  size: { w: number; h: number };
  elements: {
    id: string;
    kind: string;
    name: string;
    frame: { x: number; y: number; w: number; h: number; rot: number };
    runs?: { text: string; style?: Record<string, string | number> }[];
    style?: Record<string, unknown>;
    shape?: string;
    path?: string;
    pathUnit?: string;
    clipFrame?: boolean;
  }[];
}

async function openEditor(page: Page, clipId: string): Promise<void> {
  await page.locator(`[data-testid=clip][data-clip-id="${clipId}"]`).dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
}

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

/** 把文本改成**西文**：内置 Inter 只带拉丁字形，中文会落到系统回落字体（见文件头第 4 条）。 */
async function setAsciiText(page: Page, clipId: string, text: string): Promise<void> {
  await page.evaluate(
    ({ id, value }) => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      A.store.commit('e2e: 设文本', (p) => {
        const proj = p as { tracks: { clips: { id: string; source?: { doc?: DocShape } }[] }[] };
        for (const t of proj.tracks) {
          for (const c of t.clips) {
            if (c.id !== id || !c.source?.doc) continue;
            const el = c.source.doc.elements[0]!;
            el.runs = [{ text: value }];
            el.style = { ...el.style, fontFamily: 'Inter', fontWeight: 700 };
          }
        }
      });
    },
    { id: clipId, value: text },
  );
}

async function selectFirst(page: Page): Promise<void> {
  await page.getByTestId('typo-layer-row').first().click();
  await expect(page.getByTestId('typo-selection')).toBeVisible();
}

async function rasterize(page: Page, doc: DocShape) {
  return page.evaluate(
    ({ d }) => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      return A.typoRasterize(d, d.size.w, d.size.h, 0);
    },
    { d: doc },
  );
}

test('文字转路径：轮廓落在像素空间、面积与文字一致、一步撤销', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await setAsciiText(page, clipId, 'Outline AV 178');
  await openEditor(page, clipId);
  await selectFirst(page);

  const before = await readDoc(page);
  const rasterBefore = await rasterize(page, before);
  expect(rasterBefore.ink, '转换前应该真的画出字了').toBeGreaterThan(200);

  await page.getByTestId('typo-text-to-path').click();

  await expect.poll(async () => (await readDoc(page)).elements[0]?.kind).toBe('shape');

  const after = await readDoc(page);
  const shape = after.elements[0]!;
  expect(shape.shape).toBe('svg');
  expect(shape.pathUnit).toBe('px');
  expect(shape.clipFrame).toBe(true);
  // 多字形必须合并成多条子路径（一条 d、多个 M）。只有一条说明只转出了第一个字。
  expect((shape.path!.match(/M/g) ?? []).length).toBeGreaterThan(5);

  const rasterAfter = await rasterize(page, after);
  expect(rasterAfter.ink).toBeGreaterThan(200);
  const diff = Math.abs(rasterAfter.ink - rasterBefore.ink) / rasterBefore.ink;
  expect(diff, `文字与轮廓的墨迹面积差 ${(diff * 100).toFixed(2)}%`).toBeLessThan(0.05);

  // 一笔撤销：回到文本框（不是「先退回一个中间态」）。
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await readDoc(page)).elements[0]?.kind).toBe('text');
});

test('行内多色：按颜色拆成多个图形并成组，仍然一步撤销', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await page.evaluate((id) => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    A.store.commit('e2e: 设多色文本', (p) => {
      const proj = p as { tracks: { clips: { id: string; source?: { doc?: DocShape } }[] }[] };
      for (const t of proj.tracks) {
        for (const c of t.clips) {
          if (c.id !== id || !c.source?.doc) continue;
          const el = c.source.doc.elements[0]!;
          el.runs = [
            { text: 'Red ', style: { color: '#ff0000' } },
            { text: 'Green', style: { color: '#00ff00' } },
          ];
          el.style = { ...el.style, fontFamily: 'Inter', fontWeight: 700 };
        }
      }
    });
  }, clipId);
  await openEditor(page, clipId);
  await selectFirst(page);

  await page.getByTestId('typo-text-to-path').click();
  await expect.poll(async () => (await readDoc(page)).elements.length).toBe(2);

  const after = await readDoc(page);
  const [red, green] = after.elements as unknown as {
    kind: string;
    shape: string;
    fill: { kind: string; color?: string };
    groupId?: string;
  }[];
  expect(red!.kind).toBe('shape');
  expect(green!.kind).toBe('shape');
  expect(red!.fill).toMatchObject({ kind: 'solid', color: '#ff0000' });
  expect(green!.fill).toMatchObject({ kind: 'solid', color: '#00ff00' });
  // 两个图形属于同一个组：拖动 / 选择仍是一件事。
  expect(red!.groupId).toBeTruthy();
  expect(red!.groupId).toBe(green!.groupId);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await readDoc(page)).elements.length).toBe(1);
  expect((await readDoc(page)).elements[0]!.kind).toBe('text');
});

test('文本框底色 / 高亮 / 下划线都跟着转（不是只转字形）', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await page.evaluate((id) => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    A.store.commit('e2e: 设装饰', (p) => {
      const proj = p as { tracks: { clips: { id: string; source?: { doc?: DocShape } }[] }[] };
      for (const t of proj.tracks) {
        for (const c of t.clips) {
          if (c.id !== id || !c.source?.doc) continue;
          const el = c.source.doc.elements[0]! as unknown as Record<string, unknown>;
          el.runs = [{ text: 'Hi', style: { highlight: '#ffee00', textDecoration: 'underline' } }];
          el.style = { ...(el.style as object), fontFamily: 'Inter', fontWeight: 700, color: '#ffffff' };
          el.boxFill = { kind: 'solid', color: '#112233' };
          el.boxStroke = { color: '#445566', width: 6, style: 'solid' };
        }
      }
    });
  }, clipId);
  await openEditor(page, clipId);
  await selectFirst(page);

  await page.getByTestId('typo-text-to-path').click();
  await expect.poll(async () => (await readDoc(page)).elements.length).toBe(4);

  const after = await readDoc(page);
  const els = after.elements as unknown as {
    kind: string;
    shape: string;
    path?: string;
    fill: { kind: string; color?: string };
    stroke?: { color: string; width: number };
    groupId?: string;
  }[];
  // 顺序 = 落层顺序：文本框 → 高亮 → 字形 → 下划线。
  expect(els[0]!.shape).toBe('rect');
  expect(els[0]!.fill).toMatchObject({ kind: 'solid', color: '#112233' });
  expect(els[0]!.stroke).toMatchObject({ color: '#445566', width: 6 });
  expect(els[1]!.fill).toMatchObject({ kind: 'solid', color: '#ffee00' });
  expect(els[2]!.fill).toMatchObject({ kind: 'solid', color: '#ffffff' });
  expect((els[2]!.path!.match(/M/g) ?? []).length).toBeGreaterThan(1);
  expect(els[3]!.fill).toMatchObject({ kind: 'solid', color: '#ffffff' });
  expect((els[3]!.path!.match(/M/g) ?? []).length).toBeGreaterThan(0);
  expect(new Set(els.map((e) => e.groupId)).size).toBe(1);
});

test('系统字体：从本机字体接口取字体文件，不需要导入', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  /*
   * 造一个「本机已装」的字体：族名不与任何注册字体重名，字节用内置 Inter 700。
   * 这样不依赖跑测试那台机器装了哪些字体，但**走的是真实的 Local Font Access
   * 记录形状**（family / style / blob），能验证「查询 → 挑面 → blob → 轮廓」整条链。
   */
  await page.evaluate(async () => {
    const buf = await (await fetch('/fonts/inter-latin-700.ttf')).arrayBuffer();
    const blob = new Blob([buf]);
    (window as unknown as { queryLocalFonts: unknown }).queryLocalFonts = async () => [
      {
        family: 'E2E System Sans',
        fullName: 'E2E System Sans Bold',
        postscriptName: 'E2ESystemSans-Bold',
        style: 'Bold',
        blob: async () => blob,
      },
    ];
  });
  await page.evaluate((id) => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    A.store.commit('e2e: 本机字体', (p) => {
      const proj = p as { tracks: { clips: { id: string; source?: { doc?: DocShape } }[] }[] };
      for (const t of proj.tracks) {
        for (const c of t.clips) {
          if (c.id !== id || !c.source?.doc) continue;
          const el = c.source.doc.elements[0]!;
          el.runs = [{ text: 'Local Font 42' }];
          el.style = { ...el.style, fontFamily: 'E2E System Sans', fontWeight: 700 };
        }
      }
    });
  }, clipId);
  await openEditor(page, clipId);
  await selectFirst(page);

  await page.getByTestId('typo-text-to-path').click();
  await expect.poll(async () => (await readDoc(page)).elements[0]?.kind).toBe('shape');
  const after = await readDoc(page);
  expect(after.elements[0]!.pathUnit).toBe('px');
  expect((after.elements[0]!.path!.match(/M/g) ?? []).length).toBeGreaterThan(1);
});

test('本机字体没授权：给出授权提示，文档原样不动', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await page.evaluate(() => {
    // 规范约定「拒绝授权 ⇒ resolve 空数组」。
    (window as unknown as { queryLocalFonts: unknown }).queryLocalFonts = async () => [];
  });
  await page.evaluate((id) => {
    const A = (window as never as { __artmatic: Hooks }).__artmatic;
    A.store.commit('e2e: 本机字体未授权', (p) => {
      const proj = p as { tracks: { clips: { id: string; source?: { doc?: DocShape } }[] }[] };
      for (const t of proj.tracks) {
        for (const c of t.clips) {
          if (c.id !== id || !c.source?.doc) continue;
          const el = c.source.doc.elements[0]!;
          el.runs = [{ text: 'Need Permission' }];
          el.style = { ...el.style, fontFamily: 'E2E System Sans' };
        }
      }
    });
  }, clipId);
  await openEditor(page, clipId);
  await selectFirst(page);

  await page.getByTestId('typo-text-to-path').click();
  await page.waitForFunction(
    () => {
      const A = (window as never as { __artmatic: { appState: { notice: string | null } } }).__artmatic;
      // `typo.textToPathLocalDenied` 的说法是「需要读取权限」。
      return (A.appState.notice ?? '').includes('读取权限');
    },
    undefined,
    { timeout: 20_000 },
  );
  const after = await readDoc(page);
  expect(after.elements).toHaveLength(1);
  expect(after.elements[0]!.kind).toBe('text');
});

test('字体里没有的字：给出缺字提示，文档原样不动', async ({ page }) => {
  await boot(page);
  const clipId = await addTextClip(page);
  await openEditor(page, clipId);
  await selectFirst(page);

  const before = await readDoc(page);
  // 默认文本框是中文 + Inter（不含 CJK 字形）——正是「浏览器用回落字体画」的场景。
  await page.getByTestId('typo-text-to-path').click();

  /*
   * 底栏是**单槽位**、2.6 秒后自动消失：先把「当前提示」等出来，再在**同一次**
   * evaluate 里读 level。分两步断言会撞上「刚读到文本、下一条提示已经把它换了」
   * ——第一次写这条时就是这么偶发失败的。
   */
  const state = await page
    .waitForFunction(
      () => {
        const A = (window as never as { __artmatic: { appState: { notice: string | null; noticeLevel: string } } })
          .__artmatic;
        const text = A.appState.notice ?? '';
        return text.includes('没有这些字') ? { text, level: A.appState.noticeLevel } : false;
      },
      undefined,
      { timeout: 20_000 },
    )
    .then((h) => h.jsonValue() as Promise<{ text: string; level: string }>);

  expect(state.level).toBe('error');
  expect(state.text).toContain('Inter');

  const after = await readDoc(page);
  expect(after.elements[0]!.kind).toBe('text');
  expect(after.elements[0]!.runs?.map((r) => r.text).join('')).toBe(
    before.elements[0]!.runs?.map((r) => r.text).join(''),
  );
});
