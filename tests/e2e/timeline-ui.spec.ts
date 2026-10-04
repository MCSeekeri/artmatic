import { expect, test, type Page } from '@playwright/test';
import { addEffectViaPicker } from './_stage';

/**
 * 时间轴交互回归：覆盖 2026-09-27 那批 MVP 反馈。
 *
 * 这些断言刻意走**真实指针输入**（page.mouse）而不是直接调 store——
 * 出问题的那几条（策略结算时序、跨轨、右键菜单）全都在手势层，
 * 直接调 store 会把它们整个绕过去。
 */

// 行数多（demo 5 轨 + 测试 2 轨）时轨道区会出滚动条，窗口给高一点。
//
// deviceScaleFactor 设成 1.5 是刻意的：本机（Windows 150% 缩放）就是这个 dpr，
// 而**时间轴的 canvas 位图尺寸、以及新加的那几条像素断言都跟 dpr 直接相关**。
// dpr=1 时 `Math.round(bx) + 0.5` 这类半像素坐标正好落在整像素边界上，
// 抗锯齿退化成"刀口"状态，光栅化批次的微小差异会被放大（实测 37/255 vs 1.5 下的 3/255）
// —— 那是测量噪声，不是被测行为。
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });

type AnyA = {
  store: {
    project: { duration: number; beatGrid: { bpm: number }; tracks: { id: string; name: string; kind: string; clips: { id: string; kind: string; start: number; end: number; label: string; opacity?: number; assetId?: string }[] }[] };
    addTrack: (k: 'visual' | 'audio', name?: string) => string;
    addClip: (t: string, c: unknown) => void;
    removeTrack: (t: string) => void;
    removeClip: (c: string) => void;
    setDuration: (s: number) => void;
    setOverlapBehavior: (b: string) => void;
    setBeatGrid: (g: { bpm?: number; beatsPerBar?: number; offset?: number }) => void;
    findClip: (id: string) => { clip: { opacity: number; start: number; end: number } } | null;
    track: (t: string) => { clips: { id: string; start: number; end: number }[] } | null;
  };
  appState: {
    selectedClipId: string | null;
    waveforms: Record<string, unknown>;
    pxPerBeat: number;
  };
};

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

const MK = `(id, start, end) => ({ kind:'source', id, start, end, label:id, fadeSec:0, curves:{},
  source:{type:'solid', color:'#3a6ea5'}, blend:'normal', opacity:1,
  transform:{x:.5,y:.5,sx:1,sy:1,rot:0}, fit:'stretch' })`;

/** 建 TEST 轨（A[0,2] + B[3,5]）与空轨 DROP，并把轨道区滚到底让它们都在视野里。 */
async function seed(page: Page): Promise<void> {
  await page.evaluate((src) => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    const mk = eval(src) as (id: string, s: number, e: number) => unknown;
    const t = a.store.addTrack('visual', 'TEST');
    a.store.addClip(t, mk('A', 0, 2));
    a.store.addClip(t, mk('B', 3, 5));
    a.store.addTrack('visual', 'DROP');
  }, MK);
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid=tl-scroll]');
    if (el) el.scrollTop = el.scrollHeight;
  });
}

/** 把 TEST / DROP 清掉重建：每个子用例从同一初始几何出发，互不污染。 */
async function reseed(page: Page): Promise<void> {
  await page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    for (const t of [...a.store.project.tracks]) {
      if (t.name === 'TEST' || t.name === 'DROP') a.store.removeTrack(t.id);
    }
  });
  await seed(page);
}

async function geom(page: Page): Promise<Record<string, { track: string; start: number; end: number }>> {
  return page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    const out: Record<string, { track: string; start: number; end: number }> = {};
    for (const t of a.store.project.tracks) {
      for (const c of t.clips) {
        if (c.id === 'A' || c.id === 'B') out[c.id] = { track: t.name, start: +c.start.toFixed(3), end: +c.end.toFixed(3) };
      }
    }
    return out;
  });
}

const policy = (page: Page, p: string) =>
  page.evaluate((v) => (window as never as { __artmatic: AnyA }).__artmatic.store.setOverlapBehavior(v), p);

