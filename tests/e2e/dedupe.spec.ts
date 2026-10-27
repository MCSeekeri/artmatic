/**
 * dedupe.spec.ts — 导入去重与「从未落盘的素材被移除时不落盘」。
 *
 * 走的是**真实导入路径**（轨道右键 → 导入图片 → 文件选择器），不是直接调 API：
 * 去重如果只在 API 层成立、在 UI 路径上被绕过，用户看到的仍然是多份副本。
 */

import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

type W = {
  __artmatic: {
    project: {
      useOpfs(name?: string): Promise<string>;
      wipe(name?: string): Promise<void>;
      save(): Promise<boolean>;
      list(path: string): Promise<{ name: string; kind: 'file' | 'directory' }[]>;
    };
    store: {
      project: { assets: Record<string, { kind: string }>; tracks: { clips: { source?: { type?: string; assetId?: string } }[] }[] };
      commit(label: string, fn: (p: { tracks: { id: string; enabled: boolean }[] }) => void): void;
      addTrack(kind: 'visual', name?: string): string;
    };
    assets: { ids(): string[]; retainedIds(): string[] };
    appState: { removeAsset(id: string): void };
  };
};

const DIR = 'e2e-dedupe';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as W).__artmatic);
  await openDemo(page);
}

/** 关掉 demo 全部轨道并建一条自己的视觉轨（与 media-pool.spec 同一手法）。 */
async function cleanStage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const A = (window as never as W).__artmatic;
    A.store.commit('e2e: 清空舞台', (p) => {
      for (const t of p.tracks) t.enabled = false;
    });
    const track = A.store.addTrack('visual', 'MP');
    A.store.commit('e2e: 只启用新轨', (p) => {
      for (const t of p.tracks) t.enabled = t.id === track;
    });
    return track;
  });
}

async function makePng(page: Page, top = '#ff0000', bottom = '#0000ff'): Promise<number[]> {
  return page.evaluate(
    async (colors) => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = colors[0]!;
      ctx.fillRect(0, 0, 64, 32);
      ctx.fillStyle = colors[1]!;
      ctx.fillRect(0, 32, 64, 32);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : [];
    },
    [top, bottom],
  );
}

async function importImage(page: Page, trackId: string, name: string, bytes: number[]): Promise<void> {
  const before = await page.evaluate(
    () =>
      (window as never as W).__artmatic.store.project.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.source?.type === 'image').length,
  );
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    (async () => {
      await page
        .locator(`[data-testid=tl-row][data-track-id="${trackId}"]`)
        .click({ button: 'right', position: { x: 30, y: 14 } });
      await page.getByTestId('ctx-image').click();
    })(),
  ]);
  await chooser.setFiles({ name, mimeType: 'image/png', buffer: Buffer.from(bytes) });
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as never as W).__artmatic.store.project.tracks
              .flatMap((t) => t.clips)
              .filter((c) => c.source?.type === 'image').length,
        ),
      { timeout: 15_000 },
    )
    .toBe(before + 1);
}

async function imageStats(page: Page): Promise<{ assets: number; clips: number }> {
  return page.evaluate(() => {
    const A = (window as never as W).__artmatic;
    return {
      assets: Object.values(A.store.project.assets).filter((a) => a.kind === 'image').length,
      clips: A.store.project.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.source?.type === 'image').length,
    };
  });
}

async function assetFiles(page: Page): Promise<string[]> {
  return page.evaluate(
    async (d) =>
      (await (window as never as W).__artmatic.project.list(`${d}/assets`))
        .filter((i) => i.kind === 'file')
        .map((i) => i.name),
    DIR,
  );
}

test('同一张图导两次：只登记一条素材，只落一个文件', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  const bytes = await makePng(page);

  await importImage(page, track, 'same-a.png', bytes);
  await importImage(page, track, 'same-b.png', bytes);

  const stats = await imageStats(page);
  expect(stats.assets, '两条片段共用一条素材').toBe(1);
  expect(stats.clips, '片段还是要两条（用户导了两次）').toBe(2);

  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), DIR);
  await page.evaluate((d) => (window as never as W).__artmatic.project.useOpfs(d), DIR);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());

  expect(await assetFiles(page), '磁盘上只有一份').toHaveLength(1);
});

test('重导已移除的同一份内容：复活原素材，不再多一份文件', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  const bytes = await makePng(page);

  await importImage(page, track, 'dup.png', bytes);
  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), DIR);
  await page.evaluate((d) => (window as never as W).__artmatic.project.useOpfs(d), DIR);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());
  await expect.poll(() => assetFiles(page)).toHaveLength(1);

  const id = await page.evaluate(
    () =>
      Object.entries((window as never as W).__artmatic.store.project.assets).find(
        ([, a]) => a.kind === 'image',
      )?.[0] ?? null,
  );
  expect(id).toBeTruthy();
  await page.evaluate((aid) => (window as never as W).__artmatic.appState.removeAsset(aid), id!);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());
  expect(await page.evaluate(() => (window as never as W).__artmatic.assets.retainedIds())).toHaveLength(1);

  // 再导一次同样内容：应当恢复原条目，而不是新增一条。
  await importImage(page, track, 'dup-again.png', bytes);
  const stats = await imageStats(page);
  expect(stats.assets).toBe(1);
  expect(await page.evaluate(() => (window as never as W).__artmatic.assets.retainedIds())).toHaveLength(0);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());
  expect(await assetFiles(page), '仍然只有一份文件').toHaveLength(1);
});

test('从未保存过的素材被移除：下一次保存不会把它写进 assets/', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  const bytes = await makePng(page);

  await importImage(page, track, 'never-saved.png', bytes);
  const id = await page.evaluate(
    () =>
      Object.entries((window as never as W).__artmatic.store.project.assets).find(
        ([, a]) => a.kind === 'image',
      )?.[0] ?? null,
  );
  expect(id).toBeTruthy();

  // 工程还没有目录、也从未保存 —— 这时移除不该留下任何「待恢复」的记录。
  await page.evaluate((aid) => (window as never as W).__artmatic.appState.removeAsset(aid), id!);
  expect(await page.evaluate(() => (window as never as W).__artmatic.assets.retainedIds())).toHaveLength(0);

  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), DIR);
  await page.evaluate((d) => (window as never as W).__artmatic.project.useOpfs(d), DIR);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());

  expect(await assetFiles(page), '用户删掉的素材不许凭空出现在磁盘上').toHaveLength(0);
});
