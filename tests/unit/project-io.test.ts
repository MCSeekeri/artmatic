import { describe, expect, it } from 'vitest';
import { memoryRoot, writeBytesAtomic, type FsDirHandle, type MemoryRoot } from '../../src/project/fs';
import { NotAProjectError, listAssetPaths, openProject, saveProject } from '../../src/project/io';
import { sha256Hex } from '../../src/project/hash';
import { createLedger, type AssetLedger } from '../../src/project/ledger';
import { defaultProject, SCHEMA_VERSION, type Project } from '../../src/core/schema';

const enc = new TextEncoder();
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

interface Fixture {
  root: MemoryRoot;
  dir: FsDirHandle;
  project: Project;
  ledger: AssetLedger;
  payload: Map<string, Uint8Array>;
  /** 素材原始字节长度。测试里不要硬编码数字，改了夹具就会假红。 */
  assetBytes: number;
}

/** 一个带一份图片素材的、可反复保存的工程。 */
async function fixture(name = 'Demo'): Promise<Fixture> {
  const root = memoryRoot();
  const dir = await root.openDir('p', { create: true });
  const project = defaultProject(name);
  const bytes = enc.encode('fake-png-bytes');
  const hash = await sha256Hex(bytes);
  const payload = new Map<string, Uint8Array>([['img1', bytes]]);
  const ledger = createLedger();
  ledger.entries.img1 = {
    id: 'img1',
    kind: 'image',
    path: 'assets/img1.png',
    hash,
    bytes: bytes.byteLength,
    originName: 'img1.png',
    mode: 'bundled',
    addedAt: 1,
  };
  project.assets.img1 = { id: 'img1', kind: 'image', name: '测试图', hash };
  return { root, dir, project, ledger, payload, assetBytes: bytes.byteLength };
}

function saver(f: Fixture, over: Partial<{ project: Project; ledger: AssetLedger }> = {}) {
  return saveProject({
    dir: f.dir,
    project: over.project ?? f.project,
    ledger: over.ledger ?? f.ledger,
    bytesFor: (id) => f.payload.get(id) ?? null,
  });
}

describe('saveProject', () => {
  it('建出完整的目录结构并写下三个文件', async () => {
    const f = await fixture();
    await saver(f);

    const top = (await f.dir.list()).map((i) => i.name).sort();
    expect(top).toContain('project.json');
    expect(top).toContain('assets.json');
    expect(top).toContain('assets');
    expect(top).toContain('analysis');
    expect(top).toContain('thumbs');

    const analysis = await f.dir.openDir('analysis');
    expect((await analysis.list()).map((i) => i.name)).toContain('audio');

    expect(f.root.inspect('p/assets/img1.png')).not.toBeNull();
  });

  it('第一次保存没有 .bak（没有上一版可备份）', async () => {
    const f = await fixture();
    const r = await saver(f);
    expect(r.project.backup).toBeNull();
    expect(f.root.inspect('p/project.json.bak')).toBeNull();
  });

  it('第二次保存的 .bak 是上一版内容', async () => {
    const f = await fixture();
    await saver(f);
    await saver(f, { project: { ...f.project, name: '改过名字' } });

    expect(JSON.parse(dec(f.root.inspect('p/project.json')!)).name).toBe('改过名字');
    expect(JSON.parse(dec(f.root.inspect('p/project.json.bak')!)).name).toBe('Demo');
  });

  it('报告里带上写入量与校验强度', async () => {
    const f = await fixture();
    const r = await saver(f);
    expect(r.project.verified).toBe('hash');
    expect(r.project.bytes).toBeGreaterThan(0);
    expect(r.assetsWritten).toBe(1);
    expect(r.assetBytes).toBe(f.assetBytes);
    expect(r.warnings).toHaveLength(0);
  });

  it('素材文件名冲突时拒绝保存（否则会静默互相覆盖）', async () => {
    const f = await fixture();
    f.ledger.entries.other = { ...f.ledger.entries.img1!, id: 'other', path: 'assets/img1.png' };
    await expect(saver(f)).rejects.toThrow(/冲突/);
    expect(f.root.inspect('p/project.json')).toBeNull();
  });

  it('台账里移除的素材，磁盘上的文件**不删**（W0.1）', async () => {
    const f = await fixture();
    await saver(f);
    expect(f.root.inspect('p/assets/img1.png')).not.toBeNull();

    const empty = createLedger();
    const r = await saver(f, { ledger: empty });
    // 文件留下当孤儿，「点保存顺手销毁源文件」这条链因此断掉。
    expect(f.root.inspect('p/assets/img1.png')).not.toBeNull();
    expect(r.assetsRemoved).toBe(0);
  });

  it('内存里没有字节的素材跳过写入并给警告', async () => {
    const f = await fixture();
    f.payload.clear();
    const r = await saver(f);
    expect(r.assetsWritten).toBe(0);
    expect(r.warnings.some((w) => w.includes('没有字节'))).toBe(true);
    expect(f.root.inspect('p/project.json')).not.toBeNull();
  });
});

