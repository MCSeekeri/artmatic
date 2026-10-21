/**
 * agent-ops.ts — 排版文档的 **agent 写入原语**（不碰 DOM、不碰 store）。
 *
 * 与 `ui/typography/actions.ts` 的分工：
 *
 * | | actions.ts | 本文件 |
 * |---|---|---|
 * | 输入 | 当前选择集 + Ribbon 控件 | 明确的元素 id / 完整参数 |
 * | 依赖 | `editorState`（ui 层单例）、`appState.store` | 只有 `document.ts` / `geometry.ts` |
 * | 谁用 | 排版编辑器 | `src/agent/typography.ts`（控制平面） |
 *
 * 两者共用**同一批工厂与几何函数**（`createTextElement` / `applyPaintPatch` /
 * `alignElements` …），所以「agent 做出来的排版」与「手点出来的排版」在数据层
 * 完全同构 —— 后者能编辑前者，导出也走同一条光栅化路径。
 *
 * ## 为什么这些函数是「就地修改」
 *
 * 调用点只有一个：`store.commit(label, p => { const doc = findTextDoc(p, id); applyX(doc, …) })`。
 * 在 `commit` 里换成返回新文档的写法，就得把 `p.tracks[...].clips[...].source.doc`
 * 整条引用链重挂一遍 —— 那正是 `ProjectStore` 与编辑器都刻意避开的事（见
 * `document.ts::elementById` 的注释：给副本会踩「改了浅拷贝 → 判定无变化」）。
 *
 * 所以：**校验全部前置，修改全部就地，失败抛在改动之前**。
 */

import { newId, type Project } from '../core/schema';
import {
  SHAPE_KINDS,
  applyPaintPatch,
  createImageElement,
  createShapeElement,
  createTextElement,
  defaultTextStyle,
  elementById,
  reorderElements,
  type ImageElement,
  type Paint,
  type ShapeElement,
  type ShapeKind,
  type ShapePaintPatch,
  type Stroke,
  type TextElement,
  type TextStyle,
  type TextureFrame,
  type TypographyDocument,
  type TypographyElement,
} from './document';
import { plainTextOf, runsFromText } from './rich-text';
import { boundsOf, distribute, alignElements, toRects, type AlignAxis, type Rect } from './geometry';
import { groupElements, groupList, pruneGroups, reorderSelection, ungroupElements } from './groups';
import { buildFromSpec, generatorById, mergeParams } from './svg-gen/registry';
import type { SvgGenParams } from './svg-gen/types';

/* --------------------------------------------------------------- 文档查找 */

/** 在工程里找某个文本片段的文档。找不到返回 null（片段可能刚被删）。 */
export function findTextDoc(project: Project, clipId: string): TypographyDocument | null {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id !== clipId) continue;
      if (clip.kind === 'source' && clip.source.type === 'text') return clip.source.doc;
      return null;
    }
  }
  return null;
}

/** 这个片段是不是文本片段（写方法的第一道判据）。 */
export function isTextClip(project: Project, clipId: string): boolean {
  return findTextDoc(project, clipId) !== null;
}

/* --------------------------------------------------------------- 小工具 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 坐标保留两位小数：工程 JSON 里不该出现 `123.00000000000001`。 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clampSize(n: unknown, fallback: number): number {
  return Math.max(1, round2(finite(n, fallback)));
}

/* --------------------------------------------------------------- 帧 */

export interface FramePatch {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rot?: number;
}

/** 把补丁合进一个已有 frame（尺寸钳到 ≥1，坐标保留两位）。 */
export function applyFramePatch(frame: TextureFrame, patch: FramePatch): void {
  if (patch.x !== undefined) frame.x = round2(finite(patch.x, frame.x));
  if (patch.y !== undefined) frame.y = round2(finite(patch.y, frame.y));
  if (patch.w !== undefined) frame.w = clampSize(patch.w, frame.w);
  if (patch.h !== undefined) frame.h = clampSize(patch.h, frame.h);
  if (patch.rot !== undefined) frame.rot = finite(patch.rot, frame.rot);
}

/* --------------------------------------------------------------- 颜色 / 填充 */

const PAINT_KINDS = new Set(['none', 'solid', 'linear', 'radial', 'texture']);
const TEXTURE_IDS = new Set(['dots', 'grid', 'diagonal', 'cross', 'checker', 'wave']);

function colorString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

/**
 * `Paint` 的宽松校验。
 *
 * agent 的输出是不可信输入：错一个 `kind` 就会让渲染层走进不存在的分支
 * （`render-dom` 的 switch 没有兜底）。所以这里**一律降级到 none**，绝不抛。
 */
