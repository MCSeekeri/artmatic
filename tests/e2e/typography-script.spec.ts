/**
 * typography-script.spec.ts — 排版文档脚本的端到端验证。
 *
 * 只走 `typoRasterize`（光栅化本身，不经过 compositor / GPU）：文档脚本的
 * 承诺是「同一 t 同结果」，而整条 GPU 链路有已知的边界采样竞态（AGENTS §1.3）。
 * 在这里逐像素相等是可以要求的，在合成链上不可以。
 *
 * 覆盖四件事：
 *   1. 总开关关闭 = 与「文档里没有脚本」逐像素相同（信任边界的承诺）；
 *   2. 打开后脚本真的改画面，且同一 t 两次光栅化逐像素相同；
 *   3. `needs:['canvas']` 真的插入并截到了 2D canvas；
 *   4. 脚本抛错不会毁掉这一帧（画面回到文档原样）。
 */

import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

const DOC_W = 640;
const DOC_H = 360;

interface Shot {
  w: number;
  h: number;
  ink: number;
  sum: number;
  hash: string;
}

interface Hooks {
  appState: {
    setRunTypoScripts: (on: boolean) => void;
    runTypoScripts: boolean;
    exportProgress: number | null;
  };
  typoRasterize: (doc: unknown, w: number, h: number, t: number) => Promise<Shot>;
  store: { loadFrom: (p: unknown) => void };
  renderer: {
    setExportSize: (w: number, h: number) => void;
    clearExportSize: () => void;
    onSeek: () => void;
    enterExportMode: () => void;
    exitExportMode: () => void;
    prepareFrame: (p: unknown, t: number) => Promise<void>;
    renderFrame: (p: unknown, t: number) => void;
    readPixels: () => { data: Uint8Array; w: number; h: number };
  };
}

/** 一条白色矩形带（顶部 1/6）。脚本把它隐藏 / 移动时墨迹会立刻变化。 */
function bandDoc(scripts?: unknown[]) {
  return {
    size: { w: DOC_W, h: DOC_H },
    background: { kind: 'none' },
    elements: [
      {
        kind: 'shape',
        id: 'band',
        name: 'band',
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
    ...(scripts ? { scripts } : {}),
  };
}

/** 空矩形（不画任何东西）—— 画布脚本的落点。 */
function emptyDoc(scripts?: unknown[]) {
  return {
    size: { w: DOC_W, h: DOC_H },
    background: { kind: 'none' },
    elements: [
      {
        kind: 'shape',
        id: 'stage',
        name: 'stage',
        frame: { x: 0, y: 0, w: DOC_W, h: DOC_H, rot: 0 },
        blend: 'normal',
        opacity: 1,
        visible: true,
        locked: false,
        animations: [],
        shape: 'rect',
        fill: { kind: 'none' },
        stroke: null,
      },
    ],
    fonts: [],
    ...(scripts ? { scripts } : {}),
  };
}

const script = (code: string, needs?: string[]) => ({
  id: 's1',
  name: 'E2E script',
  code,
  enabled: true,
  ...(needs ? { needs, targets: ['band'] } : {}),
});

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

test('总开关关闭：与「文档里没有脚本」逐像素相同', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(
    async ({ plain, scripted }) => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      A.appState.setRunTypoScripts(false);
      const a = await A.typoRasterize(plain, 640, 360, 0);
      const b = await A.typoRasterize(scripted, 640, 360, 0);
      return { a, b };
    },
    {
      plain: bandDoc(),
      scripted: bandDoc([script("const el = ctx.el('band'); if (el) el.visible(false);")]),
    },
  );
  expect(result.a.ink).toBeGreaterThan(0);
  expect(result.b.hash).toBe(result.a.hash);
  expect(result.b.ink).toBe(result.a.ink);
});

test('打开后脚本改画面；同一 t 两次光栅化逐像素相同', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(
    async ({ plain, hidden, faded }) => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      A.appState.setRunTypoScripts(true);
      try {
        const base = await A.typoRasterize(plain, 640, 360, 0);
        const h1 = await A.typoRasterize(hidden, 640, 360, 0);
        const h2 = await A.typoRasterize(hidden, 640, 360, 0);
        const f0 = await A.typoRasterize(faded, 640, 360, 0);
        const f5 = await A.typoRasterize(faded, 640, 360, 0.5);
        return { base, h1, h2, f0, f5 };
      } finally {
        A.appState.setRunTypoScripts(false);
      }
    },
    {
      plain: bandDoc(),
      hidden: bandDoc([script("const el = ctx.el('band'); if (el) el.visible(false);")]),
      // 随时间变化的脚本：t 不同 → 像素不同。
      faded: bandDoc([
        script("const el = ctx.el('band'); if (el) el.opacity(0.2 + ctx.t * 0.8);"),
      ]),
    },
  );
  expect(result.base.ink).toBeGreaterThan(0);
  // visible(false) 真的把它藏了
  expect(result.h1.ink).toBe(0);
  // 同一 t 两次：逐像素相同（这是「确定性」的承诺）
  expect(result.h2).toEqual(result.h1);
  // 时间进求值：0 与 0.5 的画面不同
  expect(result.f5.hash).not.toBe(result.f0.hash);
  expect(result.f0.hash).not.toBe(result.base.hash);
});

