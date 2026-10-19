/**
 * types.ts — 控制平面的契约类型（方案：`docs/agent-control-plane.md` §3）。
 *
 * 这一层是 **agent 的唯一操作面**：读场景 / 写工程 / 出图 / 导出 / 排版 / 插件。
 * 它不 import `ui/` —— 运行期实例（当前工程的 `ProjectStore`、`Renderer`、
 * 素材仓、播放头、插件宿主）全部走注入的 `ControlContext`（见本文件末尾），
 * 与 `platform/` 的解耦是同一手法（AGENTS 硬约束 1.5）。
 *
 * ## 关于 `t` 的单位：秒（吸附到帧栅格）
 *
 * 方案 §9.3 把控制平面的 `t` 称作「帧号」，但同一条方案 §5.3 给的吸附公式
 * `round(t·fps)/fps`、以及引擎全链路的 `t`（`engine/clock.ts` 的
 * `timeOf(frame, fps) = frame/fps`、`Renderer.renderFrame(project, t)`）都说明
 * `t` 是**秒**。这里跟引擎与 §5.3 对齐：说错单位的代价是「agent 算出的反馈帧
 * 与导出帧不是同一帧」，而且**不报错**。
 *
 * 判据：**凡是要帧号的地方，字段名一律带 `Frame`**（`frameRange.from` /
 * `frameRange.to` / `frameStep`）；**`t` 永远是秒**。
 *
 * ## 关于返回值：统一 `{ ok, data } | { ok, error }`，不抛异常
 *
 * 异常跨传输层会丢掉类型（CDP 传过来是一句字符串），agent 拿不到可判别的
 * `code`。所以控制平面的每个方法都返回 `ControlResult`，`code` 是稳定的
 * 机器可读枚举，`message` 给人看。
 */

import type { Curve } from '../core/curve';
import type { BlendMode } from '../core/schema';
import type { AlignAxis } from '../typography/geometry';

/* ------------------------------------------------------------------ 结果 */

/**
 * 控制平面 API 版本。网关握手时校验主版本，不匹配就拒绝。
 *
 * v2（2026-10-18）：文本片段的 `source.doc` 从「整份文档」改成摘要
 * （`ClipTextSummary`），详情走 `getTypographyDoc`。这是**读形状变更**，
 * 旧客户端拿到的字段会变成 undefined —— 所以要抬版本而不是静默改。
 *
 * v3（2026-10-19，0.3 W2）：场景快照多了 `sections`（段落标记），
 * audio 片段多了 `fadeIn` / `fadeOut`。**只加字段**，但「工程结构里多了一类
 * 用户可编辑的实体」值得让网关照版本号判断能力，而不是让旧客户端以为
 * 时间轴上只有片段。
 */
export const CONTROL_API_VERSION = 3;

export type ControlErrorCode =
  /** 参数形状不对 / 越界 / 枚举里没有这个 id。 */
  | 'invalid-argument'
  /** 引用的东西不存在（clipId / trackId / defId / pluginId）。 */
  | 'not-found'
  /** 这个对象做不到这件事（如给 solid 源设 generator 参数）。 */
  | 'unsupported'
  /** 落点被重叠策略拒收（`overlapBehavior: 'reject'`）。 */
  | 'conflict'
  /** 一份工程都没打开（关闭全部工程之后就是这个状态）。 */
  | 'no-project'
  /** 渲染服务还没装配好（预览 canvas 还没挂载）。 */
  | 'not-ready'
  /** 已经有一个导出在跑。 */
  | 'busy'
  /** 导出被 AbortSignal 取消。 */
  | 'cancelled'
  /** 写盘 / 执行代码需要用户确认（插件安装）。 */
  | 'needs-approval'
  /** 兜底：不该发生。 */
  | 'internal';

export interface ControlError {
  code: ControlErrorCode;
  /** 给人看的一句话。 */
  message: string;
  /** 可选的机器可读细节（校验失败时的字段名、越界时的上下界等）。 */
  detail?: unknown;
}

