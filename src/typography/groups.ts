/**
 * groups.ts — 元素组合的纯函数（**不碰 DOM**）。
 *
 * ## 为什么不引入嵌套的 GroupElement
 *
 * 组合最自然的建模是「一个带 children 的元素」，但那会把本项目最值钱的一条
 * 不变量打碎：**z 序 = `elements` 数组下标**（document.ts 文件头）。嵌套之后
 * z 序要遍历树才能求，`buildStack` / 光栅化 / 命中测试 / 图层列表全都要跟着改，
 * 而它们现在都建立在「一个扁平数组、下标即层级」之上。
 *
 * 这里改成：**组合 = 一段连续的数组区间 + 一个共享的 groupId**。
 * 数组下标仍然是唯一的层级真源，代价只有一个 —— 成组时要把成员挪到一起。
 *
 * 组合自身不画内容，它是一层**共享的 CSS 外壳**（背景/边框/圆角/内边距），
 * 画在成员下面。于是「组合共享背景色、边框」是直接实现，成员本身还是普通元素。
 */

import { newId } from '../core/schema';
import type {
  Paint,
  Stroke,
  TypographyDocument,
  TypographyElement,
  TypographyGroup,
  ZOrderOp,
} from './document';
import { boundsOf, toRects, type Rect } from './geometry';

/** 组合表的读取口。老工程没有 `groups` 字段 —— 缺省语义就是「没有组合」。 */
export function groupList(doc: TypographyDocument): TypographyGroup[] {
  return doc.groups ?? [];
}

export function groupById(doc: TypographyDocument, id: string): TypographyGroup | null {
  return groupList(doc).find((g) => g.id === id) ?? null;
}

export function membersOf(doc: TypographyDocument, groupId: string): TypographyElement[] {
  return doc.elements.filter((e) => e.groupId === groupId);
}

/** 选区里出现的组合 id（去重，按数组顺序 = z 序）。 */
export function groupsInSelection(doc: TypographyDocument, ids: Iterable<string>): string[] {
  const sel = new Set(ids);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of doc.elements) {
    if (!sel.has(e.id) || !e.groupId || seen.has(e.groupId)) continue;
    seen.add(e.groupId);
    out.push(e.groupId);
  }
  return out;
}

/** 这个组合是不是**整个**都被选中了。 */
export function isGroupFullySelected(
  doc: TypographyDocument,
  groupId: string,
  ids: ReadonlySet<string>,
): boolean {
  const members = membersOf(doc, groupId);
  return members.length > 0 && members.every((m) => ids.has(m.id));
}

/**
 * 把选区扩成「整组」：选了组里任何一个成员，就等于选了整组。
 *
 * 这是所有组级操作（移动、对齐、层级、删除）的前置步骤 —— 在每一处各写一遍
 * 「再补上同组的其它成员」迟早会漏掉某一条路径，表现是「拖组合只拖走了一个元素」。
 */
export function expandToGroups(doc: TypographyDocument, ids: string[]): string[] {
  const out = new Set(ids);
  for (const gid of groupsInSelection(doc, ids)) {
    for (const m of membersOf(doc, gid)) out.add(m.id);
  }
  // 保序（z 序有意义：后选中的最后绘制）。
  return doc.elements.filter((e) => out.has(e.id)).map((e) => e.id);
}

/**
 * 组合外框（**含内边距**）。返回 null 表示这个组没有任何可见成员 —— 此时不画外壳。
 *
 * 用**未旋转**外接框，与吸附/对齐/选择框同一套口径（见 geometry.ts 的说明）。
 */
export function groupBox(doc: TypographyDocument, g: TypographyGroup): Rect | null {
  const visible = membersOf(doc, g.id).filter((m) => m.visible);
  if (!visible.length) return null;
  const b = boundsOf(toRects(visible));
  const p = Math.max(0, g.padding);
  return { id: g.id, x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 };
}

export function defaultGroup(name: string): TypographyGroup {
  return { id: newId(), name, fill: { kind: 'none' }, stroke: null, radius: 0, padding: 8 };
}

/**
 * 成组。
 *
 * 成员在数组里被挪成**连续的一段**，位置取**最前景那个成员**原来的位置 ——
 * 设计工具（Figma / PPT）都是这个语义：成组不把组拽到最前面，也不把它压到最底，
 * 而是以最高的那个成员为准。成员之间的相对顺序保持不变。
 */
export function groupElements(
  doc: TypographyDocument,
  ids: string[],
  name: string,
): TypographyDocument {
  const sel = new Set(ids);
  const members = doc.elements.filter((e) => sel.has(e.id) && !e.locked);
  if (members.length < 2) return doc;

  const g = defaultGroup(name);
  const memberIds = new Set(members.map((m) => m.id));
  for (const e of members) e.groupId = g.id;

  // 插入点：原数组里「最前景成员」之前的、不属于本组的元素个数。
  let topIndex = -1;
  for (let i = 0; i < doc.elements.length; i++) if (memberIds.has(doc.elements[i]!.id)) topIndex = i;
  let insertAt = 0;
  for (let i = 0; i < topIndex; i++) if (!memberIds.has(doc.elements[i]!.id)) insertAt += 1;

  const kept = doc.elements.filter((e) => !memberIds.has(e.id));
  const block = doc.elements.filter((e) => memberIds.has(e.id));
  return {
    ...doc,
    elements: [...kept.slice(0, insertAt), ...block, ...kept.slice(insertAt)],
    groups: [...groupList(doc), g],
  };
}

