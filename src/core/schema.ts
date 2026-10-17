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
import type { KeySettings, QuadCorners } from './image-fx';
import type { TypographyDocument } from '../typography/document';
import {
  isKnownTheme,
  parseThemeRef,
  resolveThemeColor,
  sanitizeCustomThemes,
  type TypographyTheme,
} from '../typography/theme';
import { tr } from '../i18n/index.svelte';
import type { MessageKey } from '../i18n/locales';

export const SCHEMA_VERSION = 7;

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
  /**
   * 工程默认的排版配色方案 id（新文本片段的文档默认；也供检查器里的
   * 非排版取色入口解析主题色引用）。缺省 = `DEFAULT_THEME_ID`。
   */
  typographyTheme?: string;
  /**
   * 用户自定义配色方案（随工程保存，属工程内容）。id 不得与内置方案冲突。
   * 缺省 = 无。坏数据由 `validateProject` 整条丢掉（详见那里的注释）。
   */
  customThemes?: TypographyTheme[];
}

export interface Asset {
  id: string;
  /**
   * `video` 在 M6 接上（`engine/video-source.ts`）。台账层
   * （`project/ledger.ts` 的 `AssetEntry.kind`）从 M5a 起就已经有它了，
   * 这里落后了一格 —— 于是「导入视频 → 存进工程 → 打开时按 kind 分支」
   * 会在校验处对不上。
   */
  kind: 'audio' | 'image' | 'video';
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

/**
 * 出画转场（gl-transitions 的一条）。
 *
 * 窗口以 `clip.end` 为剪切点、前后各 `duration / 2`，两侧的内容由窗口解析
 * （`core/transitions.ts`）自动取到「同轨紧邻的下一个 SourceClip」，所以这里
 * **不存 toClipId** —— 存 id 会引入悬空引用与它的一整套清理逻辑，而片段几何
 * 天然保持相邻（push / trim 都保持）。
 */
export interface TransitionRef {
  /** gl-transitions 条目的 name（如 'CrossZoom'）。渲染侧据此取 GLSL。 */
  defId: string;
  /** 秒。窗口总长；实际生效值还会被两侧片段长度与相邻转场钳制。 */
  duration: number;
  /**
   * 扁平化的标量参数，键由 `effects/transitions/params.ts` 派生
   * （向量会被拆成 `foo#0` / `foo#1`…，于是这里能保持 `Record<string, number>`，
   * 与 EffectInstance.values 的标量约定一致）。
   */
  values: Record<string, number>;
}

/*
 * 抠图 / 四角的类型与出厂值住在 `core/image-fx.ts`（纯数学、零运行时依赖）：
 * 排版文档的 `ImageElement` 也要用同一组字段，而那个模块反过来被本文件 import。
 * 定义放在叶子模块里才不会形成运行时循环。
 */
export type { KeySettings, QuadCorners } from './image-fx';
export { defaultKeySettings, identityQuad } from './image-fx';

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
  /**
   * 简易抠图（色键）。缺省 = 不抠；作用于**本层** alpha（渲染在 placement pass）。
   * 抠掉之后露出来的是什么由普通合成决定（z 序下面的轨道），与特效片段无关。
   */
  key?: KeySettings;
  /**
   * 四角调整（透视变形）。缺省 = 恒等（不调整）；坐标在**层空间**，见 `QuadCorners`。
   * 与 `transform` 复合：变换先摆好图层矩形，四角再把这个矩形透视变形。
   */
  quad?: QuadCorners;
  /** 出画转场。缺失 = 不设转场。语义与钳制规则见 core/transitions.ts。 */
  transitionOut?: TransitionRef;
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
  /**
   * **影响深度**：只作用于其下方最近的 N 条**启用**视觉轨（1 起数）；
   * `0` / 缺省 = 下方全部（即 v4 的行为）。
   *
   * 语义与实现都在 `engine/stack.ts`（渲染侧的唯一真源）：
   * `N > 0` 时这个片段的作用域变成一段**独立合成的组画面**（从透明起），
   * 特效作用在它上面，再以 normal 贴回下层 —— 所以它看不到作用域之外的轨道。
   * 边界情形（内层特效需要更深的轨道、下方没有启用轨）见那份文件头。
   */
  affectDepth?: number;
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