export type ControlResult<T> = { ok: true; data: T } | { ok: false; error: ControlError };

export function ok<T>(data: T): ControlResult<T> {
  return { ok: true, data };
}

export function fail(code: ControlErrorCode, message: string, detail?: unknown): ControlResult<never> {
  return { ok: false, error: detail === undefined ? { code, message } : { code, message, detail } };
}

/** 控制平面内部抛这个，装配层统一转成 `ControlResult`。 */
export class ControlFailure extends Error {
  constructor(
    readonly code: ControlErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ControlFailure';
  }
}

/* -------------------------------------------------------------------- 读 */

export interface DescribeInfo {
  apiVersion: number;
  appVersion: string;
  schemaVersion: number;
  /** 帧率。`t` 的吸附栅格就是它。 */
  fps: number;
  resolution: { w: number; h: number };
  /** 秒。 */
  duration: number;
}

export type SceneDetail = 'ids' | 'full';

export type ClipKind = 'source' | 'effect' | 'audio';

export type SourceType = 'video' | 'image' | 'algo' | 'text' | 'solid';

/**
 * 文本片段的摘要（v2 起 `ClipSourceView` 里给的就是它）。
 *
 * 整份 `TypographyDocument` 有元素、富文本 runs、动画、组合表 —— 一个工程里
 * 几段文字就能把上下文塞满。所以快照只给「有几个元素、画布多大、用什么配色」，
 * 详情由 `getTypographyDoc(clipId, detail)` 按需拉。
 */
export interface ClipTextSummary {
  size: { w: number; h: number };
  /** 元素个数。 */
  elements: number;
  /** 配色方案 id（缺省 = 默认方案）。 */
  theme: string | null;
  /** 有没有元素带入场动画（给「这一帧会不会动」一个提示）。 */
  animated: boolean;
}

export type ClipSourceView =
  | { type: 'video'; assetId: string; srcIn: number; speed: number }
  | { type: 'image'; assetId: string }
  | { type: 'algo'; generator: string; params: Record<string, number | string> }
  | { type: 'text'; doc: ClipTextSummary }
  | { type: 'solid'; color: string };

export interface EffectInstanceView {
  instanceId: string;
  defId: string;
  enabled: boolean;
  values: Record<string, number | string>;
}

/** `detail: 'ids'` 的片段：只够 agent 在长工程里探路。 */
export interface ClipIdView {
  id: string;
  kind: ClipKind;
  label: string;
  /** 秒。 */
  start: number;
  /** 秒。 */
  end: number;
}

/** `detail: 'full'` 的片段。 */
export interface ClipView extends ClipIdView {
  fadeSec: number;
  /**
   * `t` 时刻是否命中这一段（**含出画转场窗口**）。
   *
   * 由控制平面算好给出：判断命中要处理转场窗口（`transitionAt` 必须在 span
   * 过滤**之前**判，见 `engine/stack.ts`），让每个 agent 各自推一遍会引入
   * 一整类边界 bug。
   *
   * 只反映**几何与转场**，不含轨道 `enabled` —— 轨道开关在 track 上给。
   * 转场窗口内**两侧**（出画片段与入画片段）都是 `true`：那一帧的画面确实由
   * 两张贴图共同决定。
   */
  active: boolean;
  source?: ClipSourceView;
  blend?: BlendMode;
  opacity?: number;
  transform?: { x: number; y: number; sx: number; sy: number; rot: number };
  fit?: 'contain' | 'cover' | 'stretch';
  transitionOut?: { defId: string; duration: number; values: Record<string, number> };
  chain?: EffectInstanceView[];
  /**
   * 影响深度（只有特效片段有）：只作用于下方最近的 N 条**启用**视觉轨；
   * 0 / 缺省 = 下方全部。语义与边界规则见 `engine/stack.ts`。
   */
  affectDepth?: number;
  /** 只给**有键**的曲线，不铺开全部参数名。 */
  curves?: Record<string, Curve>;
  /** audio 片段独有的两个字段。 */
  assetId?: string;
  srcIn?: number;
  /** audio 片段的两段淡变（秒，v3）。缺省 = 0 = 不淡。 */
  fadeIn?: number;
  fadeOut?: number;
}

