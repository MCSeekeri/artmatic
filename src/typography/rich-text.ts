/**
 * rich-text.ts — 行内富文本的**纯数据层**（不碰 DOM，可单测）。
 *
 * ## 模型
 *
 * 元素级 `TextStyle` 是**基样式**，`TextRun` 是若干段文本，每段可以带一层
 * `TextSpanStyle` **局部覆盖**。所以「加粗一段字」不是把 Bold 写进文档，
 * 而是给那一段加一个 `fontWeight: 700` 的覆盖；其余属性照旧继承元素级。
 *
 * 这样做的好处是**元素级之后改一次仍然生效**：把整块字的字号从 97 调到 120，
 * 只有被单独改过字号的那一段不动，其余全跟着走。反过来（把富文本拍平成
 * 每个 run 自带完整样式）会让「改元素字号」变成一个要遍历所有 run 的回写操作，
 * 而且从元素级改回去时信息已经丢了。
 *
 * ## 偏移量口径
 *
 * 所有区间都是**纯文本里的 UTF-16 码元下标**（= `plainTextOf()` 的下标）。
 * 不用「第几个 run + 段内下标」：那种口径在插入/删除一段之后要整体重编号，
 * 而字符串下标天然稳定。代理对（emoji）按码元算，与 `String.prototype.slice`
 * 一致，也和 DOM 的 `Range` 偏移一致 —— 这是刻意的：编辑区的选区偏移本来就
 * 是码元，换一套口径只会带来一次换算和一堆边界 bug。
 *
 * ## 删除即「继承」
 *
 * 补丁的值允许是 `null`，语义是**删掉这条覆盖**（回到元素级），而不是
 * 「设成 null」。`undefined` 则是「这一项不动」。三态很啰嗦，但没有它就没法
 * 表达「把这一段的字号恢复成跟元素一样」。
 */

import { fnv1a } from './cache-key';
import type { TextStyle } from './document';

/**
 * 可以按行内覆盖的文本属性。
 *
 * **逐项列出**，不用 `keyof TextStyle`：段落级属性（`lineHeight` / `align` /
 * `vAlign` / `writingMode`）在行内没有意义，用「行内覆盖」去表达它们会得到
 * 「同一行里两种行高」这种谁也画不对的东西。列成白名单之后，类型层面就
 * 排除了这种可能。
 */
export const SPAN_STYLE_KEYS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'color',
  'textDecoration',
] as const;

export type SpanStyleKey = (typeof SPAN_STYLE_KEYS)[number];

/** 行内覆盖。缺省即继承元素级 `TextStyle`。 */
export type TextSpanStyle = Partial<Pick<TextStyle, SpanStyleKey>>;

export interface TextRun {
  text: string;
  /** 缺省 = 完全继承元素级 style。 */
  style?: TextSpanStyle;
}

/** 补丁：`undefined` = 不动，`null` = 删掉这条覆盖，值 = 写死。 */
export type SpanStylePatch = { [K in SpanStyleKey]?: TextStyle[K] | null };

export function plainTextOf(runs: readonly TextRun[]): string {
  return runs.map((r) => r.text).join('');
}

/** 字符串 → 单个 run。空串给一个空 run（保证 `runs` 永不为空数组）。 */
export function runsFromText(text: string): TextRun[] {
  return [{ text }];
}

function styleEq(a: TextSpanStyle | undefined, b: TextSpanStyle | undefined): boolean {
  const ak = a ? Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined) : [];
  const bk = b ? Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined) : [];
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}

/**
 * 归一化：丢掉空段、合并相邻的同样式段。
 *
 * **每次写回都要过一遍**。不做的话，「反复给同一段加粗再取消」会不断切碎
 * runs，最后一段 8 个字的标题能攒出二十几个 run —— 而 `stableStringify(doc)`
 * 是缓存键，run 数量膨胀会连带把光栅化缓存全部击穿。
 */
