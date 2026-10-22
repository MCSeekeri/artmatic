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

import { newId } from '../core/schema';
import { coerceKeySettings, coerceQuadCorners } from '../core/image-fx';
import type { ProjectStore } from '../core/project-store';
import { SHAPE_KINDS, coerceTransform3DPatch, type TypographyDocument, type TypographyElement } from '../typography/document';
import { CUSTOM_CSS_ERROR_KEYS } from '../typography/animation';
import {
  isKnownTheme,
  mergeThemeColors,
  themeById,
  themeDisplayName,
  themeIds,
  type TypographyTheme,
} from '../typography/theme';
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
  groupView,
  isShapeKind,
  moveElementTo,
  normalizeAfterWrite,
  PAINT_KINDS,
  parseAnimationInput,
  patchElement,
  removeElement as removeOp,
  reorderElement as reorderOp,
  setAnimation as setAnimOp,
  setBackground as setBgOp,
  setDocSize,
  setTheme as setThemeOp,
  ungroupSelection,
  updateGroup as updateGroupOp,
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

/** 对象判据（与 agent-ops 里的同名工具同义；那边不可导出内部小工具）。 */
function isRecordLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

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
    if (input.key !== undefined && input.key !== null && !coerceKeySettings(input.key)) {
      throw new ControlFailure('invalid-argument', tr('agent.clip.badKey'), { key: input.key });
    }
    if (input.quad !== undefined && input.quad !== null && !coerceQuadCorners(input.quad)) {
      throw new ControlFailure('invalid-argument', tr('agent.clip.badQuad'), { quad: input.quad });
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
  // 抠图 / 四角只存在于图片元素：形状不对时要报错，不能靠 patchElement 静默忽略。
  if ((patch.key !== undefined || patch.quad !== undefined) && el.kind !== 'image') {
    throw new ControlFailure('invalid-argument', tr('agent.typo.keyNotImage', { id: elementId }));
  }
  if (patch.key !== undefined && patch.key !== null) {
    if (!coerceKeySettings(patch.key, el.kind === 'image' ? el.key : undefined)) {
      throw new ControlFailure('invalid-argument', tr('agent.clip.badKey'), { key: patch.key });
    }
  }
  if (patch.quad !== undefined && patch.quad !== null && !coerceQuadCorners(patch.quad)) {
    throw new ControlFailure('invalid-argument', tr('agent.clip.badQuad'), { quad: patch.quad });
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
  op: 'front' | 'back' | 'forward' | 'backward' | 'index',
  index?: number,
): { changed: boolean; z: number } {
  requireElement(store, clipId, elementId);
  if (op === 'index' && !Number.isFinite(Number(index))) {
    throw new ControlFailure('invalid-argument', tr('agent.args.notFinite', { what: 'index', key: 'index' }));
  }
  const changed = withDoc(store, clipId, 'agent:typo_reorder', (d) => {
    if (op === 'index') moveElementTo(d, elementId, Number(index));
    else reorderOp(d, elementId, op);
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

/**
 * 改分组底板（组名 / 填充 / 边框 / 圆角 / 内边距）。
 *
 * 分组自带一块外壳，但「成组」只是把它建出来；不把这块壳暴露出去的话，agent 造
 * 出来的组永远是「什么都没有」的一层（`fill:none` + `stroke:null` + `padding:8`）。
 */
export function updateGroupBox(
  store: ProjectStore,
  clipId: string,
  groupId: string,
  patch: Record<string, unknown>,
): { changed: boolean; group: Record<string, unknown> } {
  const doc = requireDoc(store, clipId);
  const group = (doc.groups ?? []).find((g) => g.id === groupId);
  if (!group) {
    throw new ControlFailure('not-found', tr('agent.typo.groupNotFound', { id: groupId }), {
      validIds: (doc.groups ?? []).map((g) => g.id),
    });
  }
  if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
    throw new ControlFailure('invalid-argument', tr('agent.args.emptyPatch', { what: 'patch' }));
  }
  if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim())) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.badText', { what: 'name' }));
  }
  if (patch.fill !== undefined) {
    const kind = (patch.fill as { kind?: unknown } | null)?.kind;
    if (!isRecordLike(patch.fill) || typeof kind !== 'string' || !PAINT_KINDS.has(kind)) {
      throw new ControlFailure('invalid-argument', tr('agent.typo.badPaint'), { fill: patch.fill });
    }
  }
  if (patch.stroke !== undefined && patch.stroke !== null && !isRecordLike(patch.stroke)) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.badStroke'), { stroke: patch.stroke });
  }
  for (const key of ['radius', 'padding'] as const) {
    if (patch[key] !== undefined && !(Number(patch[key]) >= 0)) {
      throw new ControlFailure('invalid-argument', tr('agent.args.notFinite', { what: 'patch', key }));
    }
  }
  const changed = withDoc(store, clipId, 'agent:typo_group_box', (d) => {
    updateGroupOp(d, groupId, patch);
  });
  const after = (requireDoc(store, clipId).groups ?? []).find((g) => g.id === groupId);
  return { changed, group: after ? groupView(after) : {} };
}

