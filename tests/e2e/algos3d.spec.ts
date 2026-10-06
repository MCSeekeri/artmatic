import { expect, test, type Page } from '@playwright/test';
import { gridL1, shootAlgo as shoot } from './_stage';

/**
 * 3D 光线步进生成器的 E2E。
 *
 * 这几个是**最贵**的生成器（每像素跑几十次 SDF，Mandelbulb 每次 SDF 又要迭代
 * 8 回），所以只断两件事，都是标量：
 *   1. 真的画出了实体（**覆盖像素数**，不是「均值 > 0」—— 均值会被几个亮像素
 *      抬起来，只画一条线的画面在它下面也会「通过」）；
 *   2. 换参数真的换画面（**先证明两边都不空**再比不同，否则「两张黑图不同」
 *      会假通过）。
 *
 * 「换了画面」的判据是**分块均值的 L1 距离**（实现在 `_stage.ts::gridStats`
 * / `gridL1`，那里写了为什么不可以用覆盖像素数之差、为什么不可以逐像素比）。
 * 阈值（4 / 10 / 20）离噪声底（0.000）有四个数量级的余量。
 *
 * ⚠️ **每个配置都要重载页面。** `buildStage` 是「加一条新轨」，而 `addTrack`
 * 是 push（新轨 z 更低）—— 连着调两次，第一条轨一直盖在上面，后面的测量全是
 * 在量第一个源。量帧成本时被骗过一次（10 个配置量出来一模一样）。
 *
 * 也**不做逐像素相等**：headless 里有一条已知的 GPU 读回竞态
 * （见 algo-sim.spec 头注）。
 */

test('Mandelbulb：画出实体、幂次真的改变形体', async ({ page }) => {
  test.setTimeout(120_000);

  const p8 = await shoot(page, 'mandelbulb', { intRes: '480', power: 8, iter: 8 });
  expect(p8.lit / p8.total, 'power=8 应当是一团实心结构').toBeGreaterThan(0.02);

  const p3 = await shoot(page, 'mandelbulb', { intRes: '480', power: 3, iter: 8 });
  expect(p3.lit / p3.total, 'power=3 也必须有实体，否则下面的「不同」是空转').toBeGreaterThan(
    0.005,
  );
  expect(Math.abs(p3.mean - p8.mean), 'power 应当改变画面').toBeGreaterThan(0.2);
  expect(gridL1(p3.grid, p8.grid), '两个幂次的画面应当处处不同（分块 L1）').toBeGreaterThan(20);
});

test('Mandelbulb：迭代次数决定细节层级（同幂次下画面不同）', async ({ page }) => {
  test.setTimeout(120_000);
  const a = await shoot(page, 'mandelbulb', { intRes: '480', power: 8, iter: 4 });
  const b = await shoot(page, 'mandelbulb', { intRes: '480', power: 8, iter: 12 });
  expect(a.lit / a.total, 'iter=4 也要有实体').toBeGreaterThan(0.02);
  expect(b.lit / b.total, 'iter=12 也要有实体').toBeGreaterThan(0.02);
  // 细节层级变了 ⇒ 分块亮度分布必然不同（面积可以几乎不变，见文件头）
  expect(gridL1(b.grid, a.grid), '迭代次数应当改变画面（分块 L1）').toBeGreaterThan(10);
});

test('Apollonian：画出球堆（不是一块平面 / 一条线），迭代次数改变层数', async ({ page }) => {
  test.setTimeout(120_000);

  const i8 = await shoot(page, 'apollonian', { intRes: '480', iter: 8, dist: 6 });
  expect(i8.lit / i8.total, '应当有实心球体').toBeGreaterThan(0.02);
  // DE 退化成 y=0 平面时（第一版那个 bug）画面会被一整块平面铺满
  expect(i8.lit / i8.total, '不该铺满整幅 —— 那是 DE 退化成平面的形态').toBeLessThan(0.9);

  const i4 = await shoot(page, 'apollonian', { intRes: '480', iter: 4, dist: 6 });
  expect(i4.lit / i4.total, 'iter=4 也要有实体').toBeGreaterThan(0.005);
  expect(Math.abs(i4.mean - i8.mean), '迭代次数应当改变球堆的层数').toBeGreaterThan(0.2);
  expect(gridL1(i4.grid, i8.grid), '迭代次数应当改变画面（分块 L1）').toBeGreaterThan(4);
});

/**
 * 跨页面加载的确定性 —— 也是上面那些 L1 阈值的**噪声底**。
 *
 * 分形的着色里没有时钟、没有随机：同参数同 t 在两次独立加载里必须给出同一
 * 张图（`u_seed` 走的也是 `hashSeed`，见硬约束 1.2）。用分块 L1 而不是逐像素
 * 相等，是因为 headless 有一条已知的 GPU 读回竞态（单帧 ±15 字节）。
 *
 * 这条同时把「L1 > N 才算画面变了」这个判据钉在地上：噪声底必须远小于 N，
 * 否则上面三条只是在量噪声。
 */
test('同参数跨两次加载逐块一致（分块 L1 的噪声底）', async ({ page }) => {
  test.setTimeout(120_000);
  const a = await shoot(page, 'mandelbulb', { intRes: '480', power: 8, iter: 8 });
  const b = await shoot(page, 'mandelbulb', { intRes: '480', power: 8, iter: 8 });
  const noise = gridL1(a.grid, b.grid);
  expect(noise, '同参数两次加载应当逐块一致（只允许读回竞态那点噪声）').toBeLessThan(1);
  expect(Math.abs(a.mean - b.mean)).toBeLessThan(0.05);
});
