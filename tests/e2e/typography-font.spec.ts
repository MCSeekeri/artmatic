import { expect, test, type Page } from '@playwright/test';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * M4 排版：字体子集化（ADR-003 规则 ①）。
 *
 * ## 为什么要这么搭
 *
 * 被测的是一个 **9.5 MB 的中文字体**（`C:/Windows/Fonts/simhei.ttf`）。
 * 它既不能进仓库（系统字体通常不允许再分发），也不该穿过 `page.evaluate`
 * 的序列化（9.5 MB 数字数组 → 上百 MB 的 JSON）。
 *
 * 做法：测试启动时把它**临时拷进 `dist/__probe/`**，页面用 fetch 取 ——
 * 跑完删掉。这样既没进版本库，也没走序列化。
 *
 * ## 测的是什么
 *
 * 1. 子集化的**效果**：9.5 MB → 几 KB，且真正渲染出字。
 * 2. 子集化的**正确性**：ADR-003 说「子集 vs 全量逐像素零差异」——
 *    这条需要一个对照组（关掉子集化再渲一遍），否则无从验证。
 * 3. 字形集缓存的**行为**：同文本不重算、改字才重算。
 */

const CJK_FONT = 'C:/Windows/Fonts/simhei.ttf';
const PROBE_DIR = path.resolve('dist', '__probe');
const PROBE_URL = '/__probe/cjk.ttf';

test.beforeAll(async () => {
  if (!existsSync(CJK_FONT)) return;
  await mkdir(PROBE_DIR, { recursive: true });
  await copyFile(CJK_FONT, path.join(PROBE_DIR, 'cjk.ttf'));
});

test.afterAll(async () => {
  await rm(PROBE_DIR, { recursive: true, force: true });
});

interface FontHooks {
  typoRegisterFont: (name: string, bytes: Uint8Array) => Promise<string>;
  typoFontStats: () => {
    computed: number;
    cacheHits: number;
    lastMs: number;
    lastFullBytes: number;
    lastSubsetBytes: number;
    faces: { id: string; mime: string; fullBytes: number; dataUrlLen: number }[];
  };
  typoSetSubsetting: (on: boolean) => void;
  typoRasterize: (
    doc: unknown,
    w: number,
    h: number,
    localSec: number,
  ) => Promise<{ w: number; h: number; ink: number; sum: number; hash: string }>;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
}

const CJK_TEXT = '高浓度CO₂胁迫下C₃杨树与C₄玉米的生理和分子响应差异';

function cjkDoc(text: string, family = 'simhei') {
  return {
    size: { w: 900, h: 200 },
    background: { kind: 'none' },
    elements: [
      {
        kind: 'text',
        id: 't1',
        name: 't',
        frame: { x: 20, y: 40, w: 860, h: 120, rot: 0 },
        blend: 'normal',
        opacity: 1,
        visible: true,
        locked: false,
        animations: [],
        // v4（富文本）之后文档里只有 runs，没有 text。
        runs: [{ text }],
        autoHeight: false,
        style: {
          fontFamily: family,
          fontSize: 72,
          fontWeight: 400,
          fontStyle: 'normal',
          letterSpacing: 0,
          lineHeight: 1.2,
          align: 'left',
          vAlign: 'middle',
          color: '#ffffff',
          textDecoration: 'none',
          textTransform: 'none',
          textAutospace: 'none',
          writingMode: 'horizontal-tb',
        },
      },
    ],
    fonts: [],
  };
}

/** 1080p 版本：预览与导出真正会用的尺寸。 */
function bigCjkDoc(text: string, family = 'simhei') {
  const d = cjkDoc(text, family);
  d.size = { w: 1920, h: 1080 };
  d.elements[0]!.frame = { x: 96, y: 400, w: 1728, h: 260, rot: 0 };
  d.elements[0]!.style = { ...d.elements[0]!.style, fontSize: 160 };
  return d;
}

