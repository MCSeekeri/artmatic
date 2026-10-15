/**
 * clipboard.ts — 片段剪贴板的**纯逻辑**（无 DOM、无 store，可单测）。
 *
 * ## 契约
 *
 * 复制 / 剪切片段时，往系统剪贴板写一段自有 JSON：
 *
 * ```json
 * { "kind": "artmatic/clips", "version": 1, "clips": [{ "trackId": "...", "clip": {...} }] }
 * ```
 *
 * 粘贴时先 `parseClipboard(text)`：命中自家格式才接管（并 `preventDefault`），
 * **没命中必须整段放行** —— 否则输入框与文本编辑区的粘贴会整个失灵
 * （这是 `App.onPaste` 既有的纪律，见那里的注释）。
 *
 * `parseClipboard` **永不抛**：非 JSON、JSON 但不是我们的格式、字段形状不对，
 * 一律返回 null。剪贴板是用户的地盘，什么内容都可能出现在那里。
 *
 * ## 跨工程
 *
 * 片段里可能引用**目标工程不存在**的素材（assetId）。落点规划照常给出位置，
 * 但打上 `assetMissing` 标记 —— 画面按「脱机媒体」占位符表现（见
 * `core/offline-media.ts`），而不是静默丢掉片段。静默丢弃是更难查的坏法：
 * 用户看到的是「粘贴了但什么都没有」。
 */

import type { AnyClip } from './schema';
import type { BeatGrid } from './time';

/** 剪贴板载荷的类型标识。 */
export const CLIP_KIND = 'artmatic/clips' as const;

/** 载荷里的一个片段：带上**复制时所在的轨**（同工程粘贴优先回原轨位）。 */
export interface ClipboardEntry {
  trackId: string;
  clip: AnyClip;
}

export interface ClipboardPayload {
  kind: typeof CLIP_KIND;
  version: 1;
  clips: ClipboardEntry[];
  /** 复制时的工程名，仅用于跨工程粘贴时的一句提示。 */
  originName?: string;
}

/** 落点规划所需的上下文（由调用方从 store 与 UI 状态里取）。 */
export interface PasteContext {
  /** 全部轨道（id + 类型），按数组序。 */
  tracks: readonly { id: string; kind: 'visual' | 'audio' }[];
  /**
   * 优先落这条轨（当前选中片段所在轨）。复制时的原轨位优先级更高。
   */
  preferredTrackId?: string | null;
  /** 目标工程里有哪些素材 id（跨工程判「素材缺失」用）。 */
  knownAssetIds: ReadonlySet<string>;
  /** 拍网格（预留：落点吸附由调用方做，这里不读）。 */
  grid: BeatGrid;
}

/** 一个片段的落点与附加信息。 */
export interface PastePlanItem {
  clip: AnyClip;
  /** 落在哪条轨；null = 没有能装的轨（调用方跳过并说明）。 */
  trackId: string | null;
  /** 引用了目标工程里不存在的素材（画面按脱机媒体占位符表现）。 */
  assetMissing: boolean;
}

/** 片段引用的素材 id（没有素材引用的片段给空数组）。 */
export function clipAssetIds(clip: AnyClip): string[] {
  if (clip.kind === 'audio') return [clip.assetId];
  if (clip.kind === 'source' && (clip.source.type === 'image' || clip.source.type === 'video')) {
    return [clip.source.assetId];
  }
  return [];
}

/**
 * 序列化成剪贴板文本。片段的 `start` / `end` 一起归一成「相对第一个片段」——
 * 粘贴时按锚点整体平移，保留片段之间的相对关系（只搬 start 的话片段长度会
 * 变成「原 end − 新 start」，被拉长或压扁）。
 */
