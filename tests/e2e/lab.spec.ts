import { expect, test, type Page } from '@playwright/test';

/**
 * 试炼场（/lab/）的端到端验证。
 *
 * 两条与其它 spec 不同的地方，都是刻意的：
 *
 * 1. **跑的是构建产物里的第二个入口**（`dist/lab/index.html`）。试炼场不是
 *    dev-only 页面 —— 进了 build，才有这条覆盖。顺带证明「双入口 + 静态服务」
 *    这条链路是通的（`/lab/` 的目录索引、`/lab` 的 302 都由它兜底）。
 * 2. **全部断言走 GPU 读回 + 标量归约**，没有一处截图比对：像素在 page 内
 *    reduce 成计数/尺寸，只回传数字。与 determinism.spec.ts / effects.spec.ts
 *    同一套契约（几 MB 的像素数组过界会把 E2E 撑爆）。
 */

interface LabHandle {
  list: () => { sources: string[]; effects: string[] };
  current: () => { sourceId: string; effectId: string | null; bypass: boolean; scale: number; t: number };
  selectSource: (id: string) => void;
  selectEffect: (id: string | null) => void;
  setParam: (scope: 'source' | 'effect', key: string, v: number | string) => void;
  setT: (t: number) => void;
  setScale: (s: number) => void;
  setBypass: (on: boolean) => void;
  renderAt: (t: number, clearFeedback?: boolean) => void;
  readPixels: () => { data: number[]; w: number; h: number };
  renderSize: () => { w: number; h: number };
  compileAll: () => { id: string; ok: boolean; error?: string }[];
}

type LabWindow = { __lab?: LabHandle; __artmatic?: unknown };

async function boot(page: Page): Promise<void> {
  // 必须带尾斜杠：`/lab` 走 302 也能到，但那是给人手敲地址用的兜底，
  // 测试直接打规范地址，免得把重定向与页面本身的问题混在一起。
  await page.goto('/lab/');
  // 等装配真的完成（renderSize 非 0），而不是只等钩子挂上 ——
  // 钩子在 mount 之后立刻赋值，而 canvas 的尺寸要等 LabStage 的 onMount。
  await page.waitForFunction(() => {
    const L = (window as unknown as LabWindow).__lab;
    return !!L && L.renderSize().w > 0;
  });
}

/** 像素均值（0–255）。表达式字符串与 effects.spec.ts 同款，在 page 内求值。 */
function meanExpr(): string {
  return `((d) => { let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i+1] + d[i+2]; return s / (d.length / 4) / 3; })`;
}

test('试炼场是独立入口：不引导主应用', async ({ page }) => {
  await boot(page);
  // 主应用把 renderer / store 全挂在 window.__artmatic 上。试炼场里它必须不存在
  // —— 两个入口只共享 render-core 的装配，不共享任何状态。
  const hasMain = await page.evaluate(() => typeof (window as unknown as LabWindow).__artmatic);
  expect(hasMain).toBe('undefined');

  const ids = await page.evaluate(() => (window as unknown as LabWindow).__lab!.list());
  // 源 = 内置测试图 + 算法生成器；特效 = 注册表里的全部。
  expect(ids.sources.length).toBeGreaterThanOrEqual(4);
  expect(ids.effects.length).toBeGreaterThanOrEqual(5);
  expect(ids.sources).toContain('lab:bars');
  expect(ids.sources).toContain('mandelbrot');
  expect(ids.effects).toContain('pixelate');
});