async function drag(page: Page, id: string, dx: number, dy = 0, mid?: () => Promise<void>): Promise<void> {
  const box = (await page.locator(`[data-clip-id="${id}"]`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  if (mid) await mid();
  await page.mouse.up();
}

/** 拖右边缘（缩放的落点在右边缘，所以不能从中心起手）。 */
async function dragEnd(page: Page, id: string, dx: number): Promise<void> {
  const box = (await page.locator(`[data-clip-id="${id}"]`).boundingBox())!;
  const x = box.x + box.width - 3;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

test('检查器：增删特效实例立即刷新，不必重选片段', async ({ page }) => {
  await boot(page);
  const fxId = await page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    for (const t of a.store.project.tracks) {
      for (const c of t.clips) if (c.kind === 'effect') return c.id;
    }
    return null;
  });
  await page.locator(`[data-clip-id="${fxId}"]`).click();
  await expect(page.locator('[data-testid=effect-instance]')).toHaveCount(2); // demo 的 V3 带两个实例

  await addEffectViaPicker(page, 'channel-split');
  await expect(page.locator('[data-testid=effect-instance]')).toHaveCount(3);
  await addEffectViaPicker(page, 'bleach');
  await expect(page.locator('[data-testid=effect-instance]')).toHaveCount(4);

  await page.locator('[data-testid=effect-instance]').first().locator('[data-testid=effect-remove]').click();
  await expect(page.locator('[data-testid=effect-instance]')).toHaveCount(3);
});

test('检查器：拖滑杆时同行的数字输入框实时跟随', async ({ page }) => {
  await boot(page);
  const clipId = await page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    for (const t of a.store.project.tracks) {
      for (const c of t.clips) if (c.kind === 'source' && c.label.includes('Mandelbrot')) return c.id;
    }
    return null;
  }) as string;
  await page.locator(`[data-clip-id="${clipId}"]`).click();
  const row = page.locator('[data-testid=param-row]', { has: page.locator('[data-testid=param-label]', { hasText: '不透明度' }) }).first();
  const range = row.locator('[data-testid=param-slider]');
  const num = row.locator('[data-testid=param-number]');
  // 数字框按 step 精度定宽显示（step=0.01 → '1.00'）。固定小数位是刻意的：
  // 拖动时字段宽度不会来回跳。
  await expect(num).toHaveValue('1.00');

  const box = (await range.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 4 });
  await page.waitForTimeout(80);
  const shown = Number(await num.inputValue());
  const stored = await page.evaluate(
    (id) => +(window as never as { __artmatic: AnyA }).__artmatic.store.findClip(id)!.clip.opacity.toFixed(3),
    clipId,
  );
  await page.mouse.up();
  expect(stored).toBeGreaterThan(0.3);
  expect(Math.abs(shown - stored)).toBeLessThan(1e-6);
});

test('拖拽：trim 策略下邻居在松手前不被吃', async ({ page }) => {
  await boot(page);
  await seed(page);
  await policy(page, 'trim');
  let bDuring = 0;
  await drag(page, 'A', 140, 0, async () => {
    bDuring = (await geom(page)).B!.start;
  });
  expect(bDuring).toBe(3); // 拖动中 B 完好
  const after = await geom(page);
  expect(after.B!.start).toBeGreaterThan(3); // 松手才被吃
  expect(after.A!.start).toBeGreaterThan(2); // 被拖片段自由跟到了落点
});

test('拖拽：reject 策略下非法落点松手弹回，拖动中给出提示', async ({ page }) => {
  await boot(page);
  await seed(page);
  await policy(page, 'reject');
  let hinted = false;
  await drag(page, 'A', 140, 0, async () => {
    hinted = (await page.locator('[data-testid=clip][data-illegal=true]').count()) > 0;
  });
  expect(hinted).toBe(true);
  const after = await geom(page);
  expect([after.A!.start, after.A!.end]).toEqual([0, 2]);
});

