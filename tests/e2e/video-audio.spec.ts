import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

/**
 * 视频音频分离 / 锁定（v13）的 UI 可达性守卫。
 *
 * 测试视频本身是**无声**的（`makeTestVideo` 只编画面），所以这里断言的是状态与
 * 几何：分离后建轨、视频静音、移动视频时音频跟随、解锁后不跟随。真正的混音
 * 由 `tests/unit/audio-plan.test.ts` 的「哪些 span 出声」钉死 —— 这里不重复
 * 造一段带音轨的视频，那会让用例贵一个数量级，而它测的东西单测已经覆盖。
 */

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => (window as never as { __artmatic?: unknown }).__artmatic);
  await openDemo(page);
  return errors;
}

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
    const track = A.store.addTrack('visual', 'VA');
    A.store.commit('e2e: 只启用新轨', (p) => {
      for (const t of p.tracks) t.enabled = t.id === track;
    });
    return track;
  });
}

interface TrackInfo {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  muted?: boolean;
  clips: { id: string; kind: string; start: number; end: number }[];
}

async function tracksOf(page: Page): Promise<TrackInfo[]> {
  return page.evaluate(() => {
    const A = (window as never as { __artmatic: { store: { project: { tracks: TrackInfo[] } } } }).__artmatic;
    return A.store.project.tracks;
  });
}

async function importVideoClip(page: Page, trackId: string): Promise<string> {
  const clipId = await page.evaluate(
    async ({ track }) => {
      const A = (window as never as {
        __artmatic: {
          makeTestVideo: () => Promise<number[]>;
          importVideoBytes: (n: string, b: number[], t: { trackId: string; start: number }) => Promise<unknown>;
          store: { project: { tracks: { clips: { id: string; source?: { type?: string } }[] }[] } };
        };
      }).__artmatic;
      const bytes = await A.makeTestVideo();
      await A.importVideoBytes('va.mp4', bytes, { trackId: track, start: 0 });
      const clips = A.store.project.tracks.flatMap((t) => t.clips);
      return clips.find((c) => c.source?.type === 'video')?.id ?? null;
    },
    { track: trackId },
  );
  expect(clipId, '视频片段应当落下来').not.toBeNull();
  return clipId!;
}

/**
 * 静音（v15）：两处入口、同一条语义 —— **画面留着，声音不要**。
 *
 * 这里只钉 UI 接线与落库；「哪些 span 出声 / 导出有没有声」由
 * `tests/unit/audio-plan.test.ts` 的轨道静音那组钉死（预览、导出、预热表
 * 都读同一张表）。
 */
test('静音：轨道喇叭只关声音；检查器 checkbox 让音量变灰', async ({ page }) => {
  const errors = await boot(page);
  const track = await cleanStage(page);
  const videoId = await importVideoClip(page, track);

  // 轨道头：有视频片段的轨才显示喇叭，点一下写入 muted
  const row = page.locator(`[data-track-id="${track}"]`);
  const muteBtn = row.getByTestId('track-muted');
  await expect(muteBtn).toHaveCount(1);
  await muteBtn.click();
  await expect.poll(async () => (await tracksOf(page)).find((t) => t.id === track)?.muted).toBe(true);
  // 画面开关不受影响（静音 ≠ 隐藏）
  expect((await tracksOf(page)).find((t) => t.id === track)?.enabled).toBe(true);

  // 轨道静音时，选中视频片段会在检查器里明说一句（否则「没勾片段静音却没声音」像 bug）
  await page.locator(`[data-clip-id="${videoId}"]`).click();
  await expect(page.getByTestId('video-track-muted')).toBeVisible();
  await muteBtn.click();
  await expect.poll(async () => (await tracksOf(page)).find((t) => t.id === track)?.muted).toBe(undefined);
  await expect(page.getByTestId('video-track-muted')).toHaveCount(0);

  // 检查器：勾静音 → 音量滑杆 / 淡变框变灰且不可拖
  const gain = page.getByTestId('insp-video-gain');
  await expect(gain).not.toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('insp-video-muted').click();
  await expect(gain).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('insp-video-fade-in')).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const A = (window as never as {
          __artmatic: { store: { findClip: (id: string) => { clip: { audio?: { muted?: boolean } } } | null } };
        }).__artmatic;
        return A.store.findClip(id)?.clip.audio?.muted ?? false;
      }, videoId),
    )
    .toBe(true);

  // 取消：滑杆恢复可拖，值还在（不因为静音被清掉）
  await page.getByTestId('insp-video-muted').click();
  await expect(gain).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('insp-video-fade-in')).toBeEnabled();

  expect(errors, `不该有未捕获异常：${errors.join(' | ')}`).toEqual([]);
});

