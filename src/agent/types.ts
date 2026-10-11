/**
 * types.ts — 控制平面的契约类型（方案：`docs/agent-control-plane.md` §3）。
 *
 * 这一层是 **agent 的唯一操作面**：读场景 / 写工程 / 出图 / 导出。
 * 它不 import `ui/` —— 运行期实例（当前工程的 `ProjectStore`、`Renderer`、
 * 素材仓、播放头）全部走注入的 `ControlContext`（见本文件末尾），
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

/* ------------------------------------------------------------------ 结果 */

/** 控制平面 API 版本。网关握手时校验主版本，不匹配就拒绝。 */
export const CONTROL_API_VERSION = 1;

export type ControlErrorCode =
  /** 参数形状不对 / 越界 / 枚举里没有这个 id。 */
  | 'invalid-argument'
  /** 引用的东西不存在（clipId / trackId / defId）。 */
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

export type ClipSourceView =
  | { type: 'video'; assetId: string; srcIn: number; speed: number }
  | { type: 'image'; assetId: string }
  | { type: 'algo'; generator: string; params: Record<string, number | string> }
  | { type: 'text'; doc: unknown }
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

export interface SceneSnapshot {
  /** 秒，已吸附到帧栅格。 */
  t: number;
  fps: number;
  resolution: { w: number; h: number };
  /** 秒。 */
  duration: number;
  beatGrid: { bpm: number; offset: number; beatsPerBar: number };
  seed: number;
  tracks: TrackView[];
}

export interface SceneIdSnapshot {
  t: number;
  fps: number;
  resolution: { w: number; h: number };
  duration: number;
  beatGrid: { bpm: number; offset: number; beatsPerBar: number };
  seed: number;
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

export interface Capabilities {
  generators: { id: string; kind: string }[];
  effects: { id: string }[];
  transitions: { id: string }[];
  blendModes: BlendMode[];
  fits: ('contain' | 'cover' | 'stretch')[];
  curveModes: ('keyframe' | 'impulse' | 'follower')[];
  sourceTypes: SourceType[];
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
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
}
