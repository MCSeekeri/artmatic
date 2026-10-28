import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 视频预剪辑（v13）的 E2E。
 *
 * 覆盖三件事，缺一条这个功能就不算接上：
 *   1. 媒体池**单击**视频能打开弹窗（拖拽与双击的既有语义不被抢走）；
 *   2. 帧级打点 + 保存范围 → 范围真的进了 `Project.assets[id].ranges`；
 *   3. 插入按钮落下的片段 = 范围的帧数 / fps，且 `srcIn` = 入点。
 *
 * 测试视频是现场编的（`__artmatic.makeTestVideo`，160×90 @10fps，2s）；
 * 工程 fps 是 demo 的 30，所以「入点 10 帧」对应源内 10/30 秒 —— 两个帧率
 * **故意不同**，这样「按工程 fps 换算」这条被真正踩到。
 */

const FPS = 30;
const IN_FRAME = 10;
const OUT_FRAME = 40;

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
  return errors;
}

interface ClipInfo {
  id: string;
  start: number;
  end: number;
  source?: { type?: string; assetId?: string; srcIn?: number };
}

async function clipsOf(page: Page): Promise<ClipInfo[]> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: { store: { project: { tracks: { clips: ClipInfo[] }[] } } } })
      .__artmatic;
    return A.store.project.tracks.flatMap((t) => t.clips);
  });
}

test('单击视频打开预剪辑，保存范围后插入的片段长度与 srcIn 都对', async ({ page }) => {
  const errors = await boot(page);

  const assetId = await page.evaluate(async () => {
    const A = (window as never as {
      __artmatic: { makeTestVideo: () => Promise<number[]>; importVideoBytes: (n: string, b: number[]) => Promise<{ assetId: string } | null> };
    }).__artmatic;
    const bytes = await A.makeTestVideo();
    // 不给 trackId = 只进素材池，不建片段（单击要落在池子里那条上）。
    const out = await A.importVideoBytes('preclip.mp4', bytes);
    return out?.assetId ?? null;
  });
  expect(assetId, '视频应当导入成功').not.toBeNull();

  await page.getByTestId('rail-media').click();
  const row = page.locator('[data-testid=pool-item][data-kind=video]');
  await expect(row).toHaveCount(1);
  await row.click();

  await expect(page.getByTestId('preclip-modal')).toBeVisible();
  // 预览解出第一帧后 canvas 才有尺寸（解码是异步的）。
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const c = document.querySelector('[data-testid=preclip-canvas]') as HTMLCanvasElement | null;
          return c ? c.width : 0;
        }),
      { timeout: 20_000 },
    )
    .toBe(160);

  await page.getByTestId('preclip-in').fill(String(IN_FRAME));
  await page.getByTestId('preclip-in').press('Enter');
  await page.getByTestId('preclip-out').fill(String(OUT_FRAME));
  await page.getByTestId('preclip-out').press('Enter');

  await page.getByTestId('preclip-new-range').click();
  await expect(page.getByTestId('preclip-range')).toHaveCount(1);

  /*
   * 第二个范围：改出点再点「新建范围」。
   * 旧实现里这里只有一个「保存当前为范围」按钮，它会在「更新」与「新建」之间
   * 随状态跳转，于是「怎么建第二个范围」根本没有答案（点第二次会静默造重复条目）。
   */
  await page.getByTestId('preclip-out').fill(String(OUT_FRAME + 10));
  await page.getByTestId('preclip-out').press('Enter');
  await page.getByTestId('preclip-new-range').click();
  await expect(page.getByTestId('preclip-range')).toHaveCount(2);

  const saved = await page.evaluate((id) => {
    const A = (window as never as {
      __artmatic: { store: { project: { assets: Record<string, { ranges?: { inSec: number; outSec: number }[]; activeRangeId?: string }> } } };
    }).__artmatic;
    return A.store.project.assets[id] ?? null;
  }, assetId!);
  expect(saved?.ranges).toHaveLength(2);
  expect(saved!.ranges![0]!.inSec).toBeCloseTo(IN_FRAME / FPS, 6);
  expect(saved!.ranges![0]!.outSec).toBeCloseTo(OUT_FRAME / FPS, 6);
  // 新建的那条直接成为激活范围（下一步多半就是插它）
  expect(saved!.activeRangeId).toBeTruthy();
  expect(saved!.activeRangeId).not.toBe((saved!.ranges![0] as { id?: string } | undefined)?.id);

  await page.getByTestId('preclip-insert').click();
  await expect(page.getByTestId('preclip-modal')).toHaveCount(0);

  const clip = (await clipsOf(page)).find((c) => c.source?.type === 'video');
  expect(clip, '插入后应当有一条视频片段').toBeTruthy();
  expect(clip!.source!.srcIn).toBeCloseTo(IN_FRAME / FPS, 6);
  expect(clip!.end - clip!.start).toBeCloseTo((OUT_FRAME + 10 - IN_FRAME) / FPS, 6);

  expect(errors, `不该有未捕获异常：${errors.join(' | ')}`).toEqual([]);
});

