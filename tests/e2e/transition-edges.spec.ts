import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 零片段转场（v13）的 E2E：片段前面 / 后面没有邻居时，那一侧是全透明。
 *
 * 这是本功能最容易被实现成「静默失效」的地方 —— 检查器必须明确写出
 * 「从透明淡入 / 淡出到透明」，画面必须真的只出现一半的进度。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

interface StageInfo {
  clipId: string;
  trackId: string;
}

/** 一条轨、一个纯红片段 [1,3]，其余轨全部禁用。 */
async function oneClipStage(page: Page): Promise<StageInfo> {
  return page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: {
          commit: (label: string, fn: (p: { tracks: { id: string; enabled: boolean }[] }) => void) => void;
          addTrack: (kind: 'visual', name?: string) => string;
          addClip: (
            trackId: string,
            clip: {
              kind: 'source';
              id: string;
              start: number;
              end: number;
              label: string;
              fadeSec: number;
              curves: Record<string, never>;
              source: { type: 'solid'; color: string };
              blend: 'normal';
              opacity: number;
              transform: { x: number; y: number; sx: number; sy: number; rot: number };
              fit: 'stretch';
            },
          ) => void;
        };
      };
    }).__artmatic;
    A.store.commit('e2e: 清空舞台', (p) => {
      for (const t of p.tracks) t.enabled = false;
    });
    const track = A.store.addTrack('visual', 'EDGE');
    A.store.commit('e2e: 只启用新轨', (p) => {
      for (const t of p.tracks) t.enabled = t.id === track;
    });
    A.store.addClip(track, {
      kind: 'source',
      id: 'edge-solid',
      start: 1,
      end: 3,
      label: 'edge',
      fadeSec: 0,
      curves: {},
      source: { type: 'solid', color: '#ff0000' },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
    });
    return { clipId: 'edge-solid', trackId: track };
  });
}

async function rgbMeanAt(page: Page, t: number): Promise<[number, number, number]> {
  return page.evaluate((tt) => {
    const A = (window as never as {
      __artmatic: {
        renderer: { onSeek: () => void };
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
      };
    }).__artmatic;
    A.renderer.onSeek();
    A.renderFrame(tt);
    const d = A.readPixels().data;
    const sum = [0, 0, 0];
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      sum[0]! += d[i]!;
      sum[1]! += d[i + 1]!;
      sum[2]! += d[i + 2]!;
    }
    return [sum[0]! / n, sum[1]! / n, sum[2]! / n] as [number, number, number];
  }, t);
}

async function pickTransition(page: Page, side: 'in' | 'out', id: string): Promise<void> {
  await page.getByTestId(side === 'out' ? 'open-transition-picker' : 'open-transition-picker-in').click();
  await expect(page.getByTestId('modal-transition-picker')).toBeVisible();
  await page.getByTestId('transition-picker-search').fill(id);
  await page
    .locator(`[data-testid=transition-picker-item][data-transition-id="${id}"]`)
    .first()
    .click();
  await page.getByTestId('transition-picker-confirm').click();
  await expect(page.getByTestId('modal-transition-picker')).toHaveCount(0);
}

test('入场：前面没有片段 → 从透明淡入，进度 0.5 时只有半透明红', async ({ page }) => {
  await boot(page);
  const { clipId } = await oneClipStage(page);
  await page.locator(`[data-clip-id="${clipId}"]`).click();

  await pickTransition(page, 'in', 'fade');
  await expect(page.getByTestId('transition-transparent-in')).toBeVisible();

  const stored = await page.evaluate((id) => {
    const A = (window as never as {
      __artmatic: { store: { findClip: (id: string) => { clip: { transitionIn?: { defId: string } } } | null } };
    }).__artmatic;
    return A.store.findClip(id)?.clip.transitionIn ?? null;
  }, clipId);
  expect(stored?.defId).toBe('fade');

  // 窗口 = [0.5, 1.5)（cut=1，d=1）
  const before = await rgbMeanAt(page, 0.6);
  expect(before[0]).toBeLessThan(60);
  const mid = await rgbMeanAt(page, 1.0);
  expect(mid[0]).toBeGreaterThan(90);
  expect(mid[0]).toBeLessThan(170);
  const after = await rgbMeanAt(page, 1.6);
  expect(after[0]).toBeGreaterThan(230);
});

test('出场：后面没有片段 → 淡出到透明（不是静默失效）', async ({ page }) => {
  await boot(page);
  const { clipId } = await oneClipStage(page);
  await page.locator(`[data-clip-id="${clipId}"]`).click();

  await pickTransition(page, 'out', 'fade');
  await expect(page.getByTestId('transition-transparent')).toBeVisible();

  // 窗口 = [2.5, 3.5)：progress 0.4 → 60% 红
  const mid = await rgbMeanAt(page, 2.9);
  expect(mid[0]).toBeGreaterThan(110);
  expect(mid[0]).toBeLessThan(190);

  // 窗口之外仍是纯红
  const solid = await rgbMeanAt(page, 2.0);
  expect(solid[0]).toBeGreaterThan(230);
});
