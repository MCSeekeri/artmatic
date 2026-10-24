import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 视频变速（v14）的 E2E 守卫：**速度改的是「素材内时间」，不是片段几何**。
 *
 * 素材现场编（`__artmatic.makeTestVideo`，2 秒）：
 *
 * | 素材时间 | 上半 | 下半 |
 * |---|---|---|
 * | `[0,1)` | 红 | 蓝 |
 * | `[1,2)` | 绿 | 蓝 |
 *
 * 三条判据各自对应一种会静默出错的实现：
 *   1. `speed = 2` 时 t=0.75 已经该看到绿 —— 没生效的话它还是红（取帧仍按 t 算）。
 *   2. 片段边界不动 —— 「变速顺手把片段拉长/缩短」是另一类错。
 *   3. 速度曲线取负 = 倒放：t 增大时素材时间**往回走**（绿 → 红），
 *      只按 `Δt × 负速度` 或者干脆忽略曲线都会让这条挂掉。
 *
 * 视频是异步就绪的（缺帧时预览拿最近一帧顶上，见 engine/video-source.ts），
 * 所以判据一律用轮询等待，不写「渲一次就断言」。
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
}

/** 清空舞台并建一条空的视觉轨，返回 trackId。 */
async function cleanStage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: {
          addTrack: (kind: 'visual', name?: string) => string;
          commit: (label: string, fn: (p: { tracks: { id: string; enabled: boolean }[] }) => void) => void;
        };
      };
    }).__artmatic;
    A.store.commit('e2e: 清空舞台', (p) => {
      for (const t of p.tracks) t.enabled = false;
    });
    const track = A.store.addTrack('visual', 'E2E');
    A.store.commit('e2e: 只启用新轨', (p) => {
      for (const t of p.tracks) t.enabled = t.id === track;
    });
    return track;
  });
}

/**
 * 等启用轨上出现片段。
 *
 * ⚠️ **这里不许再调 `openDemo`。** 曾经有这么一行，语义是「导入把工程弄没了
 * 就把 demo 重新打开」——它会把「导入后工程被关掉」这种真回归掩盖成绿，
 * 因为欢迎界面又出现了、条件又满足了。现在如果工程真的没了，这里会超时。
 */
async function waitForClip(page: Page, timeout = 60_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const A = (window as never as {
        __artmatic: { store: { project: { tracks: { clips: unknown[]; enabled: boolean }[] } } };
      }).__artmatic;
      return A.store.project.tracks.some((t) => t.enabled && t.clips.length > 0);
    },
    undefined,
    { timeout },
  );
}

/** 上半的平均色满足 `want` 时返回 true（下半必须是蓝，方向判据与 m6 一致）。 */
async function waitFrameAt(page: Page, t: number, want: 'topRed' | 'topGreen'): Promise<boolean> {
  return page
    .waitForFunction(
      ({ t, want }) => {
        const A = (window as never as {
          __artmatic: {
            renderer: { onSeek: () => void };
            renderFrame: (t: number) => void;
            readPixels: () => { data: number[]; w: number; h: number };
          };
        }).__artmatic;
        A.renderer.onSeek();
        A.renderFrame(t);
        const { data, w, h } = A.readPixels();
        const mid = Math.floor(h / 2);
        let tr = 0;
        let tg = 0;
        let tb = 0;
        let br = 0;
        let bb = 0;
        for (let y = 0; y < h; y += 1) {
          for (let x = 0; x < w; x += 1) {
            const i = (y * w + x) * 4;
            if (y < mid) {
              br += data[i]!;
              bb += data[i + 2]!;
            } else {
              tr += data[i]!;
              tg += data[i + 1]!;
              tb += data[i + 2]!;
            }
          }
        }
        const half = (w * h) / 2;
        const bottomBlue = bb / half > br / half + 40;
        const topOk = want === 'topRed' ? tr / half > tb / half + 40 : tg / half > tr / half + 40;
        return bottomBlue && topOk;
      },
      { t, want },
      { timeout: 20_000, polling: 250 },
    )
    .then(() => true)
    .catch(() => false);
}