export function serializeClips(entries: readonly ClipboardEntry[], originName?: string): string {
  if (!entries.length) return '';
  const base = Math.min(...entries.map((e) => e.clip.start));
  const payload: ClipboardPayload = {
    kind: CLIP_KIND,
    version: 1,
    clips: entries.map((e) => ({
      trackId: e.trackId,
      clip: { ...e.clip, start: e.clip.start - base, end: e.clip.end - base },
    })),
    ...(originName ? { originName } : {}),
  };
  return JSON.stringify(payload);
}

function isClipLike(v: unknown): v is AnyClip {
  if (!v || typeof v !== 'object') return false;
  const c = v as { kind?: unknown; id?: unknown; start?: unknown; end?: unknown };
  return (
    typeof c.kind === 'string' &&
    (c.kind === 'source' || c.kind === 'effect' || c.kind === 'audio') &&
    typeof c.id === 'string' &&
    typeof c.start === 'number' &&
    typeof c.end === 'number'
  );
}

/**
 * 解析剪贴板文本。**永不抛** —— 不是我们的格式一律 null。
 *
 * 严格校验 `kind` 与 `version`：版本不同的载荷形状可能已经变了，
 * 照旧解析会写出半截片段（那种损坏要到渲染期才以「画面缺一块」显形）。
 */
export function parseClipboard(text: string): ClipboardPayload | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as { kind?: unknown; version?: unknown; clips?: unknown; originName?: unknown };
  if (p.kind !== CLIP_KIND || p.version !== 1) return null;
  if (!Array.isArray(p.clips) || !p.clips.length) return null;
  for (const e of p.clips as unknown[]) {
    if (!e || typeof e !== 'object') return null;
    const entry = e as { trackId?: unknown; clip?: unknown };
    if (typeof entry.trackId !== 'string') return null;
    if (!isClipLike(entry.clip)) return null;
  }
  const clips = (p.clips as { trackId: string; clip: AnyClip }[]).map((e) => ({
    trackId: e.trackId,
    clip: e.clip,
  }));
  return {
    kind: CLIP_KIND,
    version: 1,
    clips,
    ...(typeof p.originName === 'string' ? { originName: p.originName } : {}),
  };
}

/**
 * 纯计算：每个片段落到哪条轨、素材是否缺失。**不写任何状态。**
 *
 * 落点优先级：**复制时的原轨位**（同 id 的轨还在、且装得下这个片段）→
 * 选中片段所在轨 → 第一条装得下的轨。一条都不行 ⇒ `trackId` 为 null
 * （调用方跳过该片段并说明，不静默丢弃）。
 *
 * 同轨重叠的顺延 / 裁切不在这里做 —— 那由 `ProjectStore.pasteClips` 复用
 * `addClip` 的同一段几何处理（两处各写一份必然分叉）。
 */
export function planPaste(payload: ClipboardPayload, ctx: PasteContext): PastePlanItem[] {
  const missing = new Set<string>();
  for (const e of payload.clips) {
    for (const id of clipAssetIds(e.clip)) if (!ctx.knownAssetIds.has(id)) missing.add(id);
  }
  const trackById = new Map(ctx.tracks.map((t) => [t.id, t]));
  // 「第一条装得下的轨」：与片段同类型的第一条。
  const fallbackOf = (clip: AnyClip): string | null => {
    const wantAudio = clip.kind === 'audio';
    return ctx.tracks.find((t) => (t.kind === 'audio') === wantAudio)?.id ?? null;
  };

  return payload.clips.map((e) => {
    const canUse = (id: string | null | undefined): boolean => {
      if (!id) return false;
      const t = trackById.get(id);
      if (!t) return false;
      return (t.kind === 'audio') === (e.clip.kind === 'audio');
    };
    const trackId =
      (canUse(e.trackId) ? e.trackId : null) ??
      (canUse(ctx.preferredTrackId) ? ctx.preferredTrackId : null) ??
      fallbackOf(e.clip);
    return {
      clip: e.clip,
      trackId,
      assetMissing: clipAssetIds(e.clip).some((id) => missing.has(id)),
    };
  });
}
