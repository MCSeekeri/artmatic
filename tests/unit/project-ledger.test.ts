import { describe, expect, it } from 'vitest';
import {
  auditLedger,
  createLedger,
  detectPathConflicts,
  diffLedger,
  parseLedger,
  relinkPaths,
  serializeLedger,
  type AssetEntry,
  type AssetLedger,
} from '../../src/project/ledger';

function entry(over: Partial<AssetEntry> = {}): AssetEntry {
  return {
    id: 'a',
    kind: 'image',
    path: 'assets/a.png',
    hash: 'h1',
    bytes: 10,
    originName: 'a.png',
    mode: 'bundled',
    addedAt: 0,
    ...over,
  };
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

  it('读到合法内容', () => {
    const text = serializeLedger(ledgerOf(entry()));
    const { ledger } = parseLedger(text);
    expect(ledger.entries.a).toMatchObject({ id: 'a', hash: 'h1', bytes: 10, mode: 'bundled' });
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

  it('结尾带换行（文本文件惯例，也免得 git 报 no newline）', () => {
    expect(serializeLedger(createLedger()).endsWith('\n')).toBe(true);
  });
});

describe('diffLedger', () => {
  it('分辨增删改与未变', () => {
    const prev = ledgerOf(entry({ id: 'keep' }), entry({ id: 'gone' }), entry({ id: 'edit', hash: 'old' }));
    const next = ledgerOf(entry({ id: 'keep' }), entry({ id: 'edit', hash: 'new' }), entry({ id: 'fresh' }));
    const d = diffLedger(prev, next);
    expect(d.added).toEqual(['fresh']);
    expect(d.removed).toEqual(['gone']);
    expect(d.changed).toEqual(['edit']);
    expect(d.unchanged).toEqual(['keep']);
  });

  it('有哈希时优先比哈希', () => {
    const prev = ledgerOf(entry({ id: 'x', hash: 'h1', bytes: 10 }));
    const next = ledgerOf(entry({ id: 'x', hash: 'h1', bytes: 999 }));
    expect(diffLedger(prev, next).unchanged).toEqual(['x']);
  });

  it('没有哈希时退化到比字节数', () => {
    const prev = ledgerOf(entry({ id: 'x', hash: null, bytes: 10 }));
    const next = ledgerOf(entry({ id: 'x', hash: null, bytes: 11 }));
    expect(diffLedger(prev, next).changed).toEqual(['x']);
  });

  it('path 或 mode 变了也算变化', () => {
    const prev = ledgerOf(entry({ id: 'x' }));
    const next = ledgerOf(entry({ id: 'x', path: 'assets/renamed.png' }));
    expect(diffLedger(prev, next).changed).toEqual(['x']);
  });
});

describe('detectPathConflicts', () => {
  it('两条记录指向同一个文件时报出来', () => {
    const l = ledgerOf(
      entry({ id: 'a/b', path: 'assets/ab.png' }),
      entry({ id: 'a:b', path: 'assets/ab.png' }),
    );
    const c = detectPathConflicts(l);
    expect(c).toHaveLength(1);
    expect(c[0]!.path).toBe('assets/ab.png');
    expect(c[0]!.ids.sort()).toEqual(['a/b', 'a:b']);
  });

  it('generated 素材没有 path，不参与冲突判定', () => {
    const l = ledgerOf(
      entry({ id: 'g1', mode: 'generated', path: null }),
      entry({ id: 'g2', mode: 'generated', path: null }),
    );
    expect(detectPathConflicts(l)).toHaveLength(0);
  });
});

describe('relinkPaths', () => {
  it('按 id 与原始文件名重算路径', () => {
    const l = ledgerOf(entry({ id: 'xyz', originName: 'photo.JPEG', path: 'assets/old.png' }));
    const out = relinkPaths(l);
    expect(out.entries.xyz!.path).toBe('assets/xyz.jpeg');
  });

  it('generated 素材的 path 保持 null', () => {
    const l = ledgerOf(entry({ id: 'g', mode: 'generated', path: null, originName: 'demo' }));
    expect(relinkPaths(l).entries.g!.path).toBeNull();
  });
});

describe('auditLedger', () => {
  const noop = async () => null;

  it('文件不在 → missing', async () => {
    const issues = await auditLedger(ledgerOf(entry()), noop);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'missing', severity: 'error', assetId: 'a' });
  });

  it('哈希对得上 → 无 issue', async () => {
    const issues = await auditLedger(ledgerOf(entry({ hash: 'abc' })), async () => ({ bytes: 10, hash: 'abc' }));
    expect(issues).toHaveLength(0);
  });

  it('哈希对不上 → changed', async () => {
    const issues = await auditLedger(ledgerOf(entry({ hash: 'abc' })), async () => ({ bytes: 10, hash: 'zzz' }));
    expect(issues[0]).toMatchObject({ kind: 'changed', severity: 'warning' });
  });

  it('只有弱指纹且大小变了 → changed', async () => {
    const issues = await auditLedger(ledgerOf(entry({ hash: null, bytes: 10 })), async () => ({ bytes: 12, hash: null }));
    expect(issues[0]).toMatchObject({ kind: 'changed' });
  });

  it('只有弱指纹且大小没变 → unhashed 提示（这是刻意的降级，要说出来）', async () => {
    const issues = await auditLedger(ledgerOf(entry({ hash: null, bytes: 10 })), async () => ({ bytes: 10, hash: null }));
    expect(issues[0]).toMatchObject({ kind: 'unhashed', severity: 'info' });
  });

  it('needHash 只在台账记了哈希时才是 true（省掉每次打开的全量重算）', async () => {
    const seen: boolean[] = [];
    await auditLedger(ledgerOf(entry({ id: 'h', hash: 'x' }), entry({ id: 'n', hash: null })), async (_p, needHash) => {
      seen.push(needHash);
      return { bytes: 10, hash: 'x' };
    });
    expect(seen).toEqual([true, false]);
  });

  it('generated 素材不查磁盘', async () => {
    let called = 0;
    await auditLedger(ledgerOf(entry({ mode: 'generated', path: null })), async () => {
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
