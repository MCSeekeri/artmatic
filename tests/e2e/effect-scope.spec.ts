import { expect, test } from '@playwright/test';
import { openDemo, buildDepthStage, rgbaAt, setEffectDepth, setTrackEnabled, settle } from './_stage';

/**
 * 影响深度（`EffectClip.affectDepth`）的两条守卫。
 *
 * 这个功能的价值全在**画面上**：「作用域之外的轨道一点都没动」只有渲出来才知道
 * （op 树的结构由 `tests/unit/stack.test.ts` 钉着，这里不该重复断言结构）。
 *
 * 底图刻意用高饱和纯色：去色（`bleach` amount=1）之后三通道会贴到一起，而
 * 「没被碰到」是逐字节不变 —— 两条判据各自独立，都不依赖任何中间量。
 */
const BG = '#0000ff'; // 更深的那条轨（蓝）
const RED = '#ff0000'; // 作用域里的那条轨（红，缩到中间，四周留出下层）

/** 三通道的最大跨度：≈0 = 被去色（灰），255 = 纯色（没被碰过）。 */
function spread(rgb: readonly number[]): number {
  return Math.max(rgb[0]!, rgb[1]!, rgb[2]!) - Math.min(rgb[0]!, rgb[1]!, rgb[2]!);
}

/** 角上那一点：只被更深的那条轨覆盖 —— 作用域之外的探针。 */
const CORNER: [number, number] = [0.1, 0.1];
/** 正中那一点：被作用域里的那条轨覆盖。 */
const CENTER: [number, number] = [0.5, 0.5];

test('影响深度 1：作用域之外的轨道逐像素不变；深度 0 时它也会被改', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);

  const stage = await buildDepthStage(page, {
    effect: { id: 'fx', defId: 'bleach', values: { amount: 1 }, depth: 1 },
    scope: { id: 'top', source: { type: 'solid', color: RED }, transform: { sx: 0.4, sy: 0.4 } },
    below: { id: 'bot', source: { type: 'solid', color: BG } },
  });
  await settle(page, 1);

  // 作用域内：红被去色 ⇒ 三通道贴在一起
  const center = await rgbaAt(page, 1, CENTER[0], CENTER[1]);
  expect(spread(center), `作用域内应当被去色，实测 ${center.join(',')}`).toBeLessThan(12);

  // 作用域外：蓝原样（这条排除了「整幅都去色」的假通过）
  const corner = await rgbaAt(page, 1, CORNER[0], CORNER[1]);
  expect(corner[2], `作用域外应当是蓝的，实测 ${corner.join(',')}`).toBeGreaterThan(200);
  expect(corner[0]).toBeLessThan(40);

  // 更强的一条：关掉特效轨拿基线，角上必须逐通道相同（≤2 是给 GPU 量化的余量）
  await setTrackEnabled(page, stage.fxTrack, false);
  const base = await rgbaAt(page, 1, CORNER[0], CORNER[1]);
  for (let i = 0; i < 3; i += 1) {
    expect(
      Math.abs(corner[i]! - base[i]!),
      `第 ${i} 通道：有特效 ${corner.join(',')} vs 无特效 ${base.join(',')}`,
    ).toBeLessThanOrEqual(2);
  }
  await setTrackEnabled(page, stage.fxTrack, true);

  // 深度 0 = 下方全部 ⇒ 角上（更深的轨道）也被去色
  await setEffectDepth(page, stage.fxClipId, 0);
  const cornerAll = await rgbaAt(page, 1, CORNER[0], CORNER[1]);
  expect(spread(cornerAll), `深度 0 时下层也该被去色，实测 ${cornerAll.join(',')}`).toBeLessThan(12);
});

test('检查器：影响深度可改，提示跟着轨道走，时间轴上有角标', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);

  const stage = await buildDepthStage(page, {
    effect: { id: 'fx', defId: 'bleach', values: { amount: 1 }, depth: 0 },
    scope: { id: 'top', source: { type: 'solid', color: RED } },
    below: { id: 'bot', source: { type: 'solid', color: BG } },
  });

  await page.evaluate((id) => {
    (
      window as never as { __artmatic: { appState: { selectedClipId: string | null } } }
    ).__artmatic.appState.selectedClipId = id;
  }, stage.fxClipId);

  const input = page.getByTestId('effect-affect-depth');
  await expect(input).toHaveValue('0');
  await expect(page.getByTestId('effect-scope-all')).toBeVisible();
  // 深度 0（= 缺省）不显示角标
  await expect(page.getByTestId('clip-effect-depth')).toHaveCount(0);

  await input.fill('1');
  await input.press('Enter');
  // 提示要说清是**哪一条**轨：深度只数启用的轨，光看数字猜不出来
  await expect(page.getByTestId('effect-scope-tracks')).toHaveText('影响：SCOPE');
  await expect(page.getByTestId('clip-effect-depth')).toHaveText('↓1');

  // 下方两条轨都关掉 → 作用域为空，给出明确警告（而不是静默什么都不做）
  await setTrackEnabled(page, stage.scopeTrack, false);
  await setTrackEnabled(page, stage.belowTrack, false);
  await expect(page.getByTestId('effect-scope-empty')).toBeVisible();

  // 写库的是整数（NumberInput 允许键入小数）
  const stored = await page.evaluate((id) => {
    const A = (
      window as never as {
        __artmatic: { store: { findClip: (i: string) => { clip: { affectDepth?: number } } | null } };
      }
    ).__artmatic;
    return A.store.findClip(id)!.clip.affectDepth;
  }, stage.fxClipId);
  expect(stored).toBe(1);
});
