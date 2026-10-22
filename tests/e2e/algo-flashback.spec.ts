import { expect, test, type Page } from '@playwright/test';
import { buildStage, gridStats, openDemo, renderTwiceStats, sampleL1, settle } from './_stage';

/**
 * 闪回（`recall` 型生成器）—— 整条回放通路的**唯一**端到端证明。
 *
 * 这条生成器不算像素，它让宿主把工程在**过去某个时刻**整帧重渲一遍。所以
 * 「参数存进了 store / 着色器编过了」什么都证明不了：真正要证明的是
 * **画出来的那张图 = 垫底素材在过去的某个 t 上的那张图**。
 *
 * 做法：源轨放闪回（片段 `[4,8)`），下面垫一条 `gradient`（锥形 + 慢转）当
 * 「之前的画面」。然后把片段换成同一个 `gradient` 直接画，逐点比色：
 *
 * | 闪回的 t | 倒放进度 | 应当等于 gradient 的 t |
 * |---|---|---|
 * | 4（片段头） | 0 | **4**（最贴近片段头的那一帧） |
 * | 6（中段） | 0.5 | **2**（窗口 [0,4] 的中点） |
 * | 5 + `back=2` | 0.25 | **3.5**（窗口 [2,4]） |
 *
 * 中间那行同时钉住**方向**：正放会给出 5，倒放才是 2。判据用 `sampleL1`
 * （逐通道点采样）而不是整幅均值 —— 渐变类的整幅均值对旋转不敏感。
 */

/** 垫底素材。锥形 + 8 级色阶 + 慢转：对时间远比彩条敏感，且周期 5.9 s 不撞车。 */
const FEED = { mode: 'conic', angle: 0, softness: 1, bands: 8, speed: 0.17, colorA: '#12203a', colorB: '#ffb347' };

/** 三次取样之间的判据上限。1:1 采样回环最多差几个单位，真错位是几百。 */
const SAME = 60;
const DIFFERENT = 300;

interface StageApi {
  __artmatic: {
    store: {
      addTrack: (kind: 'visual', name?: string) => string;
      addClip: (trackId: string, clip: unknown) => void;
      commit: (
        label: string,
        fn: (p: { tracks: { id: string; enabled: boolean; clips: { id: string; source: unknown }[] }[] }) => void,
      ) => void;
    };
  };
}

/** 在源轨**下面**垫一条全幅素材（`addTrack` 是 push ⇒ 后加的 z 更低）。 */
async function addFeed(page: Page, sourceTrack: string, generator: string, params: Record<string, string | number>): Promise<void> {
  await page.evaluate(
    ({ sourceTrack, generator, params }) => {
      const A = (window as never as StageApi).__artmatic;
      const track = A.store.addTrack('visual', 'FEED');
      A.store.addClip(track, {
        id: 'fb-feed',
        label: 'feed',
        kind: 'source',
        start: 0,
        end: 8,
        fadeSec: 0,
        curves: {},
        transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
        fit: 'stretch',
        source: { type: 'algo', generator, params },
        blend: 'normal',
        opacity: 1,
      });
      A.store.commit('e2e: 启用垫底', (p) => {
        for (const t of p.tracks) t.enabled = t.id === sourceTrack || t.id === track;
      });
    },
    { sourceTrack, generator, params },
  );
}

/** 把片段换成「同一个生成器直接画」—— 参照系。 */
async function setClipSource(
  page: Page,
  clipId: string,
  generator: string,
  params: Record<string, string | number>,
): Promise<void> {
  await page.evaluate(
    ({ clipId, generator, params }) => {
      const A = (window as never as StageApi).__artmatic;
      A.store.commit('e2e: 换源', (p) => {
        for (const tr of p.tracks) {
          for (const c of tr.clips) {
            if (c.id === clipId) c.source = { type: 'algo', generator, params };
          }
        }
      });
    },
    { clipId, generator, params },
  );
}

async function shot(page: Page, t: number) {
  return gridStats(page, t, 4);
}

async function projectFps(page: Page): Promise<number> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: { store: { project: { fps: number } } } }).__artmatic;
    return A.store.project.fps;
  });
}

/** 与 `render/recall.ts` 同一口径的帧量化：回放只会落在工程帧号上。 */
function quant(sec: number, fps: number): number {
  return Math.round(sec * fps) / fps;
}