test('拖左边界裁剪时显示名被边界裁掉，松手后回到新边界', async ({ page }) => {
  await boot(page);
  const clipId = await page.evaluate(() => {
    const A = (window as never as {
      __artmatic: {
        store: {
          commit: (label: string, fn: (p: { tracks: { id: string; enabled: boolean }[] }) => void) => void;
          addTrack: (kind: 'visual', name?: string) => string;
          addClip: (trackId: string, clip: Record<string, unknown>) => void;
        };
      };
    }).__artmatic;
    A.store.commit('e2e: 清空舞台', (p) => {
      for (const t of p.tracks) t.enabled = false;
    });
    const track = A.store.addTrack('visual', 'TRIM');
    A.store.commit('e2e: 只启用新轨', (p) => {
      for (const t of p.tracks) t.enabled = t.id === track;
    });
    A.store.addClip(track, {
      kind: 'source',
      id: 'trim-solid',
      start: 1,
      end: 4,
      label: '一段足够长的片段名',
      fadeSec: 0,
      curves: {},
      source: { type: 'solid', color: '#ff0000' },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'stretch',
    });
    return 'trim-solid';
  });

  const clip = page.locator(`[data-clip-id="${clipId}"]`);
  const box = await clip.boundingBox();
  expect(box).toBeTruthy();
  const labelLeft = async (): Promise<number> =>
    page.locator(`[data-clip-id="${clipId}"] [data-testid=clip-name]`).evaluate((el) =>
      Number.parseFloat((el as HTMLElement).style.left || '5'),
    );

  expect(await labelLeft()).toBeCloseTo(5, 1);

  // 左边界右移 1s（56px）：标签锚在内容原点，于是被左边界裁掉一部分。
  await page.mouse.move(box!.x + 3, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 3 + 56, box!.y + box!.height / 2, { steps: 6 });
  expect(await labelLeft()).toBeLessThan(-20);

  await page.mouse.up();
  // 松手后重新布局：名字回到新边界右侧 5px。
  await expect.poll(labelLeft).toBeCloseTo(5, 1);
});

test('弹窗内 Space 只播预览、按墙钟配速；拖柄在弹窗外松手也不关弹窗', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const A = (window as never as {
      __artmatic: { makeTestVideo: () => Promise<number[]>; importVideoBytes: (n: string, b: number[]) => Promise<unknown> };
    }).__artmatic;
    await A.importVideoBytes('pace.mp4', await A.makeTestVideo());
  });

  await page.getByTestId('rail-media').click();
  const row = page.locator('[data-testid=pool-item][data-kind=video]');
  await row.click();
  await expect(page.getByTestId('preclip-modal')).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const c = document.querySelector('[data-testid=preclip-canvas]') as HTMLCanvasElement | null;
          return c ? c.width : 0;
        }),
      { timeout: 20_000 },
    )
    .toBe(160);

  // 整段范围，焦点不在输入框上（否则 Space 归输入框是正确行为）
  await page.getByTestId('preclip-in').fill('0');
  await page.getByTestId('preclip-in').press('Enter');
  await page.getByTestId('preclip-out').fill('60');
  await page.getByTestId('preclip-out').press('Enter');
  /** 时间码是 hh:mm:ss:ff，ff 是**秒内帧号** —— 2s 的最后一帧是 00:00:01:29，不是 00:00:00:59。 */
  const frames = async (): Promise<number> => {
    const text = await page.getByTestId('preclip-timecode').innerText();
    const [hh, mm, ss, ff] = text.split(':').map((x) => Number.parseInt(x, 10));
    return (hh! * 3600 + mm! * 60 + ss!) * FPS + ff!;
  };

  await page.keyboard.press('Space');
  // ① 全局 Space 必须让路：主时间线不能跟着播
  expect(
    await page.evaluate(() => (window as never as { __artmatic: { appState: { playing: boolean } } }).__artmatic.appState.playing),
  ).toBe(false);

  // ② 500ms 后大约播了 15 帧（30fps 工程）。旧实现「解多快播多快」会瞬间到 59。
  await page.waitForTimeout(500);
  const at500 = await frames();
  expect(at500, `预期约 15 帧，实测 ${at500} —— 到 59 说明没按墙钟配速`).toBeGreaterThanOrEqual(2);
  expect(at500).toBeLessThan(40);

  // ③ 自然播完：2s 素材最多给 8s 的余量，最后停在出点前最后一帧。
  await expect.poll(frames, { timeout: 8000 }).toBeGreaterThanOrEqual(58);

  // ④ 拖 in 柄到弹窗外面再松手：不能把「遮罩 click」补出来。
  const handle = page.getByTestId('preclip-handle-in');
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('preclip-modal')).toHaveCount(1);
});

test('双击视频仍然是「插入整段」，单击的弹窗不会抢走它', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const A = (window as never as {
      __artmatic: { makeTestVideo: () => Promise<number[]>; importVideoBytes: (n: string, b: number[]) => Promise<unknown> };
    }).__artmatic;
    await A.importVideoBytes('dbl.mp4', await A.makeTestVideo());
  });

  await page.getByTestId('rail-media').click();
  const row = page.locator('[data-testid=pool-item][data-kind=video]');
  await row.dblclick();

  // 双击不应留下弹窗
  await expect(page.getByTestId('preclip-modal')).toHaveCount(0);
  const clip = (await clipsOf(page)).find((c) => c.source?.type === 'video');
  expect(clip, '双击应当插入片段').toBeTruthy();
  // 没有保存过范围 → 整段 2s
  expect(clip!.end - clip!.start).toBeCloseTo(2, 1);
  expect(clip!.source!.srcIn).toBeCloseTo(0, 6);
});
