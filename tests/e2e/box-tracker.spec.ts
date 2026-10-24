import { expect, test, type Page } from '@playwright/test';

/**
 * 「方框跟踪」的端到端验证。
 *
 * 这条链上最容易静默坏掉的三段：
 * 1. **探针回读**（GPU → CPU）：采不到像素时显著性恒为 0，画面上一个框都没有，
 *    控制台什么都不说。`trackerStats().boxes` 直接把这一段暴露出来。
 * 2. **叠层上传把链输入顶掉**（`effects/AGENTS.md` 记过两次真实事故）：表现是
 *    整片发红/发黑。这里用「改框线颜色，画面里对应颜色随之变化」来钉死它 ——
 *    只断言 `boxes > 0` 的话，一个把 `u_texture` 顶掉的版本照样能通过。
 * 3. **探针尺寸跟着渲染尺寸走**：预览与导出会得到不同的框。所以这里显式断言
 *    `probeW === 160` 且**两种渲染档位下都一样**。
 *
 * 刻意**不**断言「同一 t 连渲两次逐字节相同」：追踪器持有跨帧状态，seek 时清空
 * （与 `feedback` 类特效同一处置），理由与 `tests/e2e/algo-sim.spec.ts` 头注一致。
 */

interface LabHandle {
  selectSource: (id: string) => void;
  selectEffect: (id: string | null) => void;
  setParam: (scope: 'source' | 'effect', key: string, v: number | string) => void;
  setScale: (s: number) => void;
  renderAt: (t: number, clearFeedback?: boolean) => void;
  readPixels: () => { data: number[]; w: number; h: number };
  renderSize: () => { w: number; h: number };
  trackerStats: () => {
    instances: number;
    boxes: number;
    probeW: number;
    probeH: number;
    saliencyMax: number;
    diag: { above: number; raw: number };
  } | null;
}

type LabWindow = { __lab?: LabHandle };

async function boot(page: Page): Promise<void> {
  await page.goto('/lab/');
  await page.waitForFunction(() => {
    const L = (window as unknown as LabWindow).__lab;
    return !!L && L.renderSize().w > 0;
  });
}

/** 选中「彩条」源 + 方框跟踪，并渲一帧。彩条有明确的竖直边缘，斑点是稳定的。 */
async function setup(page: Page, params: Record<string, number | string> = {}): Promise<void> {
  await page.evaluate(
    ({ params }) => {
      const L = (window as unknown as LabWindow).__lab!;
      L.selectSource('lab:bars');
      L.selectEffect('box-tracker');
      for (const [k, v] of Object.entries(params)) L.setParam('effect', k, v);
      L.renderAt(0.5);
    },
    { params },
  );
}

test('方框跟踪：真的检出目标并画出叠层', async ({ page }) => {
  await boot(page);
  await setup(page);

  const stats = await page.evaluate(() => (window as unknown as LabWindow).__lab!.trackerStats());
  expect(stats, '追踪服务没装配上').not.toBeNull();
  expect(stats!.probeW, '探针宽度必须固定（预览 = 导出的前提）').toBe(160);
  expect(stats!.diag.above, '阈值把所有像素都挡掉了 → 检测器等于没工作').toBeGreaterThan(0);
  expect(stats!.boxes, '一个框都没有').toBeGreaterThan(0);

  // 叠层真的进了画面：默认框线是青色，画面上应当有一批青色像素。
  const cyan = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.setParam('effect', 'frameColor', '#7fe8ff');
    L.renderAt(0.5);
    const { data } = L.readPixels();
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (b > 150 && g > 150 && r < 140) n++;
    }
    return n;
  });
  expect(cyan, '框线颜色没有出现在画面上（叠层没合成 / 被顶掉）').toBeGreaterThan(200);

  // 换颜色必须跟着变 —— 这才是「叠层纹理真的被采样了」的证据。
  const red = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.setParam('effect', 'frameColor', '#ff2020');
    L.renderAt(0.5);
    const { data } = L.readPixels();
    let n = 0;
    let cyan = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (r > 150 && g < 100 && b < 100) n++;
      if (b > 150 && g > 150 && r < 140) cyan++;
    }
    return { red: n, cyan };
  });
  expect(red.red, '改成红色后画面里没有红色框线').toBeGreaterThan(150);
  expect(red.cyan, '旧颜色还留在画面上（叠层没有重绘）').toBeLessThan(cyan);
});