test('渲染出画面，且旁路（看源）与加特效结果不同', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate((meanSrc: string) => {
    const mean = eval(meanSrc) as (d: number[]) => number;
    const L = (window as unknown as LabWindow).__lab!;
    L.selectSource('mandelbrot');
    L.selectEffect('pixelate');
    L.setParam('effect', 'size', 24);

    L.setBypass(false);
    L.renderAt(1, true);
    const withFx = L.readPixels().data;
    const withFxMean = mean(withFx);

    L.setBypass(true);
    L.renderAt(1, true);
    const noFx = L.readPixels().data;

    let diff = 0;
    for (let i = 0; i < withFx.length; i++) if (withFx[i] !== noFx[i]) diff++;

    return { withFxMean, diff, px: withFx.length / 4 };
  }, meanExpr());

  // 画面不是全黑（Mandelbrot 在 t=1 就该有内容）。
  expect(result.withFxMean).toBeGreaterThan(1);
  // 旁路真的去掉了特效 —— 同时钉住「特效轨必须排在源轨之前」这条 z 序纪律：
  // 顺序写反的话特效会被源整个盖住，这里的 diff 会是 0。
  expect(result.diff).toBeGreaterThan(0);
});

test('非反馈特效同帧可复现（逐像素一致）', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.selectSource('mandelbrot');
    L.selectEffect('scanlines');

    // 先清反馈历史再连渲两次同一 t。清一次、渲两次 —— 第二次不再清，
    // 于是"没有跨帧状态残留"这件事被真的验证到了。
    L.renderAt(1.5, true);
    const a = L.readPixels().data;
    L.renderAt(1.5, false);
    const b = L.readPixels().data;

    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return { diff };
  });
  expect(result.diff).toBe(0);
});

test('全部编译：所有特效与实时算法都编得过', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate((meanSrc: string) => {
    void meanSrc;
    const L = (window as unknown as LabWindow).__lab!;
    const ids = L.list();
    const results = L.compileAll();
    return {
      results,
      effectCount: ids.effects.length,
      failures: results.filter((r) => !r.ok).map((r) => `${r.id}: ${r.error ?? ''}`),
    };
  }, meanExpr());

  // 覆盖率：每个特效都有一条结果（外加 realtime 算法，所以只断言「不少于」）。
  expect(result.results.length).toBeGreaterThanOrEqual(result.effectCount);
  // 「新增一个特效 = 两个文件」纪律下，注册表里的每一个都必须编得过。
  expect(result.failures).toEqual([]);
});

test('分辨率档位真的改后备缓冲尺寸（不被显示区压掉）', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.setScale(1);
    const full = L.renderSize();
    L.setScale(0.5);
    const half = L.renderSize();
    L.setScale(0.25);
    const quarter = L.renderSize();
    return { full, half, quarter };
  });

  // 这一条专门守 `fitPreviewSize` 那个坑：它的 `k = Math.min(1, scale)`
  // 只缩不放，中间舞台列比 1280 窄，所以若不用 setExportSize 钉死后备缓冲，
  // 100% 档会被悄悄缩成一半、三档全都"看起来一样小"。
  expect(result.full.w).toBe(1280);
  expect(result.full.h).toBe(720);
  expect(result.half.w).toBe(640);
  expect(result.half.h).toBe(360);
  expect(result.quarter.w).toBe(320);
  expect(result.quarter.h).toBe(180);
});

test('内置测试图接进了源链路，且彼此不同', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.selectEffect(null); // 只看源
    L.selectSource('lab:bars');
    L.renderAt(0, true);
    const bars = L.readPixels().data;

    L.selectSource('lab:grid');
    L.renderAt(0, true);
    const grid = L.readPixels().data;

    L.selectSource('lab:gradient');
    L.renderAt(0, true);
    const grad = L.readPixels().data;

    let barsGrid = 0;
    let barsGrad = 0;
    for (let i = 0; i < bars.length; i++) {
      if (bars[i] !== grid[i]) barsGrid++;
      if (bars[i] !== grad[i]) barsGrad++;
    }
    return { barsGrid, barsGrad, len: bars.length };
  });

  expect(result.len).toBeGreaterThan(0);
  // 三张图为不同的画面 → 测试图确实经过 resolver 拦截渲进了合成链路，
  // 而不是都落到 SourceManager 的 `default: return null`（那样三张全黑、diff 为 0）。
  expect(result.barsGrid).toBeGreaterThan(0);
  expect(result.barsGrad).toBeGreaterThan(0);
});
