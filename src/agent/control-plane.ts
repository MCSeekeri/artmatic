/**
 * control-plane.ts — ★ 控制平面：agent 的唯一操作面（方案 `docs/agent-control-plane.md`）。
 *
 * 四类能力全部**复用既有内核**，一行求值路径都不新开：
 *
 * | 能力 | 落点 | 纪律 |
 * |---|---|---|
 * | 读 | `store.project` → `scene.ts` | 紧凑、确定、可序列化；纯读无副作用 |
 * | 写 | `ProjectStore` 的既有方法 | 每一笔都入撤销栈；**不许裸改 `project`** |
 * | 看 | `renderer.renderFrame` + `readPixels` | 出图只准「临时钉尺寸 + 用完还原」 |
 * | 导 | `runExport` + 三个 `FrameSink` | 与导出面板同一条驱动循环 |
 *
 * ## 四条容易静默坏掉的纪律（方案 §2.4）
 *
 * 1. **写操作一律走 `ProjectStore` 的方法**（`commit` / `beginTx→endTx`）。
 *    裸改的后果不是「看起来不对」，是撤销栈整个错乱 —— agent 的改动用户撤不掉。
 * 2. **读接口不得有副作用**：不推 `playT`、不改 `store.version`、不 `setExportSize`。
 * 3. **出图必须还原尺寸**：`setExportSize` → 渲 → `clearExportSize` + `syncSize`。
 *    忘了还原的表现是「预览停在导出分辨率」，而且不报错（`main.ts:234-235`）。
 * 4. **不新增语义**：本文件里的每个写方法都在 `ProjectStore` 里有唯一对应项
 *    （映射表见方案 §3.3）。「更聪明的打包方法」是活的来源。
 *
 * ## 关于 `t` 的单位
 *
 * **秒**，并且一律吸附到帧栅格（`round(t·fps)/fps`）。理由见 `types.ts` 顶部。
 * 要帧号的地方字段名一律带 `Frame`（`frameRange.from` / `frameStep`）。
 *
 * ## 关于 `label`
 *
 * 方案 §4 说写类的 label 统一形如 `agent:<tool>`。这里只在**自己 `commit`** 的
 * 那几处做到了；包给 `ProjectStore` 既有方法的那些（`addTrack` / `setFps` /
 * `setTransitionOut` …）用的是 store 自己的 i18n 标签 —— 要统一就得给那些方法
 * 加一个 label 参数，而方案 §2.1 明确「内核一行不改」。另外 `CommandStack` 的
 * `onChange(label)` 目前无人消费（`ProjectStore` 收到 label 就直接丢掉），所以
 * 这个差异对用户不可见。将来做「撤销历史」面板时若要区分 agent 的改动，
 * 得先把 label 透出来 —— 那是另一件事。
 */

import {
  BLEND_MODES,
  SCHEMA_VERSION,
  migrateProject,
  newId,
  type AnyClip,
  type BlendMode,
  type EffectClip,
  type OverlapBehavior,
  type Project,
  type SourceClip,
  type Track,
} from '../core/schema';
import type { Curve } from '../core/curve';
import { tr } from '../i18n/index.svelte';
import type { ProjectStore } from '../core/project-store';
import type { Renderer } from '../engine/renderer';
import { frameOf, timeOf } from '../engine/clock';
import { transitionCut } from '../core/transitions';
import { defaultValues, type ParamDef } from '../effects/types';
import { defaultEffectValues, getEffect } from '../effects/registry';
import { getGenerator } from '../algos/registry';
import { defaultTransitionValues, getTransition } from '../effects/transitions/registry';
import { Mp4Sink, MP4_CODEC } from '../exporters/mp4-sink';
import { PngSequenceSink } from '../exporters/png-sequence';
import { GifSink, GIF_SINK_CODEC } from '../exporters/gif-sink';
import { planGif } from '../exporters/gif-plan';
import { mixdown } from '../exporters/mixdown';
import { ExportCancelled, runExport, type ExportOptions } from '../exporters/export-runner';
import { compileAll, type CompileResult } from '../effects/compile-all';
import { createTypographyDocument } from '../typography/document';
import { makeEffectClip, makeSourceClip, type EffectClipInput, type SourceClipInput } from './clip-factory';
import { getCapabilities, getTypographyCapabilities } from './capabilities';
import { frameSignatureOf } from './frame-signature';
import { buildClipView, buildSceneSnapshot } from './scene';
import * as typo from './typography';
import {
  discardPlugin,
  installPlugin,
  listPlugins,
  removePlugin,
  tryPlugin,
  draftSource,
  type DraftStore,
} from './plugin-author';
import { helpText } from './plugin-spec';
import {
  CONTROL_API_VERSION,
  ControlFailure,
  fail,
  ok,
  type Capabilities,
  type CapabilityDetail,
  type ClipView,
  type ControlContext,
  type ControlResult,
  type DescribeInfo,
  type ExportRequest,
  type ExportArtifact,
  type ExportArtifactBase64,
  type ExportState,
  type FrameSignature,
  type OpenProjectView,
  type PluginInfoView,
  type PluginTryResult,
  type SceneDetail,
  type SceneIdSnapshot,
  type SceneSnapshot,
  type TypographyDocIdView,
  type TypographyDocView,
  type TypographyElementInput,
  type TypographyElementPatch,
  type TypographyCapabilities,
  type TypographyLayoutRequest,
  type UndoState,
} from './types';

/* --------------------------------------------------------------- 小工具 */

const label = (tool: string) => `agent:${tool}`;

/** 与导出面板同档位（`ui/export.ts` 的 GIF_DEFAULT_*）。agent 也可以直接给 size。 */
const GIF_FALLBACK_WIDTH = 480;
const GIF_FALLBACK_FPS = 12.5;
const GIF_MAX_COLORS = 256;

const MIME: Record<ExportRequest['format'], string> = {
  mp4: 'video/mp4',
  png: 'application/zip',
  gif: 'image/gif',
};

interface Size {
  w: number;
  h: number;
}

/** H.264 的 4:2:0 需要偶数边长；统一到偶数，免得编码器静默裁一列。 */
function normalizeSize(size: Size): Size {
  return {
    w: Math.max(2, Math.round(size.w / 2) * 2),
    h: Math.max(2, Math.round(size.h / 2) * 2),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `Record<string, number | string>` 的校验 + 拷贝（拒绝 NaN / 对象 / 数组）。 */
function checkScalars(values: unknown, what: string): Record<string, number | string> {
  if (!isRecord(values)) {
    throw new ControlFailure('invalid-argument', tr('agent.args.notObject', { what }));
  }
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) {
        throw new ControlFailure('invalid-argument', tr('agent.args.notFinite', { what, key: k }));
      }
      out[k] = v;
    } else if (typeof v === 'string') {
      out[k] = v;
    } else {
      throw new ControlFailure('invalid-argument', tr('agent.args.notScalar', { what, key: k }), {
        key: k,
      });
    }
  }
  return out;
}

/**
 * 只保留这个特效 / 生成器**声明过**的参数键。
 *
 * 别的键会被渲染路径静默忽略（uniform 写不进去），于是 agent 会看到「参数设了
 * 但画面没变」而完全不知道原因。这里是唯一能提前拦住它的地方。
 */
function checkKnownKeys(values: Record<string, number | string>, known: string[], what: string): void {
  const unknown = Object.keys(values).filter((k) => !known.includes(k));
  if (unknown.length > 0) {
    throw new ControlFailure(
      'invalid-argument',
      tr('agent.args.unknownKeys', { what, keys: unknown.join(', ') }),
      { unknown, known },
    );
  }
}

/** `ParamDef[]` → 参数键列表（校验用）。 */
function paramKeys(params: ParamDef[] | undefined): string[] {
  return (params ?? []).map((p) => p.key);
}

async function bytesToBase64(buf: Uint8Array): Promise<string> {
  let latin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    latin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(latin);
}

/* ------------------------------------------------------------------ 契约 */