test('闪回：倒放的是片段之前的那一帧，速度由片段几何决定', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);

  const stage = await buildStage(page, {
    id: 'fb-1',
    source: { type: 'algo', generator: 'flashback', params: { back: 0, gap: 0 } },
    start: 4,
    end: 8,
  });
  await addFeed(page, stage.sourceTrack, 'gradient', FEED);

  const fps = await projectFps(page);

  // 跨过启动窗口（见 `_stage.ts::renderTwiceStats` 的那条一次性过渡）。
  await settle(page, 4);
  const atStart = await shot(page, 4); // 片段头：紧挨着剪切点的那一张
  const atMid = await shot(page, 6); // 中段：2 秒前

  // 参照系：同一个 gradient 直接画
  await setClipSource(page, 'fb-1', 'gradient', FEED);
  const gJustBefore = await shot(page, 4 - 1 / fps);
  const g2 = await shot(page, 2);
  const g5 = await shot(page, 5);

  // 片段头取的是「片段头之前的最后一帧」—— 不是 4 本身：回放帧里不许包含
  // 这个闪回片段自己（`render/recall.ts::pastTimeOf` 的最后一道夹取）。
  expect(sampleL1(atStart, gJustBefore), '片段头应当回放剪切点之前的那一帧').toBeLessThan(SAME);
  expect(sampleL1(atMid, g2), '中段应当回放 2 秒前（窗口 [0,4] 的一半）').toBeLessThan(SAME);
  expect(sampleL1(atMid, g5), '正放才会等于 5 秒；差异太小说明回放方向错了').toBeGreaterThan(DIFFERENT);
});

test('闪回：回溯长度与间隔限定回放窗口', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);

  const stage = await buildStage(page, {
    id: 'fb-2',
    // 回溯 2 秒 → 窗口 [2,4]；t=5 的进度 0.25 ⇒ 回放到 3.5 秒
    source: { type: 'algo', generator: 'flashback', params: { back: 2, gap: 0 } },
    start: 4,
    end: 8,
  });
  await addFeed(page, stage.sourceTrack, 'gradient', FEED);
  const fps = await projectFps(page);
  await settle(page, 5);
  const at5 = await shot(page, 5);

  await setClipSource(page, 'fb-2', 'gradient', FEED);
  const g35 = await shot(page, quant(3.5, fps));
  const g45 = await shot(page, quant(4.5, fps));
  expect(sampleL1(at5, g35), '窗口 [2,4] 的 25% ⇒ 3.5 秒').toBeLessThan(SAME);
  expect(sampleL1(at5, g45)).toBeGreaterThan(DIFFERENT);
});

test('闪回：没有过去时那一层缺席（透出下层），而不是画一张黑图', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);

  const stage = await buildStage(page, {
    id: 'fb-3',
    // 间隔 100 秒把窗口末端推到时间轴之前 ⇒ 空窗口
    source: { type: 'algo', generator: 'flashback', params: { back: 0, gap: 100 } },
    start: 4,
    end: 8,
  });
  await addFeed(page, stage.sourceTrack, 'gradient', FEED);
  await settle(page, 6);

  const withEmpty = await shot(page, 6);
  await setClipSource(page, 'fb-3', 'gradient', FEED);
  const feedOnly = await shot(page, 6);
  expect(sampleL1(withEmpty, feedOnly), '空窗口 ⇒ 点穿到下层素材').toBeLessThan(SAME);
  expect(withEmpty.lit, '整幅纯黑说明那一层被画成了黑图').toBe(withEmpty.total);
});

test('试炼场：选中闪回时播放头落进片段，画面真的有内容', async ({ page }) => {
  await page.goto('/lab/');
  await page.waitForFunction(() => (window as never as { __lab?: unknown }).__lab);

  /*
   * 试炼场的回放型生成器要自带「之前的素材」（`lab/build-project.ts` 垫一条彩条轨，
   * 片段头挪到 `LAB_RECALL_START`）。这两件事任一没接上，画面就是整屏透明 ——
   * 与「生成器坏了」长得一模一样，所以这里两侧都要断。
   */
  const info = await page.evaluate(() => {
    const L = (window as never as {
      __lab: { selectSource: (id: string) => void; current: () => { t: number } };
    }).__lab;
    L.selectSource('flashback');
    return L.current();
  });
  expect(info.t, '选中时播放头应当被推进片段里（否则没有过去可放）').toBeGreaterThan(6);

  const mean = await page.evaluate(() => {
    const L = (window as never as {
      __lab: {
        current: () => { t: number };
        renderAt: (t: number) => void;
        readPixels: () => { data: number[] };
      };
    }).__lab;
    L.renderAt(L.current().t);
    const { data } = L.readPixels();
    if (!data.length) return 0;
    let s = 0;
    for (let i = 0; i < data.length; i += 4) s += data[i]! + data[i + 1]! + data[i + 2]!;
    return s / (data.length / 4) / 3;
  });
  expect(mean, '整屏透明 ⇒ 垫底素材或回放没接上').toBeGreaterThan(8);
});

test('闪回：同一 t 连渲两次一致（回放帧不带跨帧状态）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);

  const stage = await buildStage(page, {
    id: 'fb-4',
    source: { type: 'algo', generator: 'flashback', params: { back: 0, gap: 0 } },
    start: 4,
    end: 8,
  });
  await addFeed(page, stage.sourceTrack, 'gradient', FEED);

  // 回放帧里的反馈历史是每次清空的（`render/recall.ts` 文件头），所以这里
  // 必须落在已知的噪声底（< 1%），而不是「差不多就行」。
  const twice = await renderTwiceStats(page, 6, true);
  expect(twice.bytes / twice.total).toBeLessThan(0.01);
});