/** 导入现场编的视频，返回片段 id 与轨道 id。 */
async function importTestVideo(page: Page, trackId: string): Promise<string> {
  const bytes = await page.evaluate(async () => {
    const A = (window as never as { __artmatic: { makeTestVideo: () => Promise<number[]> } }).__artmatic;
    return A.makeTestVideo();
  });
  expect(bytes.length).toBeGreaterThan(1000);

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    (async () => {
      await page.locator('[data-testid=track-menu]').last().click();
      await page.getByTestId('import-video').click();
    })(),
  ]);
  await chooser.setFiles({
    name: 'e2e-speed.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from(bytes),
  });
  await waitForClip(page);

  return page.evaluate((tid) => {
    const A = (window as never as {
      __artmatic: {
        store: {
          project: { tracks: { id: string; clips: { id: string; start: number; end: number }[] }[] };
        };
      };
    }).__artmatic;
    const track = A.store.project.tracks.find((t) => t.id === tid) ?? A.store.project.tracks.find((t) => t.clips.length);
    return track?.clips[0]?.id ?? '';
  }, trackId);
}

test('变速：2× 后同一 t 取到更靠后的素材（素材只够 1s 时片段缩短）', async ({ page }) => {
  await boot(page);
  const trackId = await cleanStage(page);
  const clipId = await importTestVideo(page, trackId);
  expect(clipId).toBeTruthy();

  // 基线：常速下 t=0.75 仍是红（[0,1) 那一段）
  expect(await waitFrameAt(page, 0.75, 'topRed'), '常速基线应当是红').toBe(true);

  const before = await page.evaluate((id) => {
    const A = (window as never as {
      __artmatic: { store: { findClip: (id: string) => { clip: { start: number; end: number } } | null } };
    }).__artmatic;
    const c = A.store.findClip(id)!.clip;
    return { start: c.start, end: c.end };
  }, clipId);

  await page.evaluate((id) => {
    const A = (window as never as {
      __artmatic: { store: { setClipSpeed: (id: string, v: number) => void } };
    }).__artmatic;
    A.store.setClipSpeed(id, 2);
  }, clipId);

  const after = await page.evaluate((id) => {
    const A = (window as never as {
      __artmatic: {
        store: { findClip: (id: string) => { clip: { start: number; end: number; source: { speed?: number } } } | null };
      };
    }).__artmatic;
    const c = A.store.findClip(id)!.clip;
    return { start: c.start, end: c.end, speed: c.source.speed };
  }, clipId);

  expect(after.speed).toBe(2);
  // 起点不动；终点按「素材用完为止」缩短：2s 素材在 2× 下只够 1s 时间轴。
  // 这一条正是用户点名的例外（因速度过快导致可用时长不足）。
  expect(after.start).toBe(before.start);
  expect(after.end - after.start).toBeCloseTo(1, 6);
  // 素材更长的工程里不会缩 —— 单测 `speed.test.ts` 钉的是那条常规路径
  expect(before.end - before.start).toBeGreaterThan(1.5);

  // 2× 下 t=0.75 的素材时间是 1.5s → 上半绿
  expect(await waitFrameAt(page, 0.75, 'topGreen'), '2× 下 t=0.75 应当取到 1.5s 处（绿）').toBe(true);
});

test('变速曲线取负 = 倒放：t 增大时素材时间往回走', async ({ page }) => {
  await boot(page);
  const trackId = await cleanStage(page);
  const clipId = await importTestVideo(page, trackId);
  expect(clipId).toBeTruthy();

  // 片段缩到 1s、srcIn 1.5、速度曲线恒为 -1
  await page.evaluate((id) => {
    const A = (window as never as {
      __artmatic: {
        store: {
          updateClip: (id: string, label: string, fn: (c: never) => void) => void;
        };
      };
    }).__artmatic;
    A.store.updateClip(id, 'e2e: 倒放', (c) => {
      const clip = c as unknown as {
        end: number;
        source: { type: string; srcIn: number };
        curves: Record<string, unknown>;
      };
      clip.end = 1;
      if (clip.source.type === 'video') clip.source.srcIn = 1.5;
      clip.curves.speed = { keys: [{ t: 0, v: -1, interp: 'linear' }] };
    });
  }, clipId);

  // t=0.25 → 素材 1.25s（绿）；t=0.9 → 0.6s（红）
  expect(await waitFrameAt(page, 0.25, 'topGreen'), '倒放起点应当取到 1.25s 处（绿）').toBe(true);
  expect(await waitFrameAt(page, 0.9, 'topRed'), '倒放 0.65s 后应当回到 0.6s 处（红）').toBe(true);
});
