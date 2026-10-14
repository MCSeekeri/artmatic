import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 跨剪切点两帧预览（达芬奇式交互）。
 *
 * 根因：命中判据是**左闭右开**（`engine/stack.ts`：`t >= clip.end` 的片段不参与合成），
 * 所以播放头停在剪切点时预览显示的是下游片段的开头 —— 在末尾帧打关键帧是盲操。
 *
 * 这里守两件事：
 *  1. 播放头卡在切点时，在**预览画面**上横向轻拖 → 左右并排显示「前帧 / 后帧」；
 *     后无片段时右半为黑。松手恢复单幅。
 *  2. 检查器正在设置某条片段的关键帧值时，**不用拖**也自动并排；停止设值即收起。
 *
 * 断言能区分「并排」与「单幅」：既看 DOM（两块面板是否可见），又直接读两块面板
 * 画布的像素（左红右蓝 / 右黑）——不是只看 store。
 */

/* ---------------------------------------------------------------- 脚手架 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

interface CutStage {
  track: string;
  aId: string;
  bId: string;
}

/**
 * 搭一条只有两个**紧邻**纯色片段的轨道（关掉 demo 全部轨道）。
 * `cut` 既是上游的 end、也是下游的 start —— 正是「两片段之间」那个点。
 * 上游片段预置一条 opacity 曲线（自动模式用例要用到「已经有曲线」这个前提）。
 */
async function buildCutStage(
  page: Page,
  opts: { cut?: number; a?: string; b?: string; withCurve?: boolean; single?: boolean } = {},
): Promise<CutStage> {
  const cut = opts.cut ?? 2;
  const a = opts.a ?? '#ff0000';
  const b = opts.b ?? '#0000ff';
  return page.evaluate(
    ({ cut, a, b, withCurve, single }) => {
      const A = (window as never as { __artmatic: { store: never } & Record<string, never> })
        .__artmatic as unknown as {
        store: {
          commit: (label: string, fn: (p: { tracks: { id: string; enabled: boolean }[] }) => void) => void;
          addTrack: (kind: 'visual', name?: string) => string;
          addClip: (track: string, clip: unknown) => void;
        };
      };
      const base = {
        fadeSec: 0,
        curves: {} as Record<string, unknown>,
        transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
        fit: 'stretch' as const,
      };
      A.store.commit('e2e: 清空舞台', (p) => {
        for (const t of p.tracks) t.enabled = false;
      });
      const track = A.store.addTrack('visual', 'CUT');
      A.store.addClip(track, {
        ...base,
        curves: withCurve
          ? { opacity: { keys: [{ t: 0, v: 1, interp: 'linear' }, { t: cut, v: 0.25, interp: 'linear' }] } }
          : {},
        kind: 'source',
        id: 'cut-a',
        start: 0,
        end: cut,
        label: 'a',
        source: { type: 'solid', color: a },
        blend: 'normal',
        opacity: 1,
      });
      if (!single) {
        A.store.addClip(track, {
          ...base,
          kind: 'source',
          id: 'cut-b',
          start: cut,
          end: cut + 2,
          label: 'b',
          source: { type: 'solid', color: b },
          blend: 'normal',
          opacity: 1,
        });
      }
      A.store.commit('e2e: 启用舞台', (p) => {
        for (const t of p.tracks) t.enabled = t.id === track;
      });
      return { track, aId: 'cut-a', bId: 'cut-b' };
    },
    { cut, a, b, withCurve: opts.withCurve ?? false, single: opts.single ?? false },
  );
}

/** 把播放头放到切点（并等一帧，让 rAF 循环把画面渲出来）。 */
async function seekTo(page: Page, t: number): Promise<void> {
  await page.evaluate((tt) => {
    (window as never as { __artmatic: { appState: { seek: (t: number) => void } } }).__artmatic.appState.seek(tt);
  }, t);
  await page.waitForTimeout(120);
}

/** 读一块面板画布中心像素（返回 [r,g,b]）。 */
async function panelCenter(page: Page, testid: 'split-left' | 'split-right'): Promise<[number, number, number]> {
  return page.evaluate((id) => {
    const c = document.querySelector(`[data-testid=${id}]`) as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  }, testid);
}

/** 在预览画面中心按下并横向拖 `dx`（默认不松手）。 */
async function startPreviewDrag(page: Page, dx: number): Promise<void> {
  const box = (await page.locator('.preview').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 5 });
}

/* ------------------------------------------------------------ 1. 拖拽 */

test('拖拽预览揭示剪切点两帧并排：左为前帧（红）、右为后帧（蓝）', async ({ page }) => {
  await boot(page);
  await buildCutStage(page, { cut: 2, a: '#ff0000', b: '#0000ff' });
  await seekTo(page, 2);

  // 停在切点但不拖 → 仍是单幅。
  await expect(page.getByTestId('split-view')).toBeHidden();

  await startPreviewDrag(page, 24);
  await expect(page.getByTestId('split-view')).toBeVisible();
  await expect(page.getByTestId('split-left')).toBeVisible();
  await expect(page.getByTestId('split-right')).toBeVisible();

  const left = await panelCenter(page, 'split-left');
  const right = await panelCenter(page, 'split-right');
  // 左 = 上游片段最后一帧（红）
  expect(left[0], `左半应为上游的红帧，实测 ${left}`).toBeGreaterThan(180);
  expect(left[2], `左半应为红而非蓝，实测 ${left}`).toBeLessThan(70);
  // 右 = 下游片段首帧（蓝）
  expect(right[2], `右半应为下游的蓝帧，实测 ${right}`).toBeGreaterThan(180);
  expect(right[0], `右半应为蓝而非红，实测 ${right}`).toBeLessThan(70);

  // 松手 → 恢复单幅。
  await page.mouse.up();
  await expect(page.getByTestId('split-view')).toBeHidden();
});

