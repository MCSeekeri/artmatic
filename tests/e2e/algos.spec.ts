import { expect, test, type Page } from '@playwright/test';
import { openDemo, buildStage, hashAt, meanAt, renderTwiceStats, waitForSourceReady } from './_stage';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

/*
 * 三条用例原来都往 **demo 工程**上叠片段：addTrack 是 push，新轨落在最底层，
 * 于是它们断言的是 demo 的画面而不是自己的。现在统一从空舞台起步（buildStage）。
 *
 * 「同一 t 连渲两次逐像素一致」这类断言还必须**每次求值前清反馈历史** ——
 * 契约见 determinism.spec.ts：「连渲同一 t 不清历史是在泵历史，本身就不该一致」。
 * renderTwiceDiff 默认就按契约来。
 */

test('Rule 110 上轨：非黑、逐像素确定、生长前沿随 t 推进', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'r110',
    source: { type: 'algo', generator: 'rule110' },
    end: 8,
  });

  // 烘焙是 Worker 异步的：**从 Node 侧**轮询等它落地。
  // 固定 waitForTimeout(2500) 在机器有负载时不够 —— 烘焙中途落地会被
  // 误判成「非确定」（这不是非确定，是异步就绪）。
  // 也不要在 page 里忙轮询：持续的 rAF + readPixels 会把 worker 回包饿死在队列里。
  await waitForSourceReady(page, 6, { minMean: 1, timeoutMs: 20_000 });

  const mean6 = await meanAt(page, 6);
  expect(mean6).toBeGreaterThan(20);

  /*
   * 确定性：同一历史状态下同一 t 必须同帧。
   *
   * 判据取**比例**而不是 `diff === 0`：rule110 默认 1024×512 → 预览正是
   * 「非整数倍缩放采样」那一类，逐字节相等做不到（`_stage.ts::renderTwiceStats`
   * 与 `AGENTS.md` §1.3 都记了这条）；`algo-pattern.spec` 对同一生成器用的也是 1%。
   * 写 `=== 0` 时这条只是碰巧绿，换台机器就会偶发红。
   */
  const twice = await renderTwiceStats(page, 6, true);
  expect(twice.total, '两次读回的字节数为 0 —— 判据没有分母，下面那条是空转').toBeGreaterThan(0);
  expect(twice.bytes / twice.total).toBeLessThan(0.01);

  // 生长前沿：t=1（front 小）与 t=7（front 大）的亮度差
  const early = await meanAt(page, 1);
  const late = await meanAt(page, 7);
  expect(late - early).toBeGreaterThan(1);
});

test('生命游戏：seek 回退再前进与顺序播放逐像素一致', async ({ page }) => {
  await boot(page);
  // game-of-life 是 sim 型（同步 + 快照重放），没有异步烘焙要等。
  await buildStage(page, {
    id: 'gol',
    source: { type: 'algo', generator: 'game-of-life' },
    end: 8,
  });

  const diff = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
        renderer: { onSeek: () => void };
      };
    }).__artmatic;

    // 顺序播放到 t=40/30（simFrame=16），留档
    for (let i = 0; i <= 40; i++) A.renderFrame(i / 30);
    const sequential = A.readPixels().data;
    // seek 回 t=10/30（走快照重放），再回到 t=40/30
    A.renderer.onSeek();
    A.renderFrame(10 / 30);
    A.renderFrame(40 / 30);
    const replayed = A.readPixels().data;
    let d = 0;
    for (let i = 0; i < sequential.length; i++) if (sequential[i] !== replayed[i]) d++;
    return d;
  });
  expect(diff).toBe(0);
});

test('Mandelbrot：zoom 关键帧曲线改变画面且逐帧确定', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'mb',
    source: { type: 'algo', generator: 'mandelbrot' },
    end: 4,
    // 缓慢推近：0 → 4（clip 相对）
    curves: {
      zoom: {
        keys: [
          { t: 0, v: 0, interp: 'linear' },
          { t: 3, v: 4, interp: 'linear' },
        ],
      },
    },
  });

  // 非空（防止下面那条「不同 t 不同」在比两张黑图）
  expect(await meanAt(page, 3)).toBeGreaterThan(0);

  // zoom 曲线确实改变了画面
  expect(await hashAt(page, 0)).not.toBe(await hashAt(page, 3));

  // 确定性：同一历史状态下同一 t 必须同帧（判据同上：比例，不是逐字节 0）
  const twiceZoom = await renderTwiceStats(page, 1.5, true);
  expect(twiceZoom.total).toBeGreaterThan(0);
  expect(twiceZoom.bytes / twiceZoom.total).toBeLessThan(0.01);
});
