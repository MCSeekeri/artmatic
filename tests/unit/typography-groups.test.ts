import { describe, expect, it } from 'vitest';
import {
  cloneFragment,
  expandToGroups,
  extractFragment,
  groupBox,
  groupElements,
  groupList,
  groupsInSelection,
  isContiguous,
  isGroupFullySelected,
  layerRows,
  membersOf,
  moveBlockOne,
  pruneGroups,
  ungroupElements,
} from '../../src/typography/groups';
import { createShapeElement, createTextElement, type TypographyDocument } from '../../src/typography/document';

const SIZE = { w: 1920, h: 1080 };

/** 造一个文档：元素名就是它的身份，断言里可直接读名字。 */
function makeDoc(names: string[]): TypographyDocument {
  const elements = names.map((n, i) =>
    i % 2 === 0
      ? createTextElement(SIZE, { name: n, frame: { x: i * 100, y: i * 50, w: 200, h: 60, rot: 0 } })
      : createShapeElement(SIZE, 'rect', { name: n, frame: { x: i * 100, y: i * 50, w: 80, h: 80, rot: 0 } }),
  );
  return { size: SIZE, background: { kind: 'none' }, elements, fonts: [], groups: [] };
}

const order = (doc: TypographyDocument): string[] => doc.elements.map((e) => e.name);
const idOf = (doc: TypographyDocument, name: string): string =>
  doc.elements.find((e) => e.name === name)!.id;
const ids = (doc: TypographyDocument, names: string[]): string[] => names.map((n) => idOf(doc, n));

/** 造一个确定性 id 生成器，让「组合 id 被换掉」这类断言可读。 */
function counter(prefix = 'g'): () => string {
  let i = 0;
  return () => `${prefix}${++i}`;
}

