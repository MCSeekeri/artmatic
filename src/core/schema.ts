/**
 * schema.ts — 工程数据模型（AGENTS.md §5 的落地）+ schemaVersion + 迁移。
 *
 * 判别联合就是「轨道不区分内容」的实现：
 *   Track = VisualTrack | SoundTrack（命名避开 WebAudio 的 AudioTrack）
 *   AnyClip = SourceClip | EffectClip | AudioClip
 *
 * curves 的键约定：
 *   SourceClip  —— 保留字 'opacity' / 'transform.x' / 'transform.y' / 'transform.sx' /
 *                 'transform.sy' / 'transform.rot'；algo 源另有生成器参数键（如 'zoom'）。
 *   EffectClip  —— `${instanceId}.${paramKey}`，作用于 chain 里某个特效实例的参数。
 *   AudioClip   —— 'gain'。
 */

import type { BeatGrid } from './time';
import type { Curve } from './curve';
import type { TypographyDocument } from '../typography/document';
import { tr } from '../i18n/index.svelte';
import type { MessageKey } from '../i18n/locales';

export const SCHEMA_VERSION = 2;

export type OverlapBehavior = 'push' | 'reject' | 'trim';

export interface Project {
  schemaVersion: number;
  name: string;
  /** 全工程随机种子（硬约束 1.2 的根）。 */
  seed: number;
  fps: number;
  resolution: { w: number; h: number };
  /** 秒。 */
  duration: number;
  beatGrid: BeatGrid;
  /** 同轨重叠策略：可配置（挤开邻居 / 拒绝落点 / 吃掉邻居重叠部分），默认 reject。 */
  overlapBehavior: OverlapBehavior;
  assets: Record<string, Asset>;
  tracks: Track[];
}

export interface Asset {
  id: string;
  kind: 'audio' | 'image';
  name: string;
  /** 内容哈希（M5 引用制的预留，MVP 不强制）。 */
  hash?: string;
  durationSec?: number;
  size?: { w: number; h: number };
}

/* ---------------------------------------------------------------- tracks */

export type Track = VisualTrack | SoundTrack;

interface TrackBase {
  id: string;
  name: string;
  enabled: boolean;
}

export interface VisualTrack extends TrackBase {
  kind: 'visual';
  /** 同轨不重叠，按 start 排序。 */
  clips: (SourceClip | EffectClip)[];
}

export interface SoundTrack extends TrackBase {
  kind: 'audio';
  clips: AudioClip[];
  bus: 'master' | string;
}

/* ----------------------------------------------------------------- clips */

export type AnyClip = SourceClip | EffectClip | AudioClip;

export interface ClipBase {
  id: string;
  start: number;
  end: number;
  label: string;
  fadeSec: number;
  curves: Record<string, Curve>;
}

export type BlendMode =
  | 'normal' | 'multiply' | 'add' | 'screen'
  | 'overlay' | 'difference' | 'exclusion' | 'subtract';

/** 混合模式表。存文案键而非字符串 —— 理由见 effects/types.ts 的注释。 */
export const BLEND_MODES: { id: BlendMode; labelKey: MessageKey }[] = [
  { id: 'normal', labelKey: 'blend.normal' },
  { id: 'multiply', labelKey: 'blend.multiply' },
  { id: 'add', labelKey: 'blend.add' },
  { id: 'screen', labelKey: 'blend.screen' },
  { id: 'overlay', labelKey: 'blend.overlay' },
  { id: 'difference', labelKey: 'blend.difference' },
  { id: 'exclusion', labelKey: 'blend.exclusion' },
  { id: 'subtract', labelKey: 'blend.subtract' },
];

export type AlgoSource = { type: 'algo'; generator: string; params: Record<string, number | string> };

/** 有画面来源，参与合成。被特效影响的就是它。 */
export interface SourceClip extends ClipBase {
  kind: 'source';
  source:
    // MVP 实现 image / algo / solid / text 四种；video 只留类型位置（M5）。
    | { type: 'video'; assetId: string; srcIn: number; speed: number }
    | { type: 'image'; assetId: string }
    | AlgoSource
    | { type: 'text'; doc: TypographyDocument }
    | { type: 'solid'; color: string };
  blend: BlendMode;
  opacity: number;
  transform: { x: number; y: number; sx: number; sy: number; rot: number };
  fit: 'contain' | 'cover' | 'stretch';
}

