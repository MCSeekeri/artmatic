import { describe, expect, it } from 'vitest';
import {
  auditLedger,
  createLedger,
  detectPathConflicts,
  diffLedger,
  localPath,
  parseLedger,
  projectPath,
  relinkPaths,
  serializeLedger,
  type AssetEntry,
  type AssetLedger,
} from '../../src/project/ledger';

/** 一条「bundled、工程内有一份」的素材。覆盖项按需给。 */
function entry(over: Partial<AssetEntry> = {}): AssetEntry {
  return {
    id: 'a',
    kind: 'image',
    originName: 'a.png',
    mode: 'bundled',
    addedAt: 0,
    content: { size: 10, fp: 'fp1:10:abc' },
    locations: [
      { kind: 'project', path: 'assets/a.png', seen: { size: 10, fp: 'fp1:10:abc', mtime: null } },
    ],
    ...over,
  };
}

function projectAt(path: string): AssetEntry['locations'] {
  return [{ kind: 'project', path, seen: null }];
}

function ledgerOf(...entries: AssetEntry[]): AssetLedger {
  const l = createLedger();
  for (const e of entries) l.entries[e.id] = e;
  return l;
}

describe('parseLedger', () => {
  it('空输入给空台账，不报警告', () => {
    const { ledger, warnings } = parseLedger(null);
    expect(Object.keys(ledger.entries)).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('坏 JSON 降级成空台账（台账可重建，不该挡住打开工程）', () => {
    const { ledger, warnings } = parseLedger('{ not json');
    expect(Object.keys(ledger.entries)).toHaveLength(0);
    expect(warnings[0]).toMatch(/不是合法 JSON/);
  });

  it('读到 v3 内容：content 与 locations 都在', () => {
    const text = serializeLedger(ledgerOf(entry()));
    const { ledger } = parseLedger(text);
    expect(ledger.entries.a).toMatchObject({
      id: 'a',
      content: { size: 10, fp: 'fp1:10:abc' },
      mode: 'bundled',
    });
    expect(projectPath(ledger.entries.a!)).toBe('assets/a.png');
  });

  it('v2 台账归一化：path → project 位置，content 留空等补算', () => {
    const raw = JSON.stringify({
      layoutVersion: 2,
      entries: {
        a: {
          id: 'a',
          kind: 'image',
          path: 'assets/a.png',
          hash: 'deadbeef',
          bytes: 123,
          originName: 'a.png',
          mode: 'bundled',
          addedAt: 5,
        },
      },
    });
    const { ledger } = parseLedger(raw);
    expect(projectPath(ledger.entries.a!)).toBe('assets/a.png');
    expect(ledger.entries.a!.content).toBeNull();
    expect(ledger.entries.a!.locations[0]!.seen?.size).toBe(123);
  });

  it('单条形状不对只丢那一条，其余保留', () => {
    const raw = JSON.stringify({
      layoutVersion: 1,
      entries: { good: entry(), bad: { kind: 'nonsense' } },
    });
    const { ledger, warnings } = parseLedger(raw);
    expect(Object.keys(ledger.entries)).toEqual(['good']);
    expect(warnings.some((w) => w.includes('bad'))).toBe(true);
  });

  it('layoutVersion 高于本应用时报警告但照常读', () => {
    const raw = JSON.stringify({ layoutVersion: 99, entries: { a: entry() } });
    const { ledger, warnings } = parseLedger(raw);
    expect(Object.keys(ledger.entries)).toEqual(['a']);
    expect(warnings.some((w) => w.includes('layoutVersion'))).toBe(true);
  });
});

describe('serializeLedger', () => {
  it('按 id 排序，插入顺序不同也产出完全相同的字节', () => {
    const a = ledgerOf(entry({ id: 'z' }), entry({ id: 'a' }));
    const b = ledgerOf(entry({ id: 'a' }), entry({ id: 'z' }));
    expect(serializeLedger(a)).toBe(serializeLedger(b));
  });

  it('位置按 local → project 排序，产出稳定', () => {
    const e = entry({
      locations: [
        { kind: 'project', path: 'assets/a.png', seen: null },
        { kind: 'local', path: '/x/a.png', seen: null },
      ],
    });
    const json = JSON.parse(serializeLedger(ledgerOf(e)));
    expect(json.entries.a.locations.map((l: { kind: string }) => l.kind)).toEqual(['local', 'project']);
  });

  it('结尾带换行（文本文件惯例，也免得 git 报 no newline）', () => {
    expect(serializeLedger(createLedger()).endsWith('\n')).toBe(true);
  });
});

describe('diffLedger', () => {
  it('分辨增删改与未变', () => {
    const prev = ledgerOf(
      entry({ id: 'keep' }),
      entry({ id: 'gone' }),
      entry({ id: 'edit', content: { size: 10, fp: 'old' } }),
    );
    const next = ledgerOf(
      entry({ id: 'keep' }),
      entry({ id: 'edit', content: { size: 10, fp: 'new' } }),
      entry({ id: 'fresh' }),
    );
    const d = diffLedger(prev, next);
    expect(d.added).toEqual(['fresh']);
    expect(d.removed).toEqual(['gone']);
    expect(d.changed).toEqual(['edit']);
    expect(d.unchanged).toEqual(['keep']);
  });

  it('有强指纹时优先比指纹（大小变了但内容没变 = 未变）', () => {
    const prev = ledgerOf(entry({ id: 'x', content: { size: 10, fp: 'fp1:10:h1' } }));
    const next = ledgerOf(entry({ id: 'x', content: { size: 999, fp: 'fp1:10:h1' } }));
    expect(diffLedger(prev, next).unchanged).toEqual(['x']);
  });

  it('没有强指纹时退化到比大小', () => {
    const prev = ledgerOf(entry({ id: 'x', content: { size: 10, fp: 'fp0:10' } }));
    const next = ledgerOf(entry({ id: 'x', content: { size: 11, fp: 'fp0:11' } }));
    expect(diffLedger(prev, next).changed).toEqual(['x']);
  });

  it('工程内路径或 mode 变了也算变化', () => {
    const prev = ledgerOf(entry({ id: 'x' }));
    const next = ledgerOf(entry({ id: 'x', locations: projectAt('assets/renamed.png') }));
    expect(diffLedger(prev, next).changed).toEqual(['x']);

    const linked = ledgerOf(entry({ id: 'x', mode: 'linked' }));
    expect(diffLedger(prev, linked).changed).toEqual(['x']);
  });

  it('本地位置变化也算变化（换机器 / 重新链接）', () => {
    const prev = ledgerOf(
      entry({
        id: 'x',
        locations: [
          { kind: 'project', path: 'assets/x.png', seen: null },
          { kind: 'local', path: '/a/x.png', seen: null },
        ],
      }),
    );
    const next = ledgerOf(
      entry({
        id: 'x',
        locations: [
          { kind: 'project', path: 'assets/x.png', seen: null },
          { kind: 'local', path: '/b/x.png', seen: null },
        ],
      }),
    );
    expect(diffLedger(prev, next).changed).toEqual(['x']);
  });
});

describe('detectPathConflicts', () => {
  it('两条记录指向工程内同一个文件时报出来', () => {
    const l = ledgerOf(
      entry({ id: 'a/b', locations: projectAt('assets/ab.png') }),
      entry({ id: 'a:b', locations: projectAt('assets/ab.png') }),
    );
    const c = detectPathConflicts(l);
    expect(c).toHaveLength(1);
    expect(c[0]!.path).toBe('assets/ab.png');
    expect(c[0]!.ids.sort()).toEqual(['a/b', 'a:b']);
  });

  it('local 位置不参与冲突判定（不同机器上本来就可能相同）', () => {
    const l = ledgerOf(
      entry({ id: 'a', locations: [{ kind: 'local', path: '/x.png', seen: null }] }),
      entry({ id: 'b', locations: [{ kind: 'local', path: '/x.png', seen: null }] }),
    );
    expect(detectPathConflicts(l)).toHaveLength(0);
  });

  it('generated 素材没有位置，不参与冲突判定', () => {
    const l = ledgerOf(
      entry({ id: 'g1', mode: 'generated', locations: [] }),
      entry({ id: 'g2', mode: 'generated', locations: [] }),
    );
    expect(detectPathConflicts(l)).toHaveLength(0);
  });
});

describe('relinkPaths', () => {
  it('按 id 与原始文件名重算工程副本路径；本地位置不动', () => {
    const l = ledgerOf(
      entry({
        id: 'xyz',
        originName: 'photo.JPEG',
        locations: [
          { kind: 'project', path: 'assets/old.png', seen: null },
          { kind: 'local', path: '/home/me/photo.JPEG', seen: null },
        ],
      }),
    );
    const out = relinkPaths(l);
    expect(projectPath(out.entries.xyz!)).toBe('assets/xyz.jpeg');
    expect(localPath(out.entries.xyz!)).toBe('/home/me/photo.JPEG');
  });

  it('generated 素材保持没有位置', () => {
    const l = ledgerOf(entry({ id: 'g', mode: 'generated', locations: [] }));
    expect(relinkPaths(l).entries.g!.locations).toEqual([]);
  });
});

describe('auditLedger', () => {
  const noop = async () => null;

  it('文件不在 → missing', async () => {
    const issues = await auditLedger(ledgerOf(entry()), noop);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'missing', severity: 'error', assetId: 'a' });
  });

  it('linked 条目没有工程副本 → 不报 missing（它本来就不该有）', async () => {
    const l = ledgerOf(
      entry({
        mode: 'linked',
        locations: [{ kind: 'local', path: '/x/a.png', seen: null }],
      }),
    );
    expect(await auditLedger(l, noop)).toHaveLength(0);
  });

  it('指纹对得上 → 无 issue', async () => {
    const issues = await auditLedger(ledgerOf(entry()), async () => ({
      bytes: 10,
      fp: 'fp1:10:abc',
    }));
    expect(issues).toHaveLength(0);
  });

  it('指纹对不上 → changed', async () => {
    const issues = await auditLedger(ledgerOf(entry()), async () => ({
      bytes: 10,
      fp: 'fp1:10:zzz',
    }));
    expect(issues[0]).toMatchObject({ kind: 'changed', severity: 'warning' });
  });

  it('没有身份且大小变了 → changed', async () => {
    const issues = await auditLedger(ledgerOf(entry({ content: null })), async () => ({
      bytes: 12,
      fp: null,
    }));
    expect(issues[0]).toMatchObject({ kind: 'changed' });
  });

  it('没有身份且大小没变 → unhashed 提示（刻意的降级，要说出来）', async () => {
    const issues = await auditLedger(ledgerOf(entry({ content: null })), async () => ({
      bytes: 10,
      fp: null,
    }));
    expect(issues[0]).toMatchObject({ kind: 'unhashed', severity: 'info' });
  });

  it('needFp 只在台账有 content 时才是 true（省掉无谓的 128 KiB 读取）', async () => {
    const seen: boolean[] = [];
    await auditLedger(
      ledgerOf(entry({ id: 'h' }), entry({ id: 'n', content: null })),
      async (_p, needFp) => {
        seen.push(needFp);
        return { bytes: 10, fp: 'fp1:10:abc' };
      },
    );
    expect(seen).toEqual([true, false]);
  });

  it('generated 素材不查磁盘', async () => {
    let called = 0;
    await auditLedger(ledgerOf(entry({ mode: 'generated', locations: [] })), async () => {
      called++;
      return null;
    });
    expect(called).toBe(0);
  });

  it('assets/ 里的未跟踪文件只提示，不当作错误', async () => {
    const issues = await auditLedger(createLedger(), noop, ['assets/stray.png']);
    expect(issues[0]).toMatchObject({ kind: 'untracked', severity: 'info', path: 'assets/stray.png' });
  });
});

