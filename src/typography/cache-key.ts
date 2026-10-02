/**
 * cache-key.ts — 光栅化缓存的键（纯函数，不碰 DOM）。
 *
 * 两条设计约束：
 *  1. **只哈希文档本身**，不掺 store 的全局 version。否则改一下无关片段的名字
 *     就会把所有排版层的缓存全部击穿，等于没有缓存。
 *  2. **静态文档不带帧号**。绝大多数标题卡没有动画，整个片段生命期只该光栅化
 *     一次；带上帧号会让它每帧重做一遍。
 */

import type { TypographyDocument } from './document';
import { docIsAnimated } from './animation';

/**
 * 稳定 JSON：对象键排序后再序列化。
 *
 * 为什么要自己写：`JSON.stringify` 按插入顺序输出键，而 `{a:1,b:2}` 与
 * `{b:2,a:1}` 是同一个文档但会产出不同的字符串 —— 缓存会莫名其妙地不命中。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${stableStringify(v)}`);
  }
  return `{${parts.join(',')}}`;
}

/** FNV-1a 32 位。够用：这里的碰撞后果只是缓存错命中，不是安全问题。 */
export function fnv1a(s: string, seed = 0x811c9dc5): string {
  let h = seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 文档内容哈希。 */
export function docHash(doc: TypographyDocument): string {
  return fnv1a(stableStringify(doc));
}

export interface RasterKeyInput {
  docHash: string;
  /** 目标位图像素宽（已含 previewScale）。 */
  w: number;
  /** 目标位图像素高。 */
  h: number;
  /** 静态文档传 null；动画文档传片段内帧号。 */
  frame: number | null;
}

export function rasterKey(i: RasterKeyInput): string {
  return `${i.docHash}|${i.w}x${i.h}|${i.frame ?? '-'}`;
}

/** 由文档直接算键。 */
export function rasterKeyForDoc(
  doc: TypographyDocument,
  w: number,
  h: number,
  frame: number | null,
): string {
  return rasterKey({ docHash: docHash(doc), w, h, frame });
}

/**
 * 该文档此刻应当用哪个帧号进缓存键。
 * 静态文档返回 null → 尺寸相同就永远命中同一条缓存。
 */
export function frameKeyFor(doc: TypographyDocument, frame: number): number | null {
  return docIsAnimated(doc) ? frame : null;
}
