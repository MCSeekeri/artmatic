import { describe, expect, it } from 'vitest';
import {
  ZipWriter,
  blobChunks,
  crc32,
  listZip,
  readZipEntry,
  safeArchivePath,
} from '../../src/project/archive';

/**
 * 工程包的 ZIP 读写。判据是**往返**与**恶意输入**，不是某个字段：
 * 自己写、自己读都通过只能说明两边一起错。
 *
 * ZIP64 用 `limit = 1` 强制走（几 KB 的夹具就能覆盖 > 4 GB 的分支），
 * 否则这条路径要等用户真的塞一个 5 GB 视频才会第一次执行。
 */

async function pack(files: { name: string; bytes: Uint8Array }[], limit?: number): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const w = new ZipWriter((c) => {
    chunks.push(c.slice());
  }, limit);
  for (const f of files) {
    await w.add({ name: f.name, size: f.bytes.length, open: () => one(f.bytes) });
  }
  await w.close();
  return new Blob(chunks as unknown as BlobPart[]);
}

async function* one(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

async function readAll(blob: Blob, name: string): Promise<Uint8Array> {
  const entries = await listZip(blob);
  const e = entries.find((x) => x.name === name)!;
  const chunks: Uint8Array[] = [];
  for await (const c of readZipEntry(blob, e)) chunks.push(c);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

describe('ZipWriter / listZip / readZipEntry', () => {
  it('往返：多个条目按原字节读回', async () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new TextEncoder().encode('hello package');
    const blob = await pack([
      { name: 'project.json', bytes: b },
      { name: 'assets/a.png', bytes: a },
    ]);
    expect((await listZip(blob)).map((e) => e.name)).toEqual(['project.json', 'assets/a.png']);
    expect(await readAll(blob, 'assets/a.png')).toEqual(a);
    expect(new TextDecoder().decode(await readAll(blob, 'project.json'))).toBe('hello package');
  });

  it('ZIP64 分支（强制）：同样能往返', async () => {
    const data = new Uint8Array(1024).fill(7);
    const blob = await pack([{ name: 'assets/big.mp4', bytes: data }], 1);
    const [e] = await listZip(blob);
    expect(e!.size).toBe(1024);
    expect(await readAll(blob, 'assets/big.mp4')).toEqual(data);
  });

  it('CRC 覆盖整份数据（读回的 crc 与独立计算一致）', async () => {
    const data = new TextEncoder().encode('crc check');
    const blob = await pack([{ name: 'a.txt', bytes: data }]);
    const [e] = await listZip(blob);
    expect(e!.crc).toBe(crc32([data]));
  });

  it('空条目也能往返（零字节素材不该把包写坏）', async () => {
    const blob = await pack([{ name: 'empty.bin', bytes: new Uint8Array(0) }]);
    expect((await listZip(blob))[0]!.size).toBe(0);
    expect((await readAll(blob, 'empty.bin')).length).toBe(0);
  });

  it('拷贝流（blobChunks）与原始字节一致', async () => {
    const data = new TextEncoder().encode('stream me');
    const chunks: Uint8Array[] = [];
    for await (const c of blobChunks(new Blob([data as unknown as BlobPart]))) chunks.push(c);
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe('stream me');
  });
});

describe('包内路径安全', () => {
  it('接受普通相对路径', () => {
    expect(safeArchivePath('assets/a.png')).toBe('assets/a.png');
    expect(safeArchivePath('project.json')).toBe('project.json');
  });

  it('拒绝绝对路径 / 盘符 / 反斜杠 / ..', () => {
    expect(safeArchivePath('/etc/passwd')).toBeNull();
    expect(safeArchivePath('C:/Windows/x.dll')).toBeNull();
    expect(safeArchivePath('assets\\x.png')).toBeNull();
    expect(safeArchivePath('assets/../../x')).toBeNull();
    expect(safeArchivePath('assets//x')).toBeNull();
    expect(safeArchivePath('')).toBeNull();
  });

  it('读到恶意路径时整包拒绝（不是跳过那一条）', async () => {
    const blob = await pack([{ name: '../evil', bytes: new Uint8Array([1]) }]);
    await expect(listZip(blob)).rejects.toThrow(/unsafe archive path/);
  });

  it('重复条目整包拒绝（解包时后者会静默覆盖前者）', async () => {
    const blob = await pack([
      { name: 'a.txt', bytes: new Uint8Array([1]) },
      { name: 'a.txt', bytes: new Uint8Array([2]) },
    ]);
    await expect(listZip(blob)).rejects.toThrow(/duplicate archive entry/);
  });
});