  /**
   * v2 → v3：`SourceClip` 新增可选的 `transitionOut`（出画转场）。
   *
   * **这是一条恒等迁移**：字段可选，v2 的工程读进来天然合法，没有任何要改写的
   * 东西。写它的唯一目的是**把版本号抬上去** —— 于是新版存出的工程被旧版打开时
   * 会走 `versionTooNew` 明确报错，而不是静默忽略 `transitionOut` 再保存
   * （那会把用户的转场悄悄抹掉，是最难查的一类数据丢失）。
   */
  2: (p) => ({ ...p, schemaVersion: 3 }),

  /**
   * v3 → v4：`TextElement.text: string` → `runs: TextRun[]`（富文本）。
   *
   * 这是**真正要改写数据**的一条：v3 的每个文本元素都有一个 `text` 字段，
   * 升上来之后它必须变成只有一个 run 的 `runs`，否则富文本渲染读到 `undefined`
   * 会渲染成空白 —— 用户的标题直接消失，而控制台没有任何报错。
   *
   * 反向不成立：`runs` 表达不了的文字（被删掉的覆盖样式信息）没法回到 `text`。
   * 所以升上来之后不要再降回去。
   */
  3: (p) => {
    const tracks = (p.tracks as { clips?: unknown[] }[] | undefined) ?? [];
    for (const t of tracks) {
      for (const c of (t.clips ?? []) as {
        kind?: string;
        source?: { type?: string; doc?: TypographyDocument };
      }[]) {
        if (c.kind !== 'source' || c.source?.type !== 'text') continue;
        const doc = c.source.doc;
        if (!doc || !Array.isArray(doc.elements)) continue;
        for (const el of doc.elements as unknown as (Record<string, unknown> & { kind?: string })[]) {
          if (el.kind !== 'text') continue;
          if (Array.isArray(el.runs)) {
            delete el.text;
            continue;
          }
          const text = typeof el.text === 'string' ? el.text : '';
          el.runs = [{ text }];
          delete el.text;
        }
        // `groups` 在这一版补齐。**可选字段**，但补上空数组能让
        // 「老工程 vs 新工程」在 stableStringify 下的差异少一处。
        if (!Array.isArray((doc as unknown as { groups?: unknown }).groups)) {
          (doc as unknown as { groups: unknown[] }).groups = [];
        }
      }
    }
    return { ...p, schemaVersion: 4 };
  },

  /**
   * v4 → v5：`EffectClip` 新增可选的 `affectDepth`（影响深度）。
   *
   * **恒等迁移**：缺省 / 0 就是 v4 的行为（作用于下方全部），没有任何要改写的东西。
   * 抬版本号的唯一目的仍然是让「新版存出的工程被旧版打开」走 `versionTooNew` 明确报错
   * —— 旧版静默忽略 `affectDepth` 再保存，用户调好的作用域就没了。
   */
  4: (p) => ({ ...p, schemaVersion: 5 }),

  /**
   * v5 → v6：`Project` 新增可选的 `typographyTheme` / `customThemes`
   * （工程级配色方案 + 用户自定义方案）。
   *
   * **恒等迁移**：两个字段都可选，v5 的工程读进来天然合法，没有任何要改写的
   * 东西。抬版本号的唯一目的仍然是让「新版存出的工程被旧版打开」走
   * `versionTooNew` 明确报错 —— 旧版静默忽略 `customThemes` 再保存，
   * 用户自己调的那套配色就没了（静默数据丢失，最难查的一类）。
   */
  5: (p) => ({ ...p, schemaVersion: 6 }),