/** 特效实例：参考 openmosh EffectInstance，去掉 mosh/volumeLink。 */
export interface EffectInstance {
  instanceId: string;
  defId: string;
  enabled: boolean;
  values: Record<string, number | string>;
}

/**
 * 无画面来源，把自己插进渲染链。语义 = AE adjustment layer：
 * 只作用于 z 序在它之下所有 SourceClip 的合成结果。
 */
export interface EffectClip extends ClipBase {
  kind: 'effect';
  chain: EffectInstance[];
}

/** 声音事件，不参与视觉合成。 */
export interface AudioClip extends ClipBase {
  kind: 'audio';
  assetId: string;
  srcIn: number;
}

/* ------------------------------------------------------------- 构造工具 */

export function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // 非安全上下文（如旧版 headless）的兜底；不追求加密强度。
  return 'xxxxxxxx-xxxx-4xxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)) +
    String(Date.now()).slice(-8);
}

export function defaultTransform(): SourceClip['transform'] {
  return { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 };
}

export function defaultProject(name = tr('proj.unnamed')): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    seed: 0xa27a11c,
    fps: 30,
    resolution: { w: 1920, h: 1080 },
    duration: 16,
    beatGrid: { bpm: 120, offset: 0, beatsPerBar: 4 },
    overlapBehavior: 'reject',
    assets: {},
    tracks: [],
  };
}

/* ----------------------------------------------------------- 校验与迁移 */

class SchemaError extends Error {}

/**
 * 迁移函数表：MIGRATIONS[v] 把版本 v 的工程升到 v+1。
 * 第一天就是空表 + 版本检查——M5 的原子写 / 迁移链条在这里生长，不要事后打补丁。
 */
const MIGRATIONS: Record<number, (p: Record<string, unknown>) => Record<string, unknown>> = {
  /**
   * v1 → v2：SourceClip 的 text 源从「只留类型位置」（doc: unknown）变成真正的
   * TypographyDocument。
   *
   * v1 里从来没有出现过 text 片段，所以这条迁移在实践中几乎不会命中；写它是因为
   * 「迁移链第一天就有」是项目纪律（M0 就写下的），而且手改过的 JSON 可能带着
   * 一个形状不对的 doc，不补的话 validateProject 会在更远的地方炸。
   *
   * 注意这里**直接写字面量**而不是调 createTypographyDocument()：那会构成
   * core/schema.ts ↔ typography/document.ts 的运行时循环依赖（后者运行时要用
   * 本文件的 newId）。ESM 能容忍这个循环，但很脆 —— 不值得为省两行字去赌。
   */
  1: (p) => {
    const tracks = (p.tracks as { clips?: unknown[] }[] | undefined) ?? [];
    for (const t of tracks) {
      for (const c of (t.clips ?? []) as {
        kind?: string;
        source?: { type?: string; doc?: unknown };
      }[]) {
        if (c.kind !== 'source' || c.source?.type !== 'text') continue;
        const doc = c.source.doc as TypographyDocument | undefined;
        if (!doc || typeof doc !== 'object' || !Array.isArray(doc.elements) || !doc.size) {
          c.source.doc = { size: { w: 1920, h: 1080 }, background: { kind: 'none' }, elements: [], fonts: [] };
        }
      }
    }
    return { ...p, schemaVersion: 2 };
  },
};

export function migrateProject(raw: Record<string, unknown>): Project {
  const rawV = raw.schemaVersion;
  if (typeof rawV !== 'number') throw new SchemaError(tr('err.schema.missingVersion'));
  if (rawV > SCHEMA_VERSION) {
    throw new SchemaError(tr('err.schema.versionTooNew', { found: rawV, supported: SCHEMA_VERSION }));
  }
  let v = rawV;
  let cur = raw;
  while (v < SCHEMA_VERSION) {
    const mig = MIGRATIONS[v];
    if (!mig) throw new SchemaError(tr('err.schema.missingMigration', { version: v }));
    cur = mig(cur);
    v = cur.schemaVersion as number;
  }
  return validateProject(cur);
}

