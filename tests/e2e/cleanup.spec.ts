/**
 * cleanup.spec.ts — 回收站、未使用素材批次与孤儿清理（W1 清理链路）。
 *
 * 判据都是**磁盘事实**（`assets/` 与 `assets/.trash/` 里的文件），不是界面文案：
 * 清理动作写错时最常见的样子是「界面说清掉了，文件还在」。
 */

import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

type Entry = { name: string; kind: 'file' | 'directory' };

type W = {
  __artmatic: {
    project: {
      useOpfs(name?: string): Promise<string>;
      wipe(name?: string): Promise<void>;
      save(): Promise<boolean>;
      list(path: string): Promise<Entry[]>;
      write(path: string, bytes: number[]): Promise<void>;
    };
    store: {
      project: {
        assets: Record<string, { kind: string }>;
        tracks: { clips: { id: string; source?: { type?: string; assetId?: string } }[] }[];
      };
      commit(label: string, fn: (p: { tracks: { id: string; enabled: boolean }[] }) => void): void;
      addTrack(kind: 'visual', name?: string): string;
    };
    assets: { retainedIds(): string[] };
    appState: { removeAsset(id: string): void };
  };
};

const DIR = 'e2e-cleanup';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as never as W).__artmatic);
  await openDemo(page);
}

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

async function makePng(page: Page, top: string, bottom: string): Promise<number[]> {
  return page.evaluate(
    async (colors) => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
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

async function importImage(page: Page, trackId: string, name: string, bytes: number[]): Promise<string> {
  const before = await page.evaluate(() => {
    const clips = (window as never as W).__artmatic.store.project.tracks.flatMap((t) => t.clips);
    return {
      ids: clips.map((c) => c.id),
      images: clips.filter((c) => c.source?.type === 'image').length,
    };
  });

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
      () =>
        page.evaluate(
          () =>
            (window as never as W).__artmatic.store.project.tracks
              .flatMap((t) => t.clips)
              .filter((c) => c.source?.type === 'image').length,
        ),
      { timeout: 15_000 },
    )
    .toBe(before.images + 1);

  // 新片段的 source.assetId 才是这次导入的素材（不能拿「第一条 image 素材」）。
  return page.evaluate(
    (seen) => {
      const A = (window as never as W).__artmatic;
      const clip = A.store.project.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.source?.type === 'image' && !seen.includes(c.id));
      return clip?.source?.assetId ?? '';
    },
    before.ids,
  );
}

function filesAt(page: Page, sub: string): Promise<string[]> {
  return page.evaluate(
    async (args) =>
      (await (window as never as W).__artmatic.project.list(`${args.d}/${args.sub}`))
        .filter((i) => i.kind === 'file')
        .map((i) => i.name),
    { d: DIR, sub },
  );
}

/** 造一份「素材已移除、文件在 assets/」的工程并打开工程面板。 */
async function setupRemovedAsset(page: Page): Promise<string> {
  await boot(page);
  const track = await cleanStage(page);
  const bytes = await makePng(page, '#ff0000', '#0000ff');
  const id = await importImage(page, track, 'cleanup.png', bytes);

  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), DIR);
  await page.evaluate((d) => (window as never as W).__artmatic.project.useOpfs(d), DIR);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());
  await page.evaluate((aid) => (window as never as W).__artmatic.appState.removeAsset(aid), id);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());

  await page.getByTestId('rail-project').click();
  await expect(page.getByTestId('usage-trash')).toBeVisible();
  return id;
}

test('移除 → 回收站 → 清空：文件真的从 .trash 消失，assets/ 不动', async ({ page }) => {
  await setupRemovedAsset(page);

  await page.getByTestId('project-nav-cleanup').click();
  await expect(page.getByTestId('unused-asset')).toHaveCount(1);
  expect((await filesAt(page, 'assets')).some((n) => n.endsWith('.png'))).toBe(true);

  await page.getByTestId('unused-trash').click();
  await page.getByTestId('confirm-unused-asset-ok').click();
  await expect(page.getByTestId('unused-asset')).toHaveCount(0);
  // 数字在「概览」页：清理动作本身不在这页回显总量。
  await page.getByTestId('project-nav-overview').click();
  await expect(page.getByTestId('usage-trash')).toContainText('1 个');
  expect(await filesAt(page, 'assets/.trash')).toHaveLength(1);

  await page.getByTestId('project-nav-cleanup').click();
  await page.getByTestId('trash-clear').click();
  await page.getByTestId('confirm-cleanup-ok').click();
  await page.getByTestId('project-nav-overview').click();
  await expect(page.getByTestId('usage-trash')).toContainText('0 个');
  expect(await filesAt(page, 'assets/.trash')).toHaveLength(0);
  expect(await page.evaluate(() => (window as never as W).__artmatic.assets.retainedIds())).toHaveLength(0);
});

test('批量清理：两个未使用素材一次全进回收站', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  const first = await importImage(page, track, 'batch-a.png', await makePng(page, '#ff0000', '#0000ff'));
  const second = await importImage(page, track, 'batch-b.png', await makePng(page, '#00ff00', '#000000'));

  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), DIR);
  await page.evaluate((d) => (window as never as W).__artmatic.project.useOpfs(d), DIR);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());
  await page.evaluate(
    (ids) => {
      const A = (window as never as W).__artmatic;
      for (const id of ids) A.appState.removeAsset(id);
    },
    [first, second],
  );
  await page.evaluate(() => (window as never as W).__artmatic.project.save());

  await page.getByTestId('rail-project').click();
  await page.getByTestId('project-nav-cleanup').click();
  await expect(page.getByTestId('unused-asset')).toHaveCount(2);
  await page.getByTestId('unused-trash-all').click();
  await page.getByTestId('confirm-cleanup-ok').click();
  await expect(page.getByTestId('unused-asset')).toHaveCount(0);

  expect(await filesAt(page, 'assets'), '活文件都已搬走').toHaveLength(0);
  expect(await filesAt(page, 'assets/.trash')).toHaveLength(2);
  expect(await page.evaluate(() => (window as never as W).__artmatic.assets.retainedIds())).toHaveLength(0);
});

test('未跟踪文件：面板能看见，确认后永久清理', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  const bytes = await makePng(page, '#ff0000', '#0000ff');
  await importImage(page, track, 'orphan-source.png', bytes);

  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), DIR);
  await page.evaluate((d) => (window as never as W).__artmatic.project.useOpfs(d), DIR);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());

  // 手工塞一个「台账不知道」的文件（旧版本工程就是这个形态）。
  await page.evaluate(
    (d) => (window as never as W).__artmatic.project.write(`${d}/assets/stray.png`, [1, 2, 3]),
    DIR,
  );

  await page.getByTestId('rail-project').click();
  await expect(page.getByTestId('usage-orphans')).toContainText('1 个');
  await page.getByTestId('project-nav-cleanup').click();
  await page.getByTestId('orphans-clean').click();
  await page.getByTestId('confirm-cleanup-ok').click();
  await page.getByTestId('project-nav-overview').click();
  await expect(page.getByTestId('usage-orphans')).toContainText('0 个');

  expect(await filesAt(page, 'assets')).not.toContain('stray.png');
});