export function coercePaint(raw: unknown, fallback: Paint = { kind: 'none' }): Paint {
  if (!isRecord(raw)) return fallback;
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  if (!PAINT_KINDS.has(kind)) return fallback;
  const opacity =
    raw.opacity === undefined ? undefined : Math.max(0, Math.min(1, finite(raw.opacity, 1)));
  const stops = Array.isArray(raw.stops)
    ? (raw.stops as unknown[])
        .filter(isRecord)
        .map((s) => ({ offset: Math.max(0, Math.min(1, finite(s.offset, 0))), color: colorString(s.color, '#000000') }))
        .slice(0, 8)
    : [];
  switch (kind) {
    case 'none':
      return { kind: 'none' };
    case 'solid': {
      const p: Paint = { kind: 'solid', color: colorString(raw.color, '#ffffff') };
      return opacity === undefined ? p : { ...p, opacity };
    }
    case 'linear': {
      const p: Paint = {
        kind: 'linear',
        angle: finite(raw.angle, 0),
        stops: stops.length >= 2 ? stops : [
          { offset: 0, color: '#6f64ef' },
          { offset: 1, color: '#00e3c0' },
        ],
      };
      return opacity === undefined ? p : { ...p, opacity };
    }
    case 'radial': {
      const p: Paint = {
        kind: 'radial',
        stops: stops.length >= 2 ? stops : [
          { offset: 0, color: '#ffffff' },
          { offset: 1, color: '#000000' },
        ],
      };
      return opacity === undefined ? p : { ...p, opacity };
    }
    default: {
      const pattern = typeof raw.pattern === 'string' && TEXTURE_IDS.has(raw.pattern) ? raw.pattern : 'dots';
      const p: Paint = {
        kind: 'texture',
        pattern: pattern as Extract<Paint, { kind: 'texture' }>['pattern'],
        color: colorString(raw.color, '#ffffff'),
        bg: colorString(raw.bg, 'rgba(0,0,0,0)'),
        scale: Math.max(2, finite(raw.scale, 28)),
        thickness: Math.max(0.5, finite(raw.thickness, 3)),
      };
      return opacity === undefined ? p : { ...p, opacity };
    }
  }
}

/**
 * 描边填充：`{kind:'none'}` / `{kind:'solid'}` 等价于「没有填充」（回到 `color`），
 * 这时必须**删掉字段**而不是写一个 `{kind:'none'}` —— 见 Stroke.paint 的语义。
 */
function withStrokePaint(base: Stroke, raw: unknown): Stroke {
  if (raw === undefined) return base;
  const paint = coercePaint(raw, base.paint ?? { kind: 'none' });
  const next: Stroke = { ...base };
  if (paint.kind === 'none' || paint.kind === 'solid') delete next.paint;
  else next.paint = paint;
  return next;
}

export function coerceStroke(raw: unknown, fallback: Stroke | null = null): Stroke | null {
  if (raw === null) return null;
  if (!isRecord(raw)) return fallback;
  const style = raw.style === 'dashed' || raw.style === 'dotted' ? raw.style : 'solid';
  return withStrokePaint(
    {
      color: colorString(raw.color, '#ffffff'),
      width: Math.max(0, finite(raw.width, 2)),
      style,
    },
    raw.paint,
  );
}

/**
 * 字形描边（`TextElement.glyphStroke`）。同样是「没有 = 键不存在」，
 * 复用 `coerceStroke`：它已经把颜色 / 宽度 / 线型都钳过了（线型渲染侧忽略）。
 */
function setGlyphStroke(el: TextElement, raw: unknown): void {
  if (raw === null) {
    delete el.glyphStroke;
    return;
  }
  const s = coerceStroke(raw, el.glyphStroke ?? null);
  if (s) el.glyphStroke = s;
  else delete el.glyphStroke;
}

/**
 * 文本框边框（`TextElement.boxStroke` 是 `Stroke | undefined`，不是 `| null`）。
 *
 * 三个写入点共用：不给 `null` 语义是刻意的 —— 文档模型里「没有边框」就是
 * 键不存在，与 `Paint.kind === 'none'` 不是同一套表达。
 */
function setTextBoxStroke(el: TextElement, raw: unknown): void {
  if (raw === null) {
    delete el.boxStroke;
    return;
  }
  if (!isRecord(raw)) return;
  el.boxStroke = withStrokePaint(
    {
      color: colorString(raw.color, '#ffffff'),
      width: Math.max(0, finite(raw.width, 2)),
      style: raw.style === 'dashed' || raw.style === 'dotted' ? raw.style : 'solid',
    },
    raw.paint,
  );
}

/** 把 `applyPaintPatch` 的入参收窄成安全形状（只认它认识的键）。 */
export function coercePaintPatch(raw: unknown): ShapePaintPatch | null {
  if (!isRecord(raw)) return null;
  const out: ShapePaintPatch = {};
  if (typeof raw.kind === 'string' && PAINT_KINDS.has(raw.kind)) {
    out.kind = raw.kind as NonNullable<ShapePaintPatch['kind']>;
  }
  if (typeof raw.color === 'string') out.color = raw.color;
  if (typeof raw.color2 === 'string') out.color2 = raw.color2;
  if (Number.isFinite(Number(raw.angle))) out.angle = Number(raw.angle);
  if (Number.isFinite(Number(raw.opacity))) out.opacity = Math.max(0, Math.min(1, Number(raw.opacity)));
  if (typeof raw.pattern === 'string' && TEXTURE_IDS.has(raw.pattern)) {
    out.pattern = raw.pattern as NonNullable<ShapePaintPatch['pattern']>;
  }
  if (Number.isFinite(Number(raw.scale))) out.scale = Number(raw.scale);
  if (Number.isFinite(Number(raw.thickness))) out.thickness = Number(raw.thickness);
  if (Array.isArray(raw.stops)) {
    out.stops = (raw.stops as unknown[]).filter(isRecord).map((s) => ({
      offset: Math.max(0, Math.min(1, finite(s.offset, 0))),
      color: colorString(s.color, '#000000'),
    }));
  }
  return out;
}