export function validateProject(raw: unknown): Project {
  const p = raw as Project;
  if (!p || typeof p !== 'object') throw new SchemaError(tr('err.schema.notObject'));
  if (typeof p.name !== 'string') throw new SchemaError(tr('err.schema.missingName'));
  if (typeof p.fps !== 'number' || p.fps <= 0) throw new SchemaError(tr('err.schema.badFps'));
  if (!p.resolution || p.resolution.w <= 0 || p.resolution.h <= 0) {
    throw new SchemaError(tr('err.schema.badResolution'));
  }
  if (typeof p.duration !== 'number' || p.duration <= 0) throw new SchemaError(tr('err.schema.badDuration'));
  if (!p.beatGrid || p.beatGrid.bpm <= 0 || p.beatGrid.beatsPerBar < 1) {
    throw new SchemaError(tr('err.schema.badBeatGrid'));
  }
  if (typeof p.seed !== 'number') throw new SchemaError(tr('err.schema.badSeed'));
  if (p.overlapBehavior !== 'push' && p.overlapBehavior !== 'reject' && p.overlapBehavior !== 'trim') {
    throw new SchemaError(tr('err.schema.badOverlap'));
  }
  if (!p.assets || typeof p.assets !== 'object') throw new SchemaError(tr('err.schema.badAssets'));
  if (!Array.isArray(p.tracks)) throw new SchemaError(tr('err.schema.badTracks'));
  // 循环变量刻意叫 tk 而不是 tr：`tr` 是翻译函数的专名（i18n/index.svelte.ts），
  // 同名会把下面那两次取词整成「tr is not a function」。
  for (const tk of p.tracks as { kind: string; clips: unknown }[]) {
    if (tk.kind !== 'visual' && tk.kind !== 'audio') {
      throw new SchemaError(tr('err.schema.unknownTrackKind', { kind: String(tk.kind) }));
    }
    if (!Array.isArray(tk.clips)) throw new SchemaError(tr('err.schema.trackMissingClips'));
    for (const c of tk.clips as AnyClip[]) validateClip(c, tk.kind);
  }
  return p;
}

function validateClip(c: AnyClip, trackKind: Track['kind']): void {
  if (typeof c.id !== 'string' || !c.id) throw new SchemaError(tr('err.schema.clipMissingId'));
  if (!(c.start >= 0) || !(c.end > c.start)) {
    throw new SchemaError(tr('err.schema.clipBadSpan', { id: c.id }));
  }
  if (typeof c.fadeSec !== 'number' || c.fadeSec < 0) {
    throw new SchemaError(tr('err.schema.clipBadFade', { id: c.id }));
  }
  if (!c.curves || typeof c.curves !== 'object') {
    throw new SchemaError(tr('err.schema.clipBadCurves', { id: c.id }));
  }
  if (trackKind === 'audio') {
    if (c.kind !== 'audio') throw new SchemaError(tr('err.schema.audioTrackHasNonAudio'));
  } else {
    if (c.kind !== 'source' && c.kind !== 'effect') {
      throw new SchemaError(tr('err.schema.visualTrackHasNonVisual'));
    }
    if (c.kind === 'effect' && !Array.isArray((c as EffectClip).chain)) {
      throw new SchemaError(tr('err.schema.effectClipMissingChain', { id: c.id }));
    }
    // text 源的最小校验。validateProject 历史上不深校验 source 字段，
    // 手改 JSON 会一路静默穿透到光栅化，在那里炸得莫名其妙。
    if (c.kind === 'source') {
      const src = (c as SourceClip).source as { type?: string; doc?: unknown } | undefined;
      if (src?.type === 'text') {
        const doc = src.doc as TypographyDocument | undefined;
        if (!doc || typeof doc !== 'object' || !Array.isArray(doc.elements)) {
          throw new SchemaError(tr('err.schema.typographyBadDoc', { id: c.id }));
        }
        if (!doc.size || !(doc.size.w > 0) || !(doc.size.h > 0)) {
          throw new SchemaError(tr('err.schema.typographyBadSize', { id: c.id }));
        }
      }
    }
  }
}

/** 深拷贝（工程是纯 JSON，structuredClone 足够）。 */
export function cloneProject(p: Project): Project {
  return structuredClone(p);
}