/**
 * 解组。只在**选区涉及的**那些组上生效，其余组不受影响。
 * 解组后成员留在原位置（不改变数组顺序 —— 它们本来就是连续的）。
 */
export function ungroupElements(doc: TypographyDocument, ids: string[]): TypographyDocument {
  const gids = new Set(groupsInSelection(doc, ids));
  if (!gids.size) return doc;
  for (const e of doc.elements) if (e.groupId && gids.has(e.groupId)) delete e.groupId;
  return { ...doc, groups: groupList(doc).filter((g) => !gids.has(g.id)) };
}

/** 改组合的共享样式（局部更新，只写要覆盖的键）。 */
export function updateGroup(
  doc: TypographyDocument,
  groupId: string,
  patch: Partial<Omit<TypographyGroup, 'id'>>,
): TypographyDocument {
  return {
    ...doc,
    groups: groupList(doc).map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
  };
}

/**
 * 清掉「名不副实」的组合：成员少于 2 个，或成员在数组里已经不再连续。
 *
 * 什么时候会不连续：图层拖曳把组里的一个成员挪到了别处。与其在拖曳那一条路径上
 * 到处补判断，不如在每次写库之后统一收口 —— 表现是「拖散了就自动解组」，
 * 比「留下一个半坏不坏的组」清楚得多。
 */
export function pruneGroups(doc: TypographyDocument): TypographyDocument {
  const groups = groupList(doc);
  if (!groups.length) return doc;

  const broken = new Set<string>();
  for (const g of groups) {
    const idx: number[] = [];
    for (let i = 0; i < doc.elements.length; i++) {
      if (doc.elements[i]!.groupId === g.id) idx.push(i);
    }
    if (idx.length < 2 || idx[idx.length - 1]! - idx[0]! !== idx.length - 1) broken.add(g.id);
  }
  if (!broken.size) return doc;
  for (const e of doc.elements) if (e.groupId && broken.has(e.groupId)) delete e.groupId;
  return { ...doc, groups: groups.filter((g) => !broken.has(g.id)) };
}

/* ------------------------------------------------------------ 层级调整 */

/** 选区在数组里是不是连续的一段。 */
export function isContiguous(doc: TypographyDocument, ids: string[]): boolean {
  const sel = new Set(ids);
  const idx: number[] = [];
  for (let i = 0; i < doc.elements.length; i++) if (sel.has(doc.elements[i]!.id)) idx.push(i);
  if (idx.length < 2) return true;
  return idx[idx.length - 1]! - idx[0]! === idx.length - 1;
}

/**
 * 把整块**只挪一层**。
 *
 * 为什么不能直接用 `reorderElements` 的 forward/backward：那个实现是「逐个与
 * 相邻的未选中元素交换」。对连续的一段，只有最上面那个成员会真的换 ——
 * 结果是把整块**拆散**（[1,2,3] + 邻居 4 → [1,2,4,3]），成员不再连续，
 * 组合就散了。这里改成「把块外紧邻的那一个元素挪到块的另一侧」，
 * 整块作为单位移动。
 */
export function moveBlockOne(
  doc: TypographyDocument,
  ids: string[],
  dir: 1 | -1,
): TypographyDocument {
  const sel = new Set(ids);
  const next = doc.elements.slice();
  const idx: number[] = [];
  for (let i = 0; i < next.length; i++) if (sel.has(next[i]!.id)) idx.push(i);
  if (!idx.length) return doc;
  const s = idx[0]!;
  const e = idx[idx.length - 1]!;

  if (dir === 1) {
    if (e + 1 >= next.length) return doc;
    const [moved] = next.splice(e + 1, 1);
    next.splice(s, 0, moved!);
  } else {
    if (s - 1 < 0) return doc;
    const [moved] = next.splice(s - 1, 1);
    next.splice(e, 0, moved!);
  }
  return { ...doc, elements: next };
}

/** 层级调整的统一入口：连续选块走 `moveBlockOne`，散选走原实现。 */
export function reorderSelection(
  doc: TypographyDocument,
  ids: string[],
  op: ZOrderOp,
  plain: (d: TypographyDocument, ids: string[], op: ZOrderOp) => TypographyDocument,
): TypographyDocument {
  // front / back 对连续块天然正确（保持相对顺序），只有逐层移动需要分情况。
  if ((op === 'forward' || op === 'backward') && isContiguous(doc, ids)) {
    return moveBlockOne(doc, ids, op === 'forward' ? 1 : -1);
  }
  return plain(doc, ids, op);
}

