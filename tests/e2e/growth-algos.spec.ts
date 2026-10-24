import { expect, test, type Page } from '@playwright/test';
import { openDemo, buildStage, gridL1, gridStats, waitForSourceReady } from './_stage';

/**
 * Wave 4 批次 3 的 E2E：Buddhabrot（sim）+ 混沌游戏 / DLA（bake）。
 *
 * 三条纪律与 `algos3d.spec.ts` 一致：
 *
 * 1. **「两个配置不同」的断言前面必须先证明两边都不空**，否则「两张黑图不同」
 *    会假通过（Wave 1 踩过这个坑）。
 * 2. 判据用**分块 L1**，不用「覆盖像素数之差」也不用逐像素相等（理由见
 *    `_stage.ts::gridStats`）。
 * 3. **每个配置都要重载页面** —— `buildStage` 是加轨，而 `addTrack` 是 push。
 *
 * bake 型的画面要等 Worker 烘完，所以走 `waitForSourceReady`（从 Node 侧轮询，
 * 不在 page 里自旋）。`minMean` 给得很低（0.5）：DLA / 混沌游戏的图是**居中的
 * 一个方块**，在 16:9 画幅里只占中间一条，整幅均值本来就小 —— 拿「整幅非黑」
 * 的阈值来等会白等到超时。
 */

async function shootBake(
  page: Page,
  gen: string,
  params: Record<string, number | string>,
  t: number,
) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as never as { __artmatic?: unknown }).__artmatic));
  await openDemo(page);
  await buildStage(page, {
    id: `m-${gen}`,
    source: { type: 'algo', generator: gen, params },
    end: t + 8,
  });
  await waitForSourceReady(page, t, { minMean: 0.5, timeoutMs: 40_000 });
  return gridStats(page, t);
}

test('Buddhabrot：从噪声里显影出结构，且 zoom 真的改变视野', async ({ page }) => {
  test.setTimeout(180_000);

  const a = await shootBake(page, 'buddhabrot', { size: 256, batch: 800, maxIter: 256 }, 20);
  expect(a.lit / a.total, '采样到位后应当铺满很大一片（底噪 + 结构）').toBeGreaterThan(0.5);
  expect(a.mean, '不能是一整幅全黑').toBeGreaterThan(3);

  const b = await shootBake(page, 'buddhabrot', { size: 256, batch: 800, maxIter: 256, zoom: 4 }, 20);
  expect(b.mean, 'zoom=4 也要有东西，否则下面的「不同」是空转').toBeGreaterThan(3);
  expect(gridL1(a.grid, b.grid), 'zoom 应当换一整张图（分块 L1）').toBeGreaterThan(20);
});


test('混沌游戏：N 变了图就变（两个配置都得有东西）', async ({ page }) => {
  test.setTimeout(180_000);
  const tri = await shootBake(page, 'chaos-game', { vertices: 3, size: 512, points: 400000 }, 10);
  const pen = await shootBake(page, 'chaos-game', { vertices: 5, size: 512, points: 400000 }, 10);
  expect(tri.mean, 'N=3 的空帧会让下面的「不同」变成空转').toBeGreaterThan(1);
  expect(pen.mean, 'N=5 的空帧同上').toBeGreaterThan(1);
  expect(gridL1(tri.grid, pen.grid), 'N=3 与 N=5 是两张完全不同的图').toBeGreaterThan(20);
});

test('DLA：长出了枝晶团，粒子数改变尺寸', async ({ page }) => {
  test.setTimeout(240_000);
  const small = await shootBake(page, 'dla', { size: 384, particles: 2000 }, 12);
  const big = await shootBake(page, 'dla', { size: 384, particles: 8000 }, 14);
  expect(small.mean, 'DLA 空帧会让下面的「不同」变成空转').toBeGreaterThan(0.5);
  expect(big.mean, 'DLA 空帧同上').toBeGreaterThan(0.5);
  /* 8 千粒的团明显比 2 千粒大（分形维数 1.7 ⇒ 半径约 ×2.3），分块 L1 必然分开。
     阈值 4 离噪声底（同参数两次加载 < 1）有量级余量。 */
  expect(gridL1(big.grid, small.grid), '粒子数应当改变画面（分块 L1）').toBeGreaterThan(4);
});