export interface AgentControlPlane {
  /* 元信息 */
  describe(): Promise<ControlResult<DescribeInfo>>;
  /* 读 */
  getScene(opt?: { t?: number; detail?: SceneDetail }): Promise<ControlResult<SceneSnapshot | SceneIdSnapshot>>;
  getCapabilities(opt?: { detail?: CapabilityDetail; ids?: string[] }): Promise<ControlResult<Capabilities>>;
  getTypographyCapabilities(): Promise<ControlResult<TypographyCapabilities>>;
  getTypographyDoc(
    clipId: string | undefined,
    detail?: 'ids' | 'full',
  ): Promise<ControlResult<TypographyDocView | TypographyDocIdView>>;
  getClip(clipId: string): Promise<ControlResult<ClipView | null>>;
  listProjects(): Promise<ControlResult<OpenProjectView[]>>;
  undoState(): Promise<ControlResult<UndoState>>;
  /** 按需取协议 / 模型说明（plugin-api · timeline · typography · workflow · images）。 */
  help(topic?: string): Promise<ControlResult<{ topic: string; text: string }>>;
  /**
   * 着色器体检：把上下文里**所有**着色器编一遍（特效 + realtime 算法 + 全部转场）。
   *
   * 为什么 agent 需要它：着色器是**惰性编译**的（AGENTS §5.5），一个语法错误的
   * GLSL 在它被用到之前不报任何错。agent 在一次挂完一批特效之后自查一遍，是它
   * **唯一**能提前发现自己选错了特效 / 参数的手段（`effects/compile-all.ts`）。
   */
  compileAll(): Promise<ControlResult<{ okCount: number; total: number; failures: CompileResult[] }>>;
  /* 写 */
  addTrack(kind: 'visual' | 'audio', name?: string): Promise<ControlResult<{ trackId: string }>>;
  removeTrack(trackId: string): Promise<ControlResult<{ removed: string }>>;
  moveTrack(from: number, to: number): Promise<ControlResult<{ moved: boolean }>>;
  setTrack(trackId: string, patch: { enabled?: boolean; name?: string }): Promise<ControlResult<{ changed: boolean }>>;
  addClip(trackId: string, input: SourceClipInput): Promise<ControlResult<{ clipId: string; start: number; end: number }>>;
  addEffectClip(trackId: string, input: EffectClipInput): Promise<ControlResult<{ clipId: string }>>;
  removeClip(clipId: string): Promise<ControlResult<{ removed: string }>>;
  moveClip(clipId: string, targetTrackId: string, newStart: number): Promise<ControlResult<{ start: number; end: number }>>;
  resizeClip(clipId: string, edge: 'start' | 'end', time: number): Promise<ControlResult<{ start: number; end: number }>>;
  splitClip(clipId: string, at: number): Promise<ControlResult<{ leftId: string; rightId: string | null }>>;
  setClipProps(clipId: string, patch: Record<string, unknown>): Promise<ControlResult<{ changed: boolean }>>;
  setClipSourceParams(clipId: string, params: Record<string, number | string>): Promise<ControlResult<{ changed: boolean }>>;
  setEffectParams(clipId: string, chainIndex: number, values: Record<string, number | string>): Promise<ControlResult<{ changed: boolean }>>;
  setCurve(clipId: string, param: string, curve: Curve | null): Promise<ControlResult<{ changed: boolean }>>;
  addEffect(clipId: string, defId: string, values?: Record<string, number | string>, index?: number): Promise<ControlResult<{ instanceId: string }>>;
  removeEffect(clipId: string, chainIndex: number): Promise<ControlResult<{ changed: boolean }>>;
  reorderEffect(clipId: string, from: number, to: number): Promise<ControlResult<{ changed: boolean }>>;
  setTransition(clipId: string, defId: string, duration: number, values?: Record<string, number>): Promise<ControlResult<{ changed: boolean }>>;
  clearTransition(clipId: string): Promise<ControlResult<{ changed: boolean }>>;
  setProject(patch: {
    fps?: number;
    resolution?: { w: number; h: number };
    duration?: number;
    beatGrid?: { bpm?: number; offset?: number; beatsPerBar?: number };
    overlapBehavior?: OverlapBehavior;
  }): Promise<ControlResult<{ changed: string[] }>>;
  loadScene(project: unknown): Promise<ControlResult<{ tracks: number; clips: number }>>;
  beginTx(): Promise<ControlResult<{ open: boolean }>>;
  endTx(label: string): Promise<ControlResult<{ changed: boolean }>>;
  cancelTx(): Promise<ControlResult<{ open: boolean }>>;
  undo(): Promise<ControlResult<{ changed: boolean }>>;
  redo(): Promise<ControlResult<{ changed: boolean }>>;
  /* 看 */
  renderFrame(opt?: { t?: number; size?: Size }): Promise<ControlResult<{ t: number; w: number; h: number }>>;
  readPixels(): Promise<ControlResult<{ w: number; h: number; rgba: Uint8Array }>>;
  frameSignature(opt?: { t?: number; size?: Size; grid?: number }): Promise<ControlResult<FrameSignature>>;
  snapshotPng(opt?: { t?: number; size?: Size }): Promise<ControlResult<Uint8Array>>;
  /* 导 */
  export(opt: ExportRequest): Promise<ControlResult<ExportArtifact>>;
  exportBase64(opt: ExportRequest): Promise<ControlResult<ExportArtifactBase64>>;
  exportState(): Promise<ControlResult<ExportState | null>>;
  abortExport(): Promise<ControlResult<{ aborted: boolean }>>;
  /* 工程级动作（需要 ui 层的编排，走注入的 ctx） */
  saveProject(): Promise<ControlResult<{ saved: true }>>;
  openProject(name?: string): Promise<ControlResult<{ opened: boolean }>>;

  /* ------------------------------------------------------------- 排版 */
  /**
   * 省略 `clipId` 时用排版编辑器当前打开的那份（`ctx.getActiveTypoClipId`）——
   * 用户在排版页说「把标题改大」时不该被迫先报一个 id。
   */
  addTypographyElement(
    clipId: string | undefined,
    input: TypographyElementInput,
  ): Promise<ControlResult<{ elementId: string }>>;
  addGeneratedShape(
    clipId: string | undefined,
    input: {
      genId: string;
      params?: Record<string, number | string>;
      seed?: number;
      frame?: { x?: number; y?: number; w?: number; h?: number; rot?: number };
      name?: string;
      fill?: unknown;
      stroke?: unknown;
    },
  ): Promise<ControlResult<{ elementId: string }>>;
  updateTypographyElement(
    clipId: string | undefined,
    elementId: string,
    patch: TypographyElementPatch,
  ): Promise<ControlResult<{ changed: boolean }>>;
  setTypographyText(
    clipId: string | undefined,
    elementId: string,
    text: string,
  ): Promise<ControlResult<{ changed: boolean }>>;
  removeTypographyElement(
    clipId: string | undefined,
    elementId: string,
  ): Promise<ControlResult<{ changed: boolean }>>;
  reorderTypographyElement(
    clipId: string | undefined,
    elementId: string,
    op: 'front' | 'back' | 'forward' | 'backward',
  ): Promise<ControlResult<{ changed: boolean }>>;
  groupTypographyElements(
    clipId: string | undefined,
    elementIds: string[],
    name?: string,
  ): Promise<ControlResult<{ groupId: string | null }>>;
  ungroupTypographyElements(
    clipId: string | undefined,
    elementIds: string[],
  ): Promise<ControlResult<{ changed: boolean }>>;
  layoutTypography(
    clipId: string | undefined,
    req: TypographyLayoutRequest,
  ): Promise<ControlResult<{ moved: number }>>;
  setTypographyBackground(
    clipId: string | undefined,
    paint: unknown,
  ): Promise<ControlResult<{ changed: boolean }>>;
  setTypographyTheme(
    clipId: string | undefined,
    theme: string | null,
  ): Promise<ControlResult<{ changed: boolean }>>;
  replaceTypographyDoc(
    clipId: string | undefined,
    doc: unknown,
  ): Promise<ControlResult<{ elements: number; dropped: number }>>;

  /* ------------------------------------------------------------- 插件 */
  pluginTry(input: { id: string; name: string; source: string }): Promise<ControlResult<PluginTryResult>>;
  /**
   * 安装。`confirm: false`（默认）**只返回 `needs-approval`**，不写盘 ——
   * 面板拿到 detail 后弹确认，用户点了才带 `confirm: true` 再调一次。
   */
  pluginInstall(
    pluginId: string,
    confirm?: boolean,
  ): Promise<ControlResult<{ pluginId: string; persisted: boolean; effects: string[]; generators: string[] }>>;
  pluginList(): Promise<ControlResult<{ plugins: PluginInfoView[] }>>;
  pluginDiscard(pluginId: string): Promise<ControlResult<{ discarded: boolean; stillInstalled: boolean }>>;
  pluginRemove(pluginId: string): Promise<ControlResult<{ removed: boolean }>>;
  /** 面板审批卡用：拿草稿源码（用户要能看一眼自己批准了什么）。 */
  pluginSource(pluginId: string): Promise<ControlResult<{ source: string | null }>>;
}

