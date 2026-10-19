import { describe, expect, it } from 'vitest';
import {
  createAssetStore,
  isLazySource,
  setAssetPathReader,
  type AssetSource,
} from '../../src/project/asset-store';
import { contentOfBytes } from '../../src/project/fingerprint';
import { memoryRoot } from '../../src/project/fs';
import { createLedger, projectPath, serializeLedger } from '../../src/project/ledger';

/**
 * W1.1 的守卫：**视频素材的字节一个都不许被读进堆**。
 *
 * 这条不是性能优化，是「打开 2 GB 视频工程 = 2 GB JS 堆」那条链的唯一断点。
 * 所以判据不是「结果对不对」，而是**读取次数**：一个假的 `File` 会在
 * `arrayBuffer()` / `stream()` 被调用时计数，登记与建立台账全程必须是 0。
 */

const VIDEO_INPUT = { kind: 'video' as const, name: 'take.mp4', originName: 'take.mp4' };

/**
 * 假的 `File`：只实现素材仓会用到的成员，并记录「有没有被真读过」。
 *
 * 不能直接用 `new File([...])` 再 spy —— Node 里 File 的方法来自原型，
 * 打桩不可靠；这里要断言的恰恰是「方法压根没被调用」。
 */
function fakeVideo(size: number) {
  /** 整份读的次数（`arrayBuffer` / `stream`）—— 这个必须永远是 0。 */
  let reads = 0;
  /** 分片读的字节数（指纹只该读首尾）。 */
  let sliced = 0;
  const full = (): Uint8Array => new Uint8Array(size);
  const file = {
    name: 'take.mp4',
    size,
    type: 'video/mp4',
    arrayBuffer: async () => {
      reads += 1;
      return new ArrayBuffer(size);
    },
    stream: () => {
      reads += 1;
      return new Blob([full() as unknown as BlobPart]).stream();
    },
    slice: (start = 0, end = size): Blob => {
      const s = Math.max(0, Math.min(size, start));
      const e = Math.max(s, Math.min(size, end));
      sliced += e - s;
      return new Blob([full().subarray(s, e) as unknown as BlobPart]);
    },
  };
  return {
    file: file as unknown as File,
    get reads() {
      return reads;
    },
    get sliced() {
      return sliced;
    },
  };
}

describe('AssetStore：File 来源不整份读（W1.1）', () => {
  it('登记不读；建台账只读首尾 128 KiB；hash 退化成 null', async () => {
    const store = createAssetStore();
    const f = fakeVideo(1024 * 1024);

    store.putFile('v1', f.file, VIDEO_INPUT);
    expect(f.reads, 'putFile 不该碰文件内容').toBe(0);

    expect(store.size('v1')).toBe(1024 * 1024);
    expect(store.open('v1'), '有可读来源（只是还没读）').not.toBeNull();
    expect(store.bytesOf('v1'), '句柄来源没有内存字节').toBeNull();
    expect(f.reads).toBe(0);

    const ledger = await store.buildLedger();
    expect(ledger.entries.v1).toMatchObject({
      kind: 'video',
      content: { size: 1024 * 1024 },
    });
    expect(projectPath(ledger.entries.v1!)).toBe('assets/v1.mp4');
    expect(f.reads, '建台账也不该整份读文件').toBe(0);
    expect(f.sliced, '只有内容身份采样（首尾各 64 KiB）').toBeLessThanOrEqual(128 * 1024);
  });

  it('只有真正要字节时（open / readAll）才读', async () => {
    const store = createAssetStore();
    const f = fakeVideo(64);
    store.putFile('v1', f.file, VIDEO_INPUT);

    const chunks: number[] = [];
    for await (const c of store.open('v1')!) chunks.push(c.byteLength);
    expect(chunks.reduce((a, b) => a + b, 0)).toBe(64);
    expect(f.reads).toBe(1);

    const all = await store.readAll('v1');
    expect(all?.byteLength).toBe(64);
    expect(f.reads).toBe(2);
  });

  it('isLazySource 认得出这两类「不读字节」的来源', () => {
    expect(isLazySource({ kind: 'file' } as unknown as AssetSource)).toBe(true);
    expect(isLazySource({ kind: 'bytes', bytes: new Uint8Array() })).toBe(false);
    expect(isLazySource({ kind: 'none' })).toBe(false);
  });
});

