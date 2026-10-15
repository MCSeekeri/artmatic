import { expect, test, type Page } from '@playwright/test';
import { openDemo, rgbMeanAt } from './_stage';

/**
 * 「脱机媒体」占位符。
 *
 * 片段引用了**不存在的**素材时，画面给一块暗红色占位（图标 + 「脱机媒体」），
 * 而不是静默跳过那一层（无声空白）。三条渲染出口都要覆盖：
 *   1. 时间轴上的**图片片段**（compositor → 占位纹理）
 *   2. 时间轴上的**视频片段**（同一条路，素材字节不在仓里）
 *   3. **排版文档**里的图片元素（render-dom → DOM 占位节点）
 *
 * 判据的 A/B 是这条用例的核心：占位符只画给「不存在」，素材一旦真的到了
 * （重新登记）必须立刻换成真图 —— 否则正常加载会满屏闪暗红。
 */

const OFFLINE_ASSET = 'e2e-offline-img';

interface StageApi {
  appState: {
    store: {
      project: {
        tracks: { clips: { id: string; kind: string; source?: { type?: string } }[] }[];
      };
      commit: (
        label: string,
        fn: (p: {
          tracks: {
            id: string;
            enabled: boolean;
            clips: { id: string; source?: { type?: string; doc?: { elements: unknown[] } } }[];
          }[];
        }) => void,
      ) => void;
    };
    openTypographyTab: (clipId: string) => void;
  };
  store: {
    commit: (
      label: string,
      fn: (p: {
        tracks: { id: string; enabled: boolean; clips: unknown[] }[];
        assets: Record<string, unknown>;
      }) => void,
    ) => void;
    addTrack: (kind: 'visual', name?: string) => string;
    addClip: (trackId: string, clip: unknown) => void;
  };
  renderer: { onSeek: () => void };
  renderFrame: (t: number) => void;
  readPixels: () => { data: number[]; w: number; h: number };
  registerImageAsset: (assetId: string, blob: Blob) => Promise<void>;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

/** 搭一条「只有一个图片片段」的干净舞台（片段引用一个不存在的 assetId）。 */
async function buildOfflineImageStage(page: Page): Promise<void> {
  await page.evaluate((assetId) => {
    const A = (window as never as { __artmatic: StageApi }).__artmatic;
    A.store.commit('e2e: 清空舞台', (p) => {
      for (const t of p.tracks) t.enabled = false;
    });
    const track = A.store.addTrack('visual', 'OFFLINE');
    A.store.addClip(track, {
      kind: 'source',
      id: 'offline-img-clip',
      start: 0,
      end: 8,
      label: 'offline image',
      fadeSec: 0,
      curves: {},
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
      blend: 'normal',
      opacity: 1,
      source: { type: 'image', assetId },
    });
    A.store.commit('e2e: 启用舞台', (p) => {
      for (const t of p.tracks) t.enabled = t.id === track;
    });
  }, OFFLINE_ASSET);
}

test('视频片段引用不存在的素材 → 同样是暗红占位符（不需要真视频文件）', async ({ page }) => {
  await boot(page);

  await page.evaluate(() => {
    const A = (window as never as { __artmatic: StageApi }).__artmatic;
    A.store.commit('e2e: 清空舞台', (p) => {
      for (const t of p.tracks) t.enabled = false;
    });
    const track = A.store.addTrack('visual', 'OFFLINE-VID');
    A.store.addClip(track, {
      kind: 'source',
      id: 'offline-vid-clip',
      start: 0,
      end: 8,
      label: 'offline video',
      fadeSec: 0,
      curves: {},
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
      blend: 'normal',
      opacity: 1,
      // 字节不在仓里 → 取帧器每一帧都缺席 → 判「不存在」→ 占位符。
      // （这条用例不需要任何视频文件：占位符正是为这种素材画的。）
      source: { type: 'video', assetId: 'e2e-offline-vid', srcIn: 0, speed: 1 },
    });
    A.store.commit('e2e: 启用舞台', (p) => {
      for (const t of p.tracks) t.enabled = t.id === track;
    });
  });

  const [r, g, b] = await rgbMeanAt(page, 2);
  expect(r, `视频占位符应当偏红，实测 rgb=(${r.toFixed(1)}, ${g.toFixed(1)}, ${b.toFixed(1)})`).toBeGreaterThan(
    g + 15,
  );
  expect(r).toBeGreaterThan(b + 15);
});

test('图片片段引用不存在的素材 → 画面是暗红占位符；素材登记后换回真图', async ({ page }) => {
  await boot(page);
  await buildOfflineImageStage(page);

  // 占位符：暗红底（#3b1216）+ 浅色图标文字。判据用**通道关系**而不是亮度 ——
  // 纯黑（那一层被跳过）三通道相等，占位符红通道明显高于另外两个。
  const [r0, g0, b0] = await rgbMeanAt(page, 2);
  expect(r0, `占位符应当偏红，实测 rgb=(${r0.toFixed(1)}, ${g0.toFixed(1)}, ${b0.toFixed(1)})`).toBeGreaterThan(
    g0 + 15,
  );
  expect(r0).toBeGreaterThan(b0 + 15);
  expect(r0).toBeGreaterThan(30);

  // A/B：把素材真的登记上（一张纯红图）→ 占位符必须让位给真图。
  // 纯红图的 G/B 接近 0，与占位符（G/B 各有 ~20-40）分得开。
  await page.evaluate(async (assetId) => {
    const A = (window as never as { __artmatic: StageApi }).__artmatic;
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/png'),
    );
    await A.registerImageAsset(assetId, blob);
  }, OFFLINE_ASSET);

  await page.waitForFunction(
    () => {
      const A = (window as never as { __artmatic: StageApi }).__artmatic;
      A.renderer.onSeek();
      A.renderFrame(2);
      const d = A.readPixels().data;
      let g = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) g += d[i + 1]!;
      return g / n < 12;
    },
    undefined,
    { timeout: 10_000 },
  );