/* ------------------------------------------------------------- 实现 */

export function createControlPlane(ctx: ControlContext): AgentControlPlane {
  /** 进行中的导出读数。网关轮询 `exportState()` 把它转成 MCP 的进度通知。 */
  let exportRun: ExportState | null = null;
  let exportAbort: AbortController | null = null;
  /** 控制平面自己开的事务。`ProjectStore` 不暴露 `inTx`，只能在这里记账。 */
  let txOpen = false;
  /** 最近一次「看」拿到的像素，供 `readPixels()` 独立读取。见 `drawAndRead`。 */
  let lastFrame: { w: number; h: number; rgba: Uint8Array } | null = null;
  /** 插件草稿区（源码只活在本次会话的内存里，安装之后磁盘才是真源）。 */
  const pluginDrafts: DraftStore = new Map();

  /* ---------------------------------------------------------- 取实例 */

  function needStore(): ProjectStore {
    const store = ctx.getStore();
    if (!store) throw new ControlFailure('no-project', tr('agent.ctx.noProject'));
    return store;
  }

  function needRenderer(): Renderer {
    const renderer = ctx.getRenderer();
    if (!renderer) throw new ControlFailure('not-ready', tr('agent.ctx.notReady'));
    return renderer;
  }

  function needClip(store: ProjectStore, clipId: string): { track: Track; clip: AnyClip } {
    const found = store.findClip(clipId);
    if (!found) {
      throw new ControlFailure('not-found', tr('agent.clip.notFound', { id: clipId }), { clipId });
    }
    return found;
  }

  function needEffectClip(store: ProjectStore, clipId: string): EffectClip {
    const { clip } = needClip(store, clipId);
    if (clip.kind !== 'effect') {
      throw new ControlFailure(
        'unsupported',
        tr('agent.clip.notEffect', { id: clipId, kind: clip.kind }),
        { clipId },
      );
    }
    return clip;
  }

  function needSourceClip(store: ProjectStore, clipId: string): SourceClip {
    const { clip } = needClip(store, clipId);
    if (clip.kind !== 'source') {
      throw new ControlFailure(
        'unsupported',
        tr('agent.clip.notSource', { id: clipId, kind: clip.kind }),
        { clipId },
      );
    }
    return clip;
  }

  /** 写操作前让悬空的手势落地 —— 否则 `beginTx` 会把用户的事务快照顶掉（方案 §5.2）。 */
  function beforeWrite(): ProjectStore {
    // 先停行内文本编辑：打字是直接改 doc.runs，不经过手势事务，
    // 不停的话编辑器下一次提交会把 agent 的改动覆盖掉（两边都不报错）。
    ctx.stopTextEditing?.();
    ctx.cancelPendingGesture();
    return needStore();
  }

  /** 排版写方法的目标片段：省略时用编辑器当前打开的那一份。 */
  function typoClipId(clipId: string | undefined): string {
    const id = clipId || ctx.getActiveTypoClipId?.() || '';
    if (!id) {
      throw new ControlFailure('invalid-argument', tr('agent.typo.noDoc', { id: '(none)' }), {
        hint: 'pass clipId, or open the typography editor first',
      });
    }
    return id;
  }

  function trackIdOf(store: ProjectStore, clipId: string): string {
    return needClip(store, clipId).track.id;
  }

  function paramsOf(generator: string): ParamDef[] {
    return getGenerator(generator)?.params ?? [];
  }

  /* ------------------------------------------------------------ 包装 */

  function toFailure(e: unknown): ControlResult<never> {
    if (e instanceof ControlFailure) return fail(e.code, e.message, e.detail);
    if (e instanceof ExportCancelled) return fail('cancelled', tr('agent.export.cancelled'));
    if (e instanceof Error) return fail('internal', e.message);
    return fail('internal', String(e));
  }

  async function run<T>(fn: () => T | Promise<T>): Promise<ControlResult<T>> {
    try {
      return ok(await fn());
    } catch (e) {
      return toFailure(e);
    }
  }

  /* ------------------------------------------------------------ 读 */

  const read: Pick<
    AgentControlPlane,
    | 'describe'
    | 'getScene'
    | 'getCapabilities'
    | 'getTypographyCapabilities'
    | 'getTypographyDoc'
    | 'getClip'
    | 'listProjects'
    | 'undoState'
    | 'help'
    | 'compileAll'
    | 'exportState'
  > = {
    async describe() {
      return run<DescribeInfo>(() => {
        const store = ctx.getStore();
        return {
          apiVersion: CONTROL_API_VERSION,
          appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
          schemaVersion: SCHEMA_VERSION,
          fps: store?.project.fps ?? 0,
          resolution: store ? { ...store.project.resolution } : { w: 0, h: 0 },
          duration: store?.project.duration ?? 0,
        };
      });
    },

    /**
     * 核心读接口。**纯读**：不推 `playT`、不动 `version`、不改渲染尺寸。
     * 省略 `t` 时用当前播放头 —— 那是「用户正看着哪一帧」的诚实答案。
     */
    async getScene(opt) {
      return run(() => {
        const store = needStore();
        const t = opt?.t ?? ctx.getPlayT();
        return buildSceneSnapshot(store.project, t, opt?.detail ?? ('full' as const));
      });
    },

    async getCapabilities(opt) {
      return run(() => getCapabilities(opt));
    },

    async getTypographyCapabilities() {
      return run<TypographyCapabilities>(() => {
        const store = needStore();
        return getTypographyCapabilities(store.project.customThemes ?? null);
      });
    },

    async getTypographyDoc(clipId, detail) {
      return run<TypographyDocView | TypographyDocIdView>(() => {
        // 纯读：不取消手势、不改播放头、不动渲染尺寸。
        const store = needStore();
        return typo.getDoc(store, typoClipId(clipId), detail ?? 'full');
      });
    },

    async help(topic) {
      return run(() => ({ topic: topic ?? 'index', text: helpText(topic) }));
    },

    async getClip(clipId) {
      return run(() => {
        const store = needStore();
        return buildClipView(store.project, clipId, ctx.getPlayT());
      });
    },

    async listProjects() {
      return run(() => ctx.listProjects());
    },

    async undoState() {
      return run<UndoState>(() => {
        const store = ctx.getStore();
        return {
          canUndo: store?.canUndo() ?? false,
          canRedo: store?.canRedo() ?? false,
        };
      });
    },

    async compileAll() {
      return run(() => {
        const renderer = needRenderer();
        const { results, okCount, total } = compileAll(renderer.kit);
        return { okCount, total, failures: results.filter((r) => !r.ok) };
      });
    },

    async exportState() {
      return run(() => exportRun);
    },
  };

  /* ------------------------------------------------------ 片段输入校验 */

  /**
   * 源输入的公共校验：生成器 / 素材必须真实存在。
   *
   * 为什么放在这里而不是渲染路径上：「黑屏」与「一句明确报错」的调试成本差一个
   * 量级，而 agent 拿不到控制台 —— 一次 `not-found(generator)` 比一张纯黑 PNG
   * 有用得多。
   */
  function validateSourceInput(store: ProjectStore, input: SourceClipInput): SourceClipInput {
    if (!isRecord(input)) {
      throw new ControlFailure('invalid-argument', tr('agent.clip.inputNotObject'));
    }
    const kinds = ['algo', 'solid', 'image', 'video', 'text'];
    if (typeof input.kind !== 'string' || !kinds.includes(input.kind)) {
      throw new ControlFailure(
        'invalid-argument',
        tr('agent.clip.badKind', { kinds: kinds.join(' / ') }),
        { validIds: kinds },
      );
    }
    if (input.kind === 'algo') {
      const def = getGenerator(input.generator ?? '');
      if (!def) {
        throw new ControlFailure(
          'not-found',
          tr('agent.gen.notFound', { id: String(input.generator) }),
          { validIds: getCapabilities().generators.map((g) => g.id) },
        );
      }
      const given = checkScalars(input.params ?? {}, 'params');
      checkKnownKeys(given, paramKeys(def.params), tr('agent.what.generator', { id: def.id }));
      // 默认参数在这里补齐：让 agent 只给「想改的那几个」。
      return { ...input, generator: def.id, params: { ...defaultValues(def.params), ...given } };
    }
    if (input.kind === 'image' || input.kind === 'video') {
      const id = input.assetId ?? '';
      const inProject = Boolean(store.project.assets[id]);
      const inStore = ctx.getAssets()?.has(id) ?? false;
      if (!id || (!inProject && !inStore)) {
        throw new ControlFailure(
          'not-found',
          tr('agent.asset.notFound', { id: id || tr('agent.asset.none') }),
          { validIds: Object.keys(store.project.assets) },
        );
      }
    }
    if (input.kind === 'text' && !input.doc) {
      /*
       * 文本片段必须带文档（`clip-factory` 对空 doc 抛错）。让 agent 从零手写
       * 一份 `TypographyDocument` 是没必要的摩擦：先给一张空画布，再用
       * `typo_add_element` 往里加东西 —— 这也是排版页「新建」的同一形态。
       */
      return { ...input, doc: createTypographyDocument(store.project.resolution) };
    }
    return input;
  }

  /* ------------------------------------------------------------ 写 */

  const write: Pick<
    AgentControlPlane,
    | 'addTrack'
    | 'removeTrack'
    | 'moveTrack'
    | 'setTrack'
    | 'addClip'
    | 'addEffectClip'
    | 'removeClip'
    | 'moveClip'
    | 'resizeClip'
    | 'splitClip'
    | 'setClipProps'
    | 'setClipSourceParams'
    | 'setEffectParams'
    | 'setCurve'
    | 'addEffect'
    | 'removeEffect'
    | 'reorderEffect'
    | 'setTransition'
    | 'clearTransition'
    | 'setProject'
    | 'loadScene'
    | 'beginTx'
    | 'endTx'
    | 'cancelTx'
    | 'undo'
    | 'redo'
  > = {
    /* ---- 轨道 ---- */

    async addTrack(kind, name) {
      return run(() => {
        const store = beforeWrite();
        if (kind !== 'visual' && kind !== 'audio') {
          throw new ControlFailure('invalid-argument', tr('agent.track.badKind'));
        }
        return { trackId: store.addTrack(kind, name) };
      });
    },

    async removeTrack(trackId) {
      return run(() => {
        const store = beforeWrite();
        if (!store.track(trackId)) {
          throw new ControlFailure('not-found', tr('agent.track.notFound', { id: trackId }));
        }
        store.removeTrack(trackId);
        return { removed: trackId };
      });
    },

    async moveTrack(from, to) {
      return run(() => {
        const store = beforeWrite();
        const n = store.project.tracks.length;
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n) {
          throw new ControlFailure(
            'invalid-argument',
            tr('agent.track.badIndex', { max: n - 1 }),
            { from, to },
          );
        }
        const before = store.version;
        store.moveTrack(from, to);
        return { moved: store.version !== before };
      });
    },

    async setTrack(trackId, patch) {
      return run(() => {
        const store = beforeWrite();
        if (!store.track(trackId)) {
          throw new ControlFailure('not-found', tr('agent.track.notFound', { id: trackId }));
        }
        let changed = false;
        if (patch.enabled !== undefined) {
          const v0 = store.version;
          store.setTrackEnabled(trackId, Boolean(patch.enabled));
          changed = changed || store.version !== v0;
        }
        if (patch.name !== undefined) {
          const v0 = store.version;
          store.renameTrack(trackId, String(patch.name));
          changed = changed || store.version !== v0;
        }
        return { changed };
      });
    },

    /* ---- 片段 ---- */

    async addClip(trackId, input) {
      return run(() => {
        const store = beforeWrite();
        const track = store.track(trackId);
        if (!track) throw new ControlFailure('not-found', tr('agent.track.notFound', { id: trackId }));
        if (track.kind === 'audio') {
          throw new ControlFailure('invalid-argument', tr('agent.track.audioOnlyAudio'));
        }
        const spec = validateSourceInput(store, input);
        const clip = makeSourceClip(spec);
        store.addClip(trackId, clip);
        const placed = store.findClip(clip.id);
        if (!placed) {
          // `addClip` 在落点被占且找不到空档时会**静默不动** —— 这类「什么都没
          // 发生」必须变成明确的错误，否则 agent 会以为加上了。
          throw new ControlFailure('conflict', tr('agent.place.addFailed', { id: trackId }), {
            start: clip.start,
            end: clip.end,
          });
        }
        return { clipId: clip.id, start: placed.clip.start, end: placed.clip.end };
      });
    },

    async addEffectClip(trackId, input) {
      return run(() => {
        const store = beforeWrite();
        const track = store.track(trackId);
        if (!track) throw new ControlFailure('not-found', tr('agent.track.notFound', { id: trackId }));
        if (track.kind !== 'visual') {
          throw new ControlFailure('invalid-argument', tr('agent.track.cannotHost', { id: trackId, kind: 'effect' }));
        }
        for (const c of input.chain ?? []) {
          if (!getEffect(c.defId)) {
            throw new ControlFailure('not-found', tr('agent.fx.notFound', { id: c.defId }), {
              validIds: getCapabilities().effects.map((e) => e.id),
            });
          }
        }
        const clip = makeEffectClip(input);
        store.addClip(trackId, clip);
        if (!store.findClip(clip.id)) {
          throw new ControlFailure('conflict', tr('agent.place.addEffectFailed', { id: trackId }));
        }
        return { clipId: clip.id };
      });
    },

    async removeClip(clipId) {
      return run(() => {
        const store = beforeWrite();
        needClip(store, clipId);
        store.removeClip(clipId);
        return { removed: clipId };
      });
    },

    /**
     * 移动片段 = `liveMoveClip` + `settlePlacement` 包在**一笔** `commit` 里。
     *
     * 为什么必须是这两步：`live*` 是实时直改（不入栈、不套用重叠策略），
     * `settle*` 才是按 `overlapBehavior` 结算的那一步 —— 只调前者会把片段压在
     * 邻居身上（方案 §3.3 明令 `live*` / `settle*` 不许单独暴露给 agent）。
     * 两者都不入栈，所以外面必须套 `commit`，否则用户的 Ctrl+Z 撤不掉。
     */
    async moveClip(clipId, targetTrackId, newStart) {
      return run(() => {
        const store = beforeWrite();
        const { clip } = needClip(store, clipId);
        const target = store.track(targetTrackId);
        if (!target) {
          throw new ControlFailure('not-found', tr('agent.track.notFound', { id: targetTrackId }));
        }
        if (!store.canHost(target, clip)) {
          throw new ControlFailure(
            'invalid-argument',
            tr('agent.track.cannotHost', { id: targetTrackId, kind: clip.kind }),
          );
        }
        if (!Number.isFinite(newStart)) {
          throw new ControlFailure('invalid-argument', tr('agent.args.seconds', { what: 'newStart' }));
        }
        // 先问一次落点合法性：reject 策略下非法落点要**整次不动**，而
        // live+settle 一旦跑过就已经改过几何了（见 core/clips.ts 的时序约定）。
        if (!store.placementAccepted(targetTrackId, clipId, newStart)) {
          throw new ControlFailure(
            'conflict',
            tr('agent.place.conflict', { behavior: store.project.overlapBehavior }),
            { newStart, to: targetTrackId },
          );
        }
        store.commit(label('move_clip'), () => {
          store.liveMoveClip(targetTrackId, clipId, newStart);
          store.settlePlacement(targetTrackId, clipId, newStart);
        });
        const after = store.findClip(clipId);
        return { start: after?.clip.start ?? newStart, end: after?.clip.end ?? newStart };
      });
    },

    async resizeClip(clipId, edge, time) {
      return run(() => {
        const store = beforeWrite();
        if (edge !== 'start' && edge !== 'end') {
          throw new ControlFailure('invalid-argument', tr('agent.args.edge'));
        }
        if (!Number.isFinite(time)) {
          throw new ControlFailure('invalid-argument', tr('agent.args.seconds', { what: 'time' }));
        }
        const trackId = trackIdOf(store, clipId);
        store.commit(label('resize_clip'), () => {
          store.liveResizeClip(trackId, clipId, edge, time);
          store.settleResize(trackId, clipId, edge, time);
        });
        const after = store.findClip(clipId);
        return { start: after?.clip.start ?? 0, end: after?.clip.end ?? 0 };
      });
    },

    async splitClip(clipId, at) {
      return run(() => {
        const store = beforeWrite();
        const trackId = trackIdOf(store, clipId);
        if (!Number.isFinite(at)) {
          throw new ControlFailure('invalid-argument', tr('agent.args.seconds', { what: 'at' }));
        }
        if (!store.splitClipAt(trackId, clipId, at)) {
          throw new ControlFailure('invalid-argument', tr('agent.place.splitOutside', { at }), {
            clipId,
            at,
          });
        }
        const track = store.track(trackId);
        // 右半段是新 id（`splitSpan` 生成的），只能按几何认回来。
        const right = track?.clips.find((c) => c.id !== clipId && Math.abs(c.start - at) < 1e-6);
        return { leftId: clipId, rightId: right?.id ?? null };
      });
    },

    /** 白名单式改属性：`kind` / `id` / `source` 一律不可写（那些各有专属方法）。 */
    async setClipProps(clipId, patch) {
      return run(() => {
        const store = beforeWrite();
        needClip(store, clipId);
        if (!isRecord(patch) || Object.keys(patch).length === 0) {
          throw new ControlFailure('invalid-argument', tr('agent.args.emptyPatch', { what: 'patch' }));
        }
        const allowed = ['label', 'fadeSec', 'blend', 'opacity', 'transform', 'fit', 'affectDepth'];
        const bad = Object.keys(patch).filter((k) => !allowed.includes(k));
        if (bad.length > 0) {
          throw new ControlFailure('invalid-argument', tr('agent.args.notWritable', { keys: bad.join(', ') }), {
            allowed,
          });
        }
        if (patch.blend !== undefined && !BLEND_MODES.some((b) => b.id === patch.blend)) {
          throw new ControlFailure('invalid-argument', tr('agent.args.blend', { value: String(patch.blend) }), {
            validIds: BLEND_MODES.map((b) => b.id),
          });
        }
        if (patch.fit !== undefined && !['contain', 'cover', 'stretch'].includes(String(patch.fit))) {
          throw new ControlFailure('invalid-argument', tr('agent.args.fit', { value: String(patch.fit) }));
        }
        if (patch.opacity !== undefined && !Number.isFinite(Number(patch.opacity))) {
          throw new ControlFailure('invalid-argument', tr('agent.args.opacity'));
        }
        if (patch.fadeSec !== undefined && !(Number(patch.fadeSec) >= 0)) {
          throw new ControlFailure('invalid-argument', tr('agent.args.fade'));
        }
        if (patch.transform !== undefined && !isRecord(patch.transform)) {
          throw new ControlFailure('invalid-argument', tr('agent.args.transform'));
        }
        if (
          patch.affectDepth !== undefined &&
          (!Number.isInteger(Number(patch.affectDepth)) || Number(patch.affectDepth) < 0)
        ) {
          throw new ControlFailure('invalid-argument', tr('agent.args.affectDepth'));
        }
        const before = store.version;
        store.updateClip(clipId, label('set_clip_props'), (c) => {
          if (patch.label !== undefined) c.label = String(patch.label);
          if (patch.fadeSec !== undefined) c.fadeSec = Math.max(0, Number(patch.fadeSec));
          // 影响深度只对特效片段有意义（它是 EffectClip 的字段）。
          if (c.kind === 'effect' && patch.affectDepth !== undefined) {
            c.affectDepth = Number(patch.affectDepth);
          }
          if (c.kind !== 'source') return;
          if (patch.blend !== undefined) c.blend = patch.blend as BlendMode;
          if (patch.opacity !== undefined) c.opacity = Number(patch.opacity);
          if (patch.fit !== undefined) c.fit = patch.fit as SourceClip['fit'];
          if (patch.transform !== undefined) Object.assign(c.transform, patch.transform);
        });
        return { changed: store.version !== before };
      });
    },

    async setClipSourceParams(clipId, params) {
      return run(() => {
        const store = beforeWrite();
        const clip = needSourceClip(store, clipId);
        const given = checkScalars(params, 'params');
        if (clip.source.type === 'algo') {
          checkKnownKeys(
            given,
            paramKeys(paramsOf(clip.source.generator)),
            tr('agent.what.generator', { id: clip.source.generator }),
          );
        } else if (clip.source.type === 'solid') {
          checkKnownKeys(given, ['color'], tr('agent.what.solid'));
        } else {
          throw new ControlFailure(
            'unsupported',
            tr('agent.clip.noSourceParams', { type: clip.source.type }),
          );
        }
        const before = store.version;
        store.updateClip(clipId, label('set_params'), (c) => {
          if (c.kind !== 'source') return;
          if (c.source.type === 'algo') Object.assign(c.source.params, given);
          else if (c.source.type === 'solid' && typeof given.color === 'string') c.source.color = given.color;
        });
        return { changed: store.version !== before };
      });
    },

    async setEffectParams(clipId, chainIndex, values) {
      return run(() => {
        const store = beforeWrite();
        const clip = needEffectClip(store, clipId);
        const inst = clip.chain[chainIndex];
        if (!inst) {
          throw new ControlFailure(
            'invalid-argument',
            tr('agent.args.chainIndex', { index: chainIndex, max: clip.chain.length - 1 }),
          );
        }
        const given = checkScalars(values, 'values');
        checkKnownKeys(
          given,
          paramKeys(getEffect(inst.defId)?.params),
          tr('agent.what.effect', { id: inst.defId }),
        );
        const before = store.version;
        store.updateClip(clipId, label('set_params'), (c) => {
          if (c.kind !== 'effect') return;
          const target = c.chain[chainIndex];
          if (target) Object.assign(target.values, given);
        });
        return { changed: store.version !== before };
      });
    },

    async setCurve(clipId, param, curve) {
      return run(() => {
        const store = beforeWrite();
        const { clip } = needClip(store, clipId);
        const allowed = curveKeysOf(clip);
        if (!allowed.includes(param)) {
          throw new ControlFailure(
            'invalid-argument',
            tr('agent.curve.notCurvable', { id: clipId, param }),
            { allowed },
          );
        }
        if (curve !== null) validateCurve(param, curve);
        const before = store.version;
        store.updateClip(clipId, label('set_curve'), (c) => {
          if (curve === null) delete c.curves[param];
          else c.curves[param] = curve;
        });
        return { changed: store.version !== before };
      });
    },

    async addEffect(clipId, defId, values, index) {
      return run(() => {
        const store = beforeWrite();
        const clip = needEffectClip(store, clipId);
        const def = getEffect(defId);
        if (!def) {
          throw new ControlFailure('not-found', tr('agent.fx.notFound', { id: defId }), {
            validIds: getCapabilities().effects.map((e) => e.id),
          });
        }
        const given = checkScalars(values ?? {}, 'values');
        checkKnownKeys(given, paramKeys(def.params), tr('agent.what.effect', { id: defId }));
        // 默认值补齐：agent 只给「想改的那几个」。
        const merged = { ...defaultEffectValues(defId), ...given };
        const instanceId = `fx-${newId().slice(0, 8)}`;
        const at = index === undefined ? clip.chain.length : Math.max(0, Math.min(index, clip.chain.length));
        store.updateClip(clipId, label('add_effect'), (c) => {
          if (c.kind !== 'effect') return;
          c.chain.splice(at, 0, { instanceId, defId, enabled: true, values: merged });
        });
        return { instanceId };
      });
    },

    async removeEffect(clipId, chainIndex) {
      return run(() => {
        const store = beforeWrite();
        const clip = needEffectClip(store, clipId);
        if (!clip.chain[chainIndex]) {
          throw new ControlFailure(
            'invalid-argument',
            tr('agent.args.chainIndex', { index: chainIndex, max: clip.chain.length - 1 }),
          );
        }
        store.updateClip(clipId, label('remove_effect'), (c) => {
          if (c.kind === 'effect') c.chain.splice(chainIndex, 1);
        });
        return { changed: true };
      });
    },

    async reorderEffect(clipId, from, to) {
      return run(() => {
        const store = beforeWrite();
        const clip = needEffectClip(store, clipId);
        const n = clip.chain.length;
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n) {
          throw new ControlFailure(
            'invalid-argument',
            tr('agent.args.effectIndex', { max: n - 1 }),
            { from, to },
          );
        }
        if (from !== to) {
          store.updateClip(clipId, label('reorder_effect'), (c) => {
            if (c.kind !== 'effect') return;
            const [moved] = c.chain.splice(from, 1);
            if (moved) c.chain.splice(to, 0, moved);
          });
        }
        return { changed: from !== to };
      });
    },

    /* ---- 转场 ---- */

    async setTransition(clipId, defId, duration, values) {
      return run(() => {
        const store = beforeWrite();
        if (!getTransition(defId)) {
          throw new ControlFailure('not-found', tr('agent.tr.notFound', { id: defId }), {
            validIds: getCapabilities().transitions.map((t) => t.id),
          });
        }
        const host = transitionHostOf(store, clipId);
        if (!host) {
          throw new ControlFailure('unsupported', tr('agent.transition.host', { id: clipId }));
        }
        // 先用 core 的同一个函数问一次「这个剪切点能不能落」——store 那边对落不了
        // 地的情况是**静默不动**的，那种「什么都没发生」对 agent 不可接受。
        const cut = transitionCut(host.track, host.index);
        if (!cut.ok) {
          throw new ControlFailure('unsupported', tr('agent.transition.cut', { reason: cut.reason }), {
            reason: cut.reason,
          });
        }
        const merged = { ...defaultTransitionValues(defId), ...(values ?? {}) };
        const before = store.version;
        store.setTransitionOut(clipId, defId, duration, merged);
        return { changed: store.version !== before };
      });
    },

    async clearTransition(clipId) {
      return run(() => {
        const store = beforeWrite();
        needClip(store, clipId);
        const before = store.version;
        store.clearTransitionOut(clipId);
        return { changed: store.version !== before };
      });
    },

    /* ---- 工程 ---- */

    /**
     * 改工程级参数。**一个字段一笔 commit**（`ProjectStore` 的每个 setter 自带
     * 一个），所以一次给多字段会产生多条撤销记录 —— agent 想「一键撤销」应当
     * 先用 `beginTx` / `endTx` 把整段包起来。
     */
    async setProject(patch) {
      return run(() => {
        const store = beforeWrite();
        if (!isRecord(patch) || Object.keys(patch).length === 0) {
          throw new ControlFailure('invalid-argument', tr('agent.args.emptyPatch', { what: 'patch' }));
        }
        const allowed = ['fps', 'resolution', 'duration', 'beatGrid', 'overlapBehavior'];
        const bad = Object.keys(patch).filter((k) => !allowed.includes(k));
        if (bad.length > 0) {
          throw new ControlFailure('invalid-argument', tr('agent.args.notWritable', { keys: bad.join(', ') }), {
            allowed,
          });
        }
        const changed: string[] = [];
        const step = (name: string, fn: () => void) => {
          const v0 = store.version;
          fn();
          if (store.version !== v0) changed.push(name);
        };
        if (patch.fps !== undefined) step('fps', () => store.setFps(Number(patch.fps)));
        if (patch.resolution !== undefined) {
          const res = patch.resolution;
          if (!isRecord(res)) {
            throw new ControlFailure('invalid-argument', tr('agent.args.resolution'));
          }
          const w = Number(res.w);
          const h = Number(res.h);
          step('resolution', () => store.setResolution(w, h));
        }
        if (patch.duration !== undefined) step('duration', () => store.setDuration(Number(patch.duration)));
        if (patch.beatGrid !== undefined) {
          const grid = patch.beatGrid;
          if (!isRecord(grid)) {
            throw new ControlFailure('invalid-argument', tr('agent.args.notObject', { what: 'beatGrid' }));
          }
          step('beatGrid', () =>
            store.setBeatGrid(grid as { bpm?: number; offset?: number; beatsPerBar?: number }),
          );
        }
        if (patch.overlapBehavior !== undefined) {
          const v = patch.overlapBehavior;
          if (v !== 'push' && v !== 'reject' && v !== 'trim') {
            throw new ControlFailure('invalid-argument', tr('agent.args.overlap', { value: String(v) }));
          }
          step('overlapBehavior', () => store.setOverlapBehavior(v));
        }
        return { changed };
      });
    },

    /**
     * 整体改写（方案 §3.6 的路径 B）：传一份完整 `Project`。
     *
     * 走 `loadFrom` 而**不是** `replaceProject`：前者是「在当前工程里换内容」，
     * **可撤销**；后者清空撤销栈、只用于「打开 / 新建」。agent 的批量重排必须
     * 能被用户 Ctrl+Z 掉。
     */
    async loadScene(project) {
      return run(() => {
        const store = beforeWrite();
        if (!isRecord(project)) {
          throw new ControlFailure('invalid-argument', tr('agent.scene.notObject'));
        }
        let migrated: Project;
        try {
          migrated = migrateProject(project);
        } catch (e) {
          throw new ControlFailure(
            'invalid-argument',
            tr('agent.scene.invalid', { detail: e instanceof Error ? e.message : String(e) }),
          );
        }
        store.loadFrom(migrated);
        let clips = 0;
        for (const tk of migrated.tracks) clips += tk.clips.length;
        return { tracks: migrated.tracks.length, clips };
      });
    },

    /* ---- 事务与撤销 ---- */

    async beginTx() {
      return run(() => {
        const store = beforeWrite();
        if (txOpen) throw new ControlFailure('conflict', tr('agent.tx.open'));
        store.beginTx();
        txOpen = true;
        return { open: true };
      });
    },

    async endTx(text) {
      return run(() => {
        const store = needStore();
        if (!txOpen) throw new ControlFailure('conflict', tr('agent.tx.none'));
        txOpen = false;
        return { changed: store.endTx(text || label('transaction')) };
      });
    },

    async cancelTx() {
      return run(() => {
        const store = needStore();
        if (!txOpen) return { open: false };
        txOpen = false;
        store.cancelTx();
        return { open: false };
      });
    },

    async undo() {
      return run(() => {
        ctx.cancelPendingGesture();
        return { changed: needStore().undo() };
      });
    },

    async redo() {
      return run(() => {
        ctx.cancelPendingGesture();
        return { changed: needStore().redo() };
      });
    },
  };

  /** 片段上「能打关键帧」的参数键（AGENTS §5.6 的键约定）。 */
  function curveKeysOf(clip: AnyClip): string[] {
    const SOURCE_KEYS = [
      'opacity',
      'transform.x',
      'transform.y',
      'transform.sx',
      'transform.sy',
      'transform.rot',
    ];
    if (clip.kind === 'audio') return ['gain'];
    if (clip.kind === 'effect') {
      const out: string[] = [];
      for (const inst of clip.chain) {
        for (const p of getEffect(inst.defId)?.params ?? []) {
          // 只有 range 参数能打关键帧（`runtime.evalParams` 只对 range 走曲线）。
          if (p.type === 'range') out.push(`${inst.instanceId}.${p.key}`);
        }
      }
      return out;
    }
    if (clip.source.type === 'algo') {
      const algoKeys = paramsOf(clip.source.generator)
        .filter((p) => p.type === 'range')
        .map((p) => p.key);
      return [...SOURCE_KEYS, ...algoKeys];
    }
    return SOURCE_KEYS;
  }

  /** 曲线形状校验。**形状不对会一路穿透到渲染期**，在那里表现为「参数不动」。 */
  function validateCurve(param: string, curve: Curve): void {
    if (!isRecord(curve) || !Array.isArray(curve.keys)) {
      throw new ControlFailure('invalid-argument', tr('agent.curve.shape', { param }));
    }
    if (curve.mode && !['keyframe', 'impulse', 'follower'].includes(curve.mode)) {
      throw new ControlFailure('invalid-argument', tr('agent.curve.mode', { mode: String(curve.mode) }));
    }
    let prev = -Infinity;
    for (const [i, k] of curve.keys.entries()) {
      if (!isRecord(k) || !Number.isFinite(Number(k.t)) || !Number.isFinite(Number(k.v))) {
        throw new ControlFailure('invalid-argument', tr('agent.curve.key', { param, index: i }));
      }
      if (!['linear', 'step', 'smooth', 'bezier'].includes(String(k.interp))) {
        throw new ControlFailure('invalid-argument', tr('agent.curve.interp', { param, index: i }));
      }
      if (Number(k.t) < prev) throw new ControlFailure('invalid-argument', tr('agent.curve.order'));
      prev = Number(k.t);
    }
  }

  function transitionHostOf(
    store: ProjectStore,
    clipId: string,
  ): { track: Extract<Track, { kind: 'visual' }>; index: number } | null {
    for (const track of store.project.tracks) {
      if (track.kind !== 'visual') continue;
      const index = track.clips.findIndex((c) => c.id === clipId);
      if (index < 0) continue;
      if (track.clips[index]!.kind !== 'source') return null;
      return { track, index };
    }
    return null;
  }

  /* ------------------------------------------------------------ 看 */

  /**
   * 「临时钉尺寸 → 用完还原」的唯一入口。
   *
   * 为什么必须还原：`setExportSize` 之后 `syncSize` 会直接 return（它要尊重导出
   * 尺寸），于是预览会**停在导出分辨率**上，而这一步不报错（`main.ts:234-235`
   * 已经踩过）。`runExport` 自己只 `clearExportSize`，`syncSize` 得由调用方补
   * —— 这里把那两件事收在一处，调用方无从漏掉。
   */
  async function withPinnedSize<T>(
    renderer: Renderer,
    project: Project,
    size: Size,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    renderer.setExportSize(size.w, size.h);
    try {
      return await fn();
    } finally {
      renderer.clearExportSize();
      renderer.syncSize(project.resolution);
    }
  }

  /** GL 的原点在**左下**，`ImageData` 的第 0 行在**顶部** —— 翻一次，否则图是倒的。 */
  function flipRows(data: Uint8Array, w: number, h: number): Uint8Array {
    const out = new Uint8Array(data.length);
    const stride = w * 4;
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * stride;
      out.set(data.subarray(src, src + stride), y * stride);
    }
    return out;
  }

  /**
   * 单帧求值：钉尺寸 → 跳帧对齐 → 等文字层就绪 → 渲染 → **在同一段钉尺寸里读回**。
   *
   * 三件不能省的事：
   *  - `onSeek()`：反馈类（echo）/ sim 类特效的历史是**跨帧状态**，不清历史就等于
   *    在「泵历史」，拿到的图带着上一次查询的残留（方案 §5.3）。
   *  - `prepareFrame`：排版层的位图是**异步光栅化**的。不 await 的话，agent 加完
   *    文字片段后第一次取图会拿到一张没有字的图（导出循环里也是这么做的）。
   *  - 吸附 t：`round(t·fps)/fps`，否则反馈帧与导出帧不是同一帧。
   *
   * **读必须在钉尺寸的内层**：`syncSize` 会改 canvas 尺寸，而改尺寸会**清空
   * 帧缓冲** —— 先还原尺寸再 `readPixels` 拿到的是一张黑图（而且不报错）。
   */
  async function drawAndRead(
    renderer: Renderer,
    project: Project,
    tRaw: number,
    size: Size,
  ): Promise<{ t: number; w: number; h: number; rgba: Uint8Array }> {
    const t = timeOf(frameOf(tRaw, project.fps), project.fps);
    const frame = await withPinnedSize(renderer, project, size, async () => {
      renderer.onSeek();
      await renderer.prepareFrame(project, t);
      renderer.renderFrame(project, t);
      const { data, w, h } = renderer.readPixels();
      return { w, h, rgba: flipRows(data, w, h) };
    });
    lastFrame = frame;
    return { t, ...frame };
  }

  function signatureSize(resolution: Size): Size {
    // 指纹默认小尺寸：性能类测量只能从小尺寸做，而且 agent 往返更快。
    const w = Math.min(320, Math.max(2, resolution.w));
    return normalizeSize({ w, h: (w * resolution.h) / Math.max(1, resolution.w) });
  }

  const view: Pick<AgentControlPlane, 'renderFrame' | 'readPixels' | 'frameSignature' | 'snapshotPng'> = {
    async renderFrame(opt) {
      return run(async () => {
        const store = needStore();
        const renderer = needRenderer();
        const project = store.project;
        const size = normalizeSize(opt?.size ?? project.resolution);
        const frame = await drawAndRead(renderer, project, opt?.t ?? ctx.getPlayT(), size);
        return { t: frame.t, w: frame.w, h: frame.h };
      });
    },

    /**
     * 读回最近一次「看」的像素。
     *
     * 契约上是「读当前帧缓冲」，实现上是**把 `renderFrame` / `snapshotPng` /
     * `frameSignature` 刚刚读到的同一份像素交回来** —— 因为出图路径用完就把
     * canvas 尺寸还回去了，而改尺寸会清空帧缓冲，事后真的去读只能读到黑图。
     * 交回来的这份就是那一刻的帧缓冲，逐字节相同。
     */
    async readPixels() {
      return run(() => {
        needRenderer();
        if (!lastFrame) throw new ControlFailure('not-ready', tr('agent.view.noFrame'));
        return { ...lastFrame };
      });
    },

    /**
     * 数值指纹。**默认给这个，不要默认给 PNG**（方案 §5.1）：
     * 一张图像输入约合上千 token，而指纹只有几十个数字。
     */
    async frameSignature(opt) {
      return run<FrameSignature>(async () => {
        const store = needStore();
        const renderer = needRenderer();
        const project = store.project;
        const size = normalizeSize(opt?.size ?? signatureSize(project.resolution));
        const frame = await drawAndRead(renderer, project, opt?.t ?? ctx.getPlayT(), size);
        return frameSignatureOf({
          rgba: frame.rgba,
          w: frame.w,
          h: frame.h,
          grid: opt?.grid,
          t: frame.t,
        });
      });
    },

    /** PNG 截图。**只在需要「看」的时候用**（审美判断 / 最终验收 / 给人看）。 */
    async snapshotPng(opt) {
      return run<Uint8Array>(async () => {
        const store = needStore();
        const renderer = needRenderer();
        const project = store.project;
        const size = normalizeSize(opt?.size ?? project.resolution);
        const frame = await drawAndRead(renderer, project, opt?.t ?? ctx.getPlayT(), size);

        // 不用 WebGL 的 `preserveDrawingBuffer`：那会让预览的每一帧都多付一次
        // 拷贝。这里已经把像素读回来了（同一任务内，一定是刚画出来的那一帧），
        // 灌进一张 2D canvas 再编码即可。
        const canvas = document.createElement('canvas');
        canvas.width = frame.w;
        canvas.height = frame.h;
        const c2d = canvas.getContext('2d');
        if (!c2d) throw new ControlFailure('internal', tr('agent.view.no2d'));
        c2d.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.w, frame.h), 0, 0);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new ControlFailure('internal', tr('agent.view.pngFailed'));
        return new Uint8Array(await blob.arrayBuffer());
      });
    },
  };

  /* ------------------------------------------------------------ 导 */

  async function runOneExport(opt: ExportRequest): Promise<ExportArtifact> {
    const store = needStore();
    const renderer = needRenderer();
    const project = store.project;
    if (exportRun) throw new ControlFailure('busy', tr('agent.export.busy'));
    if (!['mp4', 'png', 'gif'].includes(opt.format)) {
      throw new ControlFailure('invalid-argument', tr('agent.export.badFormat', { format: String(opt.format) }));
    }

    let sink: ExportOptions['sink'];
    let codec: string | undefined;
    let size = opt.size ? normalizeSize(opt.size) : undefined;
    let frameStep = opt.frameStep;
    let frameRange = opt.frameRange;

    if (opt.format === 'mp4') {
      if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
        // 复用 UI 那条同义文案：agent 与面板给的是同一个下一步动作。
        throw new ControlFailure('unsupported', tr('err.export.noWebCodecs'));
      }
      const audio = mixdown(project, (id) => ctx.getAudioBuffer(id));
      sink = new Mp4Sink({ audio });
      codec = MP4_CODEC;
    } else if (opt.format === 'png') {
      sink = new PngSequenceSink();
    } else {
      // GIF 的尺寸 / 抽帧由 `gif-plan` 算（秒 → 帧号只在那里发生一次）。
      // agent 给的是帧号，所以这里把区间换回秒再交出去 —— 往返是精确的。
      const plan = planGif({
        srcSize: project.resolution,
        srcFps: project.fps,
        duration: project.duration,
        range: frameRange
          ? { start: frameRange.from / project.fps, end: frameRange.to / project.fps }
          : undefined,
        width: size?.w ?? GIF_FALLBACK_WIDTH,
        fps: frameStep && frameStep > 0 ? project.fps / frameStep : GIF_FALLBACK_FPS,
      });
      size = plan.size;
      frameStep = plan.frameStep;
      frameRange = plan.frameRange;
      sink = new GifSink({
        width: plan.size.w,
        height: plan.size.h,
        maxColors: GIF_MAX_COLORS,
        delaysMs: plan.delaysMs,
        loop: 0,
      });
      codec = GIF_SINK_CODEC;
    }

    // 进度分母必须与 runExport 同口径（抽帧 / 区间都会改它），否则进度条永远
    // 到不了 100%。
    const total = Math.max(1, Math.ceil(project.duration * project.fps));
    const from = Math.min(Math.max(0, Math.floor(frameRange?.from ?? 0)), total - 1);
    const to = Math.min(Math.max(from + 1, Math.ceil(frameRange?.to ?? total)), total);
    const step = Math.max(1, Math.floor(frameStep ?? 1));
    const totalFrames = Math.max(1, Math.ceil((to - from) / step));

    const ctrl = new AbortController();
    exportAbort = ctrl;
    const forward = () => ctrl.abort();
    opt.signal?.addEventListener('abort', forward, { once: true });
    exportRun = { format: opt.format, frac: 0, frames: 0, totalFrames, startedAt: Date.now() };

    try {
      const out = await runExport(renderer, project, {
        sink,
        codec,
        size,
        frameStep,
        frameRange,
        // GIF 是纯 CPU 编码（每帧几十毫秒），默认 10 帧让渡一次会让取消按钮
        // 半秒才响应。理由见 ExportOptions.yieldEvery。
        yieldEvery: opt.format === 'gif' ? 1 : 10,
        onProgress: (frac) => {
          if (exportRun) exportRun.frac = frac;
          opt.onProgress?.(frac);
        },
        onFrame: (ms, index) => {
          if (exportRun) exportRun.frames += 1;
          opt.onFrame?.(ms, index);
        },
        signal: ctrl.signal,
      });
      const blob = out as Blob;
      return { format: opt.format, bytes: blob.size, mimeType: MIME[opt.format], blob };
    } finally {
      opt.signal?.removeEventListener('abort', forward);
      exportAbort = null;
      exportRun = null;
      // `runExport` 的 finally 只 clearExportSize，syncSize 得调用方补 ——
      // 不补的话预览停在导出分辨率上（而且不报错）。
      renderer.syncSize(store.project.resolution);
      ctx.refreshPreview();
    }
  }

  const io: Pick<AgentControlPlane, 'export' | 'exportBase64' | 'abortExport'> = {
    async export(opt) {
      return run(() => runOneExport(opt));
    },

    /** 跨传输层的导出：字节也一起给（base64）。 */
    async exportBase64(opt) {
      return run<ExportArtifactBase64>(async () => {
        const art = await runOneExport(opt);
        const base64 = await bytesToBase64(new Uint8Array(await art.blob.arrayBuffer()));
        return { format: art.format, bytes: art.bytes, mimeType: art.mimeType, base64 };
      });
    },

    async abortExport() {
      return run(() => {
        if (!exportAbort) return { aborted: false };
        exportAbort.abort();
        return { aborted: true };
      });
    },
  };

  /* ----------------------------------------------------- 工程级动作 */

  const projectActions: Pick<AgentControlPlane, 'saveProject' | 'openProject'> = {
    async saveProject() {
      return run(async () => {
        if (!(await ctx.saveProject())) {
          throw new ControlFailure('unsupported', tr('agent.export.saveFailed'));
        }
        return { saved: true as const };
      });
    },

    async openProject(name) {
      return run(async () => {
        ctx.cancelPendingGesture();
        const opened = await ctx.openProject(name);
        return { opened };
      });
    },
  };

  /* ------------------------------------------------------------ 排版 */

  const typography: Pick<
    AgentControlPlane,
    | 'addTypographyElement'
    | 'addGeneratedShape'
    | 'updateTypographyElement'
    | 'setTypographyText'
    | 'removeTypographyElement'
    | 'reorderTypographyElement'
    | 'groupTypographyElements'
    | 'ungroupTypographyElements'
    | 'layoutTypography'
    | 'setTypographyBackground'
    | 'setTypographyTheme'
    | 'replaceTypographyDoc'
  > = {
    async addTypographyElement(clipId, input) {
      return run(() => {
        const store = beforeWrite();
        if (!isRecord(input)) {
          throw new ControlFailure('invalid-argument', tr('agent.args.notObject', { what: 'element' }));
        }
        return typo.addElement(store, typoClipId(clipId), input);
      });
    },

    async addGeneratedShape(clipId, input) {
      return run(() => {
        const store = beforeWrite();
        if (!isRecord(input) || typeof input.genId !== 'string') {
          throw new ControlFailure('invalid-argument', tr('agent.typo.badGen', { id: String(input?.genId) }));
        }
        return typo.addGenerated(store, typoClipId(clipId), input);
      });
    },

    async updateTypographyElement(clipId, elementId, patch) {
      return run(() => {
        const store = beforeWrite();
        if (!isRecord(patch) || Object.keys(patch).length === 0) {
          throw new ControlFailure('invalid-argument', tr('agent.args.emptyPatch', { what: 'patch' }));
        }
        return { changed: typo.updateElement(store, typoClipId(clipId), elementId, patch) };
      });
    },

    async setTypographyText(clipId, elementId, text) {
      return run(() => {
        const store = beforeWrite();
        return { changed: typo.setText(store, typoClipId(clipId), elementId, text) };
      });
    },

    async removeTypographyElement(clipId, elementId) {
      return run(() => {
        const store = beforeWrite();
        return { changed: typo.removeElement(store, typoClipId(clipId), elementId) };
      });
    },

    async reorderTypographyElement(clipId, elementId, op) {
      return run(() => {
        const store = beforeWrite();
        if (!['front', 'back', 'forward', 'backward'].includes(op)) {
          throw new ControlFailure('invalid-argument', tr('agent.typo.badLayout', { detail: `op=${String(op)}` }));
        }
        return { changed: typo.reorderElement(store, typoClipId(clipId), elementId, op) };
      });
    },

    async groupTypographyElements(clipId, elementIds, name) {
      return run(() => {
        const store = beforeWrite();
        if (!Array.isArray(elementIds) || elementIds.length < 2) {
          throw new ControlFailure('invalid-argument', tr('agent.typo.badLayout', { detail: 'group needs >= 2 elementIds' }));
        }
        return typo.groupElements(store, typoClipId(clipId), elementIds, name ?? 'group');
      });
    },

    async ungroupTypographyElements(clipId, elementIds) {
      return run(() => {
        const store = beforeWrite();
        if (!Array.isArray(elementIds) || elementIds.length === 0) {
          throw new ControlFailure('invalid-argument', tr('agent.typo.badLayout', { detail: 'elementIds is empty' }));
        }
        return { changed: typo.ungroupElements(store, typoClipId(clipId), elementIds) };
      });
    },

    async layoutTypography(clipId, req) {
      return run(() => {
        const store = beforeWrite();
        if (!isRecord(req) || typeof req.op !== 'string') {
          throw new ControlFailure('invalid-argument', tr('agent.typo.badLayout', { detail: 'op is required' }));
        }
        return typo.layout(store, typoClipId(clipId), req);
      });
    },

    async setTypographyBackground(clipId, paint) {
      return run(() => {
        const store = beforeWrite();
        return { changed: typo.setBackground(store, typoClipId(clipId), paint) };
      });
    },

    async setTypographyTheme(clipId, theme) {
      return run(() => {
        const store = beforeWrite();
        return { changed: typo.setTheme(store, typoClipId(clipId), theme) };
      });
    },

    async replaceTypographyDoc(clipId, doc) {
      return run(() => {
        const store = beforeWrite();
        return typo.replaceDoc(store, typoClipId(clipId), doc);
      });
    },
  };

  /* ------------------------------------------------------------ 插件 */

  const plugins: Pick<
    AgentControlPlane,
    'pluginTry' | 'pluginInstall' | 'pluginList' | 'pluginDiscard' | 'pluginRemove' | 'pluginSource'
  > = {
    async pluginTry(input) {
      return run(async () => {
        needStore();
        return tryPlugin({
          host: ctx.getPluginHost?.() ?? null,
          projectKey: ctx.getProjectKey?.() ?? null,
          drafts: pluginDrafts,
          input: {
            id: String(input?.id ?? ''),
            name: String(input?.name ?? ''),
            source: String(input?.source ?? ''),
          },
        });
      });
    },

    async pluginInstall(pluginId, confirm) {
      return run(() =>
        installPlugin({
          host: ctx.getPluginHost?.() ?? null,
          drafts: pluginDrafts,
          projectKey: ctx.getProjectKey?.() ?? null,
          persist: ctx.persistPlugin ?? null,
          pluginId,
          confirm: confirm === true,
        }),
      );
    },

    async pluginList() {
      return run(() => ({ plugins: listPlugins(ctx.getPluginHost?.() ?? null, pluginDrafts) }));
    },

    async pluginDiscard(pluginId) {
      return run(() =>
        discardPlugin({
          host: ctx.getPluginHost?.() ?? null,
          drafts: pluginDrafts,
          unload: ctx.unloadPlugin ?? null,
          pluginId,
        }),
      );
    },

    async pluginRemove(pluginId) {
      return run(() =>
        removePlugin({
          host: ctx.getPluginHost?.() ?? null,
          drafts: pluginDrafts,
          remove: ctx.removePlugin ?? null,
          pluginId,
        }),
      );
    },

    async pluginSource(pluginId) {
      return run(() => ({ source: draftSource(pluginDrafts, pluginId) }));
    },
  };

  return { ...read, ...write, ...view, ...io, ...projectActions, ...typography, ...plugins };
}
