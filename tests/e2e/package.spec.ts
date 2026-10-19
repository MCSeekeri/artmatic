/**
 * package.spec.ts — `.artmatic` 工程包的端到端往返。
 *
 * 用 OPFS 里的文件模拟「本机原文件」（与 linked-assets.spec 同一手法），
 * 打包后**删掉原文件**再导入 —— 这正好覆盖「换一台机器没有本地文件」的形态：
 * 包里的 `assets/` 必须让工程照常打开、照常能画。
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
      write(path: string, bytes: number[]): Promise<void>;
      remove(path: string): Promise<void>;
      packToOpfs(name?: string): Promise<{ bytes: number; assets: number }>;
      importPackFromOpfs(packName: string, destName: string): Promise<boolean>;
      importLinkedFromOpfs(
        kind: 'audio' | 'image',
        dirPath: string,
        name: string,
        target?: { trackId?: string | null },
      ): Promise<string | null>;
    };
    store: {
      commit(label: string, fn: (p: { tracks: { id: string; enabled: boolean }[] }) => void): void;
      addTrack(kind: 'visual', name?: string): string;
      project: { name: string; tracks: { clips: { source?: { type?: string; assetId?: string } }[] }[] };
    };
    assets: { bytesOf(id: string): Uint8Array | null };
    appState: { isAssetOffline(id: string): boolean };
  };
};

const DIR = 'e2e-pack';
const SRC = 'e2e-pack-src';
const IMPORTED = 'e2e-pack-imported';

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
    const track = A.store.addTrack('visual', 'PACK');
    A.store.commit('e2e: 只启用新轨', (p) => {
      for (const t of p.tracks) t.enabled = t.id === track;
    });
    return track;
  });
}

async function makePng(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 32, 64, 32);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : [];
  });
}

test('打包 → 删掉本机原文件 → 在另一个目录导入：素材来自包内 assets/', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  await page.evaluate((args) => (window as never as W).__artmatic.project.write(`${args.dir}/pic.png`, args.png), {
    dir: SRC,
    png: await makePng(page),
  });

  const id = await page.evaluate(
    (args) => (window as never as W).__artmatic.project.importLinkedFromOpfs('image', args.dir, 'pic.png', {
      trackId: args.track,
    }),
    { dir: SRC, track },
  );
  expect(id).toBeTruthy();

  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), DIR);
  await page.evaluate((d) => (window as never as W).__artmatic.project.useOpfs(d), DIR);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());

  // 工程目录里没有素材副本（linked）——打包必须把它收进去。
  const before = await page.evaluate(
    async (d) =>
      (await (window as never as W).__artmatic.project.list(`${d}/assets`)).filter(
        (i) => i.kind === 'file',
      ).length,
    DIR,
  );
  expect(before).toBe(0);

  const pack = await page.evaluate(() => (window as never as W).__artmatic.project.packToOpfs());
  expect(pack.assets).toBeGreaterThanOrEqual(1);
  expect(pack.bytes).toBeGreaterThan(200);

  // 换机器：本机原文件没了。
  await page.evaluate((d) => (window as never as W).__artmatic.project.remove(`${d}/pic.png`), SRC);
  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), IMPORTED);
  await expect(
    page.evaluate(
      (d) => (window as never as W).__artmatic.project.importPackFromOpfs('e2e-package.artmatic', d),
      IMPORTED,
    ),
  ).resolves.toBe(true);

  const files = await page.evaluate(
    async (d) =>
      (await (window as never as W).__artmatic.project.list(`${d}/assets`))
        .filter((i) => i.kind === 'file')
        .map((i) => i.name),
    IMPORTED,
  );
  expect(files.some((n) => n.endsWith('.png'))).toBe(true);
  // 导入后 source 是 bundled：字节在仓里、画面不脱机。
  expect(await page.evaluate((aid) => (window as never as W).__artmatic.assets.bytesOf(aid!)?.byteLength ?? 0, id!)).toBeGreaterThan(100);
  expect(await page.evaluate((aid) => (window as never as W).__artmatic.appState.isAssetOffline(aid!), id!)).toBe(false);
});

test('不是工程包：明确拒绝，不产生半成品工程', async ({ page }) => {
  await boot(page);
  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), IMPORTED);
  await page.evaluate(() =>
    (window as never as W).__artmatic.project.write('not-a-pack.artmatic', [1, 2, 3, 4]),
  );
  await expect(
    page.evaluate(
      (d) => (window as never as W).__artmatic.project.importPackFromOpfs('not-a-pack.artmatic', d),
      IMPORTED,
    ),
  ).rejects.toThrow();

  const files = await page.evaluate(
    (d) => (window as never as W).__artmatic.project.list(d),
    IMPORTED,
  );
  expect(files.some((f) => f.name === 'project.json')).toBe(false);
});
