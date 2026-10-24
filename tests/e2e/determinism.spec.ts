import { expect, test } from '@playwright/test';
import { openDemo, SETTLE_FRAMES, waitForSourceReady } from './_stage';

/**
 * 确定性测试——本项目最有价值的一类测试（AGENTS.md §6.1 / §6.2）。
 * 逐像素断言在 page 内做完 reduce 再回传标量，不要把几 MB 像素传回 Node。
 */

test('同一工程同一 t，连续求值 100 次逐像素一致（M0 验收）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
  /*
   * demo 含 bake 型生成器（Rule 110）：**等它真的落地**，否则中途从「缺席」
   * 切到「在场」会被误判成非确定（这不是非确定，是异步就绪）。
   *
   * 这里原来睡固定 2500ms —— 那正是 `_stage.ts::waitForSourceReady` 要替换的写法：
   * 负载高时睡不够、空闲时白等。
   */
  await waitForSourceReady(page, 0.5);

  const result = await page.evaluate((settleFrames: number) => {
    const A = (window as never as {
      __artmatic: {
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
        renderer: { onSeek: () => void };
      };
    }).__artmatic;
    const t = 0.5;

    /*
     * 反馈类特效（echo）的历史是时间状态：每次求值前清历史（等价于
     * 「同一历史状态下，同一 t 必须同帧」——这才是确定性契约；
     * 连渲同一 t 不清历史是在泵历史，本身就不该一致）。
     */
    const frame = (): number[] => {
      A.renderer.onSeek();
      A.renderFrame(t);
      return A.readPixels().data;
    };
    const same = (a: number[], b: number[]): boolean => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    };

    /*
     * warm-up：渲到「连续 SETTLE 帧完全一致」为止。
     *
     * 实测存在一个**一次性**过渡（刻画与结论见 AGENTS §7）：
     * 页面加载后的头几次求值之内，画面水平正中的**一个像素**会翻到另一个值
     * （量级 110），然后彻底稳定。它的触发时机随机器负载浮动（5 次加载里
     * 3 次出现，落在第 2–3 次求值之间），所以不能用「空渲固定 N 帧」这种
     * 写法 —— 固定 2 帧实测仍会挂。用收敛判据才稳。
     *
     * 顺便：把诊断信息一起回传。以后它若真的再挂，断言消息里就有
     * 「过渡了几次、第一次在第几轮」，不用再从零查一遍。
     */
    const SETTLE = settleFrames;
    const SETTLE_CAP = 80;
    let prev = frame();
    let run = 0;
    let warm = 1;
    while (warm < SETTLE_CAP) {
      const cur = frame();
      warm++;
      run = same(prev, cur) ? run + 1 : 0;
      prev = cur;
      if (run >= SETTLE - 1) break;
    }

    const first = prev;
    let maxDiff = 0;
    let diffPixels = 0;
    let transitions = 0;
    let firstTransition = -1;
    let last = first;
    for (let round = 0; round < 100; round++) {
      const cur = frame();
      for (let i = 0; i < cur.length; i++) {
        const d = Math.abs(cur[i]! - first[i]!);
        if (d > 0) diffPixels++;
        if (d > maxDiff) maxDiff = d;
      }
      if (!same(last, cur)) {
        transitions++;
        if (firstTransition < 0) firstTransition = round;
      }
      last = cur;
    }
    return { diffPixels, maxDiff, transitions, firstTransition, warm };
  }, SETTLE_FRAMES);

  expect(
    result.diffPixels,
    `同帧不一致。诊断：${JSON.stringify(result)}` +
      `（transitions>0 且 firstTransition 很小 = 那个一次性过渡没被 warm-up 吃掉；` +
      `transitions 散布在多轮 = 真的非确定）`,
  ).toBe(0);
  expect(result.maxDiff).toBe(0);
});

test('不同 t 画面确实不同（防止断言在比两张黑图）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);

  const diff = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
      };
    }).__artmatic;
    A.renderFrame(0.5);
    const a = A.readPixels().data;
    A.renderFrame(99); // 超出所有片段：空画面
    const b = A.readPixels().data;
    let diffPixels = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffPixels++;
    return diffPixels;
  });
  expect(diff).toBeGreaterThan(0);
});