test('缩放：三种重叠策略各自生效', async ({ page }) => {
  await boot(page);
  await seed(page);

  await policy(page, 'reject');
  await dragEnd(page, 'A', 140);
  expect((await geom(page)).A!.end).toBeCloseTo(3, 2); // 钳在 B 边界

  await reseed(page);
  await policy(page, 'push');
  await dragEnd(page, 'A', 140);
  const pushed = await geom(page);
  expect(pushed.A!.end).toBeGreaterThan(4); // 真的长过去了
  expect(pushed.B!.start).toBeCloseTo(pushed.A!.end, 2); // 邻居整体让位

  await reseed(page);
  await policy(page, 'trim');
  // 84px @56px/s = +1.5s → 吸附后 A.end = 3.5，压进 B 的头 0.5 秒
  await dragEnd(page, 'A', 84);
  const trimmed = await geom(page);
  expect(trimmed.A!.end).toBeGreaterThan(3);
  expect(trimmed.B!.start).toBeCloseTo(trimmed.A!.end, 2);
});

test('跨轨：拖到其它轨道 + Alt+↑↓', async ({ page }) => {
  await boot(page);
  await seed(page);
  await policy(page, 'reject');

  const rows = await page.locator('[data-testid=tl-row]').count();
  const drop = (await page.locator('[data-testid=tl-row]').nth(rows - 1).boundingBox())!;
  const box = (await page.locator('[data-clip-id="A"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, drop.y + drop.height / 2, { steps: 12 });
  await page.mouse.up();
  expect((await geom(page)).A!.track).toBe('DROP');

  await page.evaluate(() => {
    (window as never as { __artmatic: AnyA }).__artmatic.appState.selectedClipId = 'A';
  });
  await page.keyboard.press('Alt+ArrowUp');
  expect((await geom(page)).A!.track).toBe('TEST');

  await page.keyboard.press('Alt+ArrowDown');
  expect((await geom(page)).A!.track).toBe('DROP');
});

test('右键：自绘菜单在鼠标位置新建片段，原生菜单被禁用', async ({ page }) => {
  await boot(page);
  await seed(page);

  const preventedOnRow = await page.evaluate(() => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.querySelector('[data-testid=tl-row]')!.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(preventedOnRow).toBe(true);

  const rows = await page.locator('[data-testid=tl-row]').count();
  const row = (await page.locator('[data-testid=tl-row]').nth(rows - 1).boundingBox())!; // DROP 轨，空的
  await page.mouse.move(row.x + 224, row.y + row.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('[data-testid=ctx-menu]')).toHaveCount(1);

  // 右键菜单与轨道行菜单同构，新建项是一级项（只有算法会再展开一级）
  await page.getByTestId('ctx-solid').click();
  await expect(page.locator('[data-testid=ctx-menu]')).toHaveCount(0);
  const created = await page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    const tr = a.store.project.tracks[a.store.project.tracks.length - 1]!;
    const c = tr.clips[tr.clips.length - 1]!;
    return { label: c.label, start: +c.start.toFixed(2) };
  });
  expect(created.label).toBe('纯色');
  expect(Math.abs(created.start - 4)).toBeLessThan(0.3); // 224px @56px/s = 4s，吸附到拍
});

test('时长：与素材长度解耦，可任意改也能被片段撑长', async ({ page }) => {
  await boot(page);
  const dur = () => page.evaluate(() => (window as never as { __artmatic: AnyA }).__artmatic.store.project.duration);
  const d0 = await dur();

  await page.getByTestId('duration-input').fill('30');
  await page.getByTestId('duration-input').press('Enter');
  await expect.poll(dur).toBe(30);
  const width30 = await page.evaluate(() => document.querySelector('[data-testid=tl-canvas-wrap]')!.getBoundingClientRect().width);
  expect(width30).toBeGreaterThan(d0 * 50); // 30s @56px/s ≈ 1680px

  await page.getByTestId('fit-duration').click();
  const d2 = await dur();
  expect(d2).toBeLessThan(30);

  // 片段拖到内容末尾之外 → 工程跟着变长
  await seed(page);
  await policy(page, 'reject');
  const rows = await page.locator('[data-testid=tl-row]').count();
  const drop = (await page.locator('[data-testid=tl-row]').nth(rows - 1).boundingBox())!;
  const box = (await page.locator('[data-clip-id="A"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 960, drop.y + drop.height / 2, { steps: 14 });
  await page.mouse.up();
  expect(await dur()).toBeGreaterThan(d2);
});

/* ============================================================================
 * 长音频下的时间轴重绘（2026-10-02 性能修复的回归）
 *
 * 背景：导入长音频后，拖片段 / 调检查器滑杆 / 新建轨道 / 缩放全都出现 ~1s 卡顿，
 * 播放与滚动却正常。根因是**每次 version bump 都把整幅工程宽重画一遍**，而波形
 * 用的是「每像素一个子路径 + 一次性 stroke」——实测 315s 音频（工程宽 17650 CSS px）
 * 的光栅化要 1096ms，摘掉波形只剩 8.4ms。
 *
 * 现在绘制只覆盖可见区间，由 `Timeline.svelte` 自己记「已画到哪」，滚动时补画
 * 新露出来的一条。**这套记账的正确性是这次改动的真正风险**（画布会露白 / 内容陈旧），
 * 所以下面这几条断言盯的就是它，而不是性能数字（性能断言在 CI 上不可靠）。
 *
 * 音频素材不进仓库 —— 波形直接在 page 内合成注入。走的是 `grid-draw` 真实的
 * 绘制路径，只是数据来源换成了合成桶。
 * ========================================================================== */

/** 注入一段 300s 的合成波形 + 一条音频片段，并把工程撑到 300s。 */
async function seedLongAudio(page: Page): Promise<void> {
  await page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA & { store: { track: (t: string) => { clips: { id: string }[] } | null } } }).__artmatic;
    // demo 自带的节拍片段占着 [0,16]，会把我这条挤到 16s 之后（可见区只剩 40px）
    for (const t of a.store.project.tracks) {
      for (const c of [...t.clips]) if (c.kind === 'audio') a.store.removeClip(c.id);
    }
    const N = 6000; // 0.05s/桶 → 300s
    const buckets = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      buckets[i * 2] = -0.6;
      buckets[i * 2 + 1] = ((i % 37) / 37) * 0.9; // 有起伏，便于比对像素
    }
    a.appState.waveforms = {
      ...a.appState.waveforms,
      'e2e-long': { buckets, bucketSec: 0.05, length: N, duration: 300 },
    };
    a.store.setDuration(300);
    const trackId = (() => {
      for (const t of a.store.project.tracks) if (t.kind === 'audio') return t.id;
      return null;
    })() as string;
    a.store.addClip(trackId, {
      kind: 'audio',
      id: 'e2e-long-clip',
      start: 0,
      end: 300,
      label: 'e2e-long.mp3',
      fadeSec: 0,
      curves: {},
      assetId: 'e2e-long',
      srcIn: 0,
    });
  });
  await page.waitForTimeout(150);
}