async function registerCjk(page: Page): Promise<string> {  return page.evaluate(async (url) => {
    const A = (window as never as { __artmatic: FontHooks }).__artmatic;
    const res = await fetch(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return A.typoRegisterFont('simhei', bytes);
  }, PROBE_URL);
}

test('中文字体被裁到 KB 级，且确实渲染出字', async ({ page }) => {
  test.skip(!existsSync(CJK_FONT), '本机没有 simhei.ttf（非 Windows），跳过');
  await boot(page);
  await registerCjk(page);

  const r = await page.evaluate(
    async ({ doc }) => {
      const A = (window as never as { __artmatic: FontHooks }).__artmatic;
      A.typoSetSubsetting(true);
      const out = await A.typoRasterize(doc, 900, 200, 0);
      return { out, stats: A.typoFontStats() };
    },
    { doc: cjkDoc(CJK_TEXT) },
  );

  // 真的画出字了（不是空图 / 不是方块）
  expect(r.out.ink).toBeGreaterThan(2000);

  // 体积：9.5 MB → 几 KB。ADR-003 记的是 12 KB（pyftsubset --no-hinting），
  // 我们用 HarfBuzz 的 WASM；只要落在同一个量级就说明机制成立。
  expect(r.stats.lastFullBytes).toBeGreaterThan(5_000_000);
  expect(r.stats.lastSubsetBytes).toBeGreaterThan(0);
  expect(r.stats.lastSubsetBytes).toBeLessThan(r.stats.lastFullBytes * 0.02); // < 2%
  console.log(
    `[subset] ${(r.stats.lastFullBytes / 1024).toFixed(0)} KB → ` +
      `${(r.stats.lastSubsetBytes / 1024).toFixed(1)} KB，冷路径 ${r.stats.lastMs.toFixed(1)} ms`,
  );
});

test('子集 vs 全量：逐像素零差异 + 逐帧耗时差一个量级', async ({ page }) => {
  test.skip(!existsSync(CJK_FONT), '本机没有 simhei.ttf（非 Windows），跳过');
  await boot(page);
  await registerCjk(page);

  const r = await page.evaluate(
    async ({ doc, bigDoc }) => {
      const A = (window as never as { __artmatic: FontHooks }).__artmatic;

      /** 预热一次再连测 5 次取中位数：要的是**稳态**单帧成本，不是冷启动。 */
      async function bench(target: unknown, w: number, h: number, subsetting: boolean) {
        A.typoSetSubsetting(subsetting);
        await A.typoRasterize(target, w, h, 0); // 预热（含子集化的冷路径）
        const times: number[] = [];
        let last = { ink: 0, hash: '' };
        for (let i = 0; i < 5; i++) {
          const t0 = performance.now();
          last = await A.typoRasterize(target, w, h, 0);
          times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        return { median: times[2]!, hash: last.hash, ink: last.ink };
      }

      const withSubset = await bench(doc, 900, 200, true);
      const withoutSubset = await bench(doc, 900, 200, false);
      // 顺带量一次 1080p：预览与导出真正会用的尺寸。
      const at1080 = await bench(bigDoc, 1920, 1080, true);
      A.typoSetSubsetting(true); // 恢复默认
      return { withSubset, withoutSubset, at1080 };
    },
    { doc: cjkDoc(CJK_TEXT), bigDoc: bigCjkDoc(CJK_TEXT) },
  );

  console.log(
    `[bench] 900×200：子集化 ${r.withSubset.median.toFixed(2)} ms/帧  vs  全量 ${r.withoutSubset.median.toFixed(2)} ms/帧 ` +
      `(字体成本差 ${(r.withoutSubset.median - r.withSubset.median).toFixed(0)} ms)`,
  );
  console.log(`[bench] 1920×1080（子集化）：${r.at1080.median.toFixed(2)} ms/帧`);

  // 这条是本文件的核心：ADR-003 规则 ① 的正确性前提。
  // 只要两边的像素哈希不同，就说明子集改动过字形或度量 —— 那比慢更严重。
  expect(r.withSubset.ink).toBeGreaterThan(0);
  expect(r.withSubset.hash).toBe(r.withoutSubset.hash);

  // 耗时：差一个量级才算「机制成立」。
  // 用比值而不是绝对值 —— 绝对耗时会随机器与 CI 负载大幅波动，
  // 但 180× 的比值在任何一个不崩溃的环境里都成立。
  expect(r.withSubset.median * 3).toBeLessThan(r.withoutSubset.median);
});

test('字形集缓存：同文本不重算，改字才重算', async ({ page }) => {
  test.skip(!existsSync(CJK_FONT), '本机没有 simhei.ttf（非 Windows），跳过');
  await boot(page);
  await registerCjk(page);

  const r = await page.evaluate(
    async ({ a, b }) => {
      const A = (window as never as { __artmatic: FontHooks }).__artmatic;
      A.typoSetSubsetting(true);

      // 换一段完全不同的文字，把缓存状态推到一个已知起点
      await A.typoRasterize(a, 900, 200, 0);
      const afterFirst = A.typoFontStats();

      // 同一段文本再渲两次：**不该**触发新的子集化
      await A.typoRasterize(a, 900, 200, 0);
      await A.typoRasterize(a, 900, 200, 0);
      const afterRepeat = A.typoFontStats();

      // 改字：必须重新裁
      await A.typoRasterize(b, 900, 200, 0);
      const afterChange = A.typoFontStats();

      return { afterFirst, afterRepeat, afterChange };
    },
    { a: cjkDoc(CJK_TEXT), b: cjkDoc(`${CJK_TEXT}新增字符`) },
  );

  // 重复渲同一段文本：缓存命中增加、计算次数不变
  expect(r.afterRepeat.computed).toBe(r.afterFirst.computed);
  expect(r.afterRepeat.cacheHits).toBeGreaterThan(r.afterFirst.cacheHits);

  // 改了字：字形集变了，必须重算一次
  expect(r.afterChange.computed).toBe(r.afterRepeat.computed + 1);
});

test('未注册的字体出现「字体未就绪」横幅', async ({ page }) => {
  await boot(page);

  // 走真实路径：载入一个用未知字体的工程，双击片段进编辑器。
  await page.evaluate((doc) => {
    const A = (window as never as {
      __artmatic: { store: { loadFrom: (p: unknown) => void } };
    }).__artmatic;
    A.store.loadFrom({
      schemaVersion: 2,
      name: 'missing-font',
      seed: 1,
      fps: 30,
      resolution: { w: 640, h: 360 },
      duration: 1,
      beatGrid: { bpm: 120, offset: 0, beatsPerBar: 4 },
      overlapBehavior: 'reject',
      assets: {},
      tracks: [
        {
          kind: 'visual',
          id: 'v1',
          name: 'V1',
          enabled: true,
          clips: [
            {
              kind: 'source',
              id: 'txt1',
              start: 0,
              end: 1,
              label: '排版',
              fadeSec: 0,
              curves: {},
              source: { type: 'text', doc },
              blend: 'normal',
              opacity: 1,
              transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
              fit: 'contain',
            },
          ],
        },
      ],
    });
  }, cjkDoc('占位', '某个没导入的字体'));

  await page.locator('[data-testid=clip][data-clip-id="txt1"]').dblclick();
  await expect(page.getByTestId('typo-editor')).toBeVisible();
  await expect(page.getByTestId('typo-font-missing')).toBeVisible();
  await expect(page.getByTestId('typo-font-missing')).toContainText('某个没导入的字体');
});

/**
 * 内置字体的**预加载**不许失败。
 *
 * 预加载走的是「只有 URL、字节要等 `ensure()` 才 fetch」那条路，而
 * `FontFace(family, source)` 的字符串形式是按 **CSS src 值列表**解析的 ——
 * 裸 URL（`/fonts/inter-latin-400.woff2`）会被判成语法错误，浏览器分不清
 * 「语法错」与「文件坏了」，于是每次启动都报一次失败、把 `failed` 置为 true，
 * `missing()` 还会因此闪一条「字体未就绪」。
 *
 * 判据取**控制台**而不是内部状态：这条路径的全部可见症状就是那条警告。
 */
test('内置字体预加载成功（启动不发 [typo] 加载失败警告）', async ({ page }) => {
  const noise: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') noise.push(m.text());
  });
  await boot(page);
  // 预加载是「起了不等」的 promise，等它落地再收网。
  await page.waitForTimeout(600);
  expect(noise.filter((t) => t.includes('[typo]'))).toEqual([]);
});
