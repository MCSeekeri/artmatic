import { expect, test, type Page } from '@playwright/test';
import { openDemo, buildTransitionStage, clearTransition, rgbMeanAt, renderTwiceDiff, hashAt, settle } from './_stage';

/**
 * 转场（gl-transitions）的 E2E。
 *
 * 分两层：
 *   1. **全量编译** —— 122 条第三方 GLSL 在这台机器上都能编译出来。
 *      这是它们唯一的自动化防线：着色器是惰性编译的，语法错误在你点到它之前
 *      不报（`effects/compile-all.ts` 的存在理由）。
 *   2. **管线语义** —— 窗口位置、progress、规范不变量（p=0 只显示 from）、
 *      确定性、以及「删掉转场画面必须变」。
 *
 * 断言一律走 GPU 读回 + page 内标量归约，不做截图比对。颜色断言用**单通道**均值
 * （红→蓝的整帧均值会把通道差异平均掉，见 `_stage.ts::rgbMeanAt`）。
 */

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
  expect(errors).toEqual([]);
}

/** 纯色帧的容差：RGBA8 量化 + 8bit 混合舍入。 */
const TOL = 2;

function near(actual: number[], expected: number[], tol = TOL): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((v, i) => {
    expect(Math.abs(v - expected[i]!), `${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`).toBeLessThanOrEqual(tol);
  });
}

test('全量转场在这台机器上都能编译（122 条第三方 GLSL 的防线）', async ({ page }) => {
  await boot(page);
  const outcome = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { compileAll: () => { okCount: number; total: number; failures: { id: string; error?: string }[] } };
    }).__artmatic;
    return A.compileAll();
  });

  expect(
    outcome.failures,
    '编译失败的转场要在 transitions/catalog.ts 的台账里给出理由（结构性不可能的条目应该在目录层就被拒）',
  ).toEqual([]);
  expect(outcome.okCount).toBe(outcome.total);
  expect(outcome.total).toBeGreaterThan(100); // 转场 + 特效 + realtime 算法
});

test('转场窗口：位置、progress、以及「p=0 只显示 from」的规范不变量', async ({ page }) => {
  await boot(page);
  // from = 红 [0,2]，to = 蓝 [2,4]，fade d=1 → 窗口 [1.5, 2.5)
  await buildTransitionStage(page, {
    fromColor: '#ff0000',
    toColor: '#0000ff',
    cut: 2,
    toDuration: 2,
    defId: 'fade',
    duration: 1,
  });
  await settle(page, 2);

  // 覆盖率断言先来：窗口两侧必须真的是各自的纯色，否则下面的一切都测不到东西
  near(await rgbMeanAt(page, 1.2), [255, 0, 0]);
  near(await rgbMeanAt(page, 2.8), [0, 0, 255]);

  // 规范 v1：progress = 0 时只显示 from
  near(await rgbMeanAt(page, 1.5), [255, 0, 0]);
  // progress = 0.5：两边的通道各出一半
  near(await rgbMeanAt(page, 2.0), [127.5, 0, 127.5]);
  // 窗口后半段（t 已越过 from.end）依然在混合 —— 这是 stack 里
  // 「转场判断必须在 span 过滤之前」的直接后果
  const late = await rgbMeanAt(page, 2.4);
  expect(late[0]).toBeLessThan(80);
  expect(late[2]).toBeGreaterThan(180);
});

test('转场是确定性的：窗口内同一 t 渲两次逐像素一致', async ({ page }) => {
  await boot(page);
  await buildTransitionStage(page, {
    fromColor: '#ff0000',
    toColor: '#0000ff',
    cut: 2,
    toDuration: 2,
    defId: 'fade',
    duration: 1,
  });
  // 窗口中点 + 窗口后半段各测一次
  expect(await renderTwiceDiff(page, 2.0)).toBe(0);
  expect(await renderTwiceDiff(page, 2.4)).toBe(0);
});