export interface TrackView {
  id: string;
  kind: 'visual' | 'audio';
  name: string;
  enabled: boolean;
  /**
   * z 序 = 视觉轨数 − 1 − 视觉轨下标（AGENTS §4.1）。音频轨是 `null`。
   *
   * 由控制平面算好给出：这个换算写反的表现是「特效完全无效且不报错」，
   * 不该让每个 agent 各自推一遍。
   */
  z: number | null;
  clips: ClipView[];
}

export interface TrackIdView {
  id: string;
  kind: 'visual' | 'audio';
  name: string;
  enabled: boolean;
  z: number | null;
  clips: ClipIdView[];
}

/**
 * 段落标记（v3）。**只给起点**：这一段的结尾永远是下一段的起点
 * （最后一段到工程末尾）—— 与 `Section` 的存储口径一致，不在快照里再造一份
 * 「end」，否则 agent 读到的是「视图的算法」而不是数据。
 */
export interface SceneSectionView {
  id: string;
  name: string;
  /** 秒。 */
  start: number;
  color?: string;
}

export interface SceneSnapshot {
  /** 秒，已吸附到帧栅格。 */
  t: number;
  fps: number;
  resolution: { w: number; h: number };
  /** 秒。 */
  duration: number;
  beatGrid: { bpm: number; offset: number; beatsPerBar: number };
  seed: number;
  /** 按 `start` 排好序（与时间轴上的顺序一致）。 */
  sections: SceneSectionView[];
  tracks: TrackView[];
}

export interface SceneIdSnapshot {
  t: number;
  fps: number;
  resolution: { w: number; h: number };
  duration: number;
  beatGrid: { bpm: number; offset: number; beatsPerBar: number };
  seed: number;
  sections: SceneSectionView[];
  tracks: TrackIdView[];
}

/** 已打开的工程（等价 `window.__artmatic.projects()`）。 */
export interface OpenProjectView {
  name: string;
  dirty: boolean;
  active: boolean;
  view: string;
  saved: boolean;
  dir: string | null;
}

/* ------------------------------------------------------- 能力（参数化） */

/** `ids` 只给 id；`params` 额外给展示名与完整参数表。 */
export type CapabilityDetail = 'ids' | 'params';

export interface ParamOption {
  value: string;
  label: string;
}

/**
 * 一项参数的机器可读描述（从 `ParamDef` 序列化而来）。
 *
 * **`visibleWhen` 这样的函数字段一律剥掉**：它过不了 JSON，而且 agent 需要的
 * 只是「有哪些键、什么类型、取值范围」，不需要在客户端执行谓词。
 */
export interface ParamSchema {
  key: string;
  label: string;
  type: 'range' | 'select' | 'checkbox' | 'color' | 'bitmask' | 'pattern' | 'text';
  defaultValue: number | string;
  /** 只有 range 能打关键帧（`runtime.evalParams` 只对 range 走曲线）。 */
  curvable: boolean;
  min?: number;
  max?: number;
  step?: number;
  curve?: number;
  options?: ParamOption[];
  bits?: number;
  groups?: { label: string; bits: number; style: 'eca' | 'count' }[];
  presets?: { label: string; value: number }[];
  editorSize?: number;
  mode?: '2d' | '1d';
  maxLength?: number;
  multiline?: boolean;
  placeholder?: string;
}

export interface GeneratorCapability {
  id: string;
  kind: string;
  name?: string;
  desc?: string;
  pluginId?: string | null;
  params?: ParamSchema[];
}

