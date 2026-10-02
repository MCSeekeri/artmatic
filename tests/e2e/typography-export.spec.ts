import { expect, test } from '@playwright/test';

/**
 * M4 排版：光栅化 → 纹理 → 合成的闭环。
 *
 * ⚠️ 本文件刻意**不使用 demo 工程**。AGENTS §7 记录在案：determinism / algos /
 * effects 里「同一 t 多次求值逐像素一致」的断言有 60–75% 失败率，根因疑似
 * 特效栈（echo 反馈 + glitch）在 GPU 侧的边界采样竞态，与代码版本无关。
 * 所以这里：
 *   1. 用 `store.loadFrom(纯排版工程)` 换掉 demo，只有 solid 底 + 排版片段；
 *   2. 断言尽量走**结构量**（墨迹占比、质心位置、字节哈希），不做逐像素相等；
 *   3. 光栅化本身的确定性走 `typoRasterize` 钩子（不经过 compositor / GPU）。
 */

const DOC_W = 640;
const DOC_H = 360;

/** 一条横贯画面顶部 1/6 处的白色带子。方向错了会立刻露馅。 */
function bandDoc() {
  return {
    size: { w: DOC_W, h: DOC_H },
    background: { kind: 'none' },
    elements: [
      {
        kind: 'shape',
        id: 'band',
        name: 'band',
        // 顶部：doc y ∈ [12, 60]，占整幅高度 360 的 1/6
        frame: { x: 0, y: 12, w: DOC_W, h: 48, rot: 0 },
        blend: 'normal',
        opacity: 1,
        visible: true,
        locked: false,
        animations: [],
        shape: 'rect',
        fill: { kind: 'solid', color: '#ffffff' },
        stroke: null,
      },
    ],
    fonts: [],
  };
}

/** 带淡入动画的矩形，用来验证「动画真的被 seek 到 t 上了」。 */
function animatedDoc() {
  const doc = bandDoc();
  doc.elements[0]!.animations = [
    {
      id: 'a1',
      kind: 'preset',
      preset: 'fade-in',
      delay: 0,
      duration: 0.6,
      iterations: 1,
      easing: 'linear',
      direction: 'normal',
      fill: 'both',
    },
  ] as never;
  return doc;
}

function projectWith(doc: unknown, duration = 0.2) {
  return {
    schemaVersion: 2,
    name: 'typo-e2e',
    seed: 12345,
    fps: 30,
    resolution: { w: DOC_W, h: DOC_H },
    duration,
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
            end: duration,
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
  };
}

const BOOT = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
};

test('排版片段进入合成链，且方向正确（不上下颠倒）', async ({ page }) => {
  await BOOT(page);

  const result = await page.evaluate(
    async ({ doc, project }) => {
      const A = (window as never as { __artmatic: TypoHooks }).__artmatic;
      // 挂起预览 rAF：否则后台 tick 会在两条渲染之间乱泵帧。
      A.appState.exportProgress = 0;
      try {
        A.store.loadFrom(project);
        A.renderer.setExportSize(640, 360);
        A.renderer.onSeek();

        // 光栅化是异步的：第一次 renderFrame 必然落空（返回 null = 这一层缺席），
        // 结果就绪后 onReady → store.touch()。这里轮询到墨迹出现为止。
        let info = { ink: 0, cx: 0, cy: 0, w: 0, h: 0 };
        for (let i = 0; i < 120; i++) {
          A.renderFrame(0.05);
          info = measure(A.renderer.readPixels());
          if (info.ink > 0) break;
          await new Promise((r) => setTimeout(r, 25));
        }
        return info;
      } finally {
        A.appState.exportProgress = null;
      }

      /**
       * readPixels 的原点是**左下**（GL 约定），所以 data 里 row 0 是画面底部。
       * 于是「画面上半部分的带子」应该落在**较大的** y 索引上。
       */
      function measure(px: { data: Uint8Array; w: number; h: number }) {
        let ink = 0;
        let sumY = 0;
        let sumX = 0;
        for (let y = 0; y < px.h; y++) {
          for (let x = 0; x < px.w; x++) {
            const i = (y * px.w + x) * 4;
            if (px.data[i]! > 128) {
              ink += 1;
              sumY += y;
              sumX += x;
            }
          }
        }
        return {
          ink,
          w: px.w,
          h: px.h,
          cx: ink ? sumX / ink / px.w : 0,
          cy: ink ? sumY / ink / px.h : 0,
        };
      }
    },
    { doc: bandDoc(), project: projectWith(bandDoc()) },
  );

  // 带子确实画出来了。面积 = 640×48 / 640×360 ≈ 13.3%
  const frac = result.ink / (result.w * result.h);
  expect(frac).toBeGreaterThan(0.1);
  expect(frac).toBeLessThan(0.17);

  // 水平居中
  expect(result.cx).toBeGreaterThan(0.45);
  expect(result.cx).toBeLessThan(0.55);

  // **方向**：带子在文档顶部（y 12..60 / 360）→ 在 readPixels 坐标里
  // 质心应该在 0.9 附近。若纹理上传漏了 UNPACK_FLIP_Y_WEBGL，这里会变成 ~0.1。
  expect(result.cy).toBeGreaterThan(0.8);
  expect(result.cy).toBeLessThan(0.95);
});