  /**
   * v6 → v7：`SourceClip` 新增可选的 `key`（简易抠图）/ `quad`（四角调整）。
   *
   * **恒等迁移**：两个字段都可选（缺省语义分别是「不抠」与「不调整」），v6 的
   * 工程读进来天然合法，没有任何要改写的东西。抬版本号的唯一目的仍然是让
   * 「新版存出的工程被旧版打开」走 `versionTooNew` 明确报错 —— 旧版静默忽略这两个
   * 字段再保存，用户调好的抠图与四角就没了（静默数据丢失，最难查的一类）。
   */
  6: (p) => ({ ...p, schemaVersion: 7 }),
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
  /*
   * 工程级配色方案（v6 的两个可选字段）。**坏数据回落而不是抛错** ——
   * 工程必须打得开，颜色这种事不值得让整份工程打不开。
   *   - customThemes：逐条校验（`sanitizeCustomThemes`），坏条目整条丢；
   *   - typographyTheme：引用了一个不存在的方案 id（自定义方案被手删 / 工程
   *     来自更早的版本）→ 删掉这个键，读时自然回落默认方案。
   */
  const custom = sanitizeCustomThemes((p as { customThemes?: unknown }).customThemes);
  if (custom.length) (p as { customThemes?: TypographyTheme[] }).customThemes = custom;
  else delete (p as { customThemes?: TypographyTheme[] }).customThemes;
  const declared = (p as { typographyTheme?: unknown }).typographyTheme;
  if (declared !== undefined) {
    if (typeof declared === 'string' && isKnownTheme(declared, custom)) {
      (p as { typographyTheme?: string }).typographyTheme = declared;
    } else {
      delete (p as { typographyTheme?: string }).typographyTheme;
    }
  }
  /*
   * 顺手修掉历史数据里的「主题色引用跑进非排版颜色参数」。
   *
   * 取色卡对所有颜色入口都提供主题色（`@accent1`），但只有排版文档会在渲染时
   * 解析引用；算法参数 / 特效参数 / 纯色片段的颜色直接进 `hexToRgba()`，
   * 那里的坏颜色回退是**品红**。用户挑一个主题色，画面整片变品红，
   * 而参数表里存的是一串 `@accent1` —— 从界面上完全看不出发生了什么。
   *
   * 新数据由检查器在**写入时**解析（见 `ui/Inspector.svelte` 的三处取色），
   * 这里只补打开工程这一条：老工程存下来的引用要变成裸 hex，否则它们永远画品红。
   */
  resolveStrayThemeRefs(p, custom);

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

/**
 * 把「跑进非排版颜色字段的主题色引用」解析成裸 hex（就地改）。
 *
 * 只碰**能解析成合法槽位/变体**的字符串（`parseThemeRef` 非 null）：
 * 自定义文本参数里手打的 `@foo` 之类必须原样保留 —— 那是用户内容，不是坏颜色。
 *
 * 只覆盖三处：纯色片段的 `color`、算法片段的 `params`、特效实例的 `values`。
 * **排版文档里的引用一个字都不能动** —— 那是「换配色方案跟着变」的唯一依据。
 */
function resolveStrayThemeRefs(p: Project, custom: readonly TypographyTheme[]): void {
  const resolve = (v: unknown): unknown =>
    typeof v === 'string' && parseThemeRef(v) ? resolveThemeColor(v, p.typographyTheme, custom) : v;

  for (const tk of p.tracks as Track[]) {
    if (tk.kind !== 'visual') continue;
    for (const c of tk.clips) {
      if (c.kind === 'source') {
        if (c.source.type === 'solid') {
          c.source.color = String(resolve(c.source.color));
        } else if (c.source.type === 'algo') {
          for (const key of Object.keys(c.source.params)) {
            c.source.params[key] = resolve(c.source.params[key]) as number | string;
          }
        }
      } else if (c.kind === 'effect') {
        for (const inst of c.chain) {
          for (const key of Object.keys(inst.values)) {
            inst.values[key] = resolve(inst.values[key]) as number | string;
          }
        }
      }
    }
  }
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
    if (c.kind === 'effect') {
      const fx = c as EffectClip;
      if (!Array.isArray(fx.chain)) {
        throw new SchemaError(tr('err.schema.effectClipMissingChain', { id: c.id }));
      }
      // 影响深度是非负整数（0 = 下方全部）。手改 JSON 写出 2.5 / -1 时在打开时报错，
      // 而不是让它一路穿透到 `buildStack` 里以「数到第 N 条轨」的语义变成别的东西。
      if (fx.affectDepth !== undefined && (!Number.isInteger(fx.affectDepth) || fx.affectDepth < 0)) {
        throw new SchemaError(tr('err.schema.effectBadAffectDepth', { id: c.id }));
      }
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
        // 富文本的**最小结构校验**：文本元素必须有 runs 数组。
        // 漏了这一步的话，手改过的 JSON（或想当然是 v3 的旧文件）会一路穿透到
        // 渲染期，那里读到 undefined 只会渲染出空白 —— 没有报错、也很难定位。
        for (const el of doc.elements as { kind?: string; runs?: unknown }[]) {
          if (el?.kind === 'text' && !Array.isArray(el.runs)) {
            throw new SchemaError(tr('err.schema.typographyBadTextRuns', { id: c.id }));
          }
        }
      }
      // 转场同样是「形状不对就穿透到渲染期」的那一类，在这里挡住。
      const trRef = (c as SourceClip).transitionOut;
      if (trRef !== undefined) {
        if (!trRef || typeof trRef !== 'object' || typeof trRef.defId !== 'string' || !trRef.defId) {
          throw new SchemaError(tr('err.schema.transitionBadDefId', { id: c.id }));
        }
        if (typeof trRef.duration !== 'number' || !Number.isFinite(trRef.duration) || trRef.duration <= 0) {
          throw new SchemaError(tr('err.schema.transitionBadDuration', { id: c.id }));
        }
        if (!trRef.values || typeof trRef.values !== 'object') {
          throw new SchemaError(tr('err.schema.transitionBadValues', { id: c.id }));
        }
      }
      /*
       * 抠图 / 四角的形状校验。它们是「形状不对就穿透到渲染期」的那一类：
       * 渲染侧拿到坏颜色只会静默画成品红、拿到 NaN 容差会画出全透明或全不透明，
       * 没有报错、也很难定位。所以手改 JSON 的坏形状必须在打开时就挡住。
       */
      const key = (c as SourceClip).key;
      if (key !== undefined && !isValidKeySettings(key)) {
        throw new SchemaError(tr('err.schema.badKeySettings', { id: c.id }));
      }
      const quad = (c as SourceClip).quad;
      if (quad !== undefined && !isValidQuad(quad)) {
        throw new SchemaError(tr('err.schema.badQuad', { id: c.id }));
      }
    }
  }
}