test('方框跟踪：检测参数的改动立刻生效，刷新间隔 1 与 6 都能出框', async ({ page }) => {
  await boot(page);
  await setup(page, { refresh: 1 });

  const at1 = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.renderAt(0.5);
    return L.trackerStats()?.boxes ?? 0;
  });
  expect(at1).toBeGreaterThan(0);

  const at6 = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.setParam('effect', 'refresh', 6);
    L.renderAt(0.5);
    return L.trackerStats()?.boxes ?? 0;
  });
  expect(at6, '刷新率 6 时第一帧（或参数变更时）也应当立刻检测').toBeGreaterThan(0);

  // 目标数上限必须真的限制住数量上限。
  const capped = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.setParam('effect', 'blobCount', 2);
    L.renderAt(0.5);
    return L.trackerStats()?.boxes ?? 0;
  });
  expect(capped).toBeLessThanOrEqual(2);
});

test('方框跟踪：探针尺寸不随渲染档位变（预览与导出同一组框的前提）', async ({ page }) => {
  await boot(page);
  await setup(page);

  const read = (scale: number): Promise<{ w: number; h: number; probeW: number; boxes: number }> =>
    page.evaluate((s) => {
      const L = (window as unknown as LabWindow).__lab!;
      L.setScale(s);
      L.renderAt(0.5);
      const st = L.trackerStats();
      const size = L.renderSize();
      return { w: size.w, h: size.h, probeW: st?.probeW ?? 0, boxes: st?.boxes ?? 0 };
    }, scale);

  const full = await read(1);
  const quarter = await read(0.25);
  // 两种档位的后备缓冲确实不同 —— 否则这条断言没有覆盖面。
  expect(full.w).not.toBe(quarter.w);
  expect(full.probeW).toBe(160);
  expect(quarter.probeW).toBe(160);
  expect(full.boxes).toBeGreaterThan(0);
  expect(quarter.boxes).toBeGreaterThan(0);
});

test('方框跟踪：框内效果与框线是同一块矩形（位置与大小）', async ({ page }) => {
  await boot(page);
  /*
   * 钉住「掩码和叠层各算一份几何」那一类 bug。真实事故：掩码没把 Canvas2D 的
   * `cy` 翻成着色器的 v 向上（也漏了出场动画的缩放），画面上是一块与框完全错开
   * 的反色补丁 —— 看起来像检测框错了，而所有「有框 / 有叠层」的断言全绿。
   *
   * 做法：同一个 t 渲三次，只改「框线可见」「框内效果」两个开关，分别取
   * 「框线的像素包围盒」与「框内被改动的像素包围盒」，两者必须重合。
   */
  await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    /*
     * 关掉一切会同时作用于两边的量（抖动、出场动画）、会画到别处的装饰
     * （扫描线 / 准星 / 数据条 / 标签 / 连线），以及多框（包围盒会变成并集）。
     *
     * 源用 `lab:bars` 而不是分形：后者同参数连渲两次有上百个像素的差异
     * （见 `tests/e2e/AGENTS.md` 那条采样竞态），差异包围盒会被那点噪声撑爆 ——
     * 实测把框外 100 多像素的行列算进来，量出来的「错位」全是噪声。
     */
    L.selectSource('lab:bars');
    L.selectEffect('box-tracker');
    const base: Record<string, number | string> = {
      blobCount: 1,
      refresh: 6,
      jitter: 0,
      smoothness: 0,
      animShow: 0,
      frameStyle: 'solid',
      frameAlpha: 1,
      interior: 'none',
      scanShow: 0,
      reticleShow: 0,
      barsShow: 0,
      labelShow: 0,
      linkShow: 0,
    };
    for (const [k, v] of Object.entries(base)) L.setParam('effect', k, v);
    // 先让追踪器建立状态。后面三张图都停在帧 7（refresh = 6 ⇒ 不重检），
    // 于是方框位置逐像素相同，差别只有那两个开关。
    L.renderAt(0.2, true);
  });

  const boxes = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    interface Shot {
      data: number[];
      w: number;
      h: number;
    }
    interface Box {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    }
    const shot = (over: Record<string, number | string>): Shot => {
      for (const [k, v] of Object.entries(over)) L.setParam('effect', k, v);
      L.renderAt(0.24, false);
      return L.readPixels();
    };
    /** 两张图的差异包围盒（没有差异 = null）。 */
    const bbox = (a: Shot, b: Shot): Box | null => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -1;
      let y1 = -1;
      for (let i = 0; i < a.data.length; i += 4) {
        if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2]) {
          continue;
        }
        const p = i / 4;
        const x = p % a.w;
        const y = (p - x) / a.w;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      return x1 < 0 ? null : { x0, y0, x1, y1 };
    };
    const bare = shot({ interior: 'none', frameAlpha: 0 });
    return {
      frame: bbox(bare, shot({ interior: 'none', frameAlpha: 1 })),
      inner: bbox(bare, shot({ interior: 'invert', frameAlpha: 0 })),
    };
  });

  const f = boxes.frame;
  const r = boxes.inner;
  expect(f, '框线没有出现在画面上').not.toBeNull();
  expect(r, '框内效果没有出现在画面上').not.toBeNull();

  // 容差：框线 0.75px 宽且两端有抗锯齿，掩码有 1.5px 羽化。
  const tol = 4;
  const both = `框线 ${JSON.stringify(f)} / 框内效果 ${JSON.stringify(r)}`;
  expect(Math.abs((f!.x0 + f!.x1) / 2 - (r!.x0 + r!.x1) / 2), `框内效果横向错开：${both}`).toBeLessThanOrEqual(tol);
  expect(Math.abs((f!.y0 + f!.y1) / 2 - (r!.y0 + r!.y1) / 2), `框内效果纵向错开：${both}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(f!.x1 - f!.x0 - (r!.x1 - r!.x0)), `框内效果宽度与框线不一致：${both}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(f!.y1 - f!.y0 - (r!.y1 - r!.y0)), `框内效果高度与框线不一致：${both}`).toBeLessThanOrEqual(tol);
});

