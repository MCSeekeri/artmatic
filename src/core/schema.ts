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

export const SCHEMA_VERSION = 1;

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

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: '正常' },
  { id: 'multiply', label: '正片叠底' },
  { id: 'add', label: '线性加深(加)' },
  { id: 'screen', label: '滤色' },
  { id: 'overlay', label: '叠加' },
  { id: 'difference', label: '差值' },
  { id: 'exclusion', label: '排除' },
  { id: 'subtract', label: '减去' },
];

export type AlgoSource = { type: 'algo'; generator: string; params: Record<string, number | string> };

/** 有画面来源，参与合成。被特效影响的就是它。 */
export interface SourceClip extends ClipBase {
  kind: 'source';
  source:
    // MVP 实现 image / algo / solid 三种；video 与 text 只留类型位置（M5 / M4）。
    | { type: 'video'; assetId: string; srcIn: number; speed: number }
    | { type: 'image'; assetId: string }
    | AlgoSource
    | { type: 'text'; doc: unknown }
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

export function defaultProject(name = '未命名工程'): Project {
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
const MIGRATIONS: Record<number, (p: Record<string, unknown>) => Record<string, unknown>> = {};

export function migrateProject(raw: Record<string, unknown>): Project {
  const rawV = raw.schemaVersion;
  if (typeof rawV !== 'number') throw new SchemaError('缺少 schemaVersion');
  if (rawV > SCHEMA_VERSION) {
    throw new SchemaError(`工程版本 ${rawV} 高于本应用支持的 ${SCHEMA_VERSION}，请升级应用`);
  }
  let v = rawV;
  let cur = raw;
  while (v < SCHEMA_VERSION) {
    const mig = MIGRATIONS[v];
    if (!mig) throw new SchemaError(`缺少从版本 ${v} 的迁移函数`);
    cur = mig(cur);
    v = cur.schemaVersion as number;
  }
  return validateProject(cur);
}

export function validateProject(raw: unknown): Project {
  const p = raw as Project;
  if (!p || typeof p !== 'object') throw new SchemaError('不是对象');
  if (typeof p.name !== 'string') throw new SchemaError('缺少 name');
  if (typeof p.fps !== 'number' || p.fps <= 0) throw new SchemaError('fps 非法');
  if (!p.resolution || p.resolution.w <= 0 || p.resolution.h <= 0) throw new SchemaError('resolution 非法');
  if (typeof p.duration !== 'number' || p.duration <= 0) throw new SchemaError('duration 非法');
  if (!p.beatGrid || p.beatGrid.bpm <= 0 || p.beatGrid.beatsPerBar < 1) throw new SchemaError('beatGrid 非法');
  if (typeof p.seed !== 'number') throw new SchemaError('seed 非法');
  if (p.overlapBehavior !== 'push' && p.overlapBehavior !== 'reject' && p.overlapBehavior !== 'trim') {
    throw new SchemaError('overlapBehavior 非法');
  }
  if (!p.assets || typeof p.assets !== 'object') throw new SchemaError('assets 非法');
  if (!Array.isArray(p.tracks)) throw new SchemaError('tracks 非法');
  for (const tr of p.tracks as { kind: string; clips: unknown }[]) {
    if (tr.kind !== 'visual' && tr.kind !== 'audio') throw new SchemaError(`未知轨道类型 ${String(tr.kind)}`);
    if (!Array.isArray(tr.clips)) throw new SchemaError('轨道缺少 clips');
    for (const c of tr.clips as AnyClip[]) validateClip(c, tr.kind);
  }
  return p;
}

function validateClip(c: AnyClip, trackKind: Track['kind']): void {
  if (typeof c.id !== 'string' || !c.id) throw new SchemaError('片段缺少 id');
  if (!(c.start >= 0) || !(c.end > c.start)) throw new SchemaError(`片段 ${c.id} 时间区间非法`);
  if (typeof c.fadeSec !== 'number' || c.fadeSec < 0) throw new SchemaError(`片段 ${c.id} fadeSec 非法`);
  if (!c.curves || typeof c.curves !== 'object') throw new SchemaError(`片段 ${c.id} curves 非法`);
  if (trackKind === 'audio') {
    if (c.kind !== 'audio') throw new SchemaError('音频轨里有非音频片段');
  } else {
    if (c.kind !== 'source' && c.kind !== 'effect') throw new SchemaError('视觉轨里有非视觉片段');
    if (c.kind === 'effect' && !Array.isArray((c as EffectClip).chain)) {
      throw new SchemaError(`特效片段 ${c.id} 缺少 chain`);
    }
  }
}

/** 深拷贝（工程是纯 JSON，structuredClone 足够）。 */
export function cloneProject(p: Project): Project {
  return structuredClone(p);
}