export interface EffectCapability {
  id: string;
  name?: string;
  desc?: string;
  category?: string | null;
  tags?: string[];
  pluginId?: string | null;
  params?: ParamSchema[];
  /** 结构标记：agent 据此知道「这条特效有历史 / 有几个 pre-pass」。 */
  flags?: {
    feedback: boolean;
    prePasses: number;
    stateful: boolean;
    hdrFeedback: boolean;
    opaqueOutput: boolean;
  };
}

export interface TransitionParamSchema {
  key: string;
  label: string;
  type: 'range' | 'checkbox';
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number;
}

export interface TransitionCapability {
  id: string;
  name?: string;
  author?: string;
  license?: string;
  params?: TransitionParamSchema[];
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
}

export interface Capabilities {
  generators: GeneratorCapability[];
  effects: EffectCapability[];
  transitions: TransitionCapability[];
  blendModes: BlendMode[];
  fits: ('contain' | 'cover' | 'stretch')[];
  curveModes: ('keyframe' | 'impulse' | 'follower')[];
  sourceTypes: SourceType[];
}

/* ------------------------------------------------------------ 排版能力 */

export interface TypographyGeneratorCapability {
  id: string;
  group: string;
  name: string;
  defaultSeed: number;
  aspect?: number;
  params: ParamSchema[];
}

export interface TypographyCapabilities {
  /** 全部 `ShapeKind`。 */
  shapeKinds: string[];
  /** 每种图形支持哪些专属参数（圆角 / 边数 / 谷半径 / 壁厚 / 张角）。 */
  shapeParams: Record<
    string,
    { radius: boolean; sides: boolean; waist: boolean; inner: boolean; angle: boolean }
  >;
  /** 程序化 SVG 生成器（22 个）。 */
  generators: TypographyGeneratorCapability[];
  themes: { id: string; name: string; builtin: boolean }[];
  defaultFontFamily: string;
  paintKinds: ('none' | 'solid' | 'linear' | 'radial' | 'texture')[];
  texturePatterns: string[];
  mixBlends: string[];
  imageFits: ('fill' | 'contain' | 'cover' | 'none')[];
  textAligns: ('left' | 'center' | 'right' | 'justify')[];
  textVAligns: ('top' | 'middle' | 'bottom')[];
  strokeStyles: ('solid' | 'dashed' | 'dotted')[];
  layoutOps: string[];
  alignAxes: AlignAxis[];
}

/* --------------------------------------------------------------- 排版视图 */

export interface TypographyElementView {
  id: string;
  kind: 'text' | 'shape' | 'image';
  name: string;
  frame: { x: number; y: number; w: number; h: number; rot: number };
  blend: string;
  opacity: number;
  visible: boolean;
  locked: boolean;
  groupId?: string;
  /** text */
  text?: string;
  style?: Record<string, unknown>;
  fill?: unknown;
  boxFill?: unknown;
  boxStroke?: unknown;
  /** shape */
  shape?: string;
  stroke?: unknown;
  radius?: number;
  sides?: number;
  waist?: number;
  inner?: number;
  angle?: number;
  evenOdd?: boolean;
  gen?: { id: string; seed: number; params: Record<string, number | string> };
  /** image */
  assetId?: string;
  fit?: string;
  crop?: unknown;
  /** 入场动画的描述（只给类型与时长，不给完整表达式）。 */
  animations?: { kind: string; duration: number }[];
}

export interface TypographyGroupView {
  id: string;
  name: string;
  fill: unknown;
  stroke: unknown;
  radius: number;
  padding: number;
}

export interface TypographyDocView {
  clipId: string;
  size: { w: number; h: number };
  background: unknown;
  theme: string | null;
  elements: TypographyElementView[];
  groups: TypographyGroupView[];
  fonts: { family: string; format: string }[];
}

/** `detail: 'ids'` 的排版文档：只够 agent 找到「要改哪一个元素」。 */
export interface TypographyDocIdView {
  clipId: string;
  size: { w: number; h: number };
  theme: string | null;
  elements: { id: string; kind: 'text' | 'shape' | 'image'; name: string; frame: TypographyFrame }[];
}

/* --------------------------------------------------------------- 插件 */