/* --------------------------------------------------------------- 文本样式 */

const ALIGNS = new Set(['left', 'center', 'right', 'justify']);
const VALIGNS = new Set(['top', 'middle', 'bottom']);
const DECOR = new Set(['none', 'underline', 'line-through']);
const TRANSFORM = new Set(['none', 'uppercase', 'lowercase', 'capitalize']);
const WRITING = new Set(['horizontal-tb', 'vertical-rl']);

/** 文本样式的白名单补丁（未知键静默丢弃 —— agent 拼错键名不该让整次调用失败）。 */
export function applyTextStylePatch(style: TextStyle, raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  let changed = false;
  const set = <K extends keyof TextStyle>(key: K, v: TextStyle[K]): void => {
    if (style[key] === v) return;
    style[key] = v;
    changed = true;
  };
  if (typeof raw.fontFamily === 'string' && raw.fontFamily.trim()) set('fontFamily', raw.fontFamily);
  if (Number.isFinite(Number(raw.fontSize))) set('fontSize', Math.max(1, Number(raw.fontSize)));
  if (Number.isFinite(Number(raw.fontWeight))) {
    set('fontWeight', Math.max(100, Math.min(900, Math.round(Number(raw.fontWeight)))));
  }
  if (raw.fontStyle === 'normal' || raw.fontStyle === 'italic') set('fontStyle', raw.fontStyle);
  if (Number.isFinite(Number(raw.letterSpacing))) set('letterSpacing', Number(raw.letterSpacing));
  if (Number.isFinite(Number(raw.lineHeight))) set('lineHeight', Math.max(0.5, Number(raw.lineHeight)));
  if (typeof raw.align === 'string' && ALIGNS.has(raw.align)) set('align', raw.align as TextStyle['align']);
  if (typeof raw.vAlign === 'string' && VALIGNS.has(raw.vAlign)) {
    set('vAlign', raw.vAlign as TextStyle['vAlign']);
  }
  if (typeof raw.color === 'string' && raw.color.trim()) set('color', raw.color);
  if (typeof raw.textDecoration === 'string' && DECOR.has(raw.textDecoration)) {
    set('textDecoration', raw.textDecoration as TextStyle['textDecoration']);
  }
  if (typeof raw.textTransform === 'string' && TRANSFORM.has(raw.textTransform)) {
    set('textTransform', raw.textTransform as TextStyle['textTransform']);
  }
  if (typeof raw.writingMode === 'string' && WRITING.has(raw.writingMode)) {
    set('writingMode', raw.writingMode as TextStyle['writingMode']);
  }
  if (raw.highlight === null) {
    if (style.highlight !== undefined) {
      delete style.highlight;
      changed = true;
    }
  } else if (typeof raw.highlight === 'string') {
    set('highlight', raw.highlight);
  }
  /*
   * 文字阴影：三种形态都收 —— `null` 清空、单个对象（老形态 / 手写调用）、
   * 数组（多层）。写回**一律是数组**，于是「只有一份真相」成立（读的地方
   * 还要过 `textShadowList()`，那是给老工程数据留的）。
   */
  if (raw.shadow === null) {
    if (style.shadow !== undefined) {
      delete style.shadow;
      changed = true;
    }
  } else if (Array.isArray(raw.shadow) || isRecord(raw.shadow)) {
    const list = (Array.isArray(raw.shadow) ? raw.shadow : [raw.shadow])
      .filter(isRecord)
      .slice(0, 8)
      .map((s) => ({
        color: colorString(s.color, '#000000'),
        dx: finite(s.dx, 0.045),
        dy: finite(s.dy, 0.045),
        blur: Math.max(0, finite(s.blur, 0.09)),
      }));
    if (list.length) set('shadow', list);
    else if (style.shadow !== undefined) {
      delete style.shadow;
      changed = true;
    }
  }
  return changed;
}

/* --------------------------------------------------------------- 新增元素 */

export interface NewTextInput {
  text: string;
  frame?: FramePatch;
  style?: Record<string, unknown>;
  fill?: unknown;
  boxFill?: unknown;
  boxStroke?: unknown;
  /** 字形描边（`-webkit-text-stroke`）：`{ color, width }`，宽度 px。 */
  glyphStroke?: unknown;
  name?: string;
  opacity?: number;
  blend?: string;
}

export interface NewShapeInput {
  shape: string;
  frame?: FramePatch;
  fill?: unknown;
  stroke?: unknown;
  radius?: number;
  sides?: number;
  waist?: number;
  inner?: number;
  angle?: number;
  path?: string;
  evenOdd?: boolean;
  name?: string;
  opacity?: number;
  blend?: string;
}

export interface NewImageInput {
  assetId: string;
  frame?: FramePatch;
  fit?: string;
  radius?: number;
  crop?: { x: number; y: number; w: number; h: number };
  name?: string;
  opacity?: number;
  blend?: string;
}

export function isShapeKind(v: unknown): v is ShapeKind {
  return typeof v === 'string' && (SHAPE_KINDS as readonly string[]).includes(v);
}

const MIX_BLEND_IDS = new Set([
  'normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn',
  'hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity',
]);