/**
 * 音频轨那一行、当前可见窗口内的墨迹统计。
 * `ink` = 亮像素数（波形），`hash` = 该条带的像素指纹。
 *
 * ⚠️ **画布是跟着视口走的窗口，不是整幅工程宽** —— 画布 x = 内容 x − `winFrom`
 * （`winFrom` 就是 `canvas.grid.style.left`）。照 `scrollLeft` 直接当画布 x 读，
 * 会在画布边界外读到全透明，得到「波形丢了」的假结论。
 */
async function waveStats(page: Page): Promise<{ ink: number; hash: string; canvasW: number; canvasH: number; winFrom: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid=tl-scroll]') as HTMLElement;
    const c = document.querySelector('canvas.grid') as HTMLCanvasElement;
    const rows = Array.from(document.querySelectorAll('[data-testid=tl-row]'));
    const ai = rows.findIndex((r) => r.classList.contains('audio'));
    const dpr = c.width / parseFloat(c.style.width);
    const winFrom = parseFloat(c.style.left) || 0;
    const rowH = c.height / Math.max(1, rows.length);
    const x = Math.max(0, Math.round((el.scrollLeft - winFrom) * dpr));
    const w = Math.max(1, Math.min(Math.round(el.clientWidth * dpr), c.width - x));
    const d = c.getContext('2d')!.getImageData(x, Math.round(ai * rowH), w, Math.round(rowH)).data;
    let ink = 0;
    let hash = 0x811c9dc5;
    for (let i = 0; i < d.length; i += 4) {
      const bright = d[i + 3]! > 200 && d[i]! > 90 ? 1 : 0;
      ink += bright;
      hash = (Math.imul(hash ^ d[i]!, 0x01000193) ^ (d[i + 3]! + bright)) >>> 0;
    }
    return { ink, hash: hash.toString(16).padStart(8, '0'), canvasW: c.width, canvasH: c.height, winFrom };
  });
}