describe('AssetStore：从台账读回（打开工程）', () => {
  async function fixture() {
    const root = memoryRoot();
    const dir = await root.openDir('p', { create: true });

    const video = new Uint8Array(256).fill(7);
    const image = new Uint8Array([1, 2, 3, 4]);
    root.seed('p/assets/v1.mp4', video);
    root.seed('p/assets/i1.png', image);

    const ledger = createLedger();
    ledger.entries.v1 = {
      id: 'v1',
      kind: 'video',
      originName: 'take.mp4',
      mode: 'bundled',
      addedAt: 1,
      // 旧台账没有 content：打开时按首尾 128 KiB 补算。
      content: null,
      locations: [{ kind: 'project', path: 'assets/v1.mp4', seen: null }],
    };
    ledger.entries.i1 = {
      id: 'i1',
      kind: 'image',
      originName: 'pic.png',
      mode: 'bundled',
      addedAt: 2,
      content: null,
      locations: [{ kind: 'project', path: 'assets/i1.png', seen: null }],
    };
    return { root, dir, ledger, video, image };
  }

  it('视频读成句柄（没有内存字节），图片读成字节', async () => {
    const { dir, ledger, video, image } = await fixture();
    const store = createAssetStore();
    const report = await store.loadFrom(dir, ledger);

    expect(report).toMatchObject({ loaded: 2, missing: [] });
    expect(store.bytesOf('v1'), '视频不该被整份读回来').toBeNull();
    expect(store.size('v1')).toBe(video.byteLength);
    expect(store.bytesOf('i1')).toEqual(image);
  });

  it('读回的台账与磁盘一致（打开时补算采样身份，视频不整份读）', async () => {
    const { dir, ledger } = await fixture();
    const store = createAssetStore();
    await store.loadFrom(dir, ledger);
    const built = await store.buildLedger();
    expect(built.entries.v1!.content?.size).toBe(256);
    expect(built.entries.v1!.content?.fp).toMatch(/^fp1:256:/);
    expect(built.entries.i1!.content?.size).toBe(4);
    expect(built.entries.i1!.content?.fp).toMatch(/^fp1:4:/);
  });

  it('文件丢失的素材进 missing，且不会被当成「有来源」', async () => {
    const { dir, ledger } = await fixture();
    const assets = await dir.openDir('assets');
    await assets.remove('v1.mp4');
    const store = createAssetStore();
    const report = await store.loadFrom(dir, ledger);
    expect(report.missing).toEqual(['v1']);
    expect(store.has('v1')).toBe(false);
  });
});

