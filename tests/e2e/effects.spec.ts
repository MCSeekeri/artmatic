import { expect, test, type Page } from '@playwright/test';
import { openDemo, addEffectViaPicker, buildStage, hashAt, renderTwiceDiff, setTrackEnabled } from './_stage';

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