/** 与 UI 取色器 / CSS 的产物一致：必须带 `#`，六位十六进制（大小写不限）。 */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** 0..1 的有限数。`typeof NaN === 'number'` 但 `NaN >= 0` 为假，所以下界判断一并挡掉。 */
function isUnitNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

/** 形状不对一律 false —— 调用点只关心「能不能进渲染期」，不关心具体哪里错。 */
function isValidKeySettings(k: unknown): k is KeySettings {
  if (!k || typeof k !== 'object' || Array.isArray(k)) return false;
  const s = k as Partial<KeySettings>;
  return (
    typeof s.color === 'string' &&
    HEX_COLOR.test(s.color) &&
    isUnitNumber(s.tolerance) &&
    isUnitNumber(s.softness) &&
    isUnitNumber(s.spill)
  );
}

/** 一个角：长度 2 的数组 + 两个有限数（`Infinity` / `NaN` 都不能进单应）。 */
function isCorner(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

function isValidQuad(q: unknown): q is QuadCorners {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return false;
  const c = q as Partial<QuadCorners>;
  return isCorner(c.tl) && isCorner(c.tr) && isCorner(c.br) && isCorner(c.bl);
}

/** 深拷贝（工程是纯 JSON，structuredClone 足够）。 */
export function cloneProject(p: Project): Project {
  return structuredClone(p);
}
