import { expect, test, type Page } from '@playwright/test';
import {
  openDemo,
  addEffectViaPicker,
  buildStage,
  hashAt,
  renderTwiceDiff,
  setTrackEnabled,
  waitForSourceReady,
} from './_stage';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

function meanExpr(): string {
  return `((d) => { let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i+1] + d[i+2]; return s / (d.length / 4) / 3; })`;
}

/*
 * 这两条用例原来直接往 **demo 工程**上叠片段，于是同时踩了两个坑（AGENTS §7
 * 有完整记录）：
 *   - addTrack 是 push：新轨落在最**底层**，被测的东西被 demo 轨道遮住；
 *   - demo 的 echo 是反馈型特效，连渲同一 t 不清历史本来就该不一样。
 * 现在统一从空舞台起步（buildStage 负责），并且**额外断言特效真的可见**
 * —— 没有这条，用例可以在「什么也没测到」的情况下全绿。
 */

test('slices：同帧逐像素一致，异帧不同（u_seed 注入路径）', async ({ page }) => {
  await boot(page);
  // 平色底上做位移是不可见的（位移均匀场 = 原图）——垫一层有细节的 Mandelbrot。
  const stage = await buildStage(
    page,
    { id: 'mb', source: { type: 'algo', generator: 'mandelbrot' } },
    { id: 'fxc1', defId: 'slices', values: { count: 36, amount: 0.2, coverage: 0.6 } },
  );

  // ① 覆盖率：关掉特效轨画面必须变。
  //    这条断言的存在理由 —— 早先这条用例的被测对象被上层轨道整个遮住，
  //    实测开关 slices 轨对画面的影响是 **0 个像素**，两条断言其实在测 demo 工程。
  const withFx = await hashAt(page, 3);
  await setTrackEnabled(page, stage.effectTrack!, false);
  const withoutFx = await hashAt(page, 3);
  await setTrackEnabled(page, stage.effectTrack!, true);
  expect(withFx).not.toBe(withoutFx);

  // ② 确定性契约：「同一历史状态下，同一 t 必须同帧」——
  //    所以每次求值前清掉反馈历史（determinism.spec.ts 的注释写明了这条）。
  expect(await renderTwiceDiff(page, 3, true)).toBe(0);

  // ③ 防止 ② 在比两张一样的图
  expect(await hashAt(page, 3)).not.toBe(await hashAt(page, 3.5));
});

/*
 * 「抽动」（`screen-jump` 的 `jerk` / `jerkRate`）的判据：位移是**分段常量** ——
 * 刻度之内纹丝不动（画面照常平滑滚动），跨刻度时整帧突然换位置。
 *
 * 两边都要钉：
 *   - 只断「画面变了」→ 一个逐帧重掷的实现照样过，而那恰好是要避免的形态
 *     （抽动退化成噪声）。
 *   - 只断「刻度内相同」→ 一个根本没接上 `u_jump`（恒 0）的实现也照样过。
 *
 * 舞台的两个要点：
 *   - 源用 mandelbrot：它的 fragment 里**没有 `u_time`**（逐帧完全静止），而
 *     `coloring: stripe` 让逃逸区铺满高频条纹 —— 实测横移 2% 幅就改变 74% 的像素，
 *     所以「跨刻度变了」这条不会被一次不巧的小位移误判。
 *   - `speed: 0`：平滑滚动关掉，于是画面只可能因为抽动而变化。
 */
test('画面滚卷：抽动在刻度内保持、跨刻度突变', async ({ page }) => {
  await boot(page);
  await buildStage(
    page,
    {
      id: 'mbj',
      source: { type: 'algo', generator: 'mandelbrot', params: { coloring: 'stripe' } },
    },
    {
      id: 'fxj',
      defId: 'screen-jump',
      values: { direction: 'vertical', intensity: 1, sync: 'free', speed: 0, jerk: 0.4, jerkRate: 4 },
    },
  );
  await waitForSourceReady(page, 1.1);

  const r = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
        renderer: { onSeek: () => void };
      };
    }).__artmatic;
    const shot = (t: number): number[] => {
      A.renderer.onSeek();
      A.renderFrame(t);
      return A.readPixels().data;
    };
    const diff = (a: number[], b: number[]): number => {
      let n = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
      return n;
    };
    // 跨过启动窗口（AGENTS §1.3 的两个鬼只在预热之后才安静）
    for (let k = 0; k < 16; k++) shot(1.1);

    // 刻度 = 1/4 秒：1.10 / 1.20 同属刻 4；1.30 是刻 5、1.55 刻 6、1.80 刻 7
    const frames = [1.1, 1.2, 1.3, 1.55, 1.8].map(shot);
    const d0 = frames[0]!;
    let mean = 0;
    for (let i = 0; i < d0.length; i += 4) mean += (d0[i]! + d0[i + 1]! + d0[i + 2]!) / 3;
    mean /= d0.length / 4;

    return {
      total: d0.length,
      mean,
      sameTick: diff(d0, frames[1]!),
      jumps: frames.slice(2).map((f) => diff(d0, f)),
    };
  });

  // 空转探针红旗：舞台必须是「有画面的」，否则下面两条比的都是黑图。
  expect(r.mean, '舞台没有画面，下面的判据什么都不测').toBeGreaterThan(20);
  // ① 刻度内保持：位移是常量 ⇒ 两帧逐字节相同。
  expect(r.sameTick / r.total, '同一刻度内画面不该变化').toBeLessThan(0.01);
  // ② 跨刻度突变。取 3 个边界的最大值：位移有界（±0.4 幅），偶尔两次抽到相近的
  //    位置是分布本身允许的，不该判红。
  expect(Math.max(...r.jumps) / r.total, '跨刻度必须突变').toBeGreaterThan(0.1);
});