test('右键分离音频 → 新音频轨 + 视频静音 + 锁定跟随，解锁后独立', async ({ page }) => {
  const errors = await boot(page);
  const track = await cleanStage(page);
  const videoId = await importVideoClip(page, track);

  await page.locator(`[data-clip-id="${videoId}"]`).click({ button: 'right' });
  await page.getByTestId('ctx-detach-audio').click();

  await expect
    .poll(async () => (await tracksOf(page)).filter((t) => t.kind === 'audio').length)
    .toBeGreaterThan(0);

  const after = await page.evaluate((id) => {
    const A = (window as never as {
      __artmatic: {
        store: {
          project: { tracks: TrackInfo[] };
          findClip: (id: string) => {
            clip: { kind: string; audio?: { muted?: boolean }; linkedAudioId?: string; lockedTo?: string; linkedVideoId?: string; start: number; end: number };
          } | null;
        };
      };
    }).__artmatic;
    const video = A.store.findClip(id)?.clip;
    const audioClip = A.store.project.tracks
      .filter((t) => t.kind === 'audio')
      .flatMap((t) => t.clips)
      .find((c) => (c as { linkedVideoId?: string }).linkedVideoId === id);
    return { video, audio: audioClip ? A.store.findClip(audioClip.id)?.clip : null };
  }, videoId);

  expect(after.video?.audio?.muted).toBe(true);
  expect(after.video?.linkedAudioId).toBeTruthy();
  expect(after.audio?.lockedTo).toBe(videoId);
  expect(after.audio?.start).toBe(0);

  // 拖动视频片段 1s：音频跟随（拖动中同步，不是松手才跳）
  const box = await page.locator(`[data-clip-id="${videoId}"]`).boundingBox();
  expect(box).toBeTruthy();
  const pxPerSec = 56; // demo：120 BPM / 2 拍一小节 → 56px/s
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + pxPerSec, box!.y + box!.height / 2, { steps: 6 });
  await page.mouse.up();

  const moved = await page.evaluate((id) => {
    const A = (window as never as {
      __artmatic: {
        store: {
          project: { tracks: TrackInfo[] };
          findClip: (id: string) => { clip: { start: number; end: number } } | null;
        };
      };
    }).__artmatic;
    const video = A.store.findClip(id)?.clip;
    const audioClip = A.store.project.tracks
      .filter((t) => t.kind === 'audio')
      .flatMap((t) => t.clips)
      .find((c) => (c as { linkedVideoId?: string }).linkedVideoId === id);
    return { videoStart: video?.start ?? -1, audioStart: audioClip?.start ?? -1 };
  }, videoId);
  expect(moved.audioStart).toBeCloseTo(moved.videoStart, 3);
  expect(moved.videoStart).toBeGreaterThan(0.5);

  // 解锁 → 再拖视频，音频不动。
  // 只能按 linkedVideoId 找：demo 工程本身还有一条 A1（演示节拍），
  // 「第一条音频轨的第一个片段」会选中它。
  const audioId = await page.evaluate((video) => {
    const A = (window as never as {
      __artmatic: {
        store: {
          project: { tracks: { kind: string; clips: { id: string; linkedVideoId?: string }[] }[] };
        };
      };
    }).__artmatic;
    return (
      A.store.project.tracks
        .filter((t) => t.kind === 'audio')
        .flatMap((t) => t.clips)
        .find((c) => c.linkedVideoId === video)?.id ?? null
    );
  }, videoId);
  expect(audioId, '应当有分离出来的音频片段').not.toBeNull();
  await page.locator(`[data-clip-id="${audioId!}"]`).click();
  await page.getByTestId('insp-audio-lock').click();

  const box2 = await page.locator(`[data-clip-id="${videoId}"]`).boundingBox();
  await page.mouse.move(box2!.x + box2!.width / 2, box2!.y + box2!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2!.x + box2!.width / 2 + pxPerSec, box2!.y + box2!.height / 2, { steps: 6 });
  await page.mouse.up();

  const unlocked = await page.evaluate((ids) => {
    const A = (window as never as {
      __artmatic: { store: { findClip: (id: string) => { clip: { start: number; lockedTo?: string } } | null } };
    }).__artmatic;
    return {
      videoStart: A.store.findClip(ids.video)?.clip.start ?? -1,
      audioStart: A.store.findClip(ids.audio)?.clip.start ?? -1,
      lockedTo: A.store.findClip(ids.audio)?.clip.lockedTo ?? null,
    };
  }, { video: videoId, audio: audioId! });

  expect(unlocked.lockedTo).toBeNull();
  expect(unlocked.audioStart).toBeCloseTo(moved.audioStart, 3);
  expect(unlocked.videoStart).toBeGreaterThan(moved.videoStart + 0.5);

  expect(errors, `不该有未捕获异常：${errors.join(' | ')}`).toEqual([]);
});