describe('retained：已移除但文件还在（W1.3）', () => {
  it('旧台账缺这个字段 → 视为未保留（旧行为）', () => {
    const { ledger } = parseLedger(JSON.stringify({ layoutVersion: 1, entries: { a: entry() } }));
    expect(ledger.entries.a!.retained).toBeUndefined();
  });

  it('读到 retained:true 时保留它', () => {
    const text = serializeLedger(ledgerOf(entry({ retained: true })));
    const { ledger } = parseLedger(text);
    expect(ledger.entries.a!.retained).toBe(true);
  });

  it('序列化只在为真时写字段（不改变普通条目的字节）', () => {
    const plain = serializeLedger(ledgerOf(entry()));
    expect(plain).not.toContain('retained');
    const kept = serializeLedger(ledgerOf(entry({ retained: true })));
    expect(kept).toContain('"retained": true');
  });

  it('文件不在也不报 missing —— 它本来就不再被工程引用', async () => {
    const issues = await auditLedger(ledgerOf(entry({ retained: true })), async () => null);
    expect(issues).toHaveLength(0);
  });

  it('文件在时也不报 untracked（它仍算 tracked）', async () => {
    const issues = await auditLedger(
      ledgerOf(entry({ retained: true })),
      async () => ({ bytes: 10, fp: 'fp1:10:abc' }),
      ['assets/a.png'],
    );
    expect(issues).toHaveLength(0);
  });

  it('retained 标记翻转不算「内容变了」—— 不该为此重写一份字节', () => {
    const prev = ledgerOf(entry({ id: 'x' }));
    const next = ledgerOf(entry({ id: 'x', retained: true }));
    expect(diffLedger(prev, next).unchanged).toEqual(['x']);
  });
});