/** 改画幅（`scaleContent` = 过 `resizeDocument`，元素 / 字号 / 描边一起缩放）。 */
export function setCanvasSize(
  store: ProjectStore,
  clipId: string,
  size: { w: number; h: number },
  scaleContent: boolean,
): { changed: boolean; size: { w: number; h: number } } {
  requireDoc(store, clipId);
  const w = Math.round(Number(size?.w));
  const h = Math.round(Number(size?.h));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.badCanvas'), { size });
  }
  const changed = withDoc(store, clipId, 'agent:typo_canvas', (d) => {
    setDocSize(d, { w, h }, scaleContent);
  });
  const after = requireDoc(store, clipId);
  return { changed, size: { ...after.size } };
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

/** `null` = 回到默认方案。 */
export function setTheme(
  store: ProjectStore,
  clipId: string | null,
  theme: string | null,
  scope: 'clip' | 'project' = 'clip',
): boolean {
  const custom = store.project.customThemes ?? [];
  if (theme !== null && !isKnownTheme(theme, custom)) {
    // 未知 id 会被渲染静默回落默认方案 —— 那看起来就是「换了没反应」。
    throw new ControlFailure('not-found', tr('agent.typo.themeNotFound', { id: theme }), {
      validIds: themeIds(custom),
    });
  }
  if (scope === 'project') {
    return store.commit('agent:typo_theme', (p) => {
      if (theme) p.typographyTheme = theme;
      else delete p.typographyTheme;
      for (const track of p.tracks) {
        for (const clip of track.clips) {
          if (clip.kind !== 'source' || clip.source.type !== 'text') continue;
          if (theme) clip.source.doc.theme = theme;
          else delete clip.source.doc.theme;
        }
      }
    });
  }
  if (!clipId) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.noDoc', { id: '(none)' }), {
      hint: 'pass clipId, or use scope:"project"',
    });
  }
  requireDoc(store, clipId);
  return withDoc(store, clipId, 'agent:typo_theme', (d) => {
    setThemeOp(d, theme);
  });
}

export interface ThemeSaveInput {
  /** 更新已有的自定义方案（必须存在）。省略 = 新建。 */
  id?: string;
  /** 复制基准：内置或工程自定义方案的 id。省略 = 当前文档用的那套。 */
  base?: string;
  /** 显示名。更新时省略 = 保留原名。 */
  name?: string;
  /** 局部色槽：`{ accent1: '#ff8a00', dk1: '#0b0b0f' }`（合并到基准上）。 */
  colors?: unknown;
  scope?: 'clip' | 'project';
}

/**
 * 新建 / 更新一份自定义配色方案，并**立即设成当前方案**（与 UI 的保存行为一致）。
 *
 * 为什么 `colors` 是局部补丁而不是整份：模型不需要先读回整套颜色才能改一个槽，
 * 而「照着一份自己以为对的色表继续做」正是最容易偏的地方。基准优先级
 * 「id 指的那份 → `base` 指的 → 当前文档的方案 → 默认方案」。
 */