/**
 * 控制平面对插件宿主的**最小视图**。
 *
 * 只声明它用到的那几个方法（结构类型，不需要 import `plugins/host.ts`）——
 * `src/agent/` 的依赖方向里没有 `plugins/`，装配点（`main.ts`）负责把
 * `appState.plugins` 交进来。
 */
export interface AgentPluginHost {
  importBytes(
    fileName: string,
    bytes: Uint8Array,
    projectKey: string | null,
  ): Promise<{ pluginId: string; ok: boolean; issues: PluginIssueView[] }>;
  get(pluginId: string): AgentLoadedPlugin | null;
  list(): AgentLoadedPlugin[];
  markPersisted(pluginId: string, fileName: string): void;
  installedIds?(): Set<string>;
}

export interface PluginIssueView {
  code: string;
  path?: string;
  detail?: string;
}

export interface AgentLoadedPlugin {
  id: string;
  name: string | null;
  author?: string | null;
  version?: string | null;
  license?: string | null;
  fileName: string | null;
  enabled: boolean;
  status: 'ok' | 'partial' | 'failed' | 'disabled';
  effectCount: number;
  generatorCount: number;
  issues: PluginIssueView[];
  verified: boolean;
  failure?: { code: string; detail: string } | null;
}

export interface PluginTryResult {
  pluginId: string;
  ok: boolean;
  status: AgentLoadedPlugin['status'];
  /** 已进注册表的**限定 id**（`${pluginId}/${localId}`）。 */
  effects: string[];
  generators: string[];
  issues: PluginIssueView[];
  /** 有没有跑过真 GL 编译校验。false = 预览还没装配，稍后重试。 */
  verified: boolean;
  /** 归档在草稿区（可安装 / 可丢弃）。 */
  draft: boolean;
}

export interface PluginInfoView {
  id: string;
  name: string | null;
  enabled: boolean;
  status: AgentLoadedPlugin['status'];
  effectCount: number;
  generatorCount: number;
  issues: PluginIssueView[];
  /** 磁盘上的文件名。null = 只在内存里（还没安装 / 工程没目录）。 */
  fileName: string | null;
  /** 控制平面的草稿区里有没有这份源码。 */
  draft: boolean;
}

/* -------------------------------------------------------------------- 看 */

/**
 * 一帧的数值指纹（方案 §5.2）。
 *
 * **默认给这个，不要默认给 PNG**：一张图像输入约合上千 token，数值指纹只有
 * 几十个数字。agent 自循环里的「改对没改对」用它就够。
 *
 * 两条实测过的判据陷阱（AGENTS §5.6，继承 `tests/e2e/_stage.ts::gridStats`）：
 *  1. 把颜色压成一个标量之后有些调色板会退化成常量（余弦调色板三通道恒差
 *     2π/3 ⇒ 均值恒 127.5），所以 `mean` **逐通道**。
 *  2. 分块均值对「铺满整幅的彩色渐变」不敏感。要判「有没有结构」用 `spread`，
 *     **不要用 `mean`**。
 */
export interface FrameSignature {
  /** 秒，已吸附到帧栅格。 */
  t: number;
  w: number;
  h: number;
  /** 逐通道均值（0–255）。 */
  mean: [number, number, number];
  /** 采样点里单通道的最大跨度（0–255）。0 = 这一帧没有结构。 */
  spread: number;
  /** `grid×grid` 分块均值（单通道等价量，与 `_stage.ts` 同口径），行优先。 */
  grid: number[];
  /** `grid×grid` 个点采样，每点 RGB 三通道（长度 = `grid*grid*3`）。 */
  samples: number[];
  /** 非零像素数 —— 纯黑背景下「非零即几何」。 */
  lit: number;
  total: number;
}

/* -------------------------------------------------------------------- 导 */

export type ExportFormat = 'mp4' | 'png' | 'gif';

