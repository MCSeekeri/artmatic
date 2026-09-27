import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

function meanExpr(): string {
  return `((d) => { let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i+1] + d[i+2]; return s / (d.length / 4) / 3; })`;
}

test('slices：同帧逐像素一致，异帧不同（u_seed 注入路径）', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: { addTrack: (k: 'visual') => string; addClip: (t: string, c: unknown) => void };
        algo: { defaultParams: (id: string) => Record<string, number | string> };
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
      };
    }).__artmatic;
    // 平色底上做位移是不可见的（位移均匀场 = 原图）——垫一层有细节的 Mandelbrot。
    const v2 = A.store.addTrack('visual');
    A.store.addClip(v2, {
      kind: 'source', id: 'mb', start: 0, end: 8, label: 'MB', fadeSec: 0, curves: {},
      source: { type: 'algo', generator: 'mandelbrot', params: A.algo.defaultParams('mandelbrot') },
      blend: 'normal', opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 }, fit: 'stretch',
    });
    const tid = A.store.addTrack('visual');
    A.store.addClip(tid, {
      kind: 'effect', id: 'fxc1', start: 0, end: 8, label: '故障', fadeSec: 0,
      curves: {},
      chain: [{ instanceId: 'fx1', defId: 'slices', enabled: true, values: { count: 36, amount: 0.2, coverage: 0.6 } }],
    });
    const hash = (d: number[]) => { let h = 0; for (let i = 0; i < d.length; i += 887) h = (h * 31 + d[i]!) | 0; return h; };
    A.renderFrame(3);
    const a = A.readPixels().data;
    A.renderFrame(3);
    const b = A.readPixels().data;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    const h3 = hash(a);
    A.renderFrame(3.5);
    const h35 = hash(A.readPixels().data);
    return { diff, h3, h35 };
  });
  expect(result.diff).toBe(0);
  expect(result.h3).not.toBe(result.h35);
});

test('echo：顺序渲染留下拖尾，clearFeedback 后消失，两次顺序渲染一致', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate((meanSrc: string) => {
    const mean = eval(meanSrc) as (d: number[]) => number;
    const A = (window as never as {
      __artmatic: {
        store: {
          addTrack: (k: 'visual') => string;
          addClip: (t: string, c: unknown) => void;
          commit: (label: string, fn: (p: { tracks: { clips: { kind: string }[]; enabled: boolean }[] }) => void) => void;
        };
        renderFrame: (t: number) => void;
        readPixels: () => { data: number[] };
        renderer: { onSeek: () => void };
      };
    }).__artmatic;
    // 关掉 demo 自带的特效轨：本测试只量化自己这组 flash+echo 的历史。
    A.store.commit('关闭特效轨', (p) => {
      for (const tr of p.tracks) {
        if (tr.clips.some((c) => c.kind === 'effect')) tr.enabled = false;
      }
    });
    // 亮闪源：只在 [0, 0.5] 存在
    const v2 = A.store.addTrack('visual');
    A.store.addClip(v2, {
      kind: 'source', id: 'flash', start: 0, end: 0.5, label: '闪', fadeSec: 0, curves: {},
      source: { type: 'solid', color: '#ffffff' }, blend: 'normal', opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 }, fit: 'stretch',
    });
    // echo 层：z 序在亮闪之上，[0, 4]
    const v3 = A.store.addTrack('visual');
    A.store.addClip(v3, {
      kind: 'effect', id: 'echoc', start: 0, end: 4, label: '回声', fadeSec: 0, curves: {},
      chain: [{ instanceId: 'e1', defId: 'echo', enabled: true, values: { decay: 0.95, floor: 0, weight: 1, zoom: 0, spin: 0 } }],
    });

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
  await page.locator('.side-row').nth(5).getByTestId('add-effect').click(); // 新轨道（demo 有 5 轨）
  await page.getByTestId('add-effect-instance').click(); // 默认 channel-split
  const chainLen = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: { store: { project: { tracks: { clips: { kind: string; chain?: unknown[] }[] }[] } } };
    }).__artmatic;
    const tracks = A.store.project.tracks;
    const clips = tracks[tracks.length - 1]!.clips;
    return clips[0]?.kind === 'effect' ? (clips[0].chain?.length ?? 0) : -1;
  });
  expect(chainLen).toBe(1);
  await page.evaluate(() => {
    const A = (window as never as { __artmatic: { renderFrame: (t: number) => void } }).__artmatic;
    A.renderFrame(1);
  });
  expect(errors).toEqual([]);
});