test('needs:["canvas"]：2D 画布内容被截进产物', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(
    async ({ plain, drawn }) => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      A.appState.setRunTypoScripts(false);
      const off = await A.typoRasterize(drawn, 640, 360, 0);
      A.appState.setRunTypoScripts(true);
      try {
        const on = await A.typoRasterize(drawn, 640, 360, 0);
        return { off, on, plainInk: (await A.typoRasterize(plain, 640, 360, 0)).ink };
      } finally {
        A.appState.setRunTypoScripts(false);
      }
    },
    {
      plain: emptyDoc(),
      drawn: emptyDoc([
        {
          id: 's1',
          name: 'canvas fill',
          code:
            "const el = ctx.el('stage'); if (!el) return; const g = el.canvas(); if (!g) return; " +
            "const b = el.box(); g.fillStyle = '#ffffff'; g.fillRect(0, 0, b.w, b.h);",
          enabled: true,
          needs: ['canvas'],
          targets: ['stage'],
        },
      ]),
    },
  );
  expect(result.plainInk).toBe(0);
  expect(result.off.ink).toBe(0);
  // 整块画布都涂白了：面积接近 640×360（边缘允许一两行抗锯齿差异）
  expect(result.on.ink).toBeGreaterThan(result.on.w * result.on.h * 0.95);
});

test('脚本抛错：这一帧回到文档原样，不产生废图', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(
    async ({ plain, broken }) => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      A.appState.setRunTypoScripts(true);
      try {
        const a = await A.typoRasterize(plain, 640, 360, 0);
        const b = await A.typoRasterize(broken, 640, 360, 0);
        return { a, b };
      } finally {
        A.appState.setRunTypoScripts(false);
      }
    },
    {
      plain: bandDoc(),
      broken: bandDoc([script("const el = ctx.el('band'); el.nope();")]),
    },
  );
  expect(result.a.ink).toBeGreaterThan(0);
  // 脚本失败 = 这一条不生效，画面按文档原样画
  expect(result.b.hash).toBe(result.a.hash);
});

/**
 * 导出链路回归：带脚本的文档每帧都是新缓存键，`prewarmFrame` 会逐帧光栅化。
 * 曾经的 bug 是 `evict` 把**刚落地的这一帧**当成最旧的一条删掉（导出期
 * `live` / `livePrev` 还停在前两帧上），于是 `resolve` 必然 miss、这一帧
 * 排版层整层缺席 —— 成片从第 3 帧起纯黑，而且每帧还多烘一张。
 */
test('导出链路：逐帧脚本不会在半途丢掉排版层（黑帧回归）', async ({ page }) => {
  await boot(page);
  const frames = await page.evaluate(
    async ({ doc }) => {
      const A = (window as never as { __artmatic: Hooks }).__artmatic;
      const project = {
        schemaVersion: 2,
        name: 'script-export',
        seed: 12345,
        fps: 30,
        resolution: { w: 640, h: 360 },
        duration: 0.5,
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
                end: 0.5,
                label: 'text',
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
      A.appState.exportProgress = 0;
      A.appState.setRunTypoScripts(true);
      try {
        A.store.loadFrom(project);
        A.renderer.setExportSize(640, 360);
        A.renderer.onSeek();
        A.renderer.enterExportMode();
        const out: { t: number; ink: number; sum: number }[] = [];
        for (let i = 0; i < 6; i++) {
          const t = i / 30;
          await A.renderer.prepareFrame(project, t);
          A.renderer.renderFrame(project, t);
          const px = A.renderer.readPixels();
          let ink = 0;
          let sum = 0;
          for (let p = 0; p < px.data.length; p += 4) {
            if (px.data[p + 3]! > 8) ink++;
            sum += px.data[p]! + px.data[p + 1]! + px.data[p + 2]!;
          }
          out.push({ t, ink, sum });
        }
        A.renderer.exitExportMode();
        return out;
      } finally {
        A.appState.setRunTypoScripts(false);
        A.renderer.clearExportSize();
        A.renderer.onSeek();
        A.appState.exportProgress = null;
      }
    },
    {
      doc: bandDoc([
        script("const el = ctx.el('band'); if (el) el.opacity(0.3 + ctx.t * 2);"),
      ]),
    },
  );

  expect(frames.length).toBe(6);
  for (const f of frames) {
    expect(f.sum, `第 ${f.t.toFixed(3)}s 的排版层不见了（导出会得到纯黑帧）`).toBeGreaterThan(0);
  }
  // 脚本真的在逐帧改画面（不是六张一样的图）
  expect(new Set(frames.map((f) => f.sum)).size).toBeGreaterThan(1);
});