export interface ExportRequest {
  format: ExportFormat;
  /** **帧号**，左闭右开（与 `ExportOptions.frameRange` 同一约定，见 AGENTS §5.8）。 */
  frameRange?: { from: number; to: number };
  size?: { w: number; h: number };
  /** 抽帧步进（GIF 用得上），默认 1。 */
  frameStep?: number;
  /** 传进来就是秒 —— 同一条求值路径，差别只在分辨率。 */
  signal?: AbortSignal;
  onProgress?: (frac: number) => void;
  onFrame?: (ms: number, index: number) => void;
}

/** 导出跑起来时的进度读数（网关轮询它转成 MCP 的 progress notification）。 */
export interface ExportState {
  format: ExportFormat;
  /** 0–1。 */
  frac: number;
  /** 已经渲完的帧数。 */
  frames: number;
  /** 这一轮导出会渲多少帧（含抽帧）。 */
  totalFrames: number;
  startedAt: number;
}

/**
 * 导出产物。
 *
 * `blob` 只在**页面内**可用（E2E 直接读字节）。跨传输层时用 `exportBase64`
 * —— 它把字节也编码进来，代价是字符串体积约 1.37 倍。大导出请改用
 * 「导出到工程目录」那条路（当前工具面未暴露，见 `docs/agent-control-plane.md` §3.5）。
 */
export interface ExportArtifact {
  format: ExportFormat;
  bytes: number;
  mimeType: string;
  blob: Blob;
}

export interface ExportArtifactBase64 extends Omit<ExportArtifact, 'blob'> {
  base64: string;
}

/* ------------------------------------------------------------------ 上下文 */

/**
 * 控制平面与宿主之间的**唯一**接缝。
 *
 * 为什么是注入而不是直接 import `ui/app-state.svelte`：`appState` 是 `ui/`
 * 层的 `$state` 类，`src/agent/` 直接 import 它就被 `ui/` 反向绑住，将来
 * `/lab/` 或独立入口想复用控制平面时会成环。注入点只有一处（`main.ts`），
 * 代价极小。
 *
 * ⚠️ **`getStore()` 每次调用都重新取**，绝不能缓存成 `const store = ...` 后
 * 跨工程切换用 —— `appState.store` 是 getter，多工程下它永远指向当前前台那份
 * （AGENTS §5.2）。
 */
export interface ControlContext {
  /** 当前激活工程的 store。无工程时返回 null。 */
  getStore(): import('../core/project-store').ProjectStore | null;
  /** 渲染门面。预览 canvas 还没挂载时为 null。 */
  getRenderer(): import('../engine/renderer').Renderer | null;
  /** 当前工程的素材仓（校验 assetId 用）。 */
  getAssets(): import('../project/asset-store').AssetStore | null;
  getPlayT(): number;
  setPlayT(t: number): void;
  /** 音频字节（导出 mp4 混流用）。没有就返回 null。 */
  getAudioBuffer(assetId: string): AudioBuffer | null;
  listProjects(): OpenProjectView[];
  /** 写盘。返回 false = 没写成（未绑定目录 / 目录选择器不可用）。 */
  saveProject(): Promise<boolean>;
  /** 打开一份工程：给 name 走 OPFS（headless 可用），不给就弹系统对话框（需手势）。 */
  openProject(name?: string): Promise<boolean>;
  /** 编辑器的「取消当前手势」钩子 —— agent 承接事务前必须让它落地。 */
  cancelPendingGesture(): void;
  /** 让界面重新同步（导出 / 出图改过渲染尺寸之后调）。 */
  refreshPreview(): void;

  /* -------------------------------------------------- 排版 / 插件的接缝 */

  /**
   * 排版编辑器当前正在编辑的文本片段 id。没有打开排版页时返回 null。
   *
   * 排版工具允许省略 `clipId`，此时用它 —— 用户在排版页里说「把标题改大」，
   * agent 不该要求他先报一个 id。
   */
  getActiveTypoClipId?: () => string | null;
  /**
   * 停掉正在进行的行内文本编辑（contenteditable）。
   *
   * 只调 `cancelPendingGesture()` 不够：那个落地的是手势事务，而打字是
   * 直接在文档对象上改 runs 的。不停止的话，agent 写入会被编辑器下一次
   * 提交覆盖（或者反过来）—— 两边都「看起来正常」，只是改动丢了。
   */
  stopTextEditing?: () => void;