function applyCommon(el: TypographyElement, input: { name?: string; opacity?: number; blend?: string }): void {
  if (typeof input.name === 'string' && input.name.trim()) el.name = input.name;
  if (Number.isFinite(Number(input.opacity))) el.opacity = Math.max(0, Math.min(1, Number(input.opacity)));
  if (typeof input.blend === 'string' && MIX_BLEND_IDS.has(input.blend)) {
    el.blend = input.blend as TypographyElement['blend'];
  }
}

/** 追加一个文字元素。返回它（调用方要 id）。 */
export function addTextElement(doc: TypographyDocument, input: NewTextInput): TextElement {
  const el = createTextElement(doc.size, {
    text: typeof input.text === 'string' ? input.text : '',
    ...(input.name ? { name: input.name } : {}),
  });
  applyFramePatch(el.frame, input.frame ?? {});
  applyTextStylePatch(el.style, input.style ?? {});
  if (input.fill !== undefined) el.fill = coercePaint(input.fill);
  if (input.boxFill !== undefined) el.boxFill = coercePaint(input.boxFill);
  if (input.boxStroke !== undefined) setTextBoxStroke(el, input.boxStroke);
  if (input.glyphStroke !== undefined) setGlyphStroke(el, input.glyphStroke);
  applyCommon(el, input);
  doc.elements = [...doc.elements, el];
  return el;
}

/** 追加一个图形元素。 */
export function addShapeElement(doc: TypographyDocument, input: NewShapeInput): ShapeElement {
  if (!isShapeKind(input.shape)) {
    throw new Error(`unknown shape: ${String(input.shape)}`);
  }
  const el = createShapeElement(doc.size, input.shape, {
    ...(input.path ? { path: input.path } : {}),
    ...(input.evenOdd !== undefined ? { evenOdd: input.evenOdd } : {}),
  });
  applyFramePatch(el.frame, input.frame ?? {});
  if (input.fill !== undefined) el.fill = coercePaint(input.fill, el.fill);
  if (input.stroke !== undefined) el.stroke = coerceStroke(input.stroke, el.stroke);
  if (Number.isFinite(Number(input.radius))) el.radius = Math.max(0, Number(input.radius));
  if (Number.isFinite(Number(input.sides))) el.sides = Math.max(3, Math.min(64, Math.round(Number(input.sides))));
  if (Number.isFinite(Number(input.waist))) el.waist = Math.max(0.02, Math.min(1, Number(input.waist)));
  if (Number.isFinite(Number(input.inner))) el.inner = Math.max(0, Number(input.inner));
  if (Number.isFinite(Number(input.angle))) el.angle = Number(input.angle);
  if (input.name) el.name = input.name;
  applyCommon(el, input);
  doc.elements = [...doc.elements, el];
  return el;
}

/** 追加一个图片元素（`natural` 由调用方从素材仓取，取不到就按正方块）。 */
export function addImageElement(
  doc: TypographyDocument,
  input: NewImageInput,
  natural?: { w: number; h: number } | null,
): ImageElement {
  const el = createImageElement(doc.size, input.assetId, {
    ...(natural ? { natural } : {}),
    ...(input.name ? { name: input.name } : {}),
  });
  applyFramePatch(el.frame, input.frame ?? {});
  if (input.fit && ['fill', 'contain', 'cover', 'none'].includes(input.fit)) {
    el.fit = input.fit as ImageElement['fit'];
  }
  if (Number.isFinite(Number(input.radius))) el.radius = Math.max(0, Number(input.radius));
  if (isRecord(input.crop)) {
    el.crop = {
      x: Math.max(0, Math.min(1, finite(input.crop.x, 0))),
      y: Math.max(0, Math.min(1, finite(input.crop.y, 0))),
      w: Math.max(0.01, Math.min(1, finite(input.crop.w, 1))),
      h: Math.max(0.01, Math.min(1, finite(input.crop.h, 1))),
    };
  }
  applyCommon(el, input);
  doc.elements = [...doc.elements, el];
  return el;
}

/** 按生成器 id 造一个 `shape:'svg'` 元素（参数会在内部补默认值）。 */
export function addGeneratedShape(
  doc: TypographyDocument,
  input: { genId: string; params?: Record<string, number | string>; seed?: number; frame?: FramePatch; name?: string; fill?: unknown; stroke?: unknown },
): ShapeElement {
  const spec = generatorById(input.genId);
  if (!spec) throw new Error(`unknown generator: ${input.genId}`);
  const seed = Number.isFinite(Number(input.seed)) ? Number(input.seed) >>> 0 : spec.defaultSeed >>> 0;
  const params: SvgGenParams = mergeParams(spec, input.params);
  const built = buildFromSpec(spec, params, seed);

  // 默认盒子按 aspect 定（条码那类方盒里会被拉变形）。
  const aspect = spec.aspect && spec.aspect > 0 ? spec.aspect : 1;
  const baseW = Math.min(doc.size.w * 0.5, doc.size.h * 0.5 * aspect);
  const frame: TextureFrame = {
    x: round2((doc.size.w - baseW) / 2),
    y: round2((doc.size.h - baseW / aspect) / 2),
    w: round2(baseW),
    h: round2(baseW / aspect),
    rot: 0,
  };

  const el = createShapeElement(doc.size, 'svg', {
    path: built.d,
    ...(built.evenOdd ? { evenOdd: true } : {}),
    frame,
    ...(input.name ? { name: input.name } : {}),
  });
  if (built.strokeOnly) {
    el.fill = { kind: 'none' };
    el.stroke = el.stroke ?? { color: '#ffffff', width: 4, style: 'solid' };
  }
  if (input.fill !== undefined) el.fill = coercePaint(input.fill, el.fill);
  if (input.stroke !== undefined) el.stroke = coerceStroke(input.stroke, el.stroke);
  applyFramePatch(el.frame, input.frame ?? {});
  el.gen = { id: spec.id, seed, params };
  doc.elements = [...doc.elements, el];
  return el;
}