test('播放头不在剪切点时，拖拽不出现并排', async ({ page }) => {
  await boot(page);
  await buildCutStage(page, { cut: 2 });
  await seekTo(page, 1); // 上游片段内部，不是切点
  await startPreviewDrag(page, 24);
  await expect(page.getByTestId('split-view')).toBeHidden();
  await page.mouse.up();
});

/* ------------------------------------------------- 2. 后无片段 → 右侧黑 */

test('切点是最后一段的结尾时，右半为黑', async ({ page }) => {
  await boot(page);
  await buildCutStage(page, { cut: 2, a: '#00ff00', single: true });
  await seekTo(page, 2);

  await startPreviewDrag(page, 24);
  await expect(page.getByTestId('split-view')).toBeVisible();

  const left = await panelCenter(page, 'split-left');
  const right = await panelCenter(page, 'split-right');
  expect(left[1], `左半应为上游的绿帧，实测 ${left}`).toBeGreaterThan(180);
  const lum = right[0] + right[1] + right[2];
  expect(lum, `切点后没有片段，右半应为纯黑，实测 ${right}`).toBeLessThan(30);

  await page.mouse.up();
});

/* --------------------------------------------- 3. 自动模式（编辑信号） */

test('正在设置关键帧值时自动并排，无需拖动；停止后收起', async ({ page }) => {
  await boot(page);
  await buildCutStage(page, { cut: 2 });
  await seekTo(page, 2);
  await expect(page.getByTestId('split-view')).toBeHidden();

  // 模拟检查器里上游片段的关键帧字段正在被设值。
  await page.evaluate(() => {
    (window as never as {
      __artmatic: { appState: { beginEditKey: (c: string, k: string) => void } };
    }).__artmatic.appState.beginEditKey('cut-a', 'opacity');
  });
  await expect(page.getByTestId('split-view')).toBeVisible();

  await page.evaluate(() => {
    (window as never as { __artmatic: { appState: { endEditKey: () => void } } }).__artmatic.appState.endEditKey();
  });
  await expect(page.getByTestId('split-view')).toBeHidden();
});

test('设值的那条片段不在这个切点上时不自动并排', async ({ page }) => {
  await boot(page);
  const stage = await buildCutStage(page, { cut: 2 });
  await seekTo(page, 2);

  // 下游片段（cut-b）确实在切点上 → 会亮。
  await page.evaluate(() => {
    (window as never as {
      __artmatic: { appState: { beginEditKey: (c: string, k: string) => void } };
    }).__artmatic.appState.beginEditKey('cut-b', 'opacity');
  });
  await expect(page.getByTestId('split-view')).toBeVisible();

  // 换成一个与切点无关的 id → 立刻收起。
  await page.evaluate((id) => {
    (window as never as {
      __artmatic: { appState: { beginEditKey: (c: string, k: string) => void } };
    }).__artmatic.appState.beginEditKey(`${id}-nope`, 'opacity');
  }, stage.bId);
  await expect(page.getByTestId('split-view')).toBeHidden();

  await page.evaluate(() => {
    (window as never as { __artmatic: { appState: { endEditKey: () => void } } }).__artmatic.appState.endEditKey();
  });
});

/* -------------------------- 4. 真实控件把「正在设置关键帧」写进 appState */

test('拖动检查器的可关键帧滑杆会写入编辑信号，松手清空', async ({ page }) => {
  await boot(page);
  await buildCutStage(page, { cut: 2, withCurve: true });
  await seekTo(page, 2);

  // 选中上游片段 → 检查器展开它的字段（含已曲线的「不透明度」）。
  await page.evaluate(() => {
    (window as never as { __artmatic: { appState: { selectedClipId: string | null } } }).__artmatic.appState.selectedClipId =
      'cut-a';
  });

  const opacity = page.getByRole('slider', { name: '不透明度' });
  await expect(opacity).toBeVisible();
  await opacity.scrollIntoViewIfNeeded();

  const b = (await opacity.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 18, b.y + b.height / 2, { steps: 4 });

  const editing = await page.evaluate(() => {
    return (window as never as {
      __artmatic: { appState: { editingKey: { clipId: string; curveKey: string } | null } };
    }).__artmatic.appState.editingKey;
  });
  expect(editing, '拖动已曲线的滑杆应写入编辑信号').not.toBeNull();
  expect(editing!.clipId).toBe('cut-a');
  expect(editing!.curveKey).toBe('opacity');

  // 自动模式在场：上游片段正在设值且播放头在它的出点。
  await expect(page.getByTestId('split-view')).toBeVisible();

  await page.mouse.up();
  const after = await page.evaluate(() => {
    return (window as never as {
      __artmatic: { appState: { editingKey: unknown } };
    }).__artmatic.appState.editingKey;
  });
  expect(after, '松手后编辑信号应清空').toBeNull();
  await expect(page.getByTestId('split-view')).toBeHidden();
});
