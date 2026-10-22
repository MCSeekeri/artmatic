/**
 * typo-measure.ts — 排版文档的**几何体检**（`typo_measure` 的纯计算部分）。
 *
 * 为什么需要它：排版里最贵的一类返工是「肉眼看图猜像素」——正文四行塞进
 * 110px 的框、两个元素悄悄压在一起、元素跑到画布外，全都**不报错**，只能从
 * 渲染图里看出来。agent 没有眼睛，只有一张 640×360 的截图；量一次几何比
 * 来回挪三次便宜得多。
 *
 * 两条边界：
 *
 *  - **不渲染**：这里只读文档 + 浏览器排版度量，不经过光栅化 / WebGL。
 *  - **文字内容高度优先用 DOM 量**（`measureTextWithDom`）。没有 DOM（Node
 *    单测 / 网关侧）时退回**估算**，并在结果里标 `estimated: true` —— 拿估算
 *    当实测用，比没有读数更糟。
 *
 * 元素的 `frame` 是**未旋转**的包围盒（与编辑器选择框同源），所以相交检测
 * 也按未旋转框算；`summary.rotated` 给出带旋转的元素个数，提醒这个读数的边界。
 */

import type { TextElement, TypographyDocument, TypographyElement } from '../typography/document';
import { plainTextOf } from '../typography/rich-text';

export interface MeasureRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextContentMeasure {
  chars: number;
  lines: number;
  /** 排版后的内容高度（px）。 */
  contentHeight: number;
  /** 排版后的内容宽度（px；横排时等于可用宽度）。 */
  contentWidth: number;
  /** contentHeight − 可用高度。> 0 = 被裁掉。 */
  overflowY: number;
  /** contentWidth − 可用宽度。> 0 = 被裁掉。 */
  overflowX: number;
  /** true = 没有 DOM，按字符宽度估算（粗，只用来发现「明显溢出」）。 */
  estimated: boolean;
}

export interface MeasuredElement {
  id: string;
  kind: 'text' | 'shape' | 'image';
  name: string;
  frame: { x: number; y: number; w: number; h: number; rot: number };
  visible: boolean;
  locked: boolean;
  /** 只有文本元素有。 */
  text?: TextContentMeasure;
  /** 超出画布的像素数（正值 = 越界多少）。 */
  outside?: { left: number; top: number; right: number; bottom: number };
}

export interface MeasuredOverlap {
  a: string;
  b: string;
  /** 相交面积（px²）。 */
  area: number;
  rect: MeasureRect;
  /** 两边都是文本（「正文压字」）。 */
  textOverlap: boolean;
}

export interface TypographyMeasure {
  clipId: string;
  size: { w: number; h: number };
  elements: MeasuredElement[];
  /** 相交元素对，按面积从大到小。最多 50 对。 */
  overlaps: MeasuredOverlap[];
  summary: {
    elements: number;
    texts: number;
    /** 文字被裁掉的元素 id。 */
    textOverflow: string[];
    /** 有部分在画布外的元素 id。 */
    outside: string[];
    overlapPairs: number;
    /** 带旋转的元素个数（相交按未旋转框算）。 */
    rotated: number;
  };
}

export interface MeasureOptions {
  /** 只看这些元素（省略 = 全部）。 */
  elementIds?: string[];
  /** 覆盖文字度量（单测注入；省略 = DOM 或估算）。 */
  measureText?: (el: TextElement) => TextContentMeasure | null;
}

/* --------------------------------------------------------------- 小工具 */

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clampPositive(n: number): number {
  return n > 0.5 ? round1(n) : 0;
}

/** 可用文本盒（扣掉文本框边框：`box-sizing: border-box`，边框向内占）。 */
function textBoxOf(el: TextElement): { w: number; h: number } {
  const border = Math.max(0, el.boxStroke?.width ?? 0) * 2;
  return {
    w: Math.max(1, el.frame.w - border),
    h: Math.max(1, el.frame.h - border),
  };
}

/** 是否以 CJK / 全角字符为主（估算字宽用）。 */
function cjkHeavy(text: string): boolean {
  const sample = Array.from(text).slice(0, 64);
  const cjk = sample.filter((c) => /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(c)).length;
  return cjk > sample.length / 3;
}

/* ----------------------------------------------------------- 文字度量 */

/** 没有 DOM 时的估算：字符宽度 × 折行数。只用来发现**明显**溢出。 */
export function estimateTextContent(el: TextElement): TextContentMeasure {
  const text = plainTextOf(el.runs);
  const chars = Array.from(text).length;
  const box = textBoxOf(el);
  const vertical = el.style.writingMode === 'vertical-rl';
  const linePx = Math.max(1, el.style.fontSize * el.style.lineHeight);
  const charW = cjkHeavy(text) ? el.style.fontSize : el.style.fontSize * 0.55;
  const unit = Math.max(1, charW + Math.abs(el.style.letterSpacing));
  const perLine = Math.max(1, Math.floor((vertical ? box.h : box.w) / unit));
  const lines = chars
    ? text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(Array.from(line).length / perLine)), 0)
    : 0;

  const contentHeight = vertical ? box.h : Math.round(lines * linePx);
  const contentWidth = vertical ? Math.round(lines * linePx) : box.w;
  return {
    chars,
    lines,
    contentHeight,
    contentWidth,
    overflowY: round1(contentHeight - box.h),
    overflowX: round1(contentWidth - box.w),
    estimated: true,
  };
}