test('echo：顺序渲染留下拖尾，clearFeedback 后消失，两次顺序渲染一致', async ({ page }) => {
  await boot(page);

  // 亮闪源只在 [0, 0.5] 存在。echo **必须盖在它之上**才拿得到输入：
  // 早先这条用例把 echo 加在 flash 之后（= z 更低 = 被 flash 盖住），
  // 读到的 acc 恒为透明黑，反馈恒为黑 —— 表现就是 first 与 cleared 逐位相同。
  // buildStage 会把特效轨提到数组最前（= z 最大）。
  await buildStage(
    page,
    { id: 'flash', source: { type: 'solid', color: '#ffffff' }, start: 0, end: 0.5 },
    {
      id: 'echoc',
      defId: 'echo',
      values: { decay: 0.95, floor: 0, weight: 1, zoom: 0, spin: 0 },
      start: 0,
      end: 4,
    },
  );

  const result = await page.evaluate((meanSrc: string) => {
    const mean = eval(meanSrc) as (d: number[]) => number;
    const A = (window as never as {
      __artmatic: {
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
        renderer: { onSeek: () => void };
      };
    }).__artmatic;

    const runSeq = () => {
      A.renderer.onSeek(); // 清历史，等价从干净起点顺序渲染
      for (let i = 0; i <= 45; i++) A.renderFrame(i / 30);
      return mean(A.readPixels().data);
    };
    const first = runSeq();
    const firstPix = A.readPixels().data;
    const second = runSeq();
    const secondPix = A.readPixels().data;
    let detDiff = 0;
    for (let i = 0; i < firstPix.length; i++) if (firstPix[i] !== secondPix[i]) detDiff++;

    // 清历史后单独渲 t=1.5：无拖尾
    A.renderer.onSeek();
    A.renderFrame(1.5);
    const cleared = mean(A.readPixels().data);

    return { first, second, detDiff, cleared };
  }, meanExpr());

  expect(result.first).toBeGreaterThan(result.cleared + 3); // 拖尾显著提亮
  expect(result.detDiff).toBe(0); // 顺序渲染两次逐像素一致
  expect(Math.abs(result.first - result.second)).toBeLessThan(0.001);
});

test('特效链 UI：新建特效片段 + 添加实例 + 渲染无报错', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await boot(page);
  await page.getByTestId('add-visual-track').click();
  // 新建片段的按钮已收进 ⋯ 菜单（见 Timeline 侧栏行）：开菜单 → 点「+ 特效片段」。
  // 用 `.last()` 而不是写死索引：`addTrack` 是 push，新轨恒在最后一行。
  await page.locator('[data-testid=track-side-row]').last().getByTestId('track-menu').click();
  // 「特效片段」现在是二级菜单（最近 5 个 + 全部…）。这条用例走「全部特效…」，
  // 顺便盖住「从时间轴直接带着特效建片段」这条路径。
  await page.getByTestId('add-effect').click();
  await page.getByTestId('add-effect-all').click();
  await page.locator('[data-testid=effect-picker-item][data-effect-id="channel-split"]').click();
  await page.getByTestId('effect-picker-confirm').click();
  // 再走一次检查器里的「添加特效」：两条入口都要能把实例追加进同一条链。
  await addEffectViaPicker(page, 'bleach');
  const chainLen = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { clips: { kind: string; chain?: unknown[] }[] }[] } } };
    }).__artmatic;
    const tracks = A.store.project.tracks;
    const clips = tracks[tracks.length - 1]!.clips;
    return clips[0]?.kind === 'effect' ? (clips[0].chain?.length ?? 0) : -1;
  });
  expect(chainLen).toBe(2);
  await page.evaluate(() => {
    const A = (window as never as { __artmatic: { renderFrame: (t: number) => void } }).__artmatic;
    A.renderFrame(1);
  });
  expect(errors).toEqual([]);
});
