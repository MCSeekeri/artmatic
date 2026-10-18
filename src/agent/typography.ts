/**
 * typography.ts — 控制平面的**排版文档操作**（写时间轴上的文本片段内容）。
 *
 * 与 `ui/typography/actions.ts` 的区别：那边输入是「当前选择集 + Ribbon 控件」，
 * 这边输入是「明确的元素 id + 完整参数」。两者共用 `typography/agent-ops.ts`
 * 的工厂与几何函数，所以 agent 做出来的文档与手点出来的是同构的。
 *
 * ## 纪律
 *
 * 1. **每一笔写操作只产生一笔撤销**（`store.commit` 一次）。
 * 2. **校验前置**：参数不合法时在改动之前抛 `ControlFailure`，绝不半途修改。
 * 3. **不 import `ui/`**：`findTextDoc` 已经从 `editor-state` 下沉到
 *    `typography/agent-ops.ts`，那边只保留一个转导出。
 * 4. 写之前宿主会调 `ctx.stopTextEditing()`（见 control-plane 的 `beforeWrite`）
 *    —— 否则正在打的字会在下一次编辑器提交时把 agent 的改动覆盖掉。
 */

import type { ProjectStore } from '../core/project-store';
import { SHAPE_KINDS, type TypographyDocument } from '../typography/document';
import {
  addGeneratedShape,
  addImageElement,
  addShapeElement,
  addTextElement,
  applyLayout,
  coerceDocument,
  findTextDoc,
  groupSelection,
  isShapeKind,
  normalizeAfterWrite,
  patchElement,
  removeElement as removeOp,
  reorderElement as reorderOp,
  setBackground as setBgOp,
  setTheme as setThemeOp,
  ungroupSelection,
  docView,
  type LayoutRequest,
} from '../typography/agent-ops';
import { tr } from '../i18n/index.svelte';
import { ControlFailure } from './types';
import type {
  TypographyDocIdView,
  TypographyDocView,
  TypographyElementInput,
  TypographyElementPatch,
  TypographyLayoutRequest,
} from './types';

const MAX_DOC_EDGE = 8192;

/* --------------------------------------------------------------- 读取 */

export function requireDoc(store: ProjectStore, clipId: string): TypographyDocument {
  const doc = findTextDoc(store.project, clipId);
  if (!doc) {
    const clip = store.findClip(clipId);
    if (!clip) throw new ControlFailure('not-found', tr('agent.clip.notFound', { id: clipId }), { clipId });
    throw new ControlFailure('unsupported', tr('agent.typo.notText', { id: clipId }), { clipId });
  }
  return doc;
}

export function getDoc(
  store: ProjectStore,
  clipId: string,
  detail: 'ids' | 'full',
): TypographyDocView | TypographyDocIdView {
  const doc = requireDoc(store, clipId);
  return docView(doc, clipId, detail) as unknown as TypographyDocView | TypographyDocIdView;
}

/* --------------------------------------------------------------- 写入 */

/**
 * 在 `store.commit` 里拿**当前**文档（撤销 / 重做会换掉整个 project 对象，
 * 所以在提交前抓到的那份只用来校验，不能拿它改）。
 */
function withDoc(store: ProjectStore, clipId: string, label: string, fn: (doc: TypographyDocument) => void): boolean {
  return store.commit(label, (p) => {
    const doc = findTextDoc(p, clipId);
    if (!doc) return;
    fn(doc);
    normalizeAfterWrite(doc);
  });
}

function requireElement(store: ProjectStore, clipId: string, elementId: string): void {
  const doc = requireDoc(store, clipId);
  if (!doc.elements.some((e) => e.id === elementId)) {
    throw new ControlFailure('not-found', tr('agent.typo.elementNotFound', { id: elementId }), { elementId });
  }
}

/** 新增元素。三种 kind 的校验都在这里做完，再进 commit。 */
export function addElement(
  store: ProjectStore,
  clipId: string,
  input: TypographyElementInput,
): { elementId: string } {
  requireDoc(store, clipId);

  if (input.kind === 'text') {
    if (typeof input.text !== 'string') {
      throw new ControlFailure('invalid-argument', tr('agent.typo.badText', { what: 'text' }));
    }
  } else if (input.kind === 'shape') {
    if (!isShapeKind(input.shape)) {
      throw new ControlFailure('invalid-argument', tr('agent.typo.badShape', { shape: String(input.shape) }), {
        validIds: SHAPE_KINDS,
      });
    }
  } else if (input.kind === 'image') {
    if (!input.assetId) {
      throw new ControlFailure('invalid-argument', tr('agent.typo.needAsset'));
    }
    const inProject = Boolean(store.project.assets[input.assetId]);
    if (!inProject) {
      throw new ControlFailure('not-found', tr('agent.asset.notFound', { id: input.assetId }), {
        validIds: Object.keys(store.project.assets),
      });
    }
  }

  let id = '';
  // 先算一次 id 会让后面的 commit 里拿不到工厂返回值，所以把工厂调用放在 commit 内。
  withDoc(store, clipId, `agent:typo_add_${input.kind}`, (d) => {
    if (input.kind === 'text') {
      id = addTextElement(d, input).id;
    } else if (input.kind === 'shape') {
      id = addShapeElement(d, input).id;
    } else {
      id = addImageElement(d, input).id;
    }
  });
  if (!id) throw new ControlFailure('internal', tr('agent.typo.noDoc', { id: clipId }));
  return { elementId: id };
}