test('删掉转场后画面必须变（证明被测对象真的在画面上）', async ({ page }) => {
  await boot(page);
  const stage = await buildTransitionStage(page, {
    fromColor: '#ff0000',
    toColor: '#0000ff',
    cut: 2,
    toDuration: 2,
    defId: 'fade',
    duration: 1,
  });

  const withTransition = await rgbMeanAt(page, 2.0);
  near(withTransition, [127.5, 0, 127.5]);

  await clearTransition(page, stage.fromId);

  // 没有转场时 t=2.0 已经属于入画片段（from 出界）→ 纯蓝
  near(await rgbMeanAt(page, 2.0), [0, 0, 255]);
});

test('换一条转场（circleopen）画面与 fade 不同 —— defId 与 uniform 真的接上了', async ({ page }) => {
  await boot(page);
  await buildTransitionStage(page, {
    fromColor: '#ff0000',
    toColor: '#0000ff',
    cut: 2,
    toDuration: 2,
    defId: 'fade',
    duration: 1,
  });
  const fadeHash = await hashAt(page, 2.0);

  await buildTransitionStage(page, {
    fromColor: '#ff0000',
    toColor: '#0000ff',
    cut: 2,
    toDuration: 2,
    defId: 'circleopen',
    duration: 1,
  });
  const circleHash = await hashAt(page, 2.0);

  expect(circleHash).not.toBe(fadeHash);

  /*
   * circleopen 是几何擦除：progress=0.5 时圆心是「入画」、四角还是「出画」，
   * 于是红与蓝**同时成片出现**。这条比「均值变了」强得多 —— 它证明的是
   * 「选的这条转场真的在按自己的算法画」，而不是「画面动了一下」。
   *
   * 顺带记一笔：`dissolve` 是**亮度驱动的烧灼**（`show = burn(from) - progress`），
   * 纯红 from 的 burn = 0.6495，所以 p=0.5 时整帧仍是红的 —— 拿它做这条断言
   * 会得到一个「看起来像 bug」的假失败。集合里有不少条目名字与算法并不对应。
   */
  const split = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
        renderer: { onSeek: () => void };
      };
    }).__artmatic;
    A.renderer.onSeek();
    A.renderFrame(2);
    const d = A.readPixels().data;
    let reddish = 0;
    let bluish = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i]! > 200 && d[i + 2]! < 55) reddish += 1;
      if (d[i + 2]! > 200 && d[i]! < 55) bluish += 1;
    }
    return { reddish, bluish };
  });
  expect(split.reddish).toBeGreaterThan(1000);
  expect(split.bluish).toBeGreaterThan(1000);
});

test('留缝时转场退化为「淡到透明」（v13：另一侧没有片段 = 全透明）', async ({ page }) => {
  const errors: string[] = [];
  await boot(page);
  page.on('pageerror', (e) => errors.push(String(e)));

  const stage = await buildTransitionStage(page, {
    fromColor: '#ff0000',
    toColor: '#0000ff',
    cut: 2,
    toDuration: 2,
    defId: 'fade',
    duration: 1,
  });

  // 把入画片段推开 0.5s：转场不再成立（transitionCut → not-adjacent）
  await page.evaluate(
    ({ toId }) => {
      const A = (window as never as {
        __artmatic: {
          store: {
            commit: (
              label: string,
              fn: (p: { tracks: { clips: { id: string; start: number; end: number }[] }[] }) => void,
            ) => void;
          };
        };
      }).__artmatic;
      A.store.commit('e2e: 推远入画片段', (p) => {
        for (const t of p.tracks) {
          for (const c of t.clips) {
            if (c.id === toId) {
              c.start = 2.5;
              c.end = 4.5;
            }
          }
        }
      });
    },
    { toId: stage.toId },
  );

  /*
   * 缝隙里没有片段，所以转场的右半侧是全透明：fade 把红色淡到 0。
   * progress = (2.2 - 1.5) / 1 = 0.7 → 只剩 30% 红≈76（读回是预乘 alpha）。
   */
  const mid = await rgbMeanAt(page, 2.2);
  expect(mid[1]).toBeLessThan(8);
  expect(mid[2]).toBeLessThan(8);
  expect(mid[0]).toBeGreaterThan(55);
  expect(mid[0]).toBeLessThan(105);

  // 窗口外：from 仍是纯红，缝隙之后的入画片段仍是纯蓝
  near(await rgbMeanAt(page, 1.2), [255, 0, 0]);
  near(await rgbMeanAt(page, 2.8), [0, 0, 255]);
  expect(errors).toEqual([]);
});