export function saveTheme(
  store: ProjectStore,
  clipId: string | null,
  input: ThemeSaveInput,
): { theme: TypographyTheme; scope: 'clip' | 'project'; appliedTo: string | null } {
  const custom = store.project.customThemes ?? [];
  const scope = input.scope === 'project' ? 'project' : 'clip';
  const doc = clipId ? requireDoc(store, clipId) : null;
  if (scope === 'clip' && !doc) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.noDoc', { id: '(none)' }), {
      hint: 'pass clipId, or use scope:"project"',
    });
  }

  const existing = typeof input.id === 'string' ? custom.find((t) => t.id === input.id) : null;
  if (typeof input.id === 'string' && !existing) {
    throw new ControlFailure('not-found', tr('agent.typo.themeNotFound', { id: input.id }), {
      validIds: custom.map((t) => t.id),
    });
  }
  if (input.base !== undefined && !isKnownTheme(String(input.base), custom)) {
    throw new ControlFailure('not-found', tr('agent.typo.themeNotFound', { id: String(input.base) }), {
      validIds: themeIds(custom),
    });
  }
  const base = existing ?? themeById(input.base ?? doc?.theme ?? null, custom);
  const colors = input.colors === undefined ? { ...base.colors } : mergeThemeColors(base.colors, input.colors);
  if (!colors) {
    throw new ControlFailure('invalid-argument', tr('agent.typo.badThemeColors'), {
      slots: Object.keys(base.colors),
    });
  }
  const name =
    (typeof input.name === 'string' && input.name.trim()) || existing?.name || themeDisplayName(base);
  const theme: TypographyTheme = { id: existing?.id ?? newId(), name, colors };

  store.commit('agent:typo_theme_save', (p) => {
    const list = Array.isArray(p.customThemes) ? [...p.customThemes] : [];
    const i = list.findIndex((t) => t.id === theme.id);
    if (i >= 0) list[i] = theme;
    else list.push(theme);
    p.customThemes = list;
    if (scope === 'project') {
      p.typographyTheme = theme.id;
      for (const track of p.tracks) {
        for (const c of track.clips) {
          if (c.kind === 'source' && c.source.type === 'text') c.source.doc.theme = theme.id;
        }
      }
    } else if (clipId) {
      const target = findTextDoc(p, clipId);
      if (target) target.theme = theme.id;
    }
  });
  return { theme, scope, appliedTo: scope === 'project' ? null : clipId };
}

/**
 * 删除一份自定义方案，并把引用它的地方抹干净（`Project.typographyTheme` + 各文档）。
 *
 * 不抹的话工程里会留一堆悬空 id：渲染回落默认方案（不报错），但图库/检查器显示
 * 「本版本没有的方案」，下次保存也照样带着它。
 */
export function removeTheme(store: ProjectStore, themeId: string): { removed: string; clearedDocs: number } {
  const custom = store.project.customThemes ?? [];
  const target = custom.find((t) => t.id === themeId);
  if (!target) {
    throw new ControlFailure('not-found', tr('agent.typo.themeNotFound', { id: themeId }), {
      // 内置方案是只读数据表，删不掉 —— validIds 因此只列自定义的。
      validIds: custom.map((t) => t.id),
      hint: 'built-in themes cannot be removed',
    });
  }
  let cleared = 0;
  store.commit('agent:typo_theme_remove', (p) => {
    const list = (p.customThemes ?? []).filter((t) => t.id !== themeId);
    if (list.length) p.customThemes = list;
    else delete p.customThemes;
    if (p.typographyTheme === themeId) delete p.typographyTheme;
    for (const track of p.tracks) {
      for (const clip of track.clips) {
        if (clip.kind !== 'source' || clip.source.type !== 'text') continue;
        if (clip.source.doc.theme !== themeId) continue;
        delete clip.source.doc.theme;
        cleared += 1;
      }
    }
  });
  return { removed: themeId, clearedDocs: cleared };
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
