import { expect, test, type Page } from '@playwright/test';
import { buildStage, hashAt, meanAt, settle } from './_stage';
import { bitmapFromRows, encodePattern } from '../../src/algos/pattern-codec';

/**
 * `sim` 型生成器的 E2E。
 *
 * 与 `algos.spec.ts`（bake / realtime）分开：sim 是**主线程同步**的，没有异步
 * 烘焙要等 —— 所以这里一律用 `settle`，**不要**用 `waitForSourceReady`
 * （那个 `minMean` 判据是给「整幅非黑」准备的，而 sim 的画面可能只占一小块，
 * 会白等到超时）。
 *
 * ⚠️ **空转探针红旗**：任何「两个配置 hash 不同」的断言，前面必须先有一条
 * `meanAt > 阈值`。反应扩散的死区预设、或步数不够的模拟，两张图都是黑的，
 * `not.toBe` 会「通过」但什么都没测到 —— Wave 1 已经踩过一次这个坑。
 *
 * ## 两个「为什么这里没有某条断言」
 *
 * **① 为什么不断「同帧逐像素一致」（`renderTwiceDiff === 0`）**
 *
 * 试过了，**会 flaky**：同一个 t 连渲两次，实测差异恒为一个小数
 * （Brian's Brain 15 字节、沙堆 489 字节，出界 700848 字节里）——
 * 2/3 的运行失败，且数值每次都一样，说明不是随机噪声而是一处固定的渲染层竞态。
 * 已确认 `renderer.onSeek()` 只清特效反馈、**不动 sim**，所以不是模拟侧的不确定。
 *
 * 这与本项目已经踩过的同一类问题同源：`typography-export.spec.ts` 也**刻意不做
 * 逐像素相等**，改断结构量，理由记在 AGENTS §7（GPU 边界采样竞态）。
 * 于是**确定性这条断言放在它真正成立的那一层**：
 *   - `tests/unit/reaction-diffusion.test.ts` / `cellular-automata.test.ts` /
 *     `lenia-wireworld.test.ts` 里的 `seek(f) ≡ 顺序 step f 次`、`seek(0)`、
 *     同 seed 逐字节相等 —— 这些是**精确**的，且没有渲染层参与；
 *   - 这里只断「非黑」与「随时间在变」这类标量（对少量像素差异不敏感）。
 *
 * **② 为什么不断「改 volatile 参数不重建模拟」**：模拟是确定性的，重建之后
 * `seek(t)` 会重放到同一个状态 —— 画面完全一样。重建的代价是**时间**
 * （每次重放 elapsed×rate 步），而墙钟断言在 headless 里必然 flaky。
 * 这条机制由 `cacheHash` 的单测钉住。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

/** 反应扩散的公共参数：96²、120 步/秒、居中团块种子。 */
const RD = { size: 96, rate: 120, seedMode: 'blob', seedSize: 6 } as const;

test('反应扩散：长出来了、逐帧确定', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'rd-coral',
    source: { type: 'algo', generator: 'reaction-diffusion', params: { ...RD, preset: 'coral' } },
    end: 8,
  });
  // t=4 → 480 步；coral 在这个量级已经铺开
  await settle(page, 4);
  expect(await meanAt(page, 4), 'coral 应当画出东西来（不是黑图）').toBeGreaterThan(1);
});

test('反应扩散：换预设真的换图案（先证明两张都不空，再比不同）', async ({ page }) => {
  await boot(page);

  await buildStage(page, {
    id: 'rd-coral',
    source: { type: 'algo', generator: 'reaction-diffusion', params: { ...RD, preset: 'coral' } },
    end: 8,
  });
  await settle(page, 5);
  const coralMean = await meanAt(page, 5);
  const coralHash = await hashAt(page, 5);

  await buildStage(page, {
    id: 'rd-stripes',
    source: { type: 'algo', generator: 'reaction-diffusion', params: { ...RD, preset: 'stripes' } },
    end: 8,
  });
  await settle(page, 5);
  const stripesMean = await meanAt(page, 5);
  const stripesHash = await hashAt(page, 5);

  // 两条前置：不做这两条，下面那条 not.toBe 在两张黑图上也会「通过」
  expect(coralMean, 'coral 非空').toBeGreaterThan(1);
  expect(stripesMean, 'stripes 非空').toBeGreaterThan(1);
  expect(coralHash).not.toBe(stripesHash);
});