describe('groupElements', () => {
  it('成员被挪成连续的一段，位置取最前景那个成员', () => {
    const doc = makeDoc(['a', 'b', 'c', 'd']);
    const next = groupElements(doc, ids(doc, ['a', 'c']), '组合');
    // 原来是 a b c d；a 与 c 成组，最前景是 c（下标 2）⇒ 块落在 b 之后
    expect(order(next)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('块内保持原有相对顺序（z 序不乱）', () => {
    const doc = makeDoc(['a', 'b', 'c', 'd', 'e']);
    const next = groupElements(doc, ids(doc, ['d', 'a']), '组合');
    const a = next.elements.findIndex((x) => x.name === 'a');
    const d = next.elements.findIndex((x) => x.name === 'd');
    expect(a).toBeLessThan(d);
  });

  it('少于两个元素时原样返回（不成组）', () => {
    const doc = makeDoc(['a', 'b']);
    const next = groupElements(doc, ids(doc, ['a']), '组合');
    expect(next).toBe(doc);
    expect(groupList(next)).toHaveLength(0);
  });

  it('锁定元素不参与（否则它会被拖进一个它不能被改的组里）', () => {
    const doc = makeDoc(['a', 'b', 'c']);
    doc.elements[1]!.locked = true;
    const next = groupElements(doc, ids(doc, ['a', 'b']), '组合');
    expect(next).toBe(doc);
  });

  it('成员共享同一个 groupId，且组表里有一条定义', () => {
    const doc = makeDoc(['a', 'b']);
    const next = groupElements(doc, ids(doc, ['a', 'b']), '组合');
    const g = groupList(next)[0]!;
    expect(next.elements.every((e) => e.groupId === g.id)).toBe(true);
    expect(membersOf(next, g.id)).toHaveLength(2);
    expect(isContiguous(next, next.elements.map((e) => e.id))).toBe(true);
  });
});

describe('ungroupElements', () => {
  it('只解掉选区涉及的组', () => {
    const doc = makeDoc(['a', 'b', 'c', 'd']);
    const g1 = groupElements(doc, ids(doc, ['a', 'b']), 'G1');
    const g2 = groupElements(g1, ids(g1, ['c', 'd']), 'G2');
    expect(groupList(g2)).toHaveLength(2);

    const next = ungroupElements(g2, ids(g2, ['a']));
    expect(groupList(next)).toHaveLength(1);
    expect(next.elements.find((e) => e.name === 'a')!.groupId).toBeUndefined();
    expect(next.elements.find((e) => e.name === 'c')!.groupId).toBeDefined();
  });

  it('对没有组的选区是 no-op（返回同一个对象）', () => {
    const doc = makeDoc(['a', 'b']);
    expect(ungroupElements(doc, ids(doc, ['a']))).toBe(doc);
  });
});

describe('选区与组的互相推导', () => {
  it('expandToGroups：选中一个成员 = 选中整组', () => {
    const doc0 = makeDoc(['a', 'b', 'c']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    const expanded = expandToGroups(doc, [idOf(doc, 'a')]);
    expect(new Set(expanded)).toEqual(new Set([idOf(doc, 'a'), idOf(doc, 'b')]));
  });

  it('groupsInSelection：按 z 序给出涉及的组', () => {
    const doc0 = makeDoc(['a', 'b', 'c', 'd']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    expect(groupsInSelection(doc, ids(doc, ['a', 'b', 'c']))).toEqual([groupList(doc)[0]!.id]);
  });

  it('isGroupFullySelected 要求**每个**成员都在集合里', () => {
    const doc0 = makeDoc(['a', 'b']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    const gid = groupList(doc)[0]!.id;
    expect(isGroupFullySelected(doc, gid, new Set(ids(doc, ['a']))) ).toBe(false);
    expect(isGroupFullySelected(doc, gid, new Set(ids(doc, ['a', 'b'])))).toBe(true);
  });
});

describe('groupBox', () => {
  it('外接框 = 成员外接框 + 内边距（四边都加）', () => {
    const doc0 = makeDoc(['a', 'b']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    const g = { ...groupList(doc)[0]!, padding: 10 };
    const box = groupBox({ ...doc, groups: [g] }, g)!;
    // a 在 (0,0,200,60)，b 在 (100,50,80,80) ⇒ 并集 (0,0)-(200,130)
    expect(box).toEqual({ id: g.id, x: -10, y: -10, w: 220, h: 150 });
  });

  it('成员全隐藏时返回 null（不在空处留一个孤零零的框）', () => {
    const doc0 = makeDoc(['a', 'b']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    for (const e of doc.elements) e.visible = false;
    const g = groupList(doc)[0]!;
    expect(groupBox(doc, g)).toBeNull();
  });
});

describe('pruneGroups', () => {
  it('成员少于 2 个的组被解掉', () => {
    const doc0 = makeDoc(['a', 'b']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    // 删掉一个成员
    doc.elements = doc.elements.filter((e) => e.name !== 'b');
    const next = pruneGroups(doc);
    expect(groupList(next)).toHaveLength(0);
    expect(next.elements[0]!.groupId).toBeUndefined();
  });

  it('成员在数组里不再连续时自动解组（图层拖散了就是这个场景）', () => {
    const doc0 = makeDoc(['a', 'b', 'c']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G'); // → a b c
    // 把 c 插到 a 与 b 之间 —— 成员被隔开
    const c = doc.elements.find((e) => e.name === 'c')!;
    doc.elements = [doc.elements[0]!, c, ...doc.elements.filter((e) => e.name !== 'c' && e.name !== 'a')];
    expect(order(doc)).toEqual(['a', 'c', 'b']);
    expect(isContiguous(doc, nextIds(doc))).toBe(false);
    const next = pruneGroups(doc);
    expect(groupList(next)).toHaveLength(0);
    expect(next.elements.every((e) => e.groupId === undefined)).toBe(true);
  });

  it('完好的组不被误伤（返回同一个对象，便于调用方判「有没有变」）', () => {
    const doc0 = makeDoc(['a', 'b']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    expect(pruneGroups(doc)).toBe(doc);
  });
});

function nextIds(doc: TypographyDocument): string[] {
  const gid = doc.elements.find((e) => e.groupId)?.groupId;
  return gid ? membersOf(doc, gid).map((m) => m.id) : [];
}

describe('moveBlockOne', () => {
  it('上移一层：整块与上面那一个元素换位，成员仍然连续', () => {
    const doc0 = makeDoc(['a', 'b', 'c', 'd']);
    const doc = groupElements(doc0, ids(doc0, ['b', 'c']), 'G'); // a b c d（已经连续）
    const gids = nextIds(doc);
    // 块是 [b,c]，上面紧邻的是 d ⇒ 把 d 挪到块的下面
    const next = moveBlockOne(doc, gids, 1);
    expect(order(next)).toEqual(['a', 'd', 'b', 'c']);
    expect(isContiguous(next, gids)).toBe(true);
    // 顺序必须真的变了 —— 这条防止「函数是 no-op 但断言恰好也过」
    expect(order(next)).not.toEqual(order(doc));
  });

  it('逐层上移最终把整块带到最前，且成员始终连续', () => {
    const doc0 = makeDoc(['a', 'b', 'c', 'd']);
    let doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    const gids = nextIds(doc);
    for (let i = 0; i < 5; i++) {
      doc = moveBlockOne(doc, gids, 1);
      expect(isContiguous(doc, gids)).toBe(true);
    }
    expect(order(doc).slice(-2)).toEqual(['a', 'b']);
  });

  it('逐层下移最终把整块带到最底', () => {
    const doc0 = makeDoc(['a', 'b', 'c', 'd']);
    let doc = groupElements(doc0, ids(doc0, ['c', 'd']), 'G');
    const gids = nextIds(doc);
    for (let i = 0; i < 5; i++) doc = moveBlockOne(doc, gids, -1);
    expect(order(doc).slice(0, 2)).toEqual(['c', 'd']);
  });

  it('贴到边界时是 no-op（返回原对象）', () => {
    const doc0 = makeDoc(['a', 'b']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    const gids = nextIds(doc);
    expect(moveBlockOne(doc, gids, 1)).toBe(doc);
    expect(moveBlockOne(doc, gids, -1)).toBe(doc);
  });
});

describe('片段复制（组合必须一起被复制）', () => {
  it('extractFragment 连组合定义一起带走', () => {
    const doc0 = makeDoc(['a', 'b', 'c']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    const frag = extractFragment(doc, [idOf(doc, 'a')]);
    expect(frag.elements).toHaveLength(2);
    expect(frag.groups).toHaveLength(1);
  });

  it('cloneFragment 给副本**换掉组合 id** —— 复制一组不会把副本并进原来那一组', () => {
    const doc0 = makeDoc(['a', 'b']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    const frag = extractFragment(doc, doc.elements.map((e) => e.id));
    const clone = cloneFragment(frag, 24, counter());
    const originalGid = frag.groups[0]!.id;
    const cloneGid = clone.groups[0]!.id;
    expect(cloneGid).not.toBe(originalGid);
    expect(clone.elements.every((e) => e.groupId === cloneGid)).toBe(true);
    // 元素 id / 动画 id 也全部换新
    expect(clone.elements.map((e) => e.id)).not.toEqual(frag.elements.map((e) => e.id));
  });

  it('偏移只作用于几何，不改相对位置', () => {
    const doc0 = makeDoc(['a', 'b']);
    const doc0b = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    const frag = extractFragment(doc0b, doc0b.elements.map((e) => e.id));
    const clone = cloneFragment(frag, 24, counter());
    expect(clone.elements[0]!.frame.x).toBe(frag.elements[0]!.frame.x + 24);
    expect(clone.elements[1]!.frame.x - clone.elements[0]!.frame.x).toBe(
      frag.elements[1]!.frame.x - frag.elements[0]!.frame.x,
    );
  });

  it('组定义没跟着来时把 groupId 丢掉，而不是落进原组', () => {
    const doc0 = makeDoc(['a', 'b']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    const frag = { elements: doc.elements.map((e) => structuredClone(e)), groups: [] };
    const clone = cloneFragment(frag, 0, counter());
    expect(clone.elements.every((e) => e.groupId === undefined)).toBe(true);
  });
});

describe('layerRows', () => {
  it('折叠时只出一个组行；展开时成员缩进排在其后', () => {
    const doc0 = makeDoc(['a', 'b', 'c']);
    const doc = groupElements(doc0, ids(doc0, ['a', 'b']), 'G');
    const gid = groupList(doc)[0]!.id;

    // 数组顺序 a b c ⇒ 从前到后是 c、然后才是组（a/b 在后面）。
    const collapsed = layerRows(doc, new Set());
    expect(collapsed.map((r) => (r.kind === 'group' ? 'G' : r.el.name))).toEqual(['c', 'G']);

    // 展开：组行在前，成员按 z 序**从前往后**（b 盖着 a）。
    const opened = layerRows(doc, new Set([gid]));
    expect(opened.map((r) => (r.kind === 'group' ? 'G' : r.el.name))).toEqual(['c', 'G', 'b', 'a']);
  });

  it('列表是**从前到后**：数组末尾的元素排在最前', () => {
    const doc = makeDoc(['a', 'b', 'c']);
    expect(layerRows(doc, new Set()).map((r) => (r.kind === 'element' ? r.el.name : '?'))).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('组表里没有的 groupId 当成普通元素，不凭空造组行', () => {
    const doc = makeDoc(['a', 'b']);
    doc.elements[0]!.groupId = 'ghost';
    const rows = layerRows(doc, new Set());
    expect(rows.every((r) => r.kind === 'element')).toBe(true);
  });
});
