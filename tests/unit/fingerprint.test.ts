import { describe, expect, it } from 'vitest';
import {
  FP_CHUNK,
  contentOfBlob,
  contentOfBlobUncached,
  contentOfBytes,
  isStrongFp,
} from '../../src/project/fingerprint';

/**
 * W1 去重与 linked/bundled 冲突判定的地基。
 *
 * 判据只有一条：**同一份内容必须得到同一个指纹，不同内容必须不同**。
 * 采样指纹的已知弱点也在这里钉住 —— 只改中段（首尾 128 KiB 之外）不会被发现，
 * 这是刻意的取舍（读全量 = 2 GB 视频整份进堆），不是 bug。
 */

function bytes(n: number, fill = 1): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

describe('contentOfBytes', () => {
  it('同内容同指纹，不同内容不同指纹', async () => {
    const a = await contentOfBytes(bytes(1000, 7));
    const b = await contentOfBytes(bytes(1000, 7));
    const c = await contentOfBytes(bytes(1000, 8));
    expect(a.fp).toBe(b.fp);
    expect(a.fp).not.toBe(c.fp);
    expect(a.size).toBe(1000);
  });

  it('大小参与身份：同前缀不同长度不能相等', async () => {
    const a = await contentOfBytes(bytes(1000, 7));
    const b = await contentOfBytes(bytes(1001, 7));
    expect(a.fp).not.toBe(b.fp);
  });

  it('首部改了 → 变；尾部改了 → 变', async () => {
    const base = bytes(FP_CHUNK * 3, 1);
    const head = base.slice();
    head[0] = 99;
    const tail = base.slice();
    tail[tail.length - 1] = 99;
    const a = await contentOfBytes(base);
    expect((await contentOfBytes(head)).fp).not.toBe(a.fp);
    expect((await contentOfBytes(tail)).fp).not.toBe(a.fp);
  });

  it('只改中段（采样窗口之外）不会变 —— 这是刻意取舍', async () => {
    const base = bytes(FP_CHUNK * 4, 1);
    const mid = base.slice();
    mid[FP_CHUNK * 2] = 99;
    const a = await contentOfBytes(base);
    expect((await contentOfBytes(mid)).fp).toBe(a.fp);
  });

  it('格式带版本位与大小', async () => {
    const c = await contentOfBytes(bytes(1234));
    expect(c.fp).toMatch(/^fp1:1234:[0-9a-f]{32}$/);
    expect(isStrongFp(c.fp)).toBe(true);
    expect(isStrongFp('fp0:1234')).toBe(false);
  });
});

describe('contentOfBlob', () => {
  it('与同内容的 bytes 算出同一个指纹（linked 与 bundled 必须能对上）', async () => {
    const data = bytes(FP_CHUNK * 2 + 77, 3);
    const fromBytes = await contentOfBytes(data);
    const fromBlob = await contentOfBlob(new Blob([data as unknown as BlobPart]));
    expect(fromBlob).toEqual(fromBytes);
  });

  it('小于一个采样块时也稳定', async () => {
    const data = bytes(10, 5);
    const a = await contentOfBlob(new Blob([data as unknown as BlobPart]));
    const b = await contentOfBlob(new Blob([data as unknown as BlobPart]));
    expect(a).toEqual(b);
  });

  it('只读首尾：不缓存的实现也能得到同样的值', async () => {
    const data = bytes(FP_CHUNK * 3, 2);
    const blob = new Blob([data as unknown as BlobPart]);
    expect(await contentOfBlobUncached(blob)).toEqual(await contentOfBytes(data));
  });
});