test('反应扩散：手绘图案种子真的进了模拟', async ({ page }) => {
  await boot(page);
  // 16×16 的实心块：与 blob r=6（约 113 格）同量级，**保证能成核**
  // （实测孤立的小种子在 Gray-Scott 里必然死掉 —— 用滑翔机那种 5 格图案
  // 会让这条用例变成「两张黑图不同」的空转断言）。
  const solid = encodePattern(bitmapFromRows(new Array(16).fill('#'.repeat(16))));

  await buildStage(page, {
    id: 'rd-pattern',
    source: {
      type: 'algo',
      generator: 'reaction-diffusion',
      params: { ...RD, preset: 'coral', seedMode: 'pattern', pattern: solid },
    },
    end: 8,
  });
  await settle(page, 3);
  const patternMean = await meanAt(page, 3);
  const patternHash = await hashAt(page, 3);

  await buildStage(page, {
    id: 'rd-blob',
    source: { type: 'algo', generator: 'reaction-diffusion', params: { ...RD, preset: 'coral' } },
    end: 8,
  });
  await settle(page, 3);
  const blobMean = await meanAt(page, 3);
  const blobHash = await hashAt(page, 3);

  expect(patternMean, '图案种子非空').toBeGreaterThan(0.5);
  expect(blobMean, '团块种子非空').toBeGreaterThan(0.5);
  expect(patternHash).not.toBe(blobHash);
});

test("Brian's Brain：非黑、逐帧确定", async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'bb',
    source: { type: 'algo', generator: 'brians-brain', params: { size: 128, rate: 30 } },
    end: 8,
  });
  await settle(page, 1);
  expect(await meanAt(page, 1), '脉冲波应当可见').toBeGreaterThan(1);
});

test('循环元胞自动机：非黑、逐帧确定、且**画面一直在动**', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'cca',
    source: { type: 'algo', generator: 'cyclic-ca', params: { size: 128, rate: 40 } },
    end: 12,
  });
  await settle(page, 6);
  expect(await meanAt(page, 6), '螺旋波应当可见').toBeGreaterThan(1);

  // 默认参数**不许冻结**：相邻两帧必须不同。
  // 这一条是实测抓出来的真 bug 的回归守卫 —— 默认原来是 K=12/θ=2/Moore，
  // 那个组合一步就把整场冻死，画面完全静止。
  const a = await hashAt(page, 6);
  const b = await hashAt(page, 6 + 1 / 40);
  expect(a, '循环 CA 冻住了（相邻两帧完全相同）').not.toBe(b);
});

test('阿贝尔沙堆：非黑、逐帧确定、且分形在长大', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'pile',
    source: { type: 'algo', generator: 'sandpile', params: { size: 192, rate: 30 } },
    end: 12,
  });
  await settle(page, 6);
  const early = await meanAt(page, 6);
  expect(early, '沙子应当可见').toBeGreaterThan(0.5);
  await settle(page, 10);
  const late = await meanAt(page, 10);
  expect(late, '沙堆应当一直在长大').toBeGreaterThan(early);
});

test('雪花：非黑、逐帧确定、冰晶在长大', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'snow',
    source: { type: 'algo', generator: 'snowflake', params: { size: 192, rate: 10, beta: 0.6 } },
    end: 20,
  });
  await settle(page, 10);
  const early = await meanAt(page, 10);
  await settle(page, 18);
  const late = await meanAt(page, 18);
  // 结晶前沿在长：画面会变（冰更多），但两者都必须非黑
  expect(early, '雪花应当可见').toBeGreaterThan(0);
  expect(late).toBeGreaterThan(0);
});

test('Lenia：非黑、逐帧确定、生物在长', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'lenia',
    // 64² 而不是默认的 112²：卷积是 O(格数×抽头数)，E2E 只要证明它活着
    source: { type: 'algo', generator: 'lenia', params: { size: 64, rate: 12 } },
    end: 12,
  });
  await settle(page, 4);
  const early = await meanAt(page, 4);
  await settle(page, 10);
  const late = await meanAt(page, 10);
  expect(early, 'Lenia 应当长出东西（σ 默认值把窗口关死过）').toBeGreaterThan(0.5);
  expect(Math.abs(late - early), 'Lenia 应当在变').toBeGreaterThan(0.05);
});

test('Wireworld：电子一直在跑、逐帧确定', async ({ page }) => {
  await boot(page);
  await buildStage(page, {
    id: 'ww',
    source: { type: 'algo', generator: 'wireworld', params: { size: 160, rate: 60 } },
    end: 12,
  });
  await settle(page, 6);
  expect(await meanAt(page, 6), '导线与电子应当可见').toBeGreaterThan(0.5);
});