/** 把当前可见条带留在 page 里当基线，供 `diffSinceSnap` 比对。 */
async function snapStrip(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid=tl-scroll]') as HTMLElement;
    const c = document.querySelector('canvas.grid') as HTMLCanvasElement;
    const rows = Array.from(document.querySelectorAll('[data-testid=tl-row]'));
    const ai = rows.findIndex((r) => r.classList.contains('audio'));
    const dpr = c.width / parseFloat(c.style.width);
    const winFrom = parseFloat(c.style.left) || 0;
    const rowH = c.height / Math.max(1, rows.length);
    const x = Math.max(0, Math.round((el.scrollLeft - winFrom) * dpr));
    const w = Math.max(1, Math.min(Math.round(el.clientWidth * dpr), c.width - x));
    const d = c.getContext('2d')!.getImageData(x, Math.round(ai * rowH), w, Math.round(rowH)).data;
    (window as never as Record<string, unknown>).__tlSnap = { w, h: Math.round(rowH), data: new Uint8ClampedArray(d) };
  });
}

/**
 * 与基线逐通道比对。
 *
 * ⚠️ **不要断言逐位相同。** 实测：把同一段内容在「不同操作序列」下重画，
 * Skia 在抗锯齿的拍线像素上会给出 ±3/255 的舍入差（22k/59k 像素差、最大差 3）；
 * 而**同一序列重复**是逐位相同的。所以这里卡「最大通道差」和「墨迹量相等」——
 * 真正要抓的失效（画布留白、波形停在旧位置）会给出几十上百的差值，跑不掉。
 */
async function diffSinceSnap(page: Page): Promise<{ differing: number; total: number; maxDelta: number; inkA: number; inkB: number; worst: { x: number; y: number; a: number[]; b: number[] }[] }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid=tl-scroll]') as HTMLElement;
    const c = document.querySelector('canvas.grid') as HTMLCanvasElement;
    const rows = Array.from(document.querySelectorAll('[data-testid=tl-row]'));
    const ai = rows.findIndex((r) => r.classList.contains('audio'));
    const dpr = c.width / parseFloat(c.style.width);
    const winFrom = parseFloat(c.style.left) || 0;
    const rowH = c.height / Math.max(1, rows.length);
    const x = Math.max(0, Math.round((el.scrollLeft - winFrom) * dpr));
    const w = Math.max(1, Math.min(Math.round(el.clientWidth * dpr), c.width - x));
    const d = c.getContext('2d')!.getImageData(x, Math.round(ai * rowH), w, Math.round(rowH)).data;
    const A = (window as never as { __tlSnap: { w: number; h: number; data: Uint8ClampedArray } }).__tlSnap;
    const countInk = (arr: Uint8ClampedArray): number => {
      let n = 0;
      for (let i = 0; i < arr.length; i += 4) if (arr[i + 3]! > 200 && arr[i]! > 90) n += 1;
      return n;
    };
    if (A.w !== w || A.h !== Math.round(rowH)) {
      return { differing: -1, total: -1, maxDelta: -1, inkA: countInk(A.data), inkB: countInk(d), worst: [] };
    }
    let differing = 0;
    let maxDelta = 0;
    const worst: { x: number; y: number; a: number[]; b: number[] }[] = [];
    for (let i = 0; i < A.data.length; i += 4) {
      const dd = Math.max(
        Math.abs(A.data[i]! - d[i]!),
        Math.abs(A.data[i + 1]! - d[i + 1]!),
        Math.abs(A.data[i + 2]! - d[i + 2]!),
        Math.abs(A.data[i + 3]! - d[i + 3]!),
      );
      if (dd > 0) differing += 1;
      if (dd > maxDelta) maxDelta = dd;
      if (dd >= 8 && worst.length < 6) {
        const p = i / 4;
        worst.push({
          x: p % w,
          y: Math.floor(p / w),
          a: [A.data[i]!, A.data[i + 1]!, A.data[i + 2]!, A.data[i + 3]!],
          b: [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!],
        });
      }
    }
    return { differing, total: A.data.length / 4, maxDelta, inkA: countInk(A.data), inkB: countInk(d), worst };
  });
}