test('导出：帧数正确，两次导出同一帧字节一致', async ({ page }) => {
  await BOOT(page);

  const result = await page.evaluate(
    async ({ project }) => {
      const A = (window as never as { __artmatic: TypoHooks }).__artmatic;
      A.appState.exportProgress = 0;
      try {
        A.store.loadFrom(project);
        // 第一次导出会把文字层预热到导出分辨率并落进缓存。
        const first = await A.exportFrames();
        const second = await A.exportFrames();
        const names = Object.keys(first).sort();
        return {
          count: names.length,
          first: names[0],
          a: hash(first['frame_00000.png']!),
          b: hash(second['frame_00000.png']!),
          aLast: hash(first[names[names.length - 1]!]!),
          bLast: hash(second[names[names.length - 1]!]!),
        };
      } finally {
        A.appState.exportProgress = null;
      }

      function hash(bytes: number[]): string {
        let h = 0x811c9dc5;
        for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
        return h.toString(16).padStart(8, '0');
      }
    },
    { project: projectWith(bandDoc()) },
  );

  expect(result.count).toBe(6); // 0.2s @ 30fps
  expect(result.first).toBe('frame_00000.png');
  // 导出管线里没有随机性：同一工程导两次，同一帧必须逐字节相同。
  expect(result.a).toBe(result.b);
  expect(result.aLast).toBe(result.bLast);
});

test('光栅化本身确定：同参数同结果，动画真的被 seek 到 t 上', async ({ page }) => {
  await BOOT(page);

  const result = await page.evaluate(
    async ({ still, animated }) => {
      const A = (window as never as { __artmatic: TypoHooks }).__artmatic;
      // 这条路径**不经过 compositor / GPU**，所以可以放心做严格相等断言。
      const s1 = await A.typoRasterize(still, 640, 360, 0);
      const s2 = await A.typoRasterize(still, 640, 360, 0);
      // 动画：fade-in，duration 0.6 —— t=0 时 opacity 0，t=0.3 时 0.5
      const a0 = await A.typoRasterize(animated, 640, 360, 0);
      const a3 = await A.typoRasterize(animated, 640, 360, 0.3);
      const a9 = await A.typoRasterize(animated, 640, 360, 0.9);
      return { s1, s2, a0, a3, a9 };
    },
    { still: bandDoc(), animated: animatedDoc() },
  );

  // 静态文档：重复光栅化逐像素一致
  expect(result.s1.hash).toBe(result.s2.hash);
  expect(result.s1.ink).toBe(result.s2.ink);
  expect(result.s1.ink).toBeGreaterThan(0);

  // 动画在 t 上被真实 seek 了：不 seek 的话这五个数会完全一样。
  expect(result.a0.ink).toBe(0); // opacity 0
  expect(result.a3.ink).toBeGreaterThan(0); // opacity 0.5
  expect(result.a9.hash).toBe(result.s1.hash); // 已结束，回到终态（与静态文档相同）
  expect(result.a3.hash).not.toBe(result.s1.hash);
});

test('同一文档重复光栅化不泄漏缓存条目', async ({ page }) => {
  await BOOT(page);

  const result = await page.evaluate(
    async ({ doc }) => {
      const A = (window as never as { __artmatic: TypoHooks }).__artmatic;
      // 静态文档走「帧号 = null」的快速路径，所以同一份文档 + 同一尺寸
      // 只会占一条缓存。这条测试钉住的就是这个性质：漏了它，标题卡会每帧
      // 重新光栅化一次，而且**看不出来**（只是慢）。
      const before = A.typoStats();
      for (let i = 0; i < 4; i++) await A.typoRasterize(doc, 320, 180, 0);
      const after = A.typoStats();
      return { before, after };
    },
    { doc: bandDoc() },
  );

  // typoRasterize 不走缓存（它是「强制光栅化」），所以这里只断言
  // 缓存没有被无意写入 —— 缓存只由合成路径的 resolve 写入。
  expect(result.after.entries).toBe(result.before.entries);
});

interface TypoHooks {
  store: { loadFrom: (p: unknown) => void };
  appState: { exportProgress: number | null };
  renderer: {
    setExportSize: (w: number, h: number) => void;
    readPixels: () => { data: Uint8Array; w: number; h: number };
    onSeek: () => void;
  };
  renderFrame: (t: number) => void;
  exportFrames: () => Promise<Record<string, number[]>>;
  typoRasterize: (
    doc: unknown,
    w: number,
    h: number,
    localSec: number,
  ) => Promise<{ w: number; h: number; ink: number; sum: number; hash: string }>;
  typoStats: () => { entries: number; bytes: number };
}