/* --------------------------------------------------------------- 修改 / 删除 */

/**
 * 白名单属性补丁。返回是否改了东西。
 *
 * `kind` / `id` / `assetId` 一律不可写 —— 那些各有专属入口（换源要走片段层）。
 */
export function patchElement(
  doc: TypographyDocument,
  id: string,
  raw: Record<string, unknown>,
): boolean {
  const el = elementById(doc, id);
  if (!el) throw new Error(`element not found: ${id}`);
  let changed = false;
  const before = JSON.stringify(el);

  if (raw.name !== undefined && typeof raw.name === 'string') el.name = raw.name;
  if (isRecord(raw.frame)) applyFramePatch(el.frame, raw.frame as FramePatch);
  if (typeof raw.blend === 'string' && MIX_BLEND_IDS.has(raw.blend)) {
    el.blend = raw.blend as TypographyElement['blend'];
  }
  if (raw.opacity !== undefined && Number.isFinite(Number(raw.opacity))) {
    el.opacity = Math.max(0, Math.min(1, Number(raw.opacity)));
  }
  if (raw.visible !== undefined) el.visible = Boolean(raw.visible);
  if (raw.locked !== undefined) el.locked = Boolean(raw.locked);

  /* 阴影 / 虚化：所有元素通用，都是「空 = 删字段」。 */
  if (raw.blur !== undefined) {
    const v = Math.max(0, finite(raw.blur, 0));
    if (v > 0) el.blur = v;
    else delete el.blur;
  }
  if (raw.shadows !== undefined) {
    const list = (Array.isArray(raw.shadows) ? raw.shadows : [])
      .filter(isRecord)
      .slice(0, 8)
      .map((s) => ({
        color: colorString(s.color, '#000000'),
        dx: finite(s.dx, 0),
        dy: finite(s.dy, 0),
        blur: Math.max(0, finite(s.blur, 0)),
      }));
    if (list.length) el.shadows = list;
    else delete el.shadows;
  }

  if (el.kind === 'text') {
    if (isRecord(raw.style)) applyTextStylePatch(el.style, raw.style);
    const fillPatch = coercePaintPatch(raw.fill);
    if (fillPatch) el.fill = applyPaintPatch(el.fill ?? { kind: 'none' }, fillPatch);
    const boxPatch = coercePaintPatch(raw.boxFill);
    if (boxPatch) el.boxFill = applyPaintPatch(el.boxFill ?? { kind: 'none' }, boxPatch);
    if (raw.boxStroke !== undefined) setTextBoxStroke(el, raw.boxStroke);
    if (raw.glyphStroke !== undefined) setGlyphStroke(el, raw.glyphStroke);
    if (raw.text !== undefined && typeof raw.text === 'string') el.runs = runsFromText(raw.text);
  } else if (el.kind === 'shape') {
    const fillPatch = coercePaintPatch(raw.fill);
    if (fillPatch) el.fill = applyPaintPatch(el.fill, fillPatch);
    if (raw.stroke !== undefined) el.stroke = coerceStroke(raw.stroke, el.stroke);
    if (Number.isFinite(Number(raw.radius))) el.radius = Math.max(0, Number(raw.radius));
    if (Number.isFinite(Number(raw.sides))) el.sides = Math.max(3, Math.min(64, Math.round(Number(raw.sides))));
    if (Number.isFinite(Number(raw.waist))) el.waist = Math.max(0.02, Math.min(1, Number(raw.waist)));
    if (Number.isFinite(Number(raw.inner))) el.inner = Math.max(0, Number(raw.inner));
    if (Number.isFinite(Number(raw.angle))) el.angle = Number(raw.angle);
    if (raw.evenOdd !== undefined) el.evenOdd = Boolean(raw.evenOdd);
    // 改生成器的种子 / 参数：重算路径（与 UI 的 rebuildGen 同一口径）。
    if (isRecord(raw.gen)) {
      const genId = typeof raw.gen.id === 'string' ? raw.gen.id : el.gen?.id;
      const spec = genId ? generatorById(genId) : null;
      if (spec) {
        const seed = Number.isFinite(Number(raw.gen.seed))
          ? Number(raw.gen.seed) >>> 0
          : el.gen?.seed ?? spec.defaultSeed;
        const params = mergeParams(spec, isRecord(raw.gen.params) ? (raw.gen.params as SvgGenParams) : el.gen?.params);
        const built = buildFromSpec(spec, params, seed);
        el.path = built.d;
        el.evenOdd = built.evenOdd ?? false;
        el.gen = { id: spec.id, seed, params };
      }
    }
  } else if (el.kind === 'image') {
    if (typeof raw.fit === 'string' && ['fill', 'contain', 'cover', 'none'].includes(raw.fit)) {
      el.fit = raw.fit as ImageElement['fit'];
    }
    if (Number.isFinite(Number(raw.radius))) el.radius = Math.max(0, Number(raw.radius));
    if (isRecord(raw.crop)) {
      el.crop = {
        x: Math.max(0, Math.min(1, finite(raw.crop.x, 0))),
        y: Math.max(0, Math.min(1, finite(raw.crop.y, 0))),
        w: Math.max(0.01, Math.min(1, finite(raw.crop.w, 1))),
        h: Math.max(0.01, Math.min(1, finite(raw.crop.h, 1))),
      };
    }
  }

  changed = JSON.stringify(el) !== before;
  return changed;
}

