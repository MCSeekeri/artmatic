/**
 * effect-scope-blend.spec.ts — 影响深度（作用域组）不该让内层片段的混合模式失效。
 *
 * 回归对象（2026-10-12，用户实测）：作用域组**从透明起合成**，组内最底层那个 op
 * 没有背景板 ⇒ 对着透明黑做 `add` / `multiply` / `screen` 只会得到黑（alpha 却照常
 * 累积），贴回 acc 时就是一块不透明黑。用户画面：圆形是**黑填充 + 线性加深(add)**，
 * 不设影响深度时黑填充与蓝背景相加仍是蓝（看起来「透明」），一设影响深度就变成黑圆。
 *
 * 判据分两条，互相独立：
 *  1. **逐通道等价**：同一份舞台，`depth=0` 与 `depth=1` 在旋转平面**内部**的采样点
 *     必须一致（L1 ≤ 3）。修复前 `screen` 是 `[255,0,0]` vs `[255,0,255]`。
 *  2. **具体场景**：黑填充 + `add` 的层在 `depth=1` 时**不能**遮住下方的纯色
 *     （中心必须仍是下方那层颜色）。
 *
 * 只看「画面变了」是不够的：这条 bug 的表现就是「变了」——必须断「与不设深度时一致」。
 */

import { expect, test, type Page } from '@playwright/test';
import { openDemo, buildDepthStage, gridL1, rgbaAt, setEffectDepth, settle } from './_stage';

type Api = {
  __artmatic: {
    store: {
      commit: (
        label: string,
        fn: (p: { tracks: { id: string; clips: { kind: string; blend?: string }[] }[] }) => void,
      ) => void;
    };
  };
};

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

async function setScopeBlend(page: Page, trackId: string, blend: string): Promise<void> {
  await page.evaluate(
    ({ trackId, blend }) => {
      const A = (window as never as Api).__artmatic;
      A.store.commit('e2e: scope blend', (p) => {
        const t = p.tracks.find((x) => x.id === trackId)!;
        for (const c of t.clips) if (c.kind === 'source') c.blend = blend;
      });
    },
    { trackId, blend },
  );
}

test('影响深度：内层片段的混合模式与不设深度时逐通道一致', async ({ page }) => {
  await boot(page);
  const st = await buildDepthStage(page, {
    effect: { id: 'fx', defId: 'transform-3d', values: {}, depth: 0 },
    scope: { id: 'scope-red', source: { type: 'solid', color: '#ff0000' } },
    below: { id: 'below-blue', source: { type: 'solid', color: '#0000ff' } },
  });

  for (const blend of ['screen', 'add', 'multiply'] as const) {
    await setScopeBlend(page, st.scopeTrack, blend);
    await setEffectDepth(page, st.fxClipId, 0);
    await settle(page, 1);
    const d0 = await rgbaAt(page, 1, 0.5, 0.5);
    await setEffectDepth(page, st.fxClipId, 1);
    await settle(page, 1);
    const d1 = await rgbaAt(page, 1, 0.5, 0.5);

    // 先确认这真的是个「有内容」的画面（防空转：两张黑图也能一致）
    expect(d0[3], `blend=${blend} 的基线不该是全透明`).toBeGreaterThan(0);
    expect(gridL1(d0, d1), `blend=${blend}：影响深度改变了合成结果（混合模式失效）`).toBeLessThanOrEqual(3);
  }
});

test('影响深度：黑填充 + 线性加深(add) 不再遮住下方画面', async ({ page }) => {
  await boot(page);
  const st = await buildDepthStage(page, {
    effect: { id: 'fx', defId: 'transform-3d', values: {}, depth: 1 },
    // 用户的场景：这一层是黑填充，混合模式「线性加深」。不设深度时它与下方相加仍是下方色。
    scope: { id: 'scope-black', source: { type: 'solid', color: '#000000' } },
    below: { id: 'below-blue', source: { type: 'solid', color: '#0000ff' } },
  });
  await setScopeBlend(page, st.scopeTrack, 'add'); // 「线性加深」
  await settle(page, 1);

  const c = await rgbaAt(page, 1, 0.5, 0.5);
  // 中心在旋转平面内 ⇒ 采到的是「黑填充与下方相加」，必须是蓝而不是黑。
  expect(c[0], '红色通道：黑填充不该盖住下方').toBeLessThan(40);
  expect(c[2], '蓝色通道：下方那层必须还在').toBeGreaterThan(200);
  expect(c[3]).toBeGreaterThan(0);
});
