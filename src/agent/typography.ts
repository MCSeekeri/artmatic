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
import { SHAPE_KINDS, coerceTransform3DPatch, type TypographyDocument, type TypographyElement } from '../typography/document';
import { CUSTOM_CSS_ERROR_KEYS } from '../typography/animation';
import {
  addGeneratedShape,
  addImageElement,
  addShapeElement,
  addTextElement,
  applyLayout,
  coerceDocument,
  docView,
  elementViewById,
  findTextDoc,
  groupSelection,
  isShapeKind,
  normalizeAfterWrite,
  parseAnimationInput,
  patchElement,
  removeElement as removeOp,
  reorderElement as reorderOp,
  setAnimation as setAnimOp,
  setBackground as setBgOp,
  setTheme as setThemeOp,
  ungroupSelection,
  type CoerceReport,
  type LayoutRequest,
} from '../typography/agent-ops';
import { tr } from '../i18n/index.svelte';
import { ControlFailure } from './types';
import { measureDocument, type TypographyMeasure } from './typo-measure';
import type {
  TypographyDocIdView,
  TypographyDocView,
  TypographyElementInput,
  TypographyElementPatch,
  TypographyElementView,
  TypographyLayoutRequest,
} from './types';

const MAX_DOC_EDGE = 8192;
/** 一次批量写的上限（一条 undo 记录里的元素条数）。 */
const MAX_BATCH = 200;

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

function requireElement(store: ProjectStore, clipId: string, elementId: string): TypographyElement {
  const doc = requireDoc(store, clipId);
  const el = doc.elements.find((e) => e.id === elementId);
  if (!el) {
    throw new ControlFailure('not-found', tr('agent.typo.elementNotFound', { id: elementId }), { elementId });
  }
  return el;
}

/** 写后读回单个元素的 full 视图（写操作的返回值就是它）。 */
function viewOf(store: ProjectStore, clipId: string, elementId: string): TypographyElementView {
  const doc = findTextDoc(store.project, clipId);
  const view = doc ? elementViewById(doc, elementId) : null;
  if (!view) throw new ControlFailure('internal', tr('agent.typo.noDoc', { id: clipId }), { elementId });
  // `elementView` 的输出形状与 `TypographyElementView` 同源（前者是后者的超集）。
  return view as unknown as TypographyElementView;
}

/** 新增元素的**前置校验**（批量与单个共用；不合法时在改动之前抛）。 */
function validateNewInput(store: ProjectStore, input: TypographyElementInput): void {
  if (!input || typeof input !== 'object') {
    throw new ControlFailure('invalid-argument', tr('agent.args.notObject', { what: 'element' }));
  }
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
    // 其它图形的几何由参数生成，写路径字段是静默无效的（渲染侧根本不读）。
    if (
      input.shape !== 'svg' &&
      (input.path !== undefined || input.pathUnit !== undefined || input.clipFrame !== undefined)
    ) {
      throw new ControlFailure('invalid-argument', tr('agent.typo.pathNotSvg', { id: '(new element)' }));
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
  } else {
    throw new ControlFailure(
      'invalid-argument',
      tr('agent.typo.badElementKind', { kind: String((input as { kind?: unknown }).kind) }),
      { validIds: ['text', 'shape', 'image'] },
    );
  }
  if (input.transform3d !== undefined && input.transform3d !== null && !coerceTransform3DPatch(input.transform3d)) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.badTransform3d'), { transform3d: input.transform3d });
  }
  validateAnimationInput(input.animation, input.animations);
}

/**
 * 动画入参的前置校验。
 *
 * 为什么不靠 `animationFromInput` 的「返回 null」：那样非法输入会被**静默丢弃**，
 * 而模型看到的是「元素加上了、但动画没跑」，几乎不可能自己定位。这里在改动之前
 * 报错，并在 detail 里回显收到的值。
 *
 * 自定义 CSS 被拒时**必须带上原因**（`CustomCssError`）：花括号没配平与引用未定义
 * 的动画名要改的地方完全不同，只说一句「入参非法」等于让模型盲改字符串。
 */
function validateAnimationInput(animation: unknown, animations: unknown): void {
  const list = Array.isArray(animations) ? animations : animation !== undefined ? [animation] : [];
  for (const item of list) {
    if (item === null) continue;
    const parsed = parseAnimationInput(item);
    if (parsed.ok) continue;
    if (parsed.reason) {
      throw new ControlFailure(
        'invalid-argument',
        tr('agent.typo.badAnimationCss', { reason: tr(CUSTOM_CSS_ERROR_KEYS[parsed.reason]) }),
        { animation: item, reason: parsed.reason },
      );
    }
    throw new ControlFailure('invalid-argument', tr('agent.typo.badAnimation'), { animation: item });
  }
}

/**
 * `typo_update_element` 的补丁校验。**前置**：在 `commit` 之前跑完。
 *
 * 不做的后果不是「报错不清楚」而是「报错在 commit 里」：`patchElement` 抛的
 * 是裸 `Error`，穿过控制平面之后只剩一句 `internal`，模型完全看不出是自己写错了。
 * 另一个后果是**静默无效**：给非 svg 图形写 `path`、给图形写 `autoHeight`，
 * 渲染侧根本不读，而回执里那个字段还在（读的是旧值）。
 */