export function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) {
      // 样式留着没有意义（没有字承载它），但整个 runs 不能为空。
      continue;
    }
    const last = out[out.length - 1];
    if (last && styleEq(last.style, r.style)) last.text += r.text;
    else out.push({ text: r.text, style: r.style ? { ...r.style } : undefined });
  }
  return out.length ? out : [{ text: '' }];
}

/** 元素级样式的可读投影（把 `TextStyle` 里能行内覆盖的那几项取出来）。 */
function baseSpanStyle(base: TextStyle): Required<Pick<TextStyle, SpanStyleKey>> {
  return {
    fontFamily: base.fontFamily,
    fontSize: base.fontSize,
    fontWeight: base.fontWeight,
    fontStyle: base.fontStyle,
    letterSpacing: base.letterSpacing,
    color: base.color,
    textDecoration: base.textDecoration,
  };
}

/** 某一处的**生效值**（覆盖优先，否则元素级）。 */
export function spanValueAt<K extends SpanStyleKey>(
  runs: readonly TextRun[],
  offset: number,
  base: TextStyle,
  key: K,
): TextStyle[K] {
  let at = 0;
  for (const r of runs) {
    const end = at + r.text.length;
    if (offset >= at && offset < end) {
      const v = r.style?.[key];
      return (v === undefined ? baseSpanStyle(base)[key] : v) as TextStyle[K];
    }
    at = end;
  }
  // 落在末尾（光标在最后一个字符之后）时取最后一段。
  const last = runs[runs.length - 1];
  const v = last?.style?.[key];
  return (v === undefined ? baseSpanStyle(base)[key] : v) as TextStyle[K];
}

export interface UniformValue<T> {
  /** 区间内每一处都相同？不同则 UI 显示为「混合」而不是硬选一个值。 */
  uniform: boolean;
  value: T;
}

/**
 * 区间上的统一生效值（Ribbon 控件显示什么用）。
 *
 * 取的是**每一处的生效值**而不是补丁本身：一段没写覆盖、元素级是 700 的文本，
 * 它的加粗按钮必须是按下态 —— 否则用户会以为「明明加粗了，按钮却没亮」。
 */
export function uniformSpanValue<K extends SpanStyleKey>(
  runs: readonly TextRun[],
  start: number,
  end: number,
  base: TextStyle,
  key: K,
): UniformValue<TextStyle[K]> {
  const total = plainTextOf(runs).length;
  const s = Math.max(0, Math.min(start, total));
  const e = Math.max(s, Math.min(end, total));
  if (e === s) return { uniform: true, value: spanValueAt(runs, s, base, key) };

  let seen: TextStyle[K] | undefined;
  let uniform = true;
  let at = 0;
  for (const r of runs) {
    const rs = at;
    const re = at + r.text.length;
    at = re;
    if (re <= s || rs >= e) continue;
    const v = (r.style?.[key] === undefined ? baseSpanStyle(base)[key] : r.style[key]) as TextStyle[K];
    if (seen === undefined) seen = v;
    else if (seen !== v) uniform = false;
  }
  return { uniform, value: (seen ?? spanValueAt(runs, s, base, key)) as TextStyle[K] };
}

/**
 * 给 `[start, end)` 加一层覆盖。**富文本的全部写操作都走这里。**
 *
 * 三件事：在两端切开 run、给区间内的每一段合上补丁、归一化。
 * 区间为空（纯光标）时退化成「设在光标所在的那一段上」，这样先点加粗再打字
 * 也能生效 —— 这是所有编辑器的默认行为。
 */