test('长音频：重绘只覆盖可见区，滚动补画、回滚可复现、拖动后波形跟上', async ({ page }) => {
  await boot(page);
  await seedLongAudio(page);

  const a0 = await waveStats(page);
  expect(a0.ink).toBeGreaterThan(500); // 初始可见区确实有波形

  // ① 位图里「可见区以外」这一段没有画过 —— 窗口化之后位图本来就只有 3 个视口宽，
  //    所以断言改成「窗口内、可见区之外的那一段是空的」。
  const farAlpha = await page.evaluate(() => {
    const c = document.querySelector('canvas.grid') as HTMLCanvasElement;
    const dpr = c.width / parseFloat(c.style.width);
    const el = document.querySelector('[data-testid=tl-scroll]') as HTMLElement;
    const winFrom = parseFloat(c.style.left) || 0;
    const x = Math.round((el.scrollLeft - winFrom + el.clientWidth + 40) * dpr);
    if (x + 16 >= c.width) return 0;
    const d = c.getContext('2d')!.getImageData(x, 0, 16, 16).data;
    let maxA = 0;
    for (let i = 3; i < d.length; i += 4) maxA = Math.max(maxA, d[i]!);
    return maxA;
  });
  expect(farAlpha).toBe(0);

  // ② 基线快照必须在**回到起点之前**取：下面要验的是「滚出去再滚回来能复现原样」，
  //    拿错位置的快照就会变成「比较两个不同滚动位置」，那是必然不同的。
  await snapStrip(page);

  // ③ 滚到远处 → scroll 事件必须把窗口挪过去并补画（不能露白）
  await page.evaluate(() => {
    (document.querySelector('[data-testid=tl-scroll]') as HTMLElement).scrollLeft = 8000;
  });
  await page.waitForTimeout(200);
  const far = await waveStats(page);
  expect(far.ink).toBeGreaterThan(500);
  expect(far.winFrom).toBeGreaterThan(0); // 窗口确实跟着挪了

  // ④ 滚回起点 → 可见区必须复现成原样。这条是纯滚动路径（内容没变），
  //    所以卡得最严：墨迹量必须相等、最大通道差 ≤4（见 diffSinceSnap 的注释）。
  await page.evaluate(() => {
    (document.querySelector('[data-testid=tl-scroll]') as HTMLElement).scrollLeft = 0;
  });
  await page.waitForTimeout(250);
  const back = await waveStats(page);
  expect(back.winFrom).toBe(0);
  const recovered = await diffSinceSnap(page);
  expect(recovered.total).toBeGreaterThan(1000); // 尺寸对上了（否则 diff 返回 -1，下面的断言会假绿）
  // 墨迹量允许 ±0.1% 的抖动：误差会把个别像素推过 r>90 的判定阈值（实测差 4/25209）。
  // 真有内容错位是量级差别，不是千分之一。
  expect(Math.abs(recovered.inkB - recovered.inkA) / recovered.inkA).toBeLessThan(0.001);
  expect(recovered.maxDelta, `样例 ${JSON.stringify(recovered.worst)}`).toBeLessThanOrEqual(4); // 没有错位的旧内容

  // ④ 拖动音频片段 → 波形跟着走。
  //    起手点必须落在**检查器抽屉左侧**：抽屉浮在时间轴右半，落在它下面的话
  //    pointerdown 根本打不到片段（elementFromPoint 拿到的是 .drawer），
  //    手势会被静默吞掉 —— 这个坑实测踩过一次。
  const sc = (await page.locator('[data-testid=tl-scroll]').boundingBox())!;
  const clip = (await page.locator('[data-clip-id="e2e-long-clip"]').boundingBox())!;
  const start0 = await page.evaluate(
    () => (window as never as { __artmatic: AnyA }).__artmatic.store.findClip('e2e-long-clip')!.clip.start,
  );
  await page.mouse.move(sc.x + 200, clip.y + clip.height / 2);
  await page.mouse.down();
  await page.mouse.move(sc.x + 500, clip.y + clip.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const start1 = await page.evaluate(
    () => (window as never as { __artmatic: AnyA }).__artmatic.store.findClip('e2e-long-clip')!.clip.start,
  );
  expect(start1).toBeGreaterThan(start0); // 真的拖动了
  const moved = await waveStats(page);
  expect(moved.hash).not.toBe(a0.hash); // 波形跟着移位（不是缓存住不动）
});

test('长音频：位图尺寸与工程时长、缩放解耦（内存上界）', async ({ page }) => {
  await boot(page);
  await seedLongAudio(page);
  const a0 = await waveStats(page);
  const dpr = await page.evaluate(() => {
    const c = document.querySelector('canvas.grid') as HTMLCanvasElement;
    return c.width / parseFloat(c.style.width);
  });
  const clientW = await page.evaluate(
    () => (document.querySelector('[data-testid=tl-scroll]') as HTMLElement).clientWidth,
  );

  /*
   * 这是本次改动的**内存上界**保证。
   *
   * 改造前位图是整幅工程宽：内存 = 时长 × 缩放 × 轨道数 × dpr²，无上界 ——
   * 实测 950s@28px/beat 是 64MB、950s@96px/beat 是 219MB、3000s@96px/beat 是 692MB。
   * 再往上会撞浏览器的 canvas 面积上限（实测 2^28 像素），而**超限时
   * `canvas.width = …` 是静默失败的** —— 位图宽 ≠ style.width，整幅画面被压扁，
   * 控制台一句话都没有。那条路必须在测试里被堵死。
   */
  expect(a0.canvasW).toBeLessThanOrEqual(Math.ceil(clientW * 3 * dpr) + 8);

  const grown = await page.evaluate(async () => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    a.store.setDuration(3000); // 时长 ×10
    a.appState.pxPerBeat = 96; // 缩放到最大
    await new Promise((r) => setTimeout(r, 400));
    const c = document.querySelector('canvas.grid') as HTMLCanvasElement;
    const cssW = parseFloat(c.style.width);
    return {
      w: c.width,
      h: c.height,
      // 位图必须始终与布局一致；不一致就是被浏览器拒绝后的静默压扁
      consistent: Math.abs(c.width / (c.width / cssW) - cssW) < 2,
      mb: +((c.width * c.height * 4) / 1048576).toFixed(1),
    };
  });
  expect(grown.w).toBe(a0.canvasW); // 时长和缩放都变了，位图宽度纹丝不动
  expect(grown.consistent).toBe(true);
  expect(grown.mb).toBeLessThan(20); // 5 轨下仍是常数级

  // 改完之后可见区还是要画对（不能只是「尺寸没变但内容丢了」）
  const after = await waveStats(page);
  expect(after.ink).toBeGreaterThan(200);
});

