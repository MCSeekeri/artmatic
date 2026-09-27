import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

interface HookResult {
  mean: number;
  diff: number;
  frontDiff: number;
}

test('Rule 110 上轨：非黑、逐像素确定、生长前沿随 t 推进', async ({ page }) => {
  await boot(page);
  // 建 rule110 片段并等烘焙完成（轮询画面均值出现非零）
  await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: {
          addTrack: (k: 'visual') => string;
          addClip: (t: string, c: unknown) => void;
        };
        algo: { defaultParams: (id: string) => Record<string, number | string> };
      };
    }).__artmatic;
    const trackId = A.store.addTrack('visual');
    A.store.addClip(trackId, {
      kind: 'source',
      id: 'r110',
      start: 0,
      end: 8,
      label: 'R110',
      fadeSec: 0,
      curves: {},
      source: { type: 'algo', generator: 'rule110', params: A.algo.defaultParams('rule110') },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
    });
  });

  // 烘焙是异步的：被动等待（别在 page 里忙轮询——持续的 rAF + readPixels
  // 长任务会把 worker 回包饿死在队列里，这是实测踩过的坑）。
  await page.waitForTimeout(2500);

  const result = await page.evaluate((): HookResult => {
    const A = (window as never as {
      __artmatic: {
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
      };
    }).__artmatic;
    const mean = (d: number[]) => {
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i]! + d[i + 1]! + d[i + 2]!;
      return s / (d.length / 4) / 3;
    };
    A.renderFrame(6);
    const m = mean(A.readPixels().data);
    // 确定性：同一 t 两次渲染
    A.renderFrame(6);
    const a = A.readPixels().data;
    A.renderFrame(6);
    const b = A.readPixels().data;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    // 生长前沿：t=1（front 小）与 t=7（front 大）的画面差异
    A.renderFrame(1);
    const early = mean(A.readPixels().data);
    A.renderFrame(7);
    const late = mean(A.readPixels().data);
    return { mean: m, diff, frontDiff: late - early };
  });

  expect(result.mean).toBeGreaterThan(20);
  expect(result.diff).toBe(0);
  expect(result.frontDiff).toBeGreaterThan(1); // 长得越晚越亮
});

test('生命游戏：seek 回退再前进与顺序播放逐像素一致', async ({ page }) => {
  await boot(page);
  const diff = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: {
          addTrack: (k: 'visual') => string;
          addClip: (t: string, c: unknown) => void;
        };
        algo: { defaultParams: (id: string) => Record<string, number | string> };
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
      };
    }).__artmatic;
    const trackId = A.store.addTrack('visual');
    A.store.addClip(trackId, {
      kind: 'source',
      id: 'gol',
      start: 0,
      end: 8,
      label: 'GoL',
      fadeSec: 0,
      curves: {},
      source: { type: 'algo', generator: 'game-of-life', params: A.algo.defaultParams('game-of-life') },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
    });
    // 顺序播放到 t=40/30（simFrame=16），留档
    for (let i = 0; i <= 40; i++) A.renderFrame(i / 30);
    const sequential = A.readPixels().data;
    // seek 回 t=10/30（走快照重放），再回到 t=40/30
    A.renderFrame(10 / 30);
    A.renderFrame(40 / 30);
    const replayed = A.readPixels().data;
    let d = 0;
    for (let i = 0; i < sequential.length; i++) if (sequential[i] !== replayed[i]) d++;
    return d;
  });
  expect(diff).toBe(0);
});

test('Mandelbrot：zoom 关键帧曲线改变画面且逐帧确定', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: {
          addTrack: (k: 'visual') => string;
          addClip: (t: string, c: unknown) => void;
          updateClip: (id: string, label: string, fn: (c: never) => void) => void;
        };
        algo: { defaultParams: (id: string) => Record<string, number | string> };
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
      };
    }).__artmatic;
    const trackId = A.store.addTrack('visual');
    A.store.addClip(trackId, {
      kind: 'source',
      id: 'mb',
      start: 0,
      end: 4,
      label: 'Mandelbrot',
      fadeSec: 0,
      curves: {},
      source: { type: 'algo', generator: 'mandelbrot', params: A.algo.defaultParams('mandelbrot') },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
    });
    A.store.updateClip('mb', '打关键帧', (c: { curves: Record<string, unknown> }) => {
      c.curves['zoom'] = {
        keys: [
          { t: 0, v: 0, interp: 'linear' },
          { t: 3, v: 4, interp: 'linear' },
        ],
      };
    });
    const hash = (d: number[]) => {
      let h = 0;
      for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]!) | 0;
      return h;
    };
    A.renderFrame(0);
    const at0 = hash(A.readPixels().data);
    A.renderFrame(3);
    const at3 = hash(A.readPixels().data);
    // 确定性：t=1.5 两次
    A.renderFrame(1.5);
    const a = A.readPixels().data;
    A.renderFrame(1.5);
    const b = A.readPixels().data;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return { at0, at3, diff };
  });
  expect(result.at0).not.toBe(result.at3); // zoom 曲线确实改变了画面
  expect(result.diff).toBe(0);
});
