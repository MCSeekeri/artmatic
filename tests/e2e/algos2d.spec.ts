import { expect, test } from '@playwright/test';
import { sampleL1, shootAlgo as shoot } from './_stage';
import { bitmapFromRows, encodePattern } from '../../src/algos/pattern-codec';

/**
 * 三个 2D 分形（newton / kleinian / lyapunov）的 E2E。
 *
 * ## 判据只有两个，都是标量（GPU 读回 + page 内归约，无截图比对）
 *
 * 1. **`spread`（采样点单通道最大跨度）> 阈值** —— 「这一帧有结构」。
 *    **不能用 `mean`，也不能把颜色压成亮度**：余弦调色板的三个通道恒差 2π/3，
 *    于是 `(R+G+B)/3` 对**任何** t 都是 127.5 —— Lyapunov 换序列明明换了图，
 *    按亮度比出来的差只有 0.086，判据完全失效（实测踩过，详见
 *    `_stage.ts::GridStats.samples`）。`spread` 同时也覆盖「判据退化成恒真 →
 *    整幅纯色」这个失败形态。
 * 2. **换参数 → `sampleL1`（逐通道）足够大**。每个配置都先各自断一次 `spread`，
 *    否则「两张纯色不同」会假通过。
 *
 * 阈值全部按**实测**定，并留足余量（括号里是实测值）：
 * 幂次 2403 · 松弛系数 66 · Kleinian 的 v 1057 · 折叠次数 2549 ·
 * Lyapunov 换序列 2405 · 换窗口 3572 · 噪声底 **0.00**。
 * 松弛系数那一档最小（66）—— 它本来就只动边界附近那几层，所以阈值只给 25。
 *
 * Newton 多一条**专属判据**：`mean`（平均亮度）必须足够高。
 *
 * 依据是数学：牛顿法是**二次收敛**的，绝大多数像素几步内就命中根，而
 * `coloring = basin` 的亮度是「越早收敛越亮」。所以「画面亮」这件事等价于
 * 「迭代真的在收敛」—— 实测正确实现 **125.2**，把复数除法换成 GLSL 的
 * 逐分量除法之后是 **12.8**（10 倍分离，阈值取 80）。
 *
 * 那一类错（`vec2 / vec2` 是逐分量除法，不是复数除法）不报错、不影响编译，
 * 画面也会塌成一团均匀色 —— `spread` 顺带也能挡住它，但**唯一说清「为什么
 * 应该亮」的是这一条**。`tests/unit/fractals2d.test.ts` 另有一条**结构断言**
 * 钉住 fragment 里必须有 `cdiv(...)` 调用点：写法上的错用源码量，几何上的错
 * 用像素量。
 */

const seq = (...rows: string[]): string => encodePattern(bitmapFromRows(rows));

test('Newton：收敛要快（二次收敛 ⇒ 画面亮），幂次与松弛系数都改变画面', async ({ page }) => {
  test.setTimeout(180_000);

  const p3 = await shoot(page, 'newton', { intRes: '480', power: 3, coloring: 'basin', palette: 'hue' });
  expect(p3.spread, '应当画出了有结构的画面').toBeGreaterThan(60);

  // 二次收敛 ⇒ 大多数像素几步命中 ⇒ 画面偏亮。实测 125.2（逐分量除法时 12.8）
  // ⚠️ 这条耦合了 basin 着色的亮度公式（越早收敛越亮）。改那条公式时要一并复核门槛。
  expect(p3.mean, '牛顿法应当快速收敛，画面不该是暗的').toBeGreaterThan(80);

  const p5 = await shoot(page, 'newton', { intRes: '480', power: 5, coloring: 'basin', palette: 'hue' });
  expect(p5.spread, 'power=5 也要有结构').toBeGreaterThan(60);
  expect(sampleL1(p3, p5), '幂次应当改变吸引域划分').toBeGreaterThan(200);

  const rel = await shoot(page, 'newton', {
    intRes: '480',
    power: 3,
    coloring: 'basin',
    palette: 'hue',
    relax: 0.75,
  });
  expect(sampleL1(p3, rel), '松弛系数应当改变画面').toBeGreaterThan(25);
});

test('Kleinian：极限集有结构且不是一整片纯色，v 与折叠次数都改变画面', async ({ page }) => {
  test.setTimeout(180_000);

  const base = await shoot(page, 'kleinian', { intRes: '480' });
  // 判据/映射写错时的两种典型形态 —— 空屏（spread = 0）与「整幅铺满一块颜色」
  // （spread 也 = 0）—— 都会被这一条挡住。**不能用 lit/total**：背景色不是纯黑
  // （#07080e），那个比值恒为 1，什么都判不出来（第一版就是这么写的）。
  expect(base.spread, '极限集应当是有结构的一团，不是空屏也不是一整块纯色').toBeGreaterThan(80);

  const v10 = await shoot(page, 'kleinian', { intRes: '480', imag: 0.1 });
  expect(v10.spread, 'v=0.1 也要有结构').toBeGreaterThan(80);
  expect(sampleL1(base, v10), 'v 应当改变极限集的形态').toBeGreaterThan(200);

  const deep = await shoot(page, 'kleinian', { intRes: '480', iters: 24 });
  expect(sampleL1(base, deep), '折叠次数应当改变细节层级').toBeGreaterThan(80);
});

test('Lyapunov：A/B 序列就是那张图的输入，换序列就换图', async ({ page }) => {
  test.setTimeout(180_000);

  const aabab = await shoot(page, 'lyapunov', { intRes: '480' });
  expect(aabab.spread, '应当画出了有结构的画面').toBeGreaterThan(80);

  const ab = await shoot(page, 'lyapunov', { intRes: '480', sequence: seq('#.') });
  expect(ab.spread, 'AB 序列也要有结构').toBeGreaterThan(80);
  expect(sampleL1(aabab, ab), '序列应当改变整幅图').toBeGreaterThan(200);

  // 同一个序列换窗口 ⇒ 不同区域，画面必然不同
  const win = await shoot(page, 'lyapunov', {
    intRes: '480',
    sequence: seq('#.'),
    aMin: 3,
    aMax: 4,
    bMin: 3,
    bMax: 4,
  });
  expect(sampleL1(ab, win), '窗口应当改变画面').toBeGreaterThan(200);
});

/**
 * 跨页面加载的确定性 —— 也是上面那些 L1 阈值的**噪声底**。
 *
 * 三个分形的着色里都没有时钟、没有随机，所以同参数同 t 在两次独立加载里
 * 必须给出同一张图。用采样 L1 而不是逐像素相等，是因为 headless 有一条
 * 已知的 GPU 读回竞态（见 `algo-sim.spec` 头注）。
 */
test('三个 2D 分形跨两次加载逐点一致（采样 L1 的噪声底）', async ({ page }) => {
  test.setTimeout(180_000);
  for (const [gen, params] of [
    ['newton', { intRes: '480', power: 3 }],
    ['kleinian', { intRes: '480' }],
    ['lyapunov', { intRes: '480' }],
  ] as [string, Record<string, number | string>][]) {
    const a = await shoot(page, gen, params);
    const b = await shoot(page, gen, params);
    expect(sampleL1(a, b), `${gen} 同参数两次加载应当一致`).toBeLessThan(1);
    expect(a.spread, `${gen} 两次加载都该有结构`).toBe(b.spread);
  }
});