export function removeElement(doc: TypographyDocument, id: string): boolean {
  const before = doc.elements.length;
  doc.elements = doc.elements.filter((e) => e.id !== id);
  return doc.elements.length !== before;
}

/**
 * 层级调整（前后 / 逐层）。
 *
 * 就地写回同一个 doc 对象 —— `reorderElements` 是纯函数（返回新文档），
 * 而 `store.commit` 里拿到的引用必须保持有效。
 */
export function reorderElement(
  doc: TypographyDocument,
  id: string,
  op: 'front' | 'back' | 'forward' | 'backward',
): boolean {
  const next = reorderElements(doc, [id], op);
  if (next === doc) return false;
  doc.elements = next.elements;
  return true;
}

/* --------------------------------------------------------------- 组合 */

export function groupSelection(doc: TypographyDocument, ids: string[], name: string): string | null {
  const next = groupElements(doc, ids, name);
  if (next === doc) return null;
  const added = (next.groups ?? []).filter((g) => !(doc.groups ?? []).some((x) => x.id === g.id))[0];
  doc.elements = next.elements;
  doc.groups = next.groups;
  return added?.id ?? null;
}

export function ungroupSelection(doc: TypographyDocument, ids: string[]): boolean {
  const next = ungroupElements(doc, ids);
  if (next === doc) return false;
  doc.elements = next.elements;
  doc.groups = next.groups;
  return true;
}

/** 写库之后的统一收口（与 `editorState.commit` 同一件事）。 */
export function normalizeAfterWrite(doc: TypographyDocument): void {
  const pruned = pruneGroups(doc);
  if (pruned !== doc) {
    doc.elements = pruned.elements;
    doc.groups = pruned.groups;
  }
}

/* --------------------------------------------------------------- 布局 */

export type LayoutRequest =
  | { op: 'align'; axis: AlignAxis; target?: 'canvas' | 'selection'; elementIds?: string[] }
  | { op: 'distribute'; axis: 'h' | 'v'; elementIds?: string[] }
  | { op: 'grid'; cols: number; rows?: number; gap?: number; margin?: number; elementIds?: string[] }
  | { op: 'row' | 'column'; gap?: number; margin?: number; elementIds?: string[] };

function pickTargets(doc: TypographyDocument, ids?: string[]): TypographyElement[] {
  const only = ids && ids.length ? new Set(ids) : null;
  return doc.elements.filter((e) => !e.locked && (!only || only.has(e.id)));
}

/** 让一组元素在画布上排整齐。返回移动了几个。 */
export function applyLayout(doc: TypographyDocument, req: LayoutRequest): number {
  const targets = pickTargets(doc, req.elementIds);
  if (targets.length === 0) return 0;

  if (req.op === 'align') {
    const rects = toRects(targets);
    const canvas: Rect = { id: 'canvas', x: 0, y: 0, w: doc.size.w, h: doc.size.h };
    const anchor = req.target === 'selection' && rects.length > 1 ? boundsOf(rects) : canvas;
    if (req.axis === 'distribute-h' || req.axis === 'distribute-v') {
      return applyDistribute(doc, targets, req.axis === 'distribute-h' ? 'h' : 'v');
    }
    const moves = alignElements(rects, anchor, req.axis);
    for (const el of targets) {
      const m = moves.get(el.id);
      if (!m) continue;
      el.frame.x = round2(m.x);
      el.frame.y = round2(m.y);
    }
    return moves.size;
  }

  if (req.op === 'distribute') return applyDistribute(doc, targets, req.axis);

  // grid / row / column：先算格子，再把元素中心放进去（尺寸保持不变）。
  const gap = Math.max(0, finite(req.gap, Math.round(Math.min(doc.size.w, doc.size.h) * 0.03)));
  const margin = Math.max(0, finite(req.margin, Math.round(Math.min(doc.size.w, doc.size.h) * 0.06)));
  const cols = req.op === 'grid'
    ? Math.max(1, Math.min(12, Math.round(finite(req.cols, Math.max(1, targets.length)))))
    : req.op === 'row' ? targets.length : 1;
  const rows = req.op === 'grid'
    ? Math.max(1, Math.min(24, Math.round(finite(req.rows, Math.ceil(targets.length / cols)))))
    : req.op === 'column' ? targets.length : 1;

  const maxW = Math.max(...targets.map((t) => t.frame.w));
  const maxH = Math.max(...targets.map((t) => t.frame.h));
  const availW = doc.size.w - margin * 2;
  const availH = doc.size.h - margin * 2;
  const cellW = req.op === 'row' ? (availW - gap * (targets.length - 1)) / targets.length : Math.min(maxW, (availW - gap * (cols - 1)) / cols);
  const cellH = req.op === 'column' ? (availH - gap * (targets.length - 1)) / targets.length : Math.min(maxH, (availH - gap * (rows - 1)) / rows);

  targets.forEach((el, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = margin + col * (cellW + gap) + cellW / 2;
    const cy = margin + row * (cellH + gap) + cellH / 2;
    el.frame.x = round2(cx - el.frame.w / 2);
    el.frame.y = round2(cy - el.frame.h / 2);
  });
  return targets.length;
}