function validatePatch(el: TypographyElement, patch: Record<string, unknown>, elementId: string): void {
  if (patch.animation !== undefined || patch.addAnimation !== undefined) {
    validateAnimationInput(patch.animation, undefined);
    validateAnimationInput(patch.addAnimation, undefined);
  }
  if (patch.animations !== undefined) validateAnimationInput(undefined, patch.animations);

  if (patch.transform3d !== undefined && patch.transform3d !== null) {
    if (!coerceTransform3DPatch(patch.transform3d)) {
      throw new ControlFailure('invalid-argument', tr('agent.typo.badTransform3d'), {
        transform3d: patch.transform3d,
      });
    }
  }
  if (patch.autoHeight !== undefined && el.kind !== 'text') {
    throw new ControlFailure('invalid-argument', tr('agent.typo.autoHeightNotText', { id: elementId }));
  }
  // 路径三件套只对 svg 生效：写在别的图形上是静默无效（渲染侧根本不读）。
  if (patch.path !== undefined || patch.pathUnit !== undefined || patch.clipFrame !== undefined) {
    if (el.kind !== 'shape' || el.shape !== 'svg') {
      throw new ControlFailure('invalid-argument', tr('agent.typo.pathNotSvg', { id: elementId }));
    }
  }
  if (patch.path !== undefined && typeof patch.path !== 'string') {
    throw new ControlFailure('invalid-argument', tr('agent.typo.badText', { what: 'path' }));
  }
}

/** 在已拿到的文档上追加一个元素，返回新 id（调用点已在 commit 内）。 */
function appendInput(doc: TypographyDocument, input: TypographyElementInput): string {
  if (input.kind === 'text') return addTextElement(doc, input).id;
  if (input.kind === 'shape') return addShapeElement(doc, input).id;
  return addImageElement(doc, input).id;
}

/** 新增元素。三种 kind 的校验都在这里做完，再进 commit。 */
export function addElement(
  store: ProjectStore,
  clipId: string,
  input: TypographyElementInput,
): { elementId: string; element: TypographyElementView } {
  requireDoc(store, clipId);
  validateNewInput(store, input);

  let id = '';
  // 先算一次 id 会让后面的 commit 里拿不到工厂返回值，所以把工厂调用放在 commit 内。
  withDoc(store, clipId, `agent:typo_add_${input.kind}`, (d) => {
    id = appendInput(d, input);
  });
  if (!id) throw new ControlFailure('internal', tr('agent.typo.noDoc', { id: clipId }));
  return { elementId: id, element: viewOf(store, clipId, id) };
}

/**
 * 批量新增：**一次 commit = 一笔撤销**。
 *
 * 为什么必须有它：二十一个元素逐个调意味着二十一次往返 + 二十一次整工程快照
 * （`CommandStack` 每次 commit 都拍两份 JSON）。而 z 序由数组顺序决定，串行
 * 反而是唯一安全的写法 —— 批量接口把这个限制变成一次调用。
 */
export function addElements(
  store: ProjectStore,
  clipId: string,
  inputs: TypographyElementInput[],
): { elementIds: string[]; elements: TypographyElementView[] } {
  requireDoc(store, clipId);
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.batchEmpty', { what: 'elements' }));
  }
  if (inputs.length > MAX_BATCH) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.batchTooLarge', { max: MAX_BATCH }));
  }
  // 全部校验通过才动手：半途失败会留下「前三个加上了、第四个没有」。
  for (const input of inputs) validateNewInput(store, input);

  const ids: string[] = [];
  withDoc(store, clipId, 'agent:typo_add_elements', (d) => {
    for (const input of inputs) ids.push(appendInput(d, input));
  });
  if (ids.length !== inputs.length) {
    throw new ControlFailure('internal', tr('agent.typo.noDoc', { id: clipId }));
  }
  return { elementIds: ids, elements: ids.map((id) => viewOf(store, clipId, id)) };
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
): { elementId: string; element: TypographyElementView } {
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
  return { elementId: id, element: viewOf(store, clipId, id) };
}

export function updateElement(
  store: ProjectStore,
  clipId: string,
  elementId: string,
  patch: TypographyElementPatch,
): { changed: boolean; element: TypographyElementView } {
  const el = requireElement(store, clipId, elementId);
  validatePatch(el, patch as Record<string, unknown>, elementId);
  const changed = withDoc(store, clipId, 'agent:typo_update', (d) => {
    patchElement(d, elementId, patch as Record<string, unknown>);
  });
  return { changed, element: viewOf(store, clipId, elementId) };
}