  const [r1, g1, b1] = await rgbMeanAt(page, 2);
  expect(r1).toBeGreaterThan(200);
  expect(g1).toBeLessThan(12);
  expect(b1).toBeLessThan(12);
});

test('排版文档的图片元素引用不存在的素材 → 舞台上是脱机占位节点', async ({ page }) => {
  await boot(page);

  // 找一份文本片段，往它的文档里加一个引用不存在素材的图片元素，再打开编辑器。
  const clipId = await page.evaluate(() => {
    const A = (window as never as { __artmatic: StageApi }).__artmatic;
    let found: string | null = null;
    for (const t of A.appState.store.project.tracks) {
      const clip = t.clips.find((c) => c.kind === 'source' && c.source?.type === 'text');
      if (clip) {
        found = clip.id;
        break;
      }
    }
    if (!found) return null;
    A.appState.store.commit('e2e: 加脱机图片元素', (p) => {
      for (const tk of p.tracks) {
        for (const c of tk.clips as { id: string; source?: { type?: string; doc?: { elements: unknown[] } } }[]) {
          if (c.id !== found || c.source?.type !== 'text' || !c.source.doc) continue;
          c.source.doc.elements.push({
            id: 'e2e-offline-el',
            name: 'offline',
            kind: 'image',
            assetId: 'e2e-offline-typo',
            fit: 'contain',
            frame: { x: 760, y: 340, w: 400, h: 400, rot: 0 },
            blend: 'normal',
            opacity: 1,
            visible: true,
            locked: false,
            animations: [],
          });
        }
      }
    });
    return found;
  });
  expect(clipId).not.toBeNull();

  await page.evaluate((id) => {
    (window as never as { __artmatic: { appState: { openTypographyTab: (id: string) => void } } }).__artmatic.appState.openTypographyTab(id!);
  }, clipId);

  // 占位节点：暗红底 + 图标 + 「脱机媒体」文字
  const node = page.locator('.typo-image[data-typo-offline]');
  await expect(node).toBeVisible();
  await expect(node).toContainText('脱机媒体');
  // 底色确实是暗红（内联样式，两条渲染路都保证一致的那半）
  const bg = await node.locator('div').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(59, 18, 22)');
  // 图标在（file-x-corner 的 path 数 = 4）
  expect(await node.locator('svg path').count()).toBe(4);
});
