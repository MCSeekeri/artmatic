/**
 * linked-assets.spec.ts — 引用式素材在浏览器里的完整生命周期。
 *
 * 真实系统文件选择器驱动不了，所以用 **OPFS 里的文件句柄**当「本机文件」：
 * 它与 `showOpenFilePicker` 返回的是同一个 `FileSystemFileHandle` 类型，
 * 走的也是同一条「存 IndexedDB → 重开时申请权限 → 读字节」路径。
 *
 * 判据是磁盘事实：linked 素材**不许**在 `assets/` 里出现；collect 之后才出现。
 */

import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './_stage';

type W = {
  __artmatic: {
    project: {
      useOpfs(name?: string): Promise<string>;
      wipe(name?: string): Promise<void>;
      save(): Promise<boolean>;
      open(name?: string): Promise<boolean>;
      list(path: string): Promise<{ name: string; kind: 'file' | 'directory' }[]>;
      write(path: string, bytes: number[]): Promise<void>;
      remove(path: string): Promise<void>;
      collect(id: string): Promise<boolean>;
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
    };
    assets: {
      modeOf(id: string): 'linked' | 'bundled' | 'generated' | null;
      localOf(id: string): string | null;
      bytesOf(id: string): Uint8Array | null;
    };
    appState: { isAssetOffline(id: string): boolean };
  };
};

const DIR = 'e2e-linked';
const SRC = 'e2e-linked-src';

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
    const track = A.store.addTrack('visual', 'LINK');
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

async function assetFiles(page: Page): Promise<string[]> {
  return page.evaluate(
    async (d) =>
      (await (window as never as W).__artmatic.project.list(`${d}/assets`))
        .filter((i) => i.kind === 'file')
        .map((i) => i.name),
    DIR,
  );
}

test('引用本机文件：工程里不复制；重开仍然可用；collect 后才有一份副本', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  const png = await makePng(page);

  // 模拟「用户本机上已经有一个文件」。
  await page.evaluate((args) => (window as never as W).__artmatic.project.write(`${args.dir}/pic.png`, args.png), {
    dir: SRC,
    png,
  });

  const id = await page.evaluate(
    (args) => (window as never as W).__artmatic.project.importLinkedFromOpfs('image', args.dir, 'pic.png', {
      trackId: args.track,
    }),
    { dir: SRC, track },
  );
  expect(id).toBeTruthy();

  const meta = await page.evaluate((aid) => {
    const A = (window as never as W).__artmatic;
    return { mode: A.assets.modeOf(aid), local: A.assets.localOf(aid) };
  }, id!);
  expect(meta.mode).toBe('linked');
  expect(meta.local).toBe(`fsa:${id}`);

  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), DIR);
  await page.evaluate((d) => (window as never as W).__artmatic.project.useOpfs(d), DIR);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());
  expect(await assetFiles(page), 'linked 素材不该在工程里复制').toHaveLength(0);

  // 重开：句柄从 IndexedDB 接回来，字节也读回来了（图片走同步 bytesOf）。
  await page.evaluate((d) => (window as never as W).__artmatic.project.open(d), DIR);
  expect(await page.evaluate((aid) => (window as never as W).__artmatic.appState.isAssetOffline(aid), id!)).toBe(false);
  expect(
    await page.evaluate((aid) => (window as never as W).__artmatic.assets.bytesOf(aid)?.byteLength ?? 0, id!),
  ).toBeGreaterThan(100);

  // 收集到工程：这一刻才写副本，本地位置保留。
  await page.evaluate((aid) => (window as never as W).__artmatic.project.collect(aid), id!);
  expect(await assetFiles(page)).toHaveLength(1);
  expect(await page.evaluate((aid) => (window as never as W).__artmatic.assets.localOf(aid), id!)).toBe(
    `fsa:${id}`,
  );
});

test('本机原文件被删掉：重开是脱机，不是「工程坏了」', async ({ page }) => {
  await boot(page);
  const track = await cleanStage(page);
  await page.evaluate((args) => (window as never as W).__artmatic.project.write(`${args.dir}/gone.png`, args.png), {
    dir: SRC,
    png: await makePng(page),
  });

  const id = await page.evaluate(
    (args) => (window as never as W).__artmatic.project.importLinkedFromOpfs('image', args.dir, 'gone.png', {
      trackId: args.track,
    }),
    { dir: SRC, track },
  );
  await page.evaluate((d) => (window as never as W).__artmatic.project.wipe(d), DIR);
  await page.evaluate((d) => (window as never as W).__artmatic.project.useOpfs(d), DIR);
  await page.evaluate(() => (window as never as W).__artmatic.project.save());

  await page.evaluate((args) => (window as never as W).__artmatic.project.remove(`${args.dir}/gone.png`), {
    dir: SRC,
  });
  /*
   * 必须真的重载一次：同一页面里旧那份工程还开着，它注册的图片 objectURL
   * 仍在全局表里，`isAssetOffline` 会看到「运行期登记过」而判不脱机。
   * 新会话（真实用户重开应用）的形态就是这里要测的。
   */
  await page.reload();
  await page.waitForFunction(() => (window as never as W).__artmatic);
  await openDemo(page);
  await page.evaluate((d) => (window as never as W).__artmatic.project.open(d), DIR);

  expect(await page.evaluate((aid) => (window as never as W).__artmatic.appState.isAssetOffline(aid), id!)).toBe(
    true,
  );
  // 工程本体与台账都还在 —— 缺的只是外部文件。
  expect(await assetFiles(page)).toHaveLength(0);
});