/** 批量改属性：一次 commit、一次撤销；返回改后的完整元素视图。 */
export function updateElements(
  store: ProjectStore,
  clipId: string,
  updates: { elementId: string; patch: TypographyElementPatch }[],
): { changed: number; elements: TypographyElementView[] } {
  requireDoc(store, clipId);
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.batchEmpty', { what: 'updates' }));
  }
  if (updates.length > MAX_BATCH) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.batchTooLarge', { max: MAX_BATCH }));
  }
  for (const [i, update] of updates.entries()) {
    if (!update || typeof update !== 'object' || typeof update.elementId !== 'string') {
      throw new ControlFailure('invalid-argument', tr('agent.typo.badUpdate', { index: i }));
    }
    const el = requireElement(store, clipId, update.elementId);
    // 全部校验通过才动手：半途失败会留下「前三个改了、第四个没有」。
    validatePatch(el, (update.patch ?? {}) as Record<string, unknown>, update.elementId);
  }

  let changed = 0;
  withDoc(store, clipId, 'agent:typo_update_elements', (d) => {
    for (const update of updates) {
      if (patchElement(d, update.elementId, update.patch as Record<string, unknown>)) changed += 1;
    }
  });
  return { changed, elements: updates.map((u) => viewOf(store, clipId, u.elementId)) };
}

/**
 * 设置 / 清除 / 追加一个元素动画（`typo_set_animation`）。
 *
 * `input === null` 清空；`mode:'add'` 追加（一个元素可以叠多条动画：先 fade 再
 * shake 这类组合在渲染侧是**嵌套包装**，见 `typography/animation.ts` 文件头）。
 */
export function setElementAnimation(
  store: ProjectStore,
  clipId: string,
  elementId: string,
  input: unknown,
  mode: 'replace' | 'add',
): { changed: boolean; element: TypographyElementView } {
  requireElement(store, clipId, elementId);
  validateAnimationInput(input, undefined);
  const changed = withDoc(store, clipId, 'agent:typo_set_animation', (d) => {
    const el = d.elements.find((e) => e.id === elementId);
    if (!el) return;
    setAnimOp(el, input, mode);
  });
  return { changed, element: viewOf(store, clipId, elementId) };
}

export function setText(
  store: ProjectStore,
  clipId: string,
  elementId: string,
  text: string,
): { changed: boolean; element: TypographyElementView } {
  if (typeof text !== 'string') {
    throw new ControlFailure('invalid-argument', tr('agent.typo.badText', { what: 'text' }));
  }
  requireElement(store, clipId, elementId);
  const changed = withDoc(store, clipId, 'agent:typo_set_text', (d) => {
    patchElement(d, elementId, { text });
  });
  return { changed, element: viewOf(store, clipId, elementId) };
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
): { changed: boolean; z: number } {
  requireElement(store, clipId, elementId);
  const changed = withDoc(store, clipId, 'agent:typo_reorder', (d) => {
    reorderOp(d, elementId, op);
  });
  const doc = requireDoc(store, clipId);
  return { changed, z: doc.elements.findIndex((e) => e.id === elementId) };
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
export function layout(
  store: ProjectStore,
  clipId: string,
  req: TypographyLayoutRequest,
): { moved: number; elements: { id: string; frame: { x: number; y: number; w: number; h: number; rot: number } }[] } {
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
  // 回显**新的 frame**：布局是 agent 最容易「调了但不知道落到哪」的一类操作。
  const after = requireDoc(store, clipId);
  const frames = picked
    .map((id) => after.elements.find((e) => e.id === id))
    .filter((el): el is NonNullable<typeof el> => Boolean(el))
    .map((el) => ({ id: el.id, frame: { ...el.frame } }));
  return { moved, elements: frames };
}

/** 几何体检：文字内容高度 / 溢出 / 元素相交 / 出画。纯读，不写文档。 */
export function measure(store: ProjectStore, clipId: string, elementIds?: string[]): TypographyMeasure {
  const doc = requireDoc(store, clipId);
  if (elementIds && elementIds.length) {
    for (const id of elementIds) {
      if (!doc.elements.some((e) => e.id === id)) {
        throw new ControlFailure('not-found', tr('agent.typo.elementNotFound', { id }), { elementId: id });
      }
    }
  }
  return measureDocument(doc, clipId, { elementIds });
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
): { elements: number; dropped: number; droppedKeys: string[]; droppedAnimations: string[] } {
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
  const report: CoerceReport = { droppedKeys: [], droppedAnimations: [] };
  const next = coerceDocument(raw, doc, report);
  const rawCount = Array.isArray((raw as { elements?: unknown }).elements)
    ? ((raw as { elements: unknown[] }).elements.length)
    : 0;
  store.updateClip(clipId, 'agent:typo_replace_doc', (c) => {
    if (c.kind === 'source' && c.source.type === 'text') c.source.doc = next;
  });
  return {
    elements: next.elements.length,
    dropped: Math.max(0, rawCount - next.elements.length),
    // 未知键**必须报出来**：静默归一化会让模型照着一份「自己以为对」的文档继续做。
    droppedKeys: report.droppedKeys.slice(0, 100),
    // 动画条目单独一栏：它是合法键、坏内容，混进 droppedKeys 会误导成「键名写错」。
    droppedAnimations: report.droppedAnimations.slice(0, 50),
  };
}