export function applySpanStyle(
  runs: readonly TextRun[],
  start: number,
  end: number,
  patch: SpanStylePatch,
): TextRun[] {
  const total = plainTextOf(runs).length;
  let s = Math.max(0, Math.min(start, total));
  let e = Math.max(s, Math.min(end, total));
  if (s === e) {
    // 空区间：把光标所在的那一段整段改掉（找不到就退化成末尾）。
    const seg = segmentAt(runs, s);
    s = seg.at;
    e = seg.at + seg.text.length;
  }

  const out: TextRun[] = [];
  let at = 0;
  for (const r of runs) {
    const rs = at;
    const re = at + r.text.length;
    at = re;

    // 区间外的部分原样保留。
    const before = r.text.slice(0, Math.max(0, s - rs));
    const inside = r.text.slice(Math.max(0, s - rs), Math.max(0, e - rs));
    const after = r.text.slice(Math.max(0, e - rs));

    if (before) out.push({ text: before, style: r.style ? { ...r.style } : undefined });
    if (inside) out.push({ text: inside, style: mergeStyle(r.style, patch) });
    if (after) out.push({ text: after, style: r.style ? { ...r.style } : undefined });
  }
  return normalizeRuns(out);
}

/** 把 run 数组里**某个区间**的样式整体重置为「继承元素级」。 */
export function clearSpanStyle(
  runs: readonly TextRun[],
  start: number,
  end: number,
  keys?: readonly SpanStyleKey[],
): TextRun[] {
  const patch: SpanStylePatch = {};
  for (const k of keys ?? SPAN_STYLE_KEYS) (patch as Record<string, unknown>)[k] = null;
  return applySpanStyle(runs, start, end, patch);
}

function mergeStyle(style: TextSpanStyle | undefined, patch: SpanStylePatch): TextSpanStyle | undefined {
  const next: Record<string, unknown> = { ...(style ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return Object.keys(next).length ? (next as TextSpanStyle) : undefined;
}

function segmentAt(
  runs: readonly TextRun[],
  offset: number,
): { at: number; text: string; style?: TextSpanStyle } {
  let at = 0;
  for (const r of runs) {
    const end = at + r.text.length;
    if (offset >= at && offset < end) return { at, text: r.text, style: r.style };
    at = end;
  }
  const last = runs[runs.length - 1] ?? { text: '' };
  return { at: Math.max(0, at - last.text.length), text: last.text, style: last.style };
}

/** 有没有任何一段带覆盖（`Ctrl+\` 清除格式时用得上，也用于「是否富文本」的判断）。 */
export function hasSpanOverrides(runs: readonly TextRun[]): boolean {
  return runs.some((r) => r.style && Object.keys(r.style).length > 0);
}

/**
 * runs 的内容签名。DOM 同步据此判断「要不要重建节点」，
 * `runsEquivalent` 据此判断「这次编辑有没有改变内容」。
 *
 * ⚠️ **必须带上文本本身**（这里用长度 + FNV-1a 摘要，不存原文是为了不让
 * DOM 属性里塞进整段文字）。曾经只写 `text.length` —— 于是「ab → ac」这种
 * **等长替换**被判成「没变化」，编辑被静默丢弃、DOM 也不重建。单测抓到的。
 *
 * 只含文本与覆盖样式：元素级样式变了不影响这个签名（那走 CSS 那条路）。
 */
export function runsSignature(runs: readonly TextRun[]): string {
  return runs
    .map((r) => {
      const s = r.style
        ? SPAN_STYLE_KEYS.filter((k) => r.style![k] !== undefined)
            .map((k) => `${k}=${String(r.style![k])}`)
            .join(',')
        : '';
      return `${r.text.length}.${fnv1a(r.text)}:${s}`;
    })
    .join('|');
}

/**
 * 从 DOM 读回来的一组 run 做一次**等价性**判断（决定要不要写库）。
 *
 * 不能直接比 `runsSignature`：DOM 里可能把相邻同款 run 拆成两个 span，
 * 归一化之后才是可比的。
 */
export function runsEquivalent(a: readonly TextRun[], b: readonly TextRun[]): boolean {
  return runsSignature(normalizeRuns(a)) === runsSignature(normalizeRuns(b));
}