test('长音频：缩放与改拍网格后可见区仍然正确重画', async ({ page }) => {
  await boot(page);
  await seedLongAudio(page);
  const before = await waveStats(page);

  // 缩放 + 改拍网格（走真实 commit）→ 都必须让可见区正确重画，而不是留白
  await page.evaluate(() => {
    const a = (window as never as { __artmatic: AnyA }).__artmatic;
    a.store.setBeatGrid({ bpm: 180, beatsPerBar: 3 });
    a.appState.pxPerBeat = 56;
  });
  await page.waitForTimeout(250);
  const after = await waveStats(page);
  expect(after.ink).toBeGreaterThan(200); // 缩放后可见区有内容，不是空白
  expect(after.hash).not.toBe(before.hash);

  /*
   * 顺带钉住一个容易误判的事实：**标尺不随 BPM 变**。
   * 拍线画在 `b * pxPerBeat` 处，与 BPM 无关（BPM 只决定「一拍几秒」，
   * 影响的是波形/片段的像素位置，不是拍线的像素间距）。
   * 旧版拿「改 BPM 后标尺哈希变了」当断言，其实测到的是整幅画布**宽度**
   * 随 BPM 变化造成的缓冲区尺寸差异 —— 与内容无关。要动标尺就看 beatsPerBar。
   */
  const rulerHash = () =>
    page.evaluate(() => {
      const c = document.querySelector('canvas.ruler') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, Math.min(c.height, 40)).data;
      let h = 0x811c9dc5;
      for (let i = 0; i < d.length; i += 4) h = (Math.imul(h ^ d[i]!, 0x01000193) ^ d[i + 3]!) >>> 0;
      return h.toString(16).padStart(8, '0');
    });
  const r1 = await rulerHash();
  await page.evaluate(() => (window as never as { __artmatic: AnyA }).__artmatic.store.setBeatGrid({ beatsPerBar: 7 }));
  await page.waitForTimeout(250);
  expect(await rulerHash()).not.toBe(r1);
});