function applyDistribute(doc: TypographyDocument, targets: TypographyElement[], axis: 'h' | 'v'): number {
  if (targets.length < 3) return 0;
  const moves = distribute(toRects(targets), axis);
  for (const el of targets) {
    const v = moves.get(el.id);
    if (v === undefined) continue;
    if (axis === 'h') el.frame.x = round2(v);
    else el.frame.y = round2(v);
  }
  return moves.size;
}

/* --------------------------------------------------------------- 文档级 */

export function setBackground(doc: TypographyDocument, paint: unknown): void {
  doc.background = coercePaint(paint);
}

export function setTheme(doc: TypographyDocument, id: string | null): void {
  if (id === null || id === '') delete doc.theme;
  else doc.theme = id;
}

/* --------------------------------------------------------------- 视图 */

export interface DocViewOptions {
  detail: 'ids' | 'full';
}

function elementView(el: TypographyElement): Record<string, unknown> {
  const base = {
    id: el.id,
    kind: el.kind,
    name: el.name,
    frame: { ...el.frame },
    blend: el.blend,
    opacity: el.opacity,
    visible: el.visible,
    locked: el.locked,
    ...(el.groupId ? { groupId: el.groupId } : {}),
    ...(el.animations.length ? { animations: el.animations.map((a) => ({ kind: a.kind, duration: a.duration })) } : {}),
    // 阴影 / 虚化对所有元素成立，与 transform3d 一样放在公共部分。
    ...(el.shadows?.length ? { shadows: el.shadows } : {}),
    ...(el.blur ? { blur: el.blur } : {}),
  };
  if (el.kind === 'text') {
    return {
      ...base,
      text: plainTextOf(el.runs),
      style: { ...el.style },
      ...(el.fill ? { fill: el.fill } : {}),
      ...(el.boxFill ? { boxFill: el.boxFill } : {}),
      ...(el.boxStroke ? { boxStroke: el.boxStroke } : {}),
      // 字形描边只用于文本（图形有自己的 stroke），与 boxStroke 并列但含义不同。
      ...(el.glyphStroke ? { glyphStroke: el.glyphStroke } : {}),
    };
  }
  if (el.kind === 'shape') {
    return {
      ...base,
      shape: el.shape,
      fill: el.fill,
      stroke: el.stroke,
      ...(el.radius !== undefined ? { radius: el.radius } : {}),
      ...(el.sides !== undefined ? { sides: el.sides } : {}),
      ...(el.waist !== undefined ? { waist: el.waist } : {}),
      ...(el.inner !== undefined ? { inner: el.inner } : {}),
      ...(el.angle !== undefined ? { angle: el.angle } : {}),
      ...(el.evenOdd ? { evenOdd: true } : {}),
      ...(el.gen ? { gen: el.gen } : {}),
    };
  }
  return {
    ...base,
    assetId: el.assetId,
    fit: el.fit,
    ...(el.crop ? { crop: el.crop } : {}),
    ...(el.radius !== undefined ? { radius: el.radius } : {}),
  };
}

/**
 * 文档视图。
 *
 * `ids` 只给 id / 类型 / 名字 / 框 —— 二十个元素的完整样式（渐变 + 阴影 +
 * 富文本）能上万 token。agent 先探路，再对具体元素取 `full`。
 */
export function docView(
  doc: TypographyDocument,
  clipId: string,
  detail: 'ids' | 'full',
): {
  clipId: string;
  size: { w: number; h: number };
  theme: string | null;
  background?: unknown;
  elements: unknown[];
  groups?: unknown[];
  fonts?: { family: string; format: string }[];
} {
  if (detail === 'ids') {
    return {
      clipId,
      size: { w: doc.size.w, h: doc.size.h },
      theme: doc.theme ?? null,
      elements: doc.elements.map((e) => ({
        id: e.id,
        kind: e.kind,
        name: e.name,
        frame: { ...e.frame },
      })),
    };
  }
  return {
    clipId,
    size: { w: doc.size.w, h: doc.size.h },
    theme: doc.theme ?? null,
    background: doc.background,
    elements: doc.elements.map(elementView),
    groups: groupList(doc).map((g) => ({ ...g })),
    fonts: doc.fonts.map((f) => ({ family: f.family, format: f.format })),
  };
}

/* --------------------------------------------------------------- 整份替换 */

/**
 * 把不可信的 JSON 收成一份合法文档。
 *
 * **永不抛**（与 `pattern-codec` 同一条纪律）：agent 生成的文档结构可能整段错位，
 * 而「工程打不开」比「文档少几个元素」严重得多。坏元素整条丢弃，坏字段回落默认。
 */