describe('AssetStore：移除 = 解除关联（W1.3）', () => {
  it('retire 之后不在活动素材里，但台账仍以 retained:true 记录它', async () => {
    const store = createAssetStore();
    const bytes = new Uint8Array([9, 8, 7]);
    store.put('img', bytes, { kind: 'image', name: '图', originName: 'a.png' });
    // 模拟「已经保存过一次」：只有落过盘的素材才有文件可保留。
    store.markPersisted(['img']);

    expect(store.retire('img')).toBe(true);
    expect(store.ids()).toEqual([]);
    expect(store.retainedIds()).toEqual(['img']);
    expect(store.retainedSize('img')).toBe(3);
    expect(store.totalBytes()).toBe(0);

    const ledger = await store.buildLedger();
    expect(ledger.entries.img).toMatchObject({ retained: true, content: { size: 3 } });
    expect(projectPath(ledger.entries.img!)).toBe('assets/img.png');

    // 序列化之后字段真的落进了 JSON（旧版读到它也只是忽略）。
    const text = serializeLedger(ledger);
    expect(JSON.parse(text).entries.img.retained).toBe(true);
  });

  it('restore 把它放回活动素材（字节来源仍在，不需要重新读盘）', async () => {
    const store = createAssetStore();
    store.put('img', new Uint8Array([1, 2, 3]), { kind: 'image', name: '图', originName: 'a.png' });
    store.markPersisted(['img']);
    store.retire('img');

    expect(await store.restore('img')).toBe(true);
    expect(store.ids()).toEqual(['img']);
    expect(store.retainedIds()).toEqual([]);
    expect(store.bytesOf('img')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('打开工程时保留项只开句柄、不读字节，且恢复时把图片读回内存', async () => {
    const root = memoryRoot();
    const dir = await root.openDir('p', { create: true });
    const image = new Uint8Array([5, 5, 5, 5]);
    root.seed('p/assets/gone.png', image);
    const ledger = createLedger();
    ledger.entries.gone = {
      id: 'gone',
      kind: 'image',
      originName: 'gone.png',
      mode: 'bundled',
      addedAt: 1,
      retained: true,
      content: null,
      locations: [{ kind: 'project', path: 'assets/gone.png', seen: null }],
    };

    const store = createAssetStore();
    await store.loadFrom(dir, ledger);
    expect(store.ids(), '保留项不进口媒体池').toEqual([]);
    expect(store.retainedIds()).toEqual(['gone']);
    expect(store.bytesOf('gone'), '加载时不读字节').toBeNull();

    await store.restore('gone');
    expect(store.bytesOf('gone'), '恢复时图片必须回到内存（置图是同步 API）').toEqual(image);
  });
});

describe('AssetStore：内容身份与去重（W1 清理链路）', () => {
  it('同内容（同一指纹）复用同一个 id，活动区与保留区都找得到', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const content = await contentOfBytes(bytes);
    const store = createAssetStore();
    store.put('a', bytes, { kind: 'image', name: 'a', originName: 'a.png' }, content);

    expect(store.findByFp(content.fp)).toBe('a');

    store.markPersisted(['a']);
    store.retire('a');
    expect(store.findByFp(content.fp), '重导已移除的素材应当复活它').toBe('a');
    expect(store.isRetained('a')).toBe(true);
    expect(store.activate('a')).toBe(true);
    expect(store.isRetained('a')).toBe(false);
  });

  it('弱指纹（fp0）不参与去重', () => {
    const store = createAssetStore();
    store.put(
      'a',
      new Uint8Array([1]),
      { kind: 'image', name: 'a', originName: 'a.png' },
      { size: 1, fp: 'fp0:1' },
    );
    expect(store.findByFp('fp0:1')).toBeNull();
  });

  it('从未落盘的素材被移除时直接丢弃，不写进保留区', () => {
    const store = createAssetStore();
    store.put('x', new Uint8Array([1]), { kind: 'image', name: 'x', originName: 'x.png' });

    expect(store.retire('x')).toBe(false);
    expect(store.ids()).toEqual([]);
    expect(store.retainedIds()).toEqual([]);
    expect(store.isPersisted('x')).toBe(false);
  });

  it('落盘之后才保留（markPersisted 是保存成功的信号）', () => {
    const store = createAssetStore();
    store.put('x', new Uint8Array([1]), { kind: 'image', name: 'x', originName: 'x.png' });
    store.markPersisted(['x']);

    expect(store.isPersisted('x')).toBe(true);
    expect(store.retire('x')).toBe(true);
    expect(store.retainedIds()).toEqual(['x']);
  });

  it('打开工程时算出内容身份并记为「已落盘」', async () => {
    const root = memoryRoot();
    const dir = await root.openDir('p', { create: true });
    const image = new Uint8Array([4, 5, 6]);
    root.seed('p/assets/img.png', image);
    const ledger = createLedger();
    ledger.entries.img = {
      id: 'img',
      kind: 'image',
      originName: 'img.png',
      mode: 'bundled',
      addedAt: 1,
      content: null,
      locations: [{ kind: 'project', path: 'assets/img.png', seen: null }],
    };

    const store = createAssetStore();
    await store.loadFrom(dir, ledger);
    expect(store.contentOf('img')).toMatchObject({ size: 3 });
    expect(store.findByFp(store.contentOf('img')!.fp)).toBe('img');
    expect(store.isPersisted('img')).toBe(true);
  });
});

describe('path 来源：桌面版 linked（W5）', () => {
  it('按范围分块读；openVideo 返回 path 载体；没有 reader 时不假装读到空字节', async () => {
    const store = createAssetStore();
    const size = 5 * 1024 * 1024 + 7;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 251;

    store.putPath('v1', '/tmp/take.mp4', size, VIDEO_INPUT, {
      size,
      fp: `fp1:${size}:x`,
    });

    setAssetPathReader(async (_p, start, end) => bytes.slice(start, end));
    try {
      const chunks: Uint8Array[] = [];
      for await (const c of store.open('v1')!) chunks.push(c);
      expect(chunks.length).toBeGreaterThan(1); // 4 MiB 一块，5 MiB 至少两块
      expect(chunks.reduce((n, c) => n + c.byteLength, 0)).toBe(size);
      // 5 MB 的 `toEqual` 会逐元素深比较，把 5 s 的默认超时吃光；
      // 这里核对长度 + 首尾（块边界由上面的 chunks.length 覆盖）。
      const all = await store.readAll('v1');
      expect(all!.byteLength).toBe(size);
      expect(all![0]).toBe(0);
      expect(all![size - 1]).toBe((size - 1) % 251);

      const media = await store.openVideo('v1');
      expect(media).toMatchObject({ kind: 'path', path: '/tmp/take.mp4', size });
    } finally {
      setAssetPathReader(null);
    }

    expect(store.open('v1'), '没有 reader 时不能返回空流').toBeNull();
    expect(await store.openVideo('v1')).toBeNull();
  });
});