/**
 * 用浏览器量真实排版结果。
 *
 * 挂一个**视口外**的盒子（不能 `display:none` / `visibility:hidden`：计算样式
 * 会被继承，量出来是 0）。与 `render-dom` 用同一组排版属性，所以折行结果与
 * 舞台上看到的一致；字体没加载完时读数会偏 —— 调用方（控制平面）先等
 * `document.fonts.ready`。
 */
export function measureTextWithDom(el: TextElement): TextContentMeasure | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const text = plainTextOf(el.runs);
  const box = textBoxOf(el);
  const vertical = el.style.writingMode === 'vertical-rl';

  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:-200000px;top:0;width:0;height:0;overflow:visible;pointer-events:none;';
  const node = document.createElement('div');
  node.style.cssText = [
    'box-sizing:border-box',
    'margin:0',
    'padding:0',
    'border:0',
    'white-space:pre-wrap',
    'word-break:break-word',
    `font-family:${el.style.fontFamily}`,
    `font-size:${el.style.fontSize}px`,
    `font-weight:${el.style.fontWeight}`,
    `font-style:${el.style.fontStyle}`,
    `letter-spacing:${el.style.letterSpacing}px`,
    `line-height:${el.style.lineHeight}`,
    `text-transform:${el.style.textTransform}`,
    `writing-mode:${el.style.writingMode}`,
    vertical ? `height:${box.h}px` : `width:${box.w}px`,
  ].join(';');
  node.textContent = text;
  host.appendChild(node);
  document.body.appendChild(host);

  let contentHeight = 0;
  let contentWidth = 0;
  try {
    const rect = node.getBoundingClientRect();
    // 被约束的那条轴取 scroll*（能看出不可断行的溢出），另一条取实际尺寸。
    contentHeight = vertical ? node.scrollHeight : rect.height;
    contentWidth = vertical ? rect.width : node.scrollWidth;
  } catch {
    document.body.removeChild(host);
    return null;
  }
  document.body.removeChild(host);

  const linePx = Math.max(1, el.style.fontSize * el.style.lineHeight);
  const chars = Array.from(text).length;
  const lines = chars ? Math.max(1, Math.round((vertical ? contentWidth : contentHeight) / linePx)) : 0;
  return {
    chars,
    lines,
    contentHeight: round1(contentHeight),
    contentWidth: round1(contentWidth),
    overflowY: round1(contentHeight - box.h),
    overflowX: round1(contentWidth - box.w),
    estimated: false,
  };
}

/* ------------------------------------------------------------- 相交 */

function intersect(a: MeasureRect, b: MeasureRect): MeasureRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= x || bottom <= y) return null;
  return { x: round1(x), y: round1(y), w: round1(right - x), h: round1(bottom - y) };
}

/* ------------------------------------------------------------- 主入口 */

/**
 * 量一份排版文档。**纯读**：不写文档、不入撤销栈。
 *
 * @param elementIds 只看这些元素（相交也只在它们之间算）。
 */
export function measureDocument(
  doc: TypographyDocument,
  clipId: string,
  opt: MeasureOptions = {},
): TypographyMeasure {
  const only = opt.elementIds && opt.elementIds.length ? new Set(opt.elementIds) : null;
  const picked: TypographyElement[] = doc.elements.filter((e) => !only || only.has(e.id));
  const measureText = opt.measureText ?? ((el: TextElement) => measureTextWithDom(el) ?? estimateTextContent(el));

  const elements: MeasuredElement[] = picked.map((el) => {
    const out: MeasuredElement = {
      id: el.id,
      kind: el.kind,
      name: el.name,
      frame: { ...el.frame },
      visible: el.visible,
      locked: el.locked,
    };
    if (el.kind === 'text') out.text = measureText(el) ?? estimateTextContent(el);

    const left = clampPositive(-el.frame.x);
    const top = clampPositive(-el.frame.y);
    const right = clampPositive(el.frame.x + el.frame.w - doc.size.w);
    const bottom = clampPositive(el.frame.y + el.frame.h - doc.size.h);
    if (left || top || right || bottom) out.outside = { left, top, right, bottom };
    return out;
  });

  const visible = picked.filter((e) => e.visible);
  const overlaps: MeasuredOverlap[] = [];
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i]!;
      const b = visible[j]!;
      const rect = intersect(a.frame, b.frame);
      if (!rect) continue;
      overlaps.push({
        a: a.id,
        b: b.id,
        area: round1(rect.w * rect.h),
        rect,
        textOverlap: a.kind === 'text' && b.kind === 'text',
      });
    }
  }
  overlaps.sort((x, y) => y.area - x.area);

  const textOverflow = elements
    .filter((e) => e.text && (e.text.overflowY > 0.5 || e.text.overflowX > 0.5))
    .map((e) => e.id);

  return {
    clipId,
    size: { ...doc.size },
    elements,
    overlaps: overlaps.slice(0, 50),
    summary: {
      elements: elements.length,
      texts: elements.filter((e) => e.kind === 'text').length,
      textOverflow,
      outside: elements.filter((e) => e.outside).map((e) => e.id),
      overlapPairs: overlaps.length,
      rotated: visible.filter((e) => Math.abs(e.frame.rot) > 1e-6).length,
    },
  };
}
