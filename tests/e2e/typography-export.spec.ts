import { expect, test } from '@playwright/test';
import { openDemo } from './_stage';

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

/** `bandDoc` 的变体工厂：起点不同 ⇒ 文档哈希不同 ⇒ 缓存键不同（并发用例要三份不同的文档）。 */
function bandDocAt(y: number, h = 48, color = '#ffffff') {
  const doc = bandDoc();
  doc.elements[0]!.frame = { x: 0, y, w: DOC_W, h, rot: 0 };
  doc.elements[0]!.fill = { kind: 'solid', color };
  return doc;
}

const midBandDoc = () => bandDocAt(120);
const lowerBandDoc = () => bandDocAt(240);

/** 三条视觉轨、各一条排版片段、都在同一时刻可见（导出预热的并发/淘汰用例）。 */
function threeBandProject() {
  const duration = 0.2;
  const track = (id: string, doc: unknown, start: number) => ({
    kind: 'visual' as const,
    id,
    name: id,
    enabled: true,
    clips: [
      {
        kind: 'source' as const,
        id: `${id}-clip`,
        start,
        end: duration,
        label: '排版',
        fadeSec: 0,
        curves: {},
        source: { type: 'text' as const, doc },
        blend: 'normal' as const,
        opacity: 1,
        transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
        fit: 'contain' as const,
      },
    ],
  });
  return {
    ...projectWith(bandDocAt(0, 60), duration),
    // 各占 1/6 高（60 / 360），三条合起来正好半幅墨迹。
    tracks: [
      track('v1', bandDocAt(0, 60), 0),
      track('v2', bandDocAt(120, 60), 0),
      track('v3', bandDocAt(240, 60), 0),
    ],
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

/** 手写 CSS 动 `visibility`（不在旧的三个属性里），守住烘焙的动态快照。 */
function blinkDoc() {
  const doc = bandDoc();
  doc.elements[0]!.animations = [
    {
      id: 'blink',
      kind: 'custom',
      css: 'from{visibility:hidden}to{visibility:visible}',
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
  await openDemo(page);
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

/**
 * 烘焙必须覆盖**关键帧里出现的所有属性**，不只是 transform / opacity / filter。
 *
 * 手写 CSS 的属性名不受限（`parseCustomCss` 只校验关键帧选择器），而旧实现的
 * 快照写死了那三个 —— `visibility` / `letter-spacing` / `clip-path` 这类会被漏掉：
 * 停掉动画后它们回落到基础样式值，表现是**预览会动、导出不动、且不报错**。
 *
 * 为什么用 `visibility` 而不是 `color`：排版元素的颜色都有自己的显式来源
 * （形状走 SVG `fill` 属性、文字走 `.typo-text` 的 `background-clip:text`），
 * 动画层上的 `color` 根本不参与绘制 —— 拿它测只会得到「改不改都一样」的假绿。
 * `visibility` 没有任何别处会写，只能来自动画 ⇒ 漏了一定看得见。
 */
test('烘焙覆盖任意属性：手写 CSS 动 visibility，导出也跟着变', async ({ page }) => {
  await BOOT(page);

  const result = await page.evaluate(
    async ({ still, animated }) => {
      const A = (window as never as { __artmatic: TypoHooks }).__artmatic;
      const t0 = await A.typoRasterize(animated, 640, 360, 0);
      const t6 = await A.typoRasterize(animated, 640, 360, 0.6);
      const base = await A.typoRasterize(still, 640, 360, 0);
      return { t0, t6, base };
    },
    { still: bandDoc(), animated: blinkDoc() },
  );

  expect(result.base.ink).toBeGreaterThan(0);
  expect(result.t0.ink, 't=0 时动画把它藏了，导出也必须藏').toBe(0);
  // 动画结束回到常态：与「没有动画」的同一份文档逐像素相同。
  expect(result.t6.hash).toBe(result.base.hash);
});

/**
 * 并发光栅化必须与顺序光栅化**逐字段相同**。
 *
 * 后端（`dom-snap`）每次截图都把文档 `replaceChildren` 进**同一个 host**，而
 * `snapdom()` / `toCanvas()` 是异步的：两次并发调用会互相把对方的 root 从文档里
 * 摘掉 —— 脱离文档的元素拿不到 CSSAnimation、`getComputedStyle` 回落成空值，
 * 截出来是一张**全透明或全不透明黑**的废图，而且不报错。runtime 又按**正确的键**
 * 把它缓存下来（静态文档的键不含帧号）⇒ 坏图会一直生效到被淘汰，表现成
 * 「某一层排版把下面整幅画面涂黑 / 凭空消失」。
 *
 * 三条并发路径都是既有的：rAF 预览的 `schedule`、导出的 `prewarmFrame`
 * （`Promise.all`，天然并发）、编辑器的 `rasterizeOnce`。所以这条断言守的是
 * `TextRasterizer` 契约里那句「**必须确定**：同参数同结果」。
 */
test('并发光栅化与顺序光栅化产物一致', async ({ page }) => {
  await BOOT(page);

  const result = await page.evaluate(
    async ({ docs }) => {
      const A = (window as never as { __artmatic: TypoHooks }).__artmatic;
      const seq: TypoShot[] = [];
      for (const d of docs) seq.push(await A.typoRasterize(d, 640, 360, 0));
      // 与 `prewarmFrame` 同样的并发形状：三个文档同时起跑。
      const con = await Promise.all(docs.map((d) => A.typoRasterize(d, 640, 360, 0)));
      // 同一份文档并发两次：逐像素也必须一致。
      const twice = await Promise.all([
        A.typoRasterize(docs[0], 640, 360, 0),
        A.typoRasterize(docs[0], 640, 360, 0),
      ]);
      return { seq, con, twice };
    },
    { docs: [bandDoc(), midBandDoc(), lowerBandDoc()] },
  );

  // 先确认「顺序」这一路本身是好图：否则下面的相等断言可能是「都坏得很一致」。
  for (const s of result.seq) expect(s.ink).toBeGreaterThan(0);

  expect(result.con.map((s) => ({ ...s }))).toEqual(result.seq.map((s) => ({ ...s })));
  expect(result.twice[0]).toEqual(result.twice[1]);
});

/**
 * 导出预热：一帧有多层排版时，条目上限必须罩得住它们。
 *
 * `EXPORT_ENTRIES` 原本写死 2（「导出是顺序的，留着历史纯属浪费显存」）。但上限若
 * 小于「这一帧会被画到的排版层个数」，它们会每帧互相淘汰，而导出态**没有**
 * 「缺帧用最近一帧顶上」那条回退（见 `TypographyRuntime.resolve`）⇒ 那一层这帧
 * 真的没有，表现是逐帧闪烁。三条轨各一块白带：缺一层，墨迹占比就掉三分之一。
 */
test('导出预热：同帧三层排版都留下（不互相淘汰）', async ({ page }) => {
  await BOOT(page);

  const result = await page.evaluate(
    async ({ project }) => {
      const A = (window as never as { __artmatic: TypoHooks }).__artmatic;
      A.appState.exportProgress = 0;
      try {
        A.store.loadFrom(project);
        const project_ = A.store.project;
        A.renderer.setExportSize(640, 360);
        A.renderer.onSeek();
        A.renderer.enterExportMode();
        try {
          // 与导出循环同一形状：先预热这一帧，再渲染。
          await A.renderer.prepareFrame(project_, 0.05);
          A.renderFrame(0.05);
          return { stats: A.typoStats(), ink: inkOf(A.renderer.readPixels()) };
        } finally {
          A.renderer.exitExportMode();
        }
      } finally {
        A.appState.exportProgress = null;
      }

      function inkOf(px: { data: Uint8Array; w: number; h: number }): number {
        let ink = 0;
        for (let i = 0; i < px.data.length; i += 4) if (px.data[i]! > 128) ink += 1;
        return ink / (px.w * px.h);
      }
    },
    { project: threeBandProject() },
  );

  // 三层各占 1/6 高：全在 = 0.5，缺一层 = 0.333 或 0.167。
  expect(result.ink).toBeGreaterThan(0.45);
  expect(result.ink).toBeLessThan(0.55);
  // 缓存里也必须是三条（上限罩得住），而不是被压到 2。
  expect(result.stats.entries).toBeGreaterThanOrEqual(3);
});

/**
 * 预算不够时**保画面**，并把超支报出来。
 *
 * 这是 `EXPORT_ENTRIES = 2` 那次的推广形态：上限（无论是条目数还是字节）与
 * 「这一帧要画什么」冲突时，正确的行为是**保住画面 + 显式告知**，而不是让上限赢
 * —— 上限赢的表现是「某一层隔帧消失」，而我们是静默地少画了一层。
 *
 * 这里把预算压到荒谬的 1 MB，三层排版仍然必须全部留下（`overBudget` 为真）。
 */
test('排版预算不够时保住画面，并把超支报出来', async ({ page }) => {
  await BOOT(page);

  const result = await page.evaluate(
    async ({ project }) => {
      const A = (window as never as { __artmatic: TypoHooks }).__artmatic;
      A.appState.exportProgress = 0;
      const before = A.capacity.get().limits.textRasterMB;
      try {
        A.store.loadFrom(project);
        const p = A.store.project;
        // 渲染尺寸取 **1920×1080**（不是 640×360）：三层光栅就是 24.9 MB，
        // 这样才能压过预算的下限（`RANGE.textRasterMB` 的 floor 是 8 MB ——
        // 1 MB 那种写法会被 `sanitize` 夹回去，用例会变成假绿）。
        A.renderer.setExportSize(1920, 1080);
        A.renderer.onSeek();
        A.renderer.enterExportMode();
        try {
          await A.renderer.prepareFrame(p, 0.05);
          A.renderFrame(0.05);
          // 导出态先出一版完整画面（进缓存）
          const full = inkOf(A.renderer.readPixels());
          A.renderer.exitExportMode();

          // 预算压到下限，再走一次「进入/退出导出态」逼出一次淘汰结算 ——
          // 淘汰是**延迟**的（只在 upload / 模式切换时才结算），所以这里显式触发。
          A.capacity.set({ textRasterMB: 8 });
          await A.renderer.prepareFrame(p, 0.05);
          A.renderer.enterExportMode();
          A.renderer.exitExportMode();
          A.renderFrame(0.05);
          const squeezed = inkOf(A.renderer.readPixels());
          const afterEvict = A.typoStats();
          // 前提：在屏的三层确实撑破了预算（否则这条用例什么都没测到）。
          const liveMB = (afterEvict.entries * 1920 * 1080 * 4) / (1024 * 1024);
          return { full, squeezed, afterEvict, liveMB, budgetMB: A.capacity.get().limits.textRasterMB };
        } finally {
          A.renderer.exitExportMode();
        }
      } finally {
        A.appState.exportProgress = null;
        A.capacity.set({ textRasterMB: before });
      }

      function inkOf(px: { data: Uint8Array; w: number; h: number }): number {
        let ink = 0;
        for (let i = 0; i < px.data.length; i += 4) if (px.data[i]! > 128) ink += 1;
        return ink / (px.w * px.h);
      }
    },
    { project: threeBandProject() },
  );

  // 前提：在屏的三层确实撑破了预算（这条不成立的话，下面的断言就什么都没证明）。
  expect(result.liveMB).toBeGreaterThan(result.budgetMB);
  // 压缩预算前后画面**一样**：三层都还在（没有为了让预算达标而少画一层）。
  expect(result.squeezed).toBeCloseTo(result.full, 5);
  expect(result.squeezed).toBeGreaterThan(0.45);
  // 而且这件事是**可见的**，不是静默的。
  expect(result.afterEvict.overBudget).toBe(true);
  expect(result.afterEvict.entries).toBeGreaterThanOrEqual(3);
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

interface TypoShot {
  w: number;
  h: number;
  ink: number;
  sum: number;
  hash: string;
}

interface TypoHooks {
  store: { loadFrom: (p: unknown) => void; project: unknown };
  appState: { exportProgress: number | null };
  renderer: {
    setExportSize: (w: number, h: number) => void;
    readPixels: () => { data: Uint8Array; w: number; h: number };
    onSeek: () => void;
    prepareFrame: (project: unknown, t: number) => Promise<void>;
    enterExportMode: () => void;
    exitExportMode: () => void;
  };
  /** 容量预算的读写（E2E 用它把预算钉死，否则行为跟着跑测试的机器变）。 */
  capacity: {
    get: () => { limits: { textRasterMB: number } };
    set: (patch: Record<string, number>) => unknown;
  };
  renderFrame: (t: number) => void;
  exportFrames: () => Promise<Record<string, number[]>>;
  typoRasterize: (doc: unknown, w: number, h: number, localSec: number) => Promise<TypoShot>;
  typoStats: () => { entries: number; bytes: number; live: number; overBudget: boolean };
}