test('方框跟踪：每个装饰项都真的画到画面上', async ({ page }) => {
  await boot(page);
  // 用分形做源：方框又大又稳，装饰项的像素变化才量得出来
  // （`lab:bars` 的斑点全挤在底部灰阶上，差异只有几十个像素）。
  await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    L.selectSource('mandelbrot');
    L.selectEffect('box-tracker');
    L.setParam('effect', 'interior', 'none');
  });

  const counts = await page.evaluate(() => {
    const L = (window as unknown as LabWindow).__lab!;
    const BASE: Record<string, number | string> = {
      scanShow: 0,
      reticleShow: 0,
      barsShow: 0,
      linkFlow: 0,
      animShow: 0,
      frameStyle: 'solid',
      linkShow: 1,
      linkDensity: 1,
    };
    const draw = (over: Record<string, number | string>): number[] => {
      for (const [k, v] of Object.entries({ ...BASE, ...over })) L.setParam('effect', k, v);
      // 连渲几帧：跳过出场动画、让扫描线/流光走到中段
      for (let i = 0; i < 6; i++) L.renderAt(0.2 + i * 0.08, i === 0);
      return L.readPixels().data;
    };
    const diff = (a: number[], b: number[]): number => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
      }
      return n;
    };
    const base = draw({});
    return {
      scan: diff(base, draw({ scanShow: 1 })),
      reticle: diff(base, draw({ reticleShow: 1 })),
      bars: diff(base, draw({ barsShow: 1 })),
      texture: diff(base, draw({ frameStyle: 'texture' })),
      flow: diff(base, draw({ linkFlow: 1, linkDensity: 1 })),
    };
  });

  for (const [name, n] of Object.entries(counts)) {
    expect(n, `装饰项 ${name} 没有在画面上留下任何变化`).toBeGreaterThan(80);
  }
});

test('方框跟踪：自定义标签词是可编辑的多行文本框', async ({ page }) => {
  await boot(page);
  await setup(page);

  const field = page.getByTestId('lab-effect-text-labelCustom');
  await expect(field).toBeVisible();
  await field.fill('ALPHA\nBETA');
  await expect(field).toHaveValue('ALPHA\nBETA');
  // 词库下拉在「仅置信率」模式下应当消失（`visibleWhen` 的守卫）。
  await page.evaluate(() => {
    (window as unknown as LabWindow).__lab!.setParam('effect', 'labelMode', 'conf');
  });
  await expect(page.getByTestId('lab-effect-select-labelVocab')).toHaveCount(0);
});