export function coerceDocument(raw: unknown, fallback: TypographyDocument): TypographyDocument {
  if (!isRecord(raw)) return fallback;
  const sizeRaw = isRecord(raw.size) ? raw.size : {};
  const size = {
    w: Math.max(2, Math.round(finite(sizeRaw.w, fallback.size.w))),
    h: Math.max(2, Math.round(finite(sizeRaw.h, fallback.size.h))),
  };
  const doc: TypographyDocument = {
    size,
    background: coercePaint(raw.background, { kind: 'none' }),
    elements: [],
    fonts: [],
    groups: [],
    ...(typeof raw.theme === 'string' ? { theme: raw.theme } : {}),
  };

  const style0 = defaultTextStyle(size);
  const seen = new Set<string>();
  const rawEls = Array.isArray(raw.elements) ? raw.elements : [];
  for (const item of rawEls.slice(0, 200)) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' && item.id.trim() && !seen.has(item.id) ? item.id : newId();
    seen.add(id);
    const kind = item.kind;
    const frame = isRecord(item.frame) ? (item.frame as Record<string, unknown>) : {};
    const common = {
      id,
      frame: commonFrame(size, frame),
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      ...(typeof item.blend === 'string' && MIX_BLEND_IDS.has(item.blend)
        ? { blend: item.blend as TypographyElement['blend'] }
        : {}),
      ...(Number.isFinite(Number(item.opacity)) ? { opacity: Math.max(0, Math.min(1, Number(item.opacity))) } : {}),
      ...(item.visible === false ? { visible: false } : {}),
      ...(item.locked === true ? { locked: true } : {}),
    };
    if (kind === 'text') {
      const el = createTextElement(size, {
        ...common,
        text: typeof item.text === 'string' ? item.text : '',
      });
      el.style = { ...style0 };
      if (isRecord(item.style)) applyTextStylePatch(el.style, item.style);
      if (item.fill !== undefined) el.fill = coercePaint(item.fill);
      if (item.boxFill !== undefined) el.boxFill = coercePaint(item.boxFill);
      if (item.boxStroke !== undefined) setTextBoxStroke(el, item.boxStroke);
      if (item.glyphStroke !== undefined) setGlyphStroke(el, item.glyphStroke);
      doc.elements.push(el);
    } else if (kind === 'shape' && isShapeKind(item.shape)) {
      const el = createShapeElement(size, item.shape, {
        ...common,
        ...(typeof item.path === 'string' ? { path: item.path } : {}),
        ...(item.evenOdd === true ? { evenOdd: true } : {}),
      });
      if (item.fill !== undefined) el.fill = coercePaint(item.fill, el.fill);
      if (item.stroke !== undefined) el.stroke = coerceStroke(item.stroke, el.stroke);
      if (Number.isFinite(Number(item.radius))) el.radius = Math.max(0, Number(item.radius));
      if (Number.isFinite(Number(item.sides))) el.sides = Math.max(3, Math.min(64, Math.round(Number(item.sides))));
      if (Number.isFinite(Number(item.waist))) el.waist = Math.max(0.02, Math.min(1, Number(item.waist)));
      if (Number.isFinite(Number(item.inner))) el.inner = Math.max(0, Number(item.inner));
      if (Number.isFinite(Number(item.angle))) el.angle = Number(item.angle);
      doc.elements.push(el);
    } else if (kind === 'image' && typeof item.assetId === 'string' && item.assetId) {
      const el = createImageElement(size, item.assetId, { ...common });
      if (typeof item.fit === 'string' && ['fill', 'contain', 'cover', 'none'].includes(item.fit)) {
        el.fit = item.fit as ImageElement['fit'];
      }
      if (isRecord(item.crop)) {
        el.crop = {
          x: Math.max(0, Math.min(1, finite(item.crop.x, 0))),
          y: Math.max(0, Math.min(1, finite(item.crop.y, 0))),
          w: Math.max(0.01, Math.min(1, finite(item.crop.w, 1))),
          h: Math.max(0.01, Math.min(1, finite(item.crop.h, 1))),
        };
      }
      doc.elements.push(el);
    }
  }

  // 字体引用只保留格式合法的那些（字形子集化需要它）。
  const rawFonts = Array.isArray(raw.fonts) ? raw.fonts : [];
  for (const f of rawFonts) {
    if (!isRecord(f) || typeof f.family !== 'string') continue;
    const format = f.format === 'woff2' || f.format === 'woff' ? f.format : 'sfnt';
    doc.fonts.push({ id: typeof f.id === 'string' ? f.id : f.family, family: f.family, format, source: { kind: 'builtin' } });
  }
  return doc;
}

function commonFrame(
  size: { w: number; h: number },
  raw: Record<string, unknown>,
): TextureFrame {
  const w = clampSize(raw.w, Math.round(size.w * 0.5));
  const h = clampSize(raw.h, Math.round(size.h * 0.15));
  return {
    x: round2(finite(raw.x, Math.round((size.w - w) / 2))),
    y: round2(finite(raw.y, Math.round((size.h - h) / 2))),
    w,
    h,
    rot: finite(raw.rot, 0),
  };
}

/* --------------------------------------------------------------- 默认值导出 */

/** 常用留白 / 安全区（agent 给它「按边距排版」时不用自己猜数字）。 */
export function defaultMargin(doc: TypographyDocument): number {
  return Math.round(Math.min(doc.size.w, doc.size.h) * 0.06);
}