/* ------------------------------------------------------------ 片段（复制 / 粘贴） */

/**
 * 一段可独立搬运的内容：元素 + 它们用到的组合定义。
 *
 * **组合定义必须跟着元素一起走。** 只带元素的话，粘贴出来的副本会共用原来的
 * groupId —— 于是「复制一组东西」变成了「把副本并进原来那一组里」，
 * 动一下组样式原件跟着变。剪贴板里存的就应该是这个结构。
 */
export interface GroupedFragment {
  elements: TypographyElement[];
  groups: TypographyGroup[];
}

/** 从文档里取出一段（含所属组合定义）。锁定元素被排除。 */
export function extractFragment(doc: TypographyDocument, ids: string[]): GroupedFragment {
  const unlocked = ids.filter((id) => {
    const el = doc.elements.find((e) => e.id === id);
    return el && !el.locked;
  });
  const set = new Set(expandToGroups(doc, unlocked));
  const elements = doc.elements.filter((e) => set.has(e.id) && !e.locked);
  const gids = new Set(elements.map((e) => e.groupId).filter((x): x is string => !!x));
  const groups = groupList(doc)
    .filter((g) => gids.has(g.id))
    .map((g) => structuredClone(g));
  return { elements: elements.map((e) => structuredClone(e)), groups };
}

/**
 * 复制片段并换掉全部身份（元素 id / 动画 id / **组合 id**）。
 *
 * `mkId` 由调用方注入（传 `newId`）—— 保持这个函数是纯的，可以在单测里
 * 用确定性 id 生成器钉住映射关系。
 */
export function cloneFragment(
  frag: GroupedFragment,
  offset: number,
  mkId: () => string,
): GroupedFragment {
  const gmap = new Map<string, string>();
  const groups = frag.groups.map((g) => {
    const id = mkId();
    gmap.set(g.id, id);
    return { ...g, id };
  });
  const elements = frag.elements.map((el) => {
    const copy = structuredClone(el) as TypographyElement;
    copy.id = mkId();
    if (offset) copy.frame = { ...copy.frame, x: copy.frame.x + offset, y: copy.frame.y + offset };
    copy.animations = copy.animations.map((a) => ({ ...a, id: mkId() }));
    if (copy.groupId) {
      const next = gmap.get(copy.groupId);
      if (next) copy.groupId = next;
      else delete copy.groupId; // 组定义没跟着来（老数据）→ 当成散元素，别落进原组
    }
    return copy;
  });
  return { elements, groups };
}

/* ------------------------------------------------------------ 图层面板的行 */

export type LayerRow =
  | { kind: 'group'; id: string; group: TypographyGroup; memberIds: string[]; expanded: boolean }
  | { kind: 'element'; id: string; el: TypographyElement; inGroup: boolean };

/**
 * 图层列表的行模型（**从前到后** = 数组倒序）。
 *
 * 组合默认**折叠**：它的成员不单独出行，只出一个组行。展开时成员缩进排在组行下面。
 * 放在这里而不是组件里，是为了让「组内成员按 z 序、组行占最前景成员的位置」
 * 这些规则能被单测钉住，不用起浏览器。
 */
export function layerRows(doc: TypographyDocument, expanded: ReadonlySet<string>): LayerRow[] {
  const out: LayerRow[] = [];
  const done = new Set<string>();
  for (let i = doc.elements.length - 1; i >= 0; i--) {
    const el = doc.elements[i]!;
    const gid = el.groupId;
    if (!gid) {
      out.push({ kind: 'element', id: el.id, el, inGroup: false });
      continue;
    }
    if (done.has(gid)) continue;
    done.add(gid);
    const g = groupById(doc, gid);
    if (!g) {
      // 组表里没有它（老数据 / 刚被 prune 掉）—— 当成普通元素，不要凭空造一个组行。
      out.push({ kind: 'element', id: el.id, el, inGroup: false });
      continue;
    }
    const members = membersOf(doc, gid).slice().reverse();
    const isOpen = expanded.has(gid);
    out.push({ kind: 'group', id: gid, group: g, memberIds: members.map((m) => m.id), expanded: isOpen });
    if (isOpen) {
      for (const m of members) out.push({ kind: 'element', id: m.id, el: m, inGroup: true });
    }
  }
  return out;
}

/** 组行的显示名：优先用文档里给的，其次用第一个能看到内容的成员。 */
export function groupLabel(doc: TypographyDocument, g: TypographyGroup): string {
  const members = membersOf(doc, g.id);
  const names = members.map((m) => m.name).filter(Boolean);
  return names.length ? names.join(' · ') : g.name;
}

/** 组合共享的 Paint 当前值（Ribbon 控件的显示值来源）。 */
export function groupFillOf(g: TypographyGroup | null): Paint {
  return g?.fill ?? { kind: 'none' };
}

export function groupStrokeOf(g: TypographyGroup | null): Stroke | null {
  return g?.stroke ?? null;
}
