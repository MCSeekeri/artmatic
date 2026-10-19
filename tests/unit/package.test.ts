import { describe, expect, it } from 'vitest';
import { packProject, readManifest, unpackProject } from '../../src/project/package';
import { listZip } from '../../src/project/archive';
import { createLedger, projectPath, type AssetLedger } from '../../src/project/ledger';
import { contentOfBytes } from '../../src/project/fingerprint';
import { memoryRoot, resolveDir } from '../../src/project/fs';
import { defaultProject } from '../../src/core/schema';

/**
 * `.artmatic` 工程包：打包 = 收集（含未使用素材），导入 = 校验后落盘。
 *
 * 判据是**往返 + 拒绝坏包**。打包最容易错的地方不是字节，而是清单与数据对不上
 * ——那种包在用户机器上会以「打开后少素材」的形态出现，而打包端毫无报错。
 */

async function fixture() {
  const project = defaultProject('Pack Me');
  const ledger = createLedger();
  const payload = new Map<string, Uint8Array>([
    ['a', new TextEncoder().encode('AAAA')],
    ['b', new TextEncoder().encode('BBBBBB')],
  ]);
  ledger.entries.a = {
    id: 'a',
    kind: 'image',
    originName: 'a.png',
    mode: 'linked',
    addedAt: 1,
    content: await contentOfBytes(payload.get('a')!),
    locations: [{ kind: 'local', path: 'fsa:a', seen: null }],
  };
  ledger.entries.b = {
    id: 'b',
    kind: 'audio',
    originName: 'b.mp3',
    mode: 'bundled',
    addedAt: 2,
    retained: true,
    content: await contentOfBytes(payload.get('b')!),
    locations: [{ kind: 'project', path: 'assets/b.mp3', seen: null }],
  };
  ledger.entries.g = {
    id: 'g',
    kind: 'audio',
    originName: 'demo',
    mode: 'generated',
    addedAt: 3,
    content: null,
    locations: [],
  };
  project.assets.a = { id: 'a', kind: 'image', name: '图' };
  project.assets.g = { id: 'g', kind: 'audio', name: '生成音频' };

  const store = {
    buildLedger: async (): Promise<AssetLedger> => ledger,
    open(id: string): AsyncIterable<Uint8Array> | null {
      const bytes = payload.get(id);
      if (!bytes) return null;
      return (async function* () {
        yield bytes;
      })();
    },
  };
  return { project, ledger, payload, store };
}

async function packToBlob(input: Awaited<ReturnType<typeof fixture>>, createdAt = 123): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const report = await packProject({
    project: input.project,
    store: input.store,
    sink: (c) => {
      chunks.push(c.slice());
    },
    appVersion: 'test',
    createdAt,
  });
  expect(report.missing).toEqual([]);
  return new Blob(chunks as unknown as BlobPart[]);
}

describe('packProject', () => {
  it('包含未使用素材、把 linked 物化为工程副本、不含 generated 字节', async () => {
    const input = await fixture();
    const blob = await packToBlob(input);
    const manifest = await readManifest(blob);
    expect(manifest.kind).toBe('artmatic/project');
    expect(manifest.appVersion).toBe('test');
    expect(manifest.assets.map((a) => a.id).sort()).toEqual(['a', 'b']);
    expect(manifest.assets.find((a) => a.id === 'b')!.retained).toBe(true);

    const names = (await listZip(blob)).map((e) => e.name);
    expect(names).toContain('manifest.json');
    expect(names).toContain('project.json');
    expect(names).toContain('assets.json');
    expect(names.filter((n) => n.startsWith('assets/'))).toHaveLength(2);
  });

  it('拿不到字节的素材不进清单（不制造必然导入失败的坏包）', async () => {
    const input = await fixture();
    input.payload.delete('b');
    const chunks: Uint8Array[] = [];
    const report = await packProject({
      project: input.project,
      store: input.store,
      sink: (c) => {
        chunks.push(c.slice());
      },
      appVersion: 'test',
    });
    expect(report.missing).toEqual(['b.mp3']);
    const manifest = await readManifest(new Blob(chunks as unknown as BlobPart[]));
    expect(manifest.assets.map((a) => a.id)).toEqual(['a']);
  });
});

describe('unpackProject', () => {
  it('往返：工程一致、素材落盘、保留项与 generated 都还在', async () => {
    const input = await fixture();
    const blob = await packToBlob(input);
    const out = await memoryRoot().openDir('out', { create: true });

    const result = await unpackProject(blob, out);
    expect(result.project.name).toBe('Pack Me');
    expect(result.assets).toBe(2);
    expect(projectPath(result.ledger.entries.a!)).toBe('assets/a.png');
    expect(result.ledger.entries.b!.retained).toBe(true);
    expect(result.ledger.entries.g!.mode).toBe('generated');

    const read = async (p: string): Promise<string> => {
      const segs = p.split('/');
      const name = segs.pop()!;
      const parent = await resolveDir(out, segs, false);
      return new TextDecoder().decode(await (await (await parent.openFile(name)).get()).readBytes());
    };
    expect(await read('assets/a.png')).toBe('AAAA');
    expect(await read('assets/b.mp3')).toBe('BBBBBB');
  });

  it('不是工程包 → 明确报错', async () => {
    await expect(readManifest(new Blob(['hello']))).rejects.toThrow(/工程包/);
  });

  it('工程本体被改过一个字节 → 拒绝（不写半成品）', async () => {
    const input = await fixture();
    const blob = await packToBlob(input);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const entries = await listZip(blob);
    const p = entries.find((e) => e.name === 'project.json')!;
    const local = new Uint8Array(await blob.slice(p.offset, p.offset + 30).arrayBuffer());
    const nameLen = local[26]! | (local[27]! << 8);
    const extraLen = local[28]! | (local[29]! << 8);
    bytes[p.offset + 30 + nameLen + extraLen] ^= 0xff;

    const out = await memoryRoot().openDir('bad', { create: true });
    await expect(unpackProject(new Blob([bytes as unknown as BlobPart]), out)).rejects.toThrow(/校验失败/);
  });
});