test('检查器：带筛选地选转场、时间轴出现窗口涂层、选「无」能撤掉', async ({ page }) => {
  const errors: string[] = [];
  await boot(page);
  page.on('pageerror', (e) => errors.push(String(e)));

  // 基线：demo 工程自带若干转场（那是它的展示内容之一），涂层是**每条轨都画**的，
  // 与被测轨是否 enabled 无关。所以这里比相对量，不断言绝对条数 —— 写死数字
  // 等于把「demo 里有几个转场」也一起钉进这个用例。
  // 先轮询等到时间轴画完第一遍，否则读到的是 0（`boot` 只保证 __artmatic 在了）。
  await expect
    .poll(() => page.getByTestId('transition-marker').count(), {
      message: '开箱 demo 应当自带转场 —— 零个说明它没被渲染出来',
    })
    .toBeGreaterThan(0);
  const demoMarkers = await page.getByTestId('transition-marker').count();

  const stage = await buildTransitionStage(page, {
    fromColor: '#ff0000',
    toColor: '#0000ff',
    cut: 2,
    toDuration: 2,
    defId: 'fade',
    duration: 1,
  });

  // 选中出画片段 → 检查器出现转场小节，时间轴出现窗口涂层
  await page.locator(`[data-clip-id="${stage.fromId}"]`).click();
  await expect(page.getByTestId('transition-section')).toBeVisible();
  await expect(page.getByTestId('transition-marker')).toHaveCount(demoMarkers + 1);

  // 122 条转场：靠选择器的搜索框找目标，而不是在一个下拉里滚
  await page.getByTestId('open-transition-picker').click();
  await expect(page.getByTestId('modal-transition-picker')).toBeVisible();
  await page.getByTestId('transition-picker-search').fill('circle');
  await page.locator('[data-testid=transition-picker-item][data-transition-id="circleopen"]').click();
  await page.getByTestId('transition-picker-confirm').click();
  await expect(page.getByTestId('modal-transition-picker')).toHaveCount(0);

  const afterPick = await page.evaluate((id) => {
    const A = (window as never as {
      __artmatic: {
        store: { findClip: (id: string) => { clip: { transitionOut?: { defId: string; duration: number } } } | null };
      };
    }).__artmatic;
    return A.store.findClip(id)?.clip.transitionOut ?? null;
  }, stage.fromId);
  expect(afterPick?.defId).toBe('circleopen');
  expect(afterPick?.duration).toBeCloseTo(1, 6);

  // 选「无转场」= 删除，涂层随之消失（回到 demo 自带的那些）
  await page.getByTestId('open-transition-picker').click();
  await page.getByTestId('transition-picker-none').click();
  await page.getByTestId('transition-picker-confirm').click();
  await expect(page.getByTestId('transition-marker')).toHaveCount(demoMarkers);

  const afterClear = await page.evaluate((id) => {
    const A = (window as never as {
      __artmatic: {
        store: { findClip: (id: string) => { clip: { transitionOut?: unknown } } | null };
      };
    }).__artmatic;
    return A.store.findClip(id)?.clip.transitionOut ?? null;
  }, stage.fromId);
  expect(afterClear).toBeNull();

  expect(errors).toEqual([]);
});