/** 按生成器 id 造一个程序化图形。 */
export function addGenerated(
  store: ProjectStore,
  clipId: string,
  input: {
    genId: string;
    params?: Record<string, number | string>;
    seed?: number;
    frame?: { x?: number; y?: number; w?: number; h?: number; rot?: number };
    name?: string;
    fill?: unknown;
    stroke?: unknown;
  },
): { elementId: string } {
  requireDoc(store, clipId);
  let id = '';
  withDoc(store, clipId, 'agent:typo_add_shape', (d) => {
    try {
      id = addGeneratedShape(d, input).id;
    } catch (e) {
      throw new ControlFailure('not-found', tr('agent.typo.badGen', { id: input.genId }), {
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });
  if (!id) throw new ControlFailure('internal', tr('agent.typo.noDoc', { id: clipId }));
  return { elementId: id };
}

export function updateElement(
  store: ProjectStore,
  clipId: string,
  elementId: string,
  patch: TypographyElementPatch,
): boolean {
  requireElement(store, clipId, elementId);
  return withDoc(store, clipId, 'agent:typo_update', (d) => {
    patchElement(d, elementId, patch as Record<string, unknown>);
  });
}

export function setText(
  store: ProjectStore,
  clipId: string,
  elementId: string,
  text: string,
): boolean {
  if (typeof text !== 'string') {
    throw new ControlFailure('invalid-argument', tr('agent.typo.badText', { what: 'text' }));
  }
  requireElement(store, clipId, elementId);
  return withDoc(store, clipId, 'agent:typo_set_text', (d) => {
    patchElement(d, elementId, { text });
  });
}

export function removeElement(store: ProjectStore, clipId: string, elementId: string): boolean {
  requireElement(store, clipId, elementId);
  return withDoc(store, clipId, 'agent:typo_remove', (d) => {
    removeOp(d, elementId);
  });
}

export function reorderElement(
  store: ProjectStore,
  clipId: string,
  elementId: string,
  op: 'front' | 'back' | 'forward' | 'backward',
): boolean {
  requireElement(store, clipId, elementId);
  return withDoc(store, clipId, 'agent:typo_reorder', (d) => {
    reorderOp(d, elementId, op);
  });
}

export function groupElements(
  store: ProjectStore,
  clipId: string,
  elementIds: string[],
  name: string,
): { groupId: string | null } {
  requireDoc(store, clipId);
  let groupId: string | null = null;
  withDoc(store, clipId, 'agent:typo_group', (d) => {
    groupId = groupSelection(d, elementIds, name || 'group');
  });
  return { groupId };
}

export function ungroupElements(store: ProjectStore, clipId: string, elementIds: string[]): boolean {
  requireDoc(store, clipId);
  return withDoc(store, clipId, 'agent:typo_ungroup', (d) => {
    ungroupSelection(d, elementIds);
  });
}

/** 对齐 / 分布 / 网格 / 行列。 */
export function layout(store: ProjectStore, clipId: string, req: TypographyLayoutRequest): { moved: number } {
  const doc = requireDoc(store, clipId);
  const picked = req.elementIds && req.elementIds.length ? req.elementIds : doc.elements.map((e) => e.id);
  if (picked.length === 0) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.noElements'));
  }
  for (const id of picked) {
    if (!doc.elements.some((e) => e.id === id)) {
      throw new ControlFailure('not-found', tr('agent.typo.elementNotFound', { id }));
    }
  }
  if (req.op === 'distribute' && picked.length < 3) {
    throw new ControlFailure(
      'invalid-argument',
      tr('agent.typo.badLayout', { detail: tr('agent.typo.distributeMin') }),
    );
  }
  if (req.op === 'grid' && !(req.cols >= 1)) {
    throw new ControlFailure(
      'invalid-argument',
      tr('agent.typo.badLayout', { detail: tr('agent.typo.badCols') }),
    );
  }

  let moved = 0;
  withDoc(store, clipId, 'agent:typo_layout', (d) => {
    moved = applyLayout(d, req as LayoutRequest);
  });
  return { moved };
}

export function setBackground(store: ProjectStore, clipId: string, paint: unknown): boolean {
  requireDoc(store, clipId);
  return withDoc(store, clipId, 'agent:typo_background', (d) => {
    setBgOp(d, paint);
  });
}

export function setTheme(store: ProjectStore, clipId: string, theme: string | null): boolean {
  requireDoc(store, clipId);
  return withDoc(store, clipId, 'agent:typo_theme', (d) => {
    setThemeOp(d, theme);
  });
}

/**
 * 整体替换文档（路径 B）。
 *
 * 与 `loadScene` 同一条思路：agent 生成一份完整文档比逐元素调 40 次更自然，
 * 而 `coerceDocument` 保证坏数据降级而不是把工程卡住。
 */
export function replaceDoc(
  store: ProjectStore,
  clipId: string,
  raw: unknown,
): { elements: number; dropped: number } {
  const doc = requireDoc(store, clipId);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.docNotObject'));
  }
  const rawSize = (raw as { size?: unknown }).size;
  if (rawSize && typeof rawSize === 'object') {
    const w = Number((rawSize as { w?: unknown }).w);
    const h = Number((rawSize as { h?: unknown }).h);
    if (Number.isFinite(w) && Number.isFinite(h) && (w > MAX_DOC_EDGE || h > MAX_DOC_EDGE)) {
      throw new ControlFailure('invalid-argument', tr('agent.typo.widthTooLarge', { w, h, max: MAX_DOC_EDGE }));
    }
  }
  const next = coerceDocument(raw, doc);
  const rawCount = Array.isArray((raw as { elements?: unknown }).elements)
    ? ((raw as { elements: unknown[] }).elements.length)
    : 0;
  store.updateClip(clipId, 'agent:typo_replace_doc', (c) => {
    if (c.kind === 'source' && c.source.type === 'text') c.source.doc = next;
  });
  return { elements: next.elements.length, dropped: Math.max(0, rawCount - next.elements.length) };
}
