/**
 * agent-bound-effect.spec.ts — 绑定片段（`EffectClip.boundClipId`，v11）真的只作用一层。
 *
 * 判据分两条，缺一条就测不到东西：
 *  1. **只有目标层变了**：特效绑在红方块上时，方块外的像素（下方那条轨的纯蓝）
 *     必须**逐位不变**。
 *  2. **对照**：同一条链不绑定时（`affectDepth = 0`，adjustment layer）方块外也
 *     必须被改到 —— 否则第 1 条可能只是因为「这条特效本来就什么都没做」。
 *
 * 另外守两条新观察入口的形状：`render_sequence` 的联系表尺寸 / 帧数，
 * 以及 `snapshotPng({ region })` 的裁切 + 放大。
 */

import { expect, test } from '@playwright/test';
import { buildDepthStage, openDemo, rgbaAt, settle } from './_stage';

interface ControlApi {
  snapshotPng(opt: {
    t?: number;
    size?: { w: number; h: number };
    region?: { x: number; y: number; w: number; h: number };
  }): Promise<{ ok: true; data: Uint8Array } | { ok: false }>;
  renderSequence(opt: {
    from?: number;
    to?: number;
    step?: number;
    size?: { w: number; h: number };
    cols?: number;
  }): Promise<{
    ok: true;
    data: { png: Uint8Array; times: number[]; cols: number; rows: number; w: number; h: number };
  } | { ok: false }>;
}

type Api = {
  __artmatic: {
    control: ControlApi;
    store: { setEffectBoundClip(clipId: string, boundClipId: string | null): void };
  };
};

/** 搭舞台：顶层 FX（duotone）→ 中间红方块 → 底层纯蓝。 */
async function buildStage(page: import('@playwright/test').Page) {
  return buildDepthStage(page, {
    effect: { id: 'fx', defId: 'duotone', values: { intensity: 1 }, depth: 0 },
    // 方块：缩小到画面中央 40%（外部留给下方那条轨）。
    scope: { id: 'scope-red', source: { type: 'solid', color: '#ff0000' }, transform: { sx: 0.4, sy: 0.4 } },
    below: { id: 'below-blue', source: { type: 'solid', color: '#0000ff' } },
  });
}

async function setBound(page: import('@playwright/test').Page, clipId: string, target: string | null) {
  await page.evaluate(
    ({ clipId, target }) => {
      (window as never as Api).__artmatic.store.setEffectBoundClip(clipId, target);
    },
    { clipId, target },
  );
}

test('绑定片段：只改目标那一层，下方轨道逐位不变（与不绑定的对照）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
  const st = await buildStage(page);

  // 1) 绑定在红方块上：中心（方块内）被 duotone 改色，角落（方块外）必须还是纯蓝。
  await setBound(page, st.fxClipId, 'scope-red');
  await settle(page, 1);
  const center = await rgbaAt(page, 1, 0.5, 0.5);
  const corner = await rgbaAt(page, 1, 0.05, 0.05);
  expect(center[0], '方块内应被 duotone 改色（不再是纯红）').toBeLessThan(180);
  expect(corner[2], '方块外必须仍是下方那层的蓝').toBeGreaterThan(200);
  expect(corner[0], '方块外不该被 duotone 染色').toBeLessThan(40);

  // 2) 解绑（回到 adjustment layer 语义）：同一条链现在会盖到下方整幅画面上。
  await setBound(page, st.fxClipId, null);
  await settle(page, 1);
  const cornerUnbound = await rgbaAt(page, 1, 0.05, 0.05);
  expect(
    Math.abs(cornerUnbound[0] - corner[0]) + Math.abs(cornerUnbound[1] - corner[1]) + Math.abs(cornerUnbound[2] - corner[2]),
    '不绑定时同一条链应该改到方块外的画面（否则第 1 条测不到东西）',
  ).toBeGreaterThan(20);
});

test('观察入口：联系表尺寸 / 帧数，以及 region 的裁切放大', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);

  const out = await page.evaluate(async () => {
    const C = (window as never as Api).__artmatic.control;
    const pngSize = (u8: Uint8Array) => {
      const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      return { w: view.getUint32(16), h: view.getUint32(20) };
    };

    const seq = await C.renderSequence({ from: 0, to: 2, step: 0.5, size: { w: 160, h: 90 }, cols: 3 });
    const zoom = await C.snapshotPng({
      t: 1,
      size: { w: 320, h: 180 },
      region: { x: 0, y: 0, w: 0.5, h: 0.5 },
    });
    if (!seq.ok || !zoom.ok) return null;
    return {
      times: seq.data.times,
      cols: seq.data.cols,
      rows: seq.data.rows,
      sheet: { w: seq.data.w, h: seq.data.h },
      bytes: seq.data.png.byteLength,
      // 160×90 的左上四分之一 = 80×45 → 最近邻放大到 ≥480 宽（factor 6）⇒ 480×270。
      zoom: pngSize(zoom.data),
    };
  });

  expect(out).not.toBeNull();
  // 0..2 秒、步长 0.5 ⇒ 0 / 0.5 / 1 / 1.5（不含 2）＝ 4 帧。
  expect(out!.times).toHaveLength(4);
  expect(out!.cols).toBe(3);
  expect(out!.rows).toBe(2);
  // 3 列 × 160 + 2 条 4px 缝
  expect(out!.sheet).toEqual({ w: 3 * 160 + 2 * 4, h: 2 * 90 + 4 });
  expect(out!.bytes).toBeGreaterThan(1000);
  expect(out!.zoom.w).toBeGreaterThanOrEqual(480);
  expect(out!.zoom.w % 80).toBe(0);
});