  /** 插件宿主（`appState.plugins`）。没有工程 / 未初始化时为 null。 */
  getPluginHost?: () => AgentPluginHost | null;
  /** 当前工程的引用计数键（`OpenProject.id`）。 */
  getProjectKey?: () => string | null;
  /**
   * 把插件源码写进 `<工程目录>/plugins/<id>.js`。
   * 返回 false = 没有工程目录（只能本次会话内存可用）。
   */
  persistPlugin?: (pluginId: string, source: string) => Promise<boolean>;
  /** 从注册表卸载（不删磁盘文件）。 */
  unloadPlugin?: (pluginId: string) => Promise<void>;
  /** 彻底移除：注册表 + 记录 + 磁盘文件。 */
  removePlugin?: (pluginId: string) => Promise<void>;
}

/* ------------------------------------------------------ 排版写入的请求形状 */

/**
 * 新增元素。三种 `kind` 各有自己的字段，公共字段（位置 / 样式）在顶层。
 *
 * 之所以不用「一个通用 patch 对象」：文字要 runs + style、图形要 shape + fill，
 * 混在一个宽松对象里，agent 写错字段名不会有任何报错（只是静默没生效）。
 */
export type TypographyElementInput =
  | {
      kind: 'text';
      text: string;
      /** 文档坐标（左上原点，px）。省略 = 水平居中、纵向居中偏上。 */
      frame?: Partial<TypographyFrame>;
      style?: Partial<TypographyTextStyleInput>;
      fill?: unknown;
      boxFill?: unknown;
      boxStroke?: unknown;
      name?: string;
      opacity?: number;
      blend?: string;
    }
  | {
      kind: 'shape';
      shape: string;
      frame?: Partial<TypographyFrame>;
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
  | {
      kind: 'image';
      assetId: string;
      frame?: Partial<TypographyFrame>;
      fit?: 'fill' | 'contain' | 'cover' | 'none';
      radius?: number;
      crop?: { x: number; y: number; w: number; h: number };
      name?: string;
      opacity?: number;
      blend?: string;
    };

export interface TypographyFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
}

export interface TypographyTextStyleInput {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  letterSpacing: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right' | 'justify';
  vAlign: 'top' | 'middle' | 'bottom';
  color: string;
  textDecoration: 'none' | 'underline' | 'line-through';
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  highlight?: string;
  shadow?: { color: string; dx: number; dy: number; blur: number };
  writingMode: 'horizontal-tb' | 'vertical-rl';
}

/** 元素属性的白名单补丁（`kind` / `id` / `source` 一类不可写）。 */
export interface TypographyElementPatch {
  name?: string;
  frame?: Partial<TypographyFrame>;
  blend?: string;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  /** text */
  style?: Partial<TypographyTextStyleInput>;
  fill?: unknown;
  boxFill?: unknown;
  boxStroke?: unknown;
  /** shape */
  stroke?: unknown;
  radius?: number;
  sides?: number;
  waist?: number;
  inner?: number;
  angle?: number;
  evenOdd?: boolean;
  /** image */
  fit?: 'fill' | 'contain' | 'cover' | 'none';
  crop?: { x: number; y: number; w: number; h: number };
}

export type TypographyLayoutRequest =
  | { op: 'align'; axis: AlignAxis; target?: 'canvas' | 'selection'; elementIds?: string[] }
  | { op: 'distribute'; axis: 'h' | 'v'; elementIds?: string[] }
  | { op: 'grid'; cols: number; rows?: number; gap?: number; margin?: number; elementIds?: string[] }
  | { op: 'row' | 'column'; gap?: number; margin?: number; elementIds?: string[] };