describe('openProject', () => {
  it('保存后重开，工程内容完全一致', async () => {
    const f = await fixture();
    await saver(f);
    const r = await openProject(f.dir);
    expect(r.project).toEqual(f.project);
    expect(r.issues).toHaveLength(0);
  });

  it('台账与素材都对得上时没有任何 issue', async () => {
    const f = await fixture();
    await saver(f);
    const r = await openProject(f.dir);
    expect(r.ledger.entries.img1).toMatchObject({ hash: f.ledger.entries.img1!.hash, bytes: f.assetBytes });
    expect(r.issues).toHaveLength(0);
  });

  it('素材被换掉时检出 changed', async () => {
    const f = await fixture();
    await saver(f);
    f.root.seed('p/assets/img1.png', 'tampered');
    const r = await openProject(f.dir);
    expect(r.issues.some((i) => i.kind === 'changed' && i.assetId === 'img1')).toBe(true);
  });

  it('素材文件被删掉时检出 missing', async () => {
    const f = await fixture();
    await saver(f);
    await (await f.dir.openDir('assets')).remove('img1.png');
    const r = await openProject(f.dir);
    expect(r.issues.some((i) => i.kind === 'missing')).toBe(true);
  });

  it('台账丢了就从 assets/ 目录重建（文件名就是 assetId）', async () => {
    const f = await fixture();
    await saver(f);
    await f.dir.remove('assets.json');

    const r = await openProject(f.dir);
    expect(r.warnings.some((w) => w.includes('重建'))).toBe(true);
    expect(r.ledger.entries.img1).toMatchObject({ path: 'assets/img1.png', bytes: f.assetBytes });
    expect(r.ledger.entries.img1!.hash).toBe(f.ledger.entries.img1!.hash);
  });

  it('assets/ 里的未跟踪文件只提示，不删', async () => {
    const f = await fixture();
    await saver(f);
    f.root.seed('p/assets/stray.png', 'who put this here');
    const r = await openProject(f.dir);
    expect(r.issues.some((i) => i.kind === 'untracked')).toBe(true);
    expect(f.root.inspect('p/assets/stray.png')).not.toBeNull();
  });

  it('多个孤儿素材聚合成一条提示，而不是每个文件一条', async () => {
    const f = await fixture();
    await saver(f);
    f.root.seed('p/assets/orphan-a.bin', 'aaaa');
    f.root.seed('p/assets/orphan-b.bin', 'bbbbbb');

    const r = await openProject(f.dir);
    const orphans = r.issues.filter((i) => i.kind === 'untracked');
    // 逐文件形态是 auditLedger 的行为（3 条），openProject 要把它收成 1 条。
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.path).toBeNull();
    expect(orphans[0]!.message).toContain('2 个');
    // 体积取的是 4 + 6 字节，不是「有没有读到字节」。
    expect(orphans[0]!.message).toContain('10 B');
  });

  it('打开旧版本工程时跑迁移', async () => {
    const f = await fixture();
    const v1 = { ...f.project, schemaVersion: 1 };
    f.root.seed('p/project.json', JSON.stringify(v1));
    const r = await openProject(f.dir);
    expect(r.project.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('不是工程目录时给一个能看懂的错', async () => {
    const root = memoryRoot();
    const empty = await root.openDir('empty', { create: true });
    await expect(openProject(empty)).rejects.toThrow(NotAProjectError);
    await expect(openProject(empty)).rejects.toThrow(/不是一个 Artmatic 工程目录/);
  });

  it('工程 JSON 坏掉时报出是 JSON 的问题', async () => {
    const root = memoryRoot();
    const dir = await root.openDir('bad', { create: true });
    root.seed('bad/project.json', '{ oops');
    await expect(openProject(dir)).rejects.toThrow(/不是合法 JSON/);
  });

  it('isProjectDir / listAssetPaths 的判定', async () => {
    const f = await fixture();
    expect(await listAssetPaths(f.dir)).toEqual([]);
    await saver(f);
    expect(await listAssetPaths(f.dir)).toEqual(['assets/img1.png']);
  });
});

describe('writeBytesAtomic', () => {
  it('写入失败时原文件一个字节都没变（swap 语义）', async () => {
    const root = memoryRoot();
    const dir = await root.openDir('w', { create: true });
    await writeBytesAtomic(dir, 'x.txt', 'old');

    root.setFault((op) => (op === 'write' ? new Error('disk full') : null));
    await expect(writeBytesAtomic(dir, 'x.txt', 'new')).rejects.toThrow(/disk full/);
    expect(dec(root.inspect('w/x.txt')!)).toBe('old');
  });

  it('exclusive 模式下第二个 writer 被挡住，关掉后可以再开', async () => {
    const root = memoryRoot();
    const dir = await root.openDir('w', { create: true });
    const fh = await dir.openFile('y.txt', { create: true });

    const w1 = await fh.openWrite();
    await expect(fh.openWrite()).rejects.toThrow(/已有写入者/);
    await w1.close();

    expect(root.openWriters()).toBe(0);
    const w2 = await fh.openWrite();
    await w2.close();
  });

  it('abort 之后目标保持原样', async () => {
    const root = memoryRoot();
    const dir = await root.openDir('w', { create: true });
    await writeBytesAtomic(dir, 'z.txt', 'keep-me');

    const fh = await dir.openFile('z.txt', { create: true });
    const w = await fh.openWrite();
    await w.write('throw away');
    await w.abort();

    expect(dec(root.inspect('w/z.txt')!)).toBe('keep-me');
  });

  it('可选备份写入 .bak', async () => {
    const root = memoryRoot();
    const dir = await root.openDir('w', { create: true });
    await writeBytesAtomic(dir, 'a.json', 'v1');
    const r = await writeBytesAtomic(dir, 'a.json', 'v2', { backup: 'a.json.bak' });
    expect(r.backup).toMatchObject({ name: 'a.json.bak', bytes: 2 });
    expect(dec(root.inspect('w/a.json.bak')!)).toBe('v1');
    expect(dec(root.inspect('w/a.json')!)).toBe('v2');
  });

  it('读回校验能抓到长度不符', async () => {
    const root = memoryRoot();
    const dir = await root.openDir('w', { create: true });
    const fh = await dir.openFile('t.txt', { create: true });
    // 伪造一个「写进去 3 字节、读出来 5 字节」的文件句柄。
    const real = await fh.get();
    const fake: typeof fh = {
      name: 't.txt',
      get: async () => ({ ...real, readBytes: async () => new Uint8Array(5), size: 5 }),
      openWrite: fh.openWrite.bind(fh),
    };
    await expect(
      writeBytesAtomic({ ...dir, openFile: async () => fake }, 't.txt', 'abc'),
    ).rejects.toThrow(/写入后校验失败/);
  });
});
