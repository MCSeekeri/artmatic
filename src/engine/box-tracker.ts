/**
 * box-tracker.ts — 「方框跟踪」特效的服务层：探针回读 + 追踪状态 + HUD 叠层。
 *
 * ## 它解决的是什么
 *
 * 特效协议（`effects/shader-def.ts`）是**无状态的全屏片段**，拿不到
 * 「画面里有哪些物体」。这个服务补上那一环：
 *
 *   链输入纹理 → 固定 160×90 探针帧 → readPixels → core/blob-track（纯 TS）
 *   → Canvas2D 画方框/标签/连线 → 上传成 `u_overlay` → 主 pass 做框内效果 + 合成
 *
 * ## 为什么放 engine 而不是 effects
 *
 * `engine/` 不许 import `effects/`（层次 `engine ← effects`）。特效那一侧只认
 * **uniform 协议**：program 声明了 `u_overlay` 就调用本服务（与
 * `SpectrumTextures.bindTo` 对着 `u_spectrum` 的判据同构），服务本身不认识任何
 * 具体 effect id。所以主应用与 `/lab/` 自动都有，不需要各自装配。
 *
 * ## 探针尺寸固定，与渲染尺寸解耦
 *
 * 探针恒为 160 宽（高按画幅比推算）。若它跟着渲染尺寸走，预览（960 宽）与
 * 导出（1920 宽）会降采样出不同的显著性图 —— 表现是「预览里框在这，导出后
 * 框在那」。固定探针是「预览即所得」的前提；代价是方框坐标最多差一个探针
 * 像素（≈0.6% 画幅），肉眼不可见。
 *
 * ## 有状态与 seek
 *
 * 追踪状态（方框列表、ID、标签、上一帧亮度）**跨帧**存在。`Renderer.onSeek()`
 * 时由 `render-core` 调 `reset()` 清空 —— 与现有 `feedback: true` 特效同一处置。
 * 导出是顺序紧循环，逐帧精确；预览跳转后从新画面重新检测（一两帧内收敛）。
 * 因此**不保证「同一 t 连渲两次逐字节相同」**，测试不得断言这一点
 * （理由同 `tests/e2e/algo-sim.spec.ts` 头注）。
 *
 * ## 两条已记录在案的 GL 事故
 *
 * 创建 / 上传纹理前**必须**先切到 scratch 单元：`bindTexture` 作用在「当前
 * 激活的纹理单元」上，而 `Program.tex()` 会把采样本绑到 0..n 并留下最后一个为
 * 激活态。不切走的话，叠层纹理会把链输入（`u_texture`）顶掉，画面整片发红，
 * 而且只在该实例的第一帧出现（见 `effects/AGENTS.md`）。
 */

import {
  detectBlobs,
  emptyTrackState,
  jitteredView,
  makeSaliency,
  saliency,
  stepTracker,
  type DetectDiag,
  type DetectMode,
  type Saliency,
  type TrackBox,
  type TrackState,
} from '../core/blob-track';
import { hexToRgba } from '../core/color';
import { hashSeed, mulberry32 } from '../core/prng';
import type { EffectInstance } from '../core/schema';
import { tr } from '../i18n/index.svelte';
import type { MessageKey } from '../i18n/locales';
import type { Kit, Program, Target } from './kit';

/** 探针宽度（像素）。见文件头「探针尺寸固定」。 */
export const PROBE_WIDTH = 160;
/** 方框数上限。必须与 GLSL 里 `u_boxA[12]` 的数组长度一致。 */
export const MAX_BOXES = 12;
/** 探针 program 的名字。预编译（`effects/compile-all.ts`）与运行期必须同名。 */
export const PROBE_PROGRAM_NAME = 'fx-box-tracker:probe';

/**
 * 探针 pass：把链输入降采样成一块小图。
 *
 * 采样坐标的 y 是**反的**（`1.0 - vUv.y`）。理由：`gl.readPixels` 的第 0 行是
 * 帧缓冲的**底部**，而 Canvas2D 的第 0 行是**顶部**。这里先翻一次，读回来的
 * 数组就与 canvas 的行序一致，后面算出来的 `cy` 可以直接拿去画叠层；
 * 否则方框会整体上下颠倒（只翻标签不翻框更糟）。
 */
const PROBE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
/** 一个**探针像素**在源纹理 UV 上的步长（= 1/探针尺寸，不是 1/源尺寸）。 */
uniform vec2 u_step;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  // 3×3 覆盖整个探针像素的足迹。**步长必须用探针的 texel**：
  // 用源的 texel（1/源尺寸）时每个 tap 只隔半个源像素，等于点采样 ——
  // 实测周期为整数倍的画面（lab 的网格）整幅被采成同一个值，显著性恒为 0。
  vec3 sum = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      sum += texture(u_texture, uv + u_step * vec2(float(x), float(y)) / 3.0).rgb;
    }
  }
  outColor = vec4(sum / 9.0, 1.0);
}`;

/** 预编译探针 program（`compileAll` 用）。名字与运行期同源。 */
export function compileTrackerPrograms(kit: Kit): { id: string; ok: boolean; error?: string } {
  try {
    kit.quad(PROBE_FRAG, PROBE_PROGRAM_NAME);
    return { id: PROBE_PROGRAM_NAME, ok: true };
  } catch (e) {
    return { id: PROBE_PROGRAM_NAME, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ----------------------------------------------------------------- 参数 */

type FrameStyle = 'solid' | 'dashed' | 'brackets' | 'double' | 'texture';
type LabelMode = 'full' | 'label' | 'conf' | 'id';
type LabelPos = 'outTop' | 'inTop' | 'inBottom' | 'outLeft';
type LinkStyle = 'straight' | 'elbow45' | 'curve';
type ScanAxis = 'v' | 'h';

/** 一个方框在当前帧的**绘制态**（动画只作用于绘制，不写回追踪状态）。 */
interface BoxView {
  b: TrackBox;
  /** 出场渐入 × 消失渐出。 */
  alpha: number;
  /** 出场时从 1.16 收到 1，消失时再略微撑开。 */
  scale: number;
  /** 扫描线的相位 [0,1)：每个方框各有相位，不然所有框同步扫、像整幅画面在闪。 */
  scanPhase: number;
}

interface Params {
  blobCount: number;
  refresh: number;
  sensitivity: number;
  mode: DetectMode;
  minSize: number;
  maxSize: number;
  smoothness: number;
  jitter: number;
  hold: number;
  frameStyle: FrameStyle;
  frameWidth: number;
  frameColor: string;
  frameAlpha: number;
  cornerLen: number;
  labelShow: boolean;
  labelCustom: string;
  labelVocab: string;
  labelMode: LabelMode;
  labelPos: LabelPos;
  labelSize: number;
  labelColor: string;
  labelBg: string;
  labelBgAlpha: number;
  labelFont: 'mono' | 'sans';
  linkShow: boolean;
  linkStyle: LinkStyle;
  linkDensity: number;
  linkColor: string;
  linkWidth: number;
  linkDash: boolean;
  linkRate: number;
  linkFlow: boolean;
  linkFlowSpeed: number;
  scanShow: boolean;
  scanAxis: ScanAxis;
  scanSpeed: number;
  reticleShow: boolean;
  reticleSize: number;
  barsShow: boolean;
  animShow: boolean;
  animDur: number;
}

const num = (v: Record<string, number | string>, k: string, d: number): number => {
  const n = Number(v[k]);
  return Number.isFinite(n) ? n : d;
};
const str = <T extends string>(v: Record<string, number | string>, k: string, d: T): T =>
  typeof v[k] === 'string' ? (v[k] as T) : d;

function parseParams(v: Record<string, number | string>): Params {
  return {
    blobCount: Math.round(num(v, 'blobCount', 6)),
    refresh: Math.max(1, Math.round(num(v, 'refresh', 2))),
    sensitivity: num(v, 'sensitivity', 0.55),
    mode: str<DetectMode>(v, 'detectMode', 'contrast'),
    minSize: num(v, 'minSize', 0.05),
    maxSize: num(v, 'maxSize', 0.75),
    smoothness: num(v, 'smoothness', 0.6),
    jitter: num(v, 'jitter', 0.35),
    hold: Math.round(num(v, 'hold', 6)),
    frameStyle: str<FrameStyle>(v, 'frameStyle', 'brackets'),
    frameWidth: num(v, 'frameWidth', 1.5),
    frameColor: str(v, 'frameColor', '#7fe8ff'),
    frameAlpha: num(v, 'frameAlpha', 0.9),
    cornerLen: num(v, 'cornerLen', 18),
    labelShow: num(v, 'labelShow', 1) !== 0,
    labelCustom: str(v, 'labelCustom', ''),
    labelVocab: str(v, 'labelVocab', 'mil'),
    labelMode: str<LabelMode>(v, 'labelMode', 'full'),
    labelPos: str<LabelPos>(v, 'labelPos', 'outTop'),
    labelSize: num(v, 'labelSize', 14),
    labelColor: str(v, 'labelColor', '#eafcff'),
    labelBg: str(v, 'labelBg', '#07141c'),
    labelBgAlpha: num(v, 'labelBgAlpha', 0.72),
    labelFont: str<'mono' | 'sans'>(v, 'labelFont', 'mono'),
    linkShow: num(v, 'linkShow', 1) !== 0,
    linkStyle: str<LinkStyle>(v, 'linkStyle', 'elbow45'),
    linkDensity: num(v, 'linkDensity', 0.35),
    linkColor: str(v, 'linkColor', '#7fe8ff'),
    linkWidth: num(v, 'linkWidth', 1),
    linkDash: num(v, 'linkDash', 1) !== 0,
    linkRate: Math.max(0.1, num(v, 'linkRate', 1.5)),
    linkFlow: num(v, 'linkFlow', 1) !== 0,
    linkFlowSpeed: Math.max(0.05, num(v, 'linkFlowSpeed', 0.9)),
    scanShow: num(v, 'scanShow', 1) !== 0,
    scanAxis: str<ScanAxis>(v, 'scanAxis', 'v'),
    scanSpeed: Math.max(0.01, num(v, 'scanSpeed', 0.55)),
    reticleShow: num(v, 'reticleShow', 1) !== 0,
    reticleSize: num(v, 'reticleSize', 0.42),
    barsShow: num(v, 'barsShow', 1) !== 0,
    animShow: num(v, 'animShow', 1) !== 0,
    animDur: Math.max(0.01, num(v, 'animDur', 0.22)),
  };
}

/** 主 pass 需要的只读一帧上下文（结构上等价于 `EffectUniformCtx`）。 */
export interface TrackerFrameCtx {
  t: number;
  frame: number;
  fps: number;
  w: number;
  h: number;
  seed: number;
}

/* ------------------------------------------------------------- 每实例 */

interface Entry {
  /** 探针目标。尺寸随画幅比变，变了就 resize。 */
  probe: Target | null;
  probeW: number;
  probeH: number;
  /** readPixels 的落点（RGBA8）。 */
  bytes: Uint8Array;
  sal: Saliency | null;
  /** 上一帧亮度（motion 模式用）。 */
  prevLuma: Float32Array | null;
  state: TrackState;
  /** 抖动后的视图：绘制与 uniform 都用它。 */
  view: TrackBox[];
  canvas: HTMLCanvasElement | null;
  g: CanvasRenderingContext2D | null;
  tex: WebGLTexture | null;
  texW: number;
  texH: number;
  lastUsed: number;
  /** 上一次实际检测时的参数签名（变了就立刻重检，见 prepare）。 */
  detectSig: string;
  /** 诊断：最近一次检测的显著性峰值、斑点数、检测时的帧号。 */
  saliencyMax: number;
  lastBlobs: number;
  lastFrame: number;
  diag: DetectDiag;
}

const FONT_MONO = `'Cascadia Code', Consolas, 'Courier New', monospace`;
const FONT_SANS = `Inter, 'Microsoft YaHei', system-ui, sans-serif`;

/**
 * 词库 id → 文案键。
 *
 * 词条本身住在语言表里（`fx.boxTracker.words*`，逗号分隔一张表）：`src/` 下的
 * 中日韩字面量只有语言文件允许出现（`tests/unit/i18n.test.ts` 的硬编码守卫）。
 * **不能在模块加载时 `tr()`** —— 那会把值冻在导入那一刻的语言上。
 */
const VOCAB_KEYS: Record<string, MessageKey> = {
  mil: 'fx.boxTracker.wordsMil',
  tech: 'fx.boxTracker.wordsTech',
  id: 'fx.boxTracker.wordsId',
  bio: 'fx.boxTracker.wordsBio',
};

function vocabWords(id: string): string[] {
  const key = VOCAB_KEYS[id] ?? VOCAB_KEYS.mil!;
  return tr(key)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgba(hex);
  return `rgba(${r ?? 0},${g ?? 0},${b ?? 0},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

export class BoxTracker {
  private readonly perInstance = new Map<string, Entry>();
  /**
   * 无叠层时绑的 1×1 透明纹理。绝不能让 sampler 停在未绑定状态 —— 那是 GL 的
   * 未定义行为，读回黑或垃圾都会让画面「莫名其妙地脏」。
   */
  private readonly emptyTex: WebGLTexture;
  /** 上传/创建纹理用的 scratch 单元（见文件头的事故说明）。 */
  private readonly scratchUnit: number;
  /** `u_boxA` 的暂存（每次 bind 前重写，`uniform4fv` 会复制一份）。 */
  private readonly boxA = new Float32Array(MAX_BOXES * 4);
  private frameCount = 0;

  constructor(
    private readonly kit: Kit,
    private readonly projectSeed: () => number,
  ) {
    const gl = kit.gl;
    const max = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number;
    this.scratchUnit = Math.max(1, (max || 16) - 1);
    gl.activeTexture(gl.TEXTURE0 + this.scratchUnit);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.emptyTex = tex;
  }

  /* ------------------------------------------------------------- 主入口 */

  /**
   * 主 pass 之前调用：探针渲染 / 回读 / 检测 / 绘叠层 / 上传。
   *
   * **必须在 `prog.use()` 之前**：这里会切换 program、FBO 与激活纹理单元，
   * 插在主 pass 绑定纹理之后调用会把 `u_texture` 顶掉。
   */
  prepare(
    prog: Program,
    inst: EffectInstance,
    srcTex: WebGLTexture,
    values: Record<string, number | string>,
    fc: TrackerFrameCtx,
  ): void {
    // 协议判据只有一条：主 pass 声明了 `u_overlay` 才干活。其余七十多个特效
    // 走的是这条早退路径（与 `SpectrumTextures.bindTo` 对 `u_spectrum` 同构）。
    if (!prog.uniforms['u_overlay']) return;
    const e = this.entryFor(inst.instanceId);
    e.lastUsed = ++this.frameCount;
    const p = parseParams(values);

    /*
     * 什么时候真的跑检测：
     * 1. 到了刷新栅格（`frame % refresh`）—— 用**帧号**而不是调用次数计数，
     *    所以暂停时反复重渲同一帧不会把检测节奏带乱；
     * 2. 状态为空 —— 刷新率 > 1 时 seek 后的第一帧不能是空的；
     * 3. **检测参数变了** —— 否则暂停着拖「目标数上限 / 灵敏度」看不出任何变化，
     *    用户会以为滑杆坏了（这比多跑一次检测的代价重要得多）。
     */
    const detectSig = `${p.blobCount}|${p.refresh}|${p.sensitivity}|${p.mode}|${p.minSize}|${p.maxSize}|${p.smoothness}|${p.hold}`;
    const detect =
      fc.frame % p.refresh === 0 || e.state.boxes.length === 0 || e.detectSig !== detectSig;
    if (detect) {
      e.detectSig = detectSig;
      this.runProbe(e, srcTex, fc);
      const sw = e.probeW;
      const sh = e.probeH;
      if (!e.sal || e.sal.map.length !== sw * sh) e.sal = makeSaliency(sw, sh);
      const s = saliency(e.bytes, sw, sh, p.mode, e.prevLuma, e.sal);
      if (!e.prevLuma || e.prevLuma.length !== sw * sh) e.prevLuma = new Float32Array(sw * sh);
      e.prevLuma.set(s.luma);

      let max = 0;
      for (let i = 0; i < s.map.length; i++) if (s.map[i]! > max) max = s.map[i]!;
      e.saliencyMax = max;
      e.lastFrame = fc.frame;

      const blobs = detectBlobs(
        s.map,
        sw,
        sh,
        {
          mode: p.mode,
          sensitivity: p.sensitivity,
          minSize: p.minSize,
          maxSize: p.maxSize,
          maxBlobs: p.blobCount,
        },
        e.diag,
      );
      e.lastBlobs = blobs.length;
      const labels = this.labelsFor(p);
      e.state = stepTracker(
        e.state,
        blobs,
        {
          maxBoxes: Math.min(MAX_BOXES, Math.max(1, p.blobCount)),
          smoothness: p.smoothness,
          jitter: p.jitter,
          hold: p.hold,
          labelCount: labels.length,
        },
        hashSeed(this.projectSeed(), inst.instanceId, 'track'),
      );
    }

    e.view = jitteredView(
      e.state.boxes,
      p.jitter,
      hashSeed(this.projectSeed(), inst.instanceId, 'jitter'),
      fc.frame,
    );

    this.drawOverlay(e, p, fc);
    this.uploadOverlay(e, fc.w, fc.h);

    // 自愈式清理：实例被删掉时没人会记得调 drop()，所以按「多久没被用到」淘汰。
    if (this.frameCount % 240 === 0) this.prune();
  }

  /**
   * `prog.use()` 与 `u_texture` / `u_original` 绑定之后调用：只绑 `u_overlay`
   * 并写方框 uniform。program 没声明 `u_overlay` 就什么都不做（绝大多数特效
   * 走这条路径，所以这个调用是廉价的）。
   */
  bind(prog: Program, inst: EffectInstance): void {
    const loc = prog.uniforms['u_overlay'];
    if (!loc) return;
    const e = this.perInstance.get(inst.instanceId);
    const gl = this.kit.gl;

    const n = Math.min(MAX_BOXES, e?.view.length ?? 0);
    // 先写数组再绑纹理：`prog.tex()` 会切换激活单元，但 uniform 与单元无关。
    const countLoc = prog.uniforms['u_boxCount'];
    if (countLoc) gl.uniform1i(countLoc, n);
    if (n > 0 && e) {
      for (let i = 0; i < n; i++) {
        const b = e.view[i]!;
        this.boxA[i * 4] = b.cx;
        this.boxA[i * 4 + 1] = b.cy;
        this.boxA[i * 4 + 2] = b.hw;
        this.boxA[i * 4 + 3] = b.hh;
      }
      const aLoc = prog.uniforms['u_boxA'];
      // `Program.u()` 只认 number / 2·3·4 长数组，装不下 48 个 float，
      // 所以数组 uniform 必须直接走 `uniform4fv`（location 已去掉 `[0]` 后缀）。
      if (aLoc) gl.uniform4fv(aLoc, this.boxA);
    }

    prog.tex('u_overlay', e?.tex ?? this.emptyTex);
  }

  /* --------------------------------------------------------- 生命周期 */

  /** seek / 跳帧：清掉追踪状态，下一帧从新画面重新检测。 */
  reset(): void {
    for (const e of this.perInstance.values()) {
      e.state = emptyTrackState();
      e.prevLuma = null;
      e.view = [];
      e.detectSig = '';
      if (e.g && e.canvas) e.g.clearRect(0, 0, e.canvas.width, e.canvas.height);
    }
  }

  /** 实例消失时释放它的纹理与目标。 */
  drop(instanceId: string): void {
    const e = this.perInstance.get(instanceId);
    if (!e) return;
    if (e.tex) this.kit.gl.deleteTexture(e.tex);
    e.probe?.dispose();
    this.perInstance.delete(instanceId);
  }

  /** 关工程 / 卸载：全清。**必须有调用方**（见 `src/core/AGENTS.md` 的生命周期一条）。 */
  clear(): void {
    for (const id of [...this.perInstance.keys()]) this.drop(id);
  }

  /**
   * 诊断读数（E2E / 试炼场 / 手工调试）。
   *
   * 只报「有没有框」是不够的：方框不出现可能是探针没回读到东西、显著性全 0、
   * 斑点被尺寸过滤掉、或者叠层没上传。这几个数把那段黑盒切开一半。
   */
  stats(): {
    instances: number;
    boxes: number;
    probeW: number;
    probeH: number;
    /** 最近一次检测的显著性峰值与检出斑点数。 */
    saliencyMax: number;
    blobs: number;
    frames: number;
    /** 探针像素的平均亮度（0..255）。0 = 回读到的是全黑。 */
    probeMean: number;
    probeBytes: number;
    /** 阈值那几个量：`above`/`raw` 为 0 时就是「阈值把所有东西都挡掉了」。 */
    diag: DetectDiag;
  } {
    let boxes = 0;
    let probeW = 0;
    let probeH = 0;
    let saliencyMax = 0;
    let blobs = 0;
    let frames = 0;
    let probeMean = 0;
    let probeBytes = 0;
    const diag: DetectDiag = { mean: 0, std: 0, thr: 0, above: 0, raw: 0 };
    for (const e of this.perInstance.values()) {
      probeBytes = e.bytes.length;
      if (e.bytes.length > 0) {
        let s = 0;
        for (let i = 0; i < e.bytes.length; i += 4) s += e.bytes[i]!;
        probeMean = s / (e.bytes.length / 4);
      }
      boxes += e.view.length;
      probeW = e.probeW;
      probeH = e.probeH;
      saliencyMax = Math.max(saliencyMax, e.saliencyMax);
      blobs += e.lastBlobs;
      frames = Math.max(frames, e.lastFrame);
      diag.mean = Math.max(diag.mean, e.diag.mean);
      diag.std = Math.max(diag.std, e.diag.std);
      diag.thr = Math.max(diag.thr, e.diag.thr);
      diag.above += e.diag.above;
      diag.raw += e.diag.raw;
    }
    return {
      instances: this.perInstance.size,
      boxes,
      probeW,
      probeH,
      saliencyMax,
      blobs,
      frames,
      probeMean,
      probeBytes,
      diag,
    };
  }

  /* ------------------------------------------------------------- 内部 */

  private entryFor(id: string): Entry {
    let e = this.perInstance.get(id);
    if (!e) {
      e = {
        probe: null,
        probeW: 0,
        probeH: 0,
        bytes: new Uint8Array(0),
        sal: null,
        prevLuma: null,
        state: emptyTrackState(),
        view: [],
        canvas: null,
        g: null,
        tex: null,
        texW: 0,
        texH: 0,
        lastUsed: this.frameCount,
        detectSig: '',
        saliencyMax: 0,
        lastBlobs: 0,
        lastFrame: -1,
        diag: { mean: 0, std: 0, thr: 0, above: 0, raw: 0 },
      };
      this.perInstance.set(id, e);
    }
    return e;
  }

  private prune(): void {
    const cutoff = this.frameCount - 600;
    for (const [id, e] of [...this.perInstance]) {
      if (e.lastUsed < cutoff) this.drop(id);
    }
  }

  private runProbe(e: Entry, srcTex: WebGLTexture, fc: TrackerFrameCtx): void {
    const gl = this.kit.gl;
    const pw = PROBE_WIDTH;
    const ph = Math.max(24, Math.min(240, Math.round((PROBE_WIDTH * fc.h) / Math.max(1, fc.w))));

    if (!e.probe) {
      // 建纹理也要先切 scratch —— `Target` 的构造里会 bindTexture（见文件头）。
      gl.activeTexture(gl.TEXTURE0 + this.scratchUnit);
      e.probe = this.kit.target(pw, ph, { nearest: true });
      e.probeW = pw;
      e.probeH = ph;
    } else if (e.probe.w !== pw || e.probe.h !== ph) {
      gl.activeTexture(gl.TEXTURE0 + this.scratchUnit);
      e.probe.resize(pw, ph);
      e.probeW = pw;
      e.probeH = ph;
    }
    if (e.bytes.length !== pw * ph * 4) e.bytes = new Uint8Array(pw * ph * 4);

    const prog = this.kit.quad(PROBE_FRAG, PROBE_PROGRAM_NAME);
    prog.use();
    prog.tex('u_texture', srcTex);
    prog.u('u_step', [1 / pw, 1 / ph]);
    this.kit.pass(prog, e.probe);

    // `kit.pass` 之后该 target 的 FBO 仍是绑定的，直接读。
    e.probe.bind();
    gl.readPixels(0, 0, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, e.bytes);
  }

  private labelsFor(p: Params): readonly string[] {
    // 自定义优先：逗号 / 分号 / 换行都算分隔符（用户不会去猜我们想要哪一种）。
    const custom = p.labelCustom
      .split(/[\n,，;；]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (custom.length > 0) return custom;
    return vocabWords(p.labelVocab);
  }

  private drawOverlay(e: Entry, p: Params, fc: TrackerFrameCtx): void {
    const w = Math.max(1, Math.round(fc.w));
    const h = Math.max(1, Math.round(fc.h));
    if (!e.canvas) {
      e.canvas = document.createElement('canvas');
      e.g = e.canvas.getContext('2d');
    }
    const c = e.canvas;
    const g = e.g;
    if (!g) return;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);

    // 线宽与字号按画高缩放：同一个参数在预览（540）与导出（1080）上应当长得一样。
    // 下限 0.5 只影响缩略图（360 高）这类小尺寸：再按比例缩下去字就读不出来了。
    const s = Math.max(h / 1080, 0.5);
    if (e.view.length === 0) return;

    const views = this.viewsFor(e, p, fc);
    if (p.linkShow && views.length > 1) this.drawLinks(g, views, p, w, h, s, fc);

    for (const v of views) {
      const r = frameRect(v, w, h);
      // 出场/消失只改这一层的整体不透明度，各绘制函数内部仍用自己的 rgba。
      g.save();
      g.globalAlpha = v.alpha;
      this.drawFrame(g, v, r, p, s);
      if (p.scanShow) this.drawScan(g, v, r, p, s, fc);
      if (p.reticleShow) this.drawReticle(g, r, p, s);
      if (p.barsShow) this.drawBars(g, v, r, p, s, fc, w);
      g.restore();
    }
    if (p.labelShow) {
      const labels = this.labelsFor(p);
      for (const v of views) this.drawLabel(g, v, p, labels, w, h, s);
    }
  }

  /**
   * 把追踪状态折成**绘制态**。
   *
   * 出场/消失是纯绘制动画，**不写回 `TrackState`** —— 否则它会污染关联算法
   * （「正在淡出的框」还算不算同一个目标），而且 seek 后的帧号对不上。
   *
   * `age` / `lost` 的单位是**检测次数**（`stepTracker` 每帧网格调一次），
   * 所以换算秒要乘 `refresh`。刷新率调大时动画会粗一点，但时长仍然对得上。
   */
  private viewsFor(e: Entry, p: Params, fc: TrackerFrameCtx): BoxView[] {
    const fps = Math.max(1, fc.fps);
    const durFrames = Math.max(1, p.animDur * fps);
    return e.view.map((b) => {
      const scanPhase = hashSeed(this.projectSeed(), 'scan', b.id) / 4294967296;
      if (!p.animShow) return { b, alpha: 1, scale: 1, scanPhase };
      const spawn = clampUnit(((b.age - 1) * p.refresh) / durFrames);
      // 缓出：前 40% 的时间里就完成 80% 的淡入 —— 线性淡入看起来「反应慢」。
      const ease = 1 - (1 - spawn) ** 3;
      const gone = p.hold > 0 ? clampUnit((b.lost * p.refresh) / durFrames) : 0;
      return {
        b,
        /*
         * 起点不是 0 而是 0.35：**单帧渲染**（缩略图、首帧）里 `age` 恒为 1，
         * 从 0 开始的话那一帧一个框都看不见 —— 表现是「特效在缩略图里是空的」。
         * 从 0.35 起，单帧也是一眼能认出的半透明框，连续播放时仍然有渐入感。
         */
        alpha: clampUnit((0.35 + 0.65 * ease) * (1 - gone)),
        scale: 1 + (1 - ease) * 0.12 + gone * 0.06,
        scanPhase,
      };
    });
  }

  private drawFrame(
    g: CanvasRenderingContext2D,
    v: BoxView,
    r: Rect,
    p: Params,
    s: number,
  ): void {
    const lw = Math.max(0.6, p.frameWidth * s);
    g.lineWidth = lw;
    g.strokeStyle = rgba(p.frameColor, p.frameAlpha);
    g.lineCap = 'square';
    const x = r.x;
    const y = r.y;

    if (p.frameStyle === 'brackets') {
      strokeBrackets(g, r, lw, bracketLen(r, p, s));
      return;
    }

    if (p.frameStyle === 'texture') {
      /*
       * 纹理描边 = 三条叠出来的「缝线带」：
       *   1. 细实线（外框，压住边界）
       *   2. 粗虚线（像缝线/刻度带，密而短）
       *   3. 角括号（保留取景框的视觉锚点）
       * 比 `dashed` 重、比 `double` 有方向感，是这一档想要的「有材质」。
       */
      g.globalAlpha = v.alpha * 0.45;
      g.strokeRect(x + lw * 0.5, y + lw * 0.5, r.w - lw, r.h - lw);
      g.globalAlpha = v.alpha;
      g.lineWidth = lw * 2.2;
      g.setLineDash([2.2 * s, 4.4 * s]);
      g.strokeRect(x + lw * 0.6, y + lw * 0.6, Math.max(1, r.w - lw * 1.2), Math.max(1, r.h - lw * 1.2));
      g.setLineDash([]);
      g.lineWidth = lw;
      strokeBrackets(g, r, lw, bracketLen(r, p, s) * 1.25);
      return;
    }

    if (p.frameStyle === 'double') {
      const inset = Math.max(2 * s, Math.min(r.w, r.h) * 0.06);
      g.strokeRect(x + lw * 0.5, y + lw * 0.5, r.w - lw, r.h - lw);
      g.globalAlpha = v.alpha * 0.55;
      g.strokeRect(x + inset, y + inset, Math.max(1, r.w - inset * 2), Math.max(1, r.h - inset * 2));
      g.globalAlpha = v.alpha;
      return;
    }

    if (p.frameStyle === 'dashed') {
      g.setLineDash([6 * s, 4 * s]);
      g.strokeRect(x + lw * 0.5, y + lw * 0.5, r.w - lw, r.h - lw);
      g.setLineDash([]);
      return;
    }

    g.strokeRect(x + lw * 0.5, y + lw * 0.5, r.w - lw, r.h - lw);
  }

  /** 框内横向/纵向扫过的一条亮线（前缘亮、后面拖一段淡出）。 */
  private drawScan(
    g: CanvasRenderingContext2D,
    v: BoxView,
    r: Rect,
    p: Params,
    s: number,
    fc: TrackerFrameCtx,
  ): void {
    const inset = Math.max(1, p.frameWidth * s);
    const phase = (((fc.t * p.scanSpeed + v.scanPhase) % 1) + 1) % 1;
    g.save();
    g.beginPath();
    g.rect(r.x + inset, r.y + inset, Math.max(1, r.w - inset * 2), Math.max(1, r.h - inset * 2));
    g.clip();

    if (p.scanAxis === 'v') {
      const x = r.x + phase * r.w;
      const band = Math.max(10 * s, r.w * 0.14);
      const grad = g.createLinearGradient(x - band, 0, x, 0);
      grad.addColorStop(0, rgba(p.frameColor, 0));
      grad.addColorStop(1, rgba(p.frameColor, 0.3));
      g.fillStyle = grad;
      g.fillRect(x - band, r.y, band, r.h);
      g.fillStyle = rgba(p.frameColor, 0.8);
      g.fillRect(x, r.y, Math.max(1, 1.4 * s), r.h);
    } else {
      const y = r.y + phase * r.h;
      const band = Math.max(10 * s, r.h * 0.14);
      const grad = g.createLinearGradient(0, y - band, 0, y);
      grad.addColorStop(0, rgba(p.frameColor, 0));
      grad.addColorStop(1, rgba(p.frameColor, 0.3));
      g.fillStyle = grad;
      g.fillRect(r.x, y - band, r.w, band);
      g.fillStyle = rgba(p.frameColor, 0.8);
      g.fillRect(r.x, y, r.w, Math.max(1, 1.4 * s));
    }
    g.restore();
  }

  /** 准星：中心十字 + 四条边中点的向内刻度。 */
  private drawReticle(g: CanvasRenderingContext2D, r: Rect, p: Params, s: number): void {
    const k = Math.min(r.w, r.h) * clampUnit(p.reticleSize) * 0.5;
    if (k < 2) return;
    const gap = Math.max(2 * s, k * 0.22);
    const tick = Math.min(7 * s, Math.min(r.w, r.h) * 0.14);
    g.strokeStyle = rgba(p.frameColor, p.frameAlpha);
    g.lineWidth = Math.max(0.5, p.frameWidth * 0.7 * s);
    g.beginPath();
    g.moveTo(r.cx - k, r.cy);
    g.lineTo(r.cx - gap, r.cy);
    g.moveTo(r.cx + gap, r.cy);
    g.lineTo(r.cx + k, r.cy);
    g.moveTo(r.cx, r.cy - k);
    g.lineTo(r.cx, r.cy - gap);
    g.moveTo(r.cx, r.cy + gap);
    g.lineTo(r.cx, r.cy + k);
    // 边框中点向内的一小段刻度：没有它，准星会显得是「浮在画面上」而不是嵌在框里。
    g.moveTo(r.cx, r.y);
    g.lineTo(r.cx, r.y + tick);
    g.moveTo(r.cx, r.y + r.h);
    g.lineTo(r.cx, r.y + r.h - tick);
    g.moveTo(r.x, r.cy);
    g.lineTo(r.x + tick, r.cy);
    g.moveTo(r.x + r.w, r.cy);
    g.lineTo(r.x + r.w - tick, r.cy);
    g.stroke();
    g.fillStyle = rgba(p.frameColor, p.frameAlpha);
    g.fillRect(r.cx - 1.2 * s, r.cy - 1.2 * s, 2.4 * s, 2.4 * s);
  }

  /**
   * 侧边数据条：贴着框右缘的一列短横条，长度按 8Hz 的种子噪声跳。
   *
   * 用**时间桶**而不是逐帧随机：逐帧跳变看起来像噪点，8Hz 才像「数据在刷新」。
   */
  private drawBars(
    g: CanvasRenderingContext2D,
    v: BoxView,
    r: Rect,
    p: Params,
    s: number,
    fc: TrackerFrameCtx,
    viewW: number,
  ): void {
    const n = 8;
    const barH = Math.max(1.2, 2.2 * s);
    const gap = Math.max(0.8, 1.6 * s);
    const total = n * barH + (n - 1) * gap;
    const blockH = Math.min(total, r.h * 0.9);
    const x0 = r.x + r.w + 5 * s;
    if (x0 > viewW - 4) return;
    const y0 = r.cy - blockH * 0.5;
    const bucket = Math.floor(fc.t * 8);
    const rng = mulberry32(hashSeed(this.projectSeed(), 'bars', v.b.id, bucket));
    const maxLen = Math.min(r.w * 0.18 + 8 * s, viewW - x0 - 2);
    g.fillStyle = rgba(p.frameColor, 0.7);
    for (let i = 0; i < n; i++) {
      const len = Math.max(1, (0.18 + 0.82 * rng()) * maxLen);
      g.fillRect(x0, y0 + i * (barH + gap), len, barH);
    }
    // 竖脊：把散条串成一根「表」。
    g.fillRect(x0 - 2.5 * s, y0, Math.max(1, 1 * s), blockH);
  }

  private drawLabel(
    g: CanvasRenderingContext2D,
    v: BoxView,
    p: Params,
    labels: readonly string[],
    w: number,
    h: number,
    s: number,
  ): void {
    const b = v.b;
    const size = Math.max(7, p.labelSize * s);
    const font = p.labelFont === 'mono' ? FONT_MONO : FONT_SANS;
    g.font = `${size.toFixed(1)}px ${font}`;
    g.textBaseline = 'top';

    const word = labels.length > 0 ? labels[b.label % labels.length]! : '';
    const conf = `${(b.conf * 100).toFixed(1)}%`;
    const id = `#${String(b.id).padStart(3, '0')}`;
    const text =
      p.labelMode === 'label'
        ? word
        : p.labelMode === 'conf'
          ? conf
          : p.labelMode === 'id'
            ? `${id} ${word} ${conf}`
            : `${word} ${conf}`;
    if (!text) return;

    const padX = 5 * s;
    const padY = 2.5 * s;
    const tw = g.measureText(text).width;
    const th = size;
    const boxW = tw + padX * 2;
    const boxH = th + padY * 2;

    // 标签跟着**动画后**的框走（出场时框在缩放，标签不能钉在旧位置上）。
    const fr = frameRect(v, w, h);
    const bx = fr.x;
    const by = fr.y;
    const bw = fr.w;
    const bh = fr.h;

    let x = bx;
    let y = by - boxH - 3 * s;
    if (p.labelPos === 'inTop') {
      x = bx + 3 * s;
      y = by + 3 * s;
    } else if (p.labelPos === 'inBottom') {
      x = bx + 3 * s;
      y = by + bh - boxH - 3 * s;
    } else if (p.labelPos === 'outLeft') {
      x = bx - boxW - 4 * s;
      y = by + bh * 0.5 - boxH * 0.5;
    } else if (y < 2 * s) {
      // 框贴着画面顶部时，标签翻进框内，而不是被裁掉。
      x = bx + 3 * s;
      y = by + 3 * s;
    }
    // 视口钳制：标签是「信息」，出了画面就等于没写。
    x = Math.max(1, Math.min(w - boxW - 1, x));
    y = Math.max(1, Math.min(h - boxH - 1, y));

    g.save();
    g.globalAlpha = v.alpha;
    g.fillStyle = rgba(p.labelBg, p.labelBgAlpha);
    g.fillRect(x, y, boxW, boxH);
    g.fillStyle = rgba(p.frameColor, p.frameAlpha * 0.85);
    g.fillRect(x, y, Math.max(1, 2 * s), boxH);
    g.fillStyle = rgba(p.labelColor, 1);
    g.fillText(text, x + padX + 2 * s, y + padY);
    g.restore();
  }

  private drawLinks(
    g: CanvasRenderingContext2D,
    views: BoxView[],
    p: Params,
    w: number,
    h: number,
    s: number,
    fc: TrackerFrameCtx,
  ): void {
    // 配对按「时间桶」重抽：逐帧重抽会让线疯狂闪，完全不重抽又不像是
    // 「实时计算出来的关系」。1/rate 秒一换是观感上最像检测器的节奏。
    const bucket = Math.floor(fc.t * p.linkRate);
    const rng = mulberry32(hashSeed(this.projectSeed(), 'links', bucket, views.length));
    const maxPairs = Math.min(12, Math.floor(((views.length * (views.length - 1)) / 2) * p.linkDensity));
    if (maxPairs <= 0) return;

    const used = new Set<string>();
    g.lineWidth = Math.max(0.5, p.linkWidth * s);
    g.strokeStyle = rgba(p.linkColor, 0.55);
    g.fillStyle = rgba(p.linkColor, 0.8);
    if (p.linkDash) g.setLineDash([5 * s, 5 * s]);

    let drawn = 0;
    let guard = 0;
    while (drawn < maxPairs && guard++ < 64) {
      const a = Math.floor(rng() * views.length);
      let bIdx = Math.floor(rng() * views.length);
      if (bIdx === a) bIdx = (bIdx + 1) % views.length;
      if (bIdx === a) break;
      const key = a < bIdx ? `${a}:${bIdx}` : `${bIdx}:${a}`;
      if (used.has(key)) continue;
      used.add(key);
      this.drawLink(g, views[a]!, views[bIdx]!, p, w, h, s, rng, fc);
      drawn++;
    }
    g.setLineDash([]);
  }

  private drawLink(
    g: CanvasRenderingContext2D,
    A: BoxView,
    B: BoxView,
    p: Params,
    w: number,
    h: number,
    s: number,
    rng: () => number,
    fc: TrackerFrameCtx,
  ): void {
    const a = A.b;
    const b = B.b;
    const pa = linkAnchor(a, b.cx * w, b.cy * h, w, h, 4 * s);
    const pb = linkAnchor(b, a.cx * w, a.cy * h, w, h, 4 * s);
    /*
     * 三种样式先统一折成一条**采样折线**：折线要精确的 45° 顶点，曲线按
     * 24 段够用（在 1080p 上单段 < 3px）。流光要沿路径走，没有折线就只能
     * 为「曲线」和「折线」各写一套取点逻辑。
     */
    const pts = linkPath(pa, pb, p.linkStyle, rng);

    g.save();
    // 端点还在淡入/淡出时，连线跟着一起淡（否则「框没了线还在」）。
    g.globalAlpha = Math.min(A.alpha, B.alpha);
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
    g.stroke();

    // 端点小方块：没有它的时候两条线交在一起分不清哪头是哪头。
    const dot = Math.max(1.2, 1.8 * s);
    g.fillRect(pa.x - dot, pa.y - dot, dot * 2, dot * 2);
    g.fillRect(pb.x - dot, pb.y - dot, dot * 2, dot * 2);

    if (p.linkFlow) {
      const total = polylineLength(pts);
      if (total > 1) {
        // 每条线一个自己的相位：所有光点同步走会像整片在闪。
        const phase = (((fc.t * p.linkFlowSpeed + rng()) % 1) + 1) % 1;
        const head = phase * total;
        // 头部柔光 + 尾迹：一颗硬点看起来像噪点，带拖尾才像「数据在流」。
        const hp = pointAtDistance(pts, head);
        const halo = g.createRadialGradient(hp.x, hp.y, 0, hp.x, hp.y, 8 * s);
        halo.addColorStop(0, rgba(p.linkColor, 0.4));
        halo.addColorStop(1, rgba(p.linkColor, 0));
        g.fillStyle = halo;
        g.beginPath();
        g.arc(hp.x, hp.y, 8 * s, 0, Math.PI * 2);
        g.fill();
        for (let k = 3; k >= 0; k--) {
          const d = head - k * Math.max(5 * s, total * 0.015);
          if (d < 0) continue;
          const pt = pointAtDistance(pts, d);
          g.fillStyle = rgba(p.linkColor, k === 0 ? 0.95 : 0.24 - k * 0.05);
          g.beginPath();
          g.arc(pt.x, pt.y, (k === 0 ? 2.4 : 1.3) * s, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    g.restore();
  }

  private uploadOverlay(e: Entry, w: number, h: number): void {
    const gl = this.kit.gl;
    const c = e.canvas;
    if (!c) return;
    gl.activeTexture(gl.TEXTURE0 + this.scratchUnit);
    if (!e.tex || e.texW !== w || e.texH !== h) {
      if (e.tex) gl.deleteTexture(e.tex);
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // canvas 上传必须翻一次 —— 与 `SourceManager.uploadImage` 同一纪律
      // （那条路上有两轮实测的注释，别在这里另写一套）。
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      e.tex = tex;
      e.texW = w;
      e.texH = h;
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }
}

/* ------------------------------------------------------------ 绘制几何 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

interface Pt {
  x: number;
  y: number;
}

const clampUnit = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 方框在**动画之后**的屏幕矩形（缩放绕中心）。 */
function frameRect(v: BoxView, w: number, h: number): Rect {
  const hw = v.b.hw * v.scale;
  const hh = v.b.hh * v.scale;
  return {
    x: (v.b.cx - hw) * w,
    y: (v.b.cy - hh) * h,
    w: hw * 2 * w,
    h: hh * 2 * h,
    cx: v.b.cx * w,
    cy: v.b.cy * h,
  };
}

/** 角括号臂长：按框短边的百分比，但至少 4px（小框上不能消失）。 */
function bracketLen(r: Rect, p: Params, s: number): number {
  return Math.max(4 * s, Math.min(r.w, r.h) * (p.cornerLen / 100));
}

/** 四个角的 L 形取景框（`brackets` 与 `texture` 共用）。 */
function strokeBrackets(g: CanvasRenderingContext2D, r: Rect, lw: number, len: number): void {
  const x = r.x;
  const y = r.y;
  g.beginPath();
  g.moveTo(x + lw * 0.5, y + len);
  g.lineTo(x + lw * 0.5, y + lw * 0.5);
  g.lineTo(x + len, y + lw * 0.5);
  g.moveTo(x + r.w - len, y + lw * 0.5);
  g.lineTo(x + r.w - lw * 0.5, y + lw * 0.5);
  g.lineTo(x + r.w - lw * 0.5, y + len);
  g.moveTo(x + r.w - lw * 0.5, y + r.h - len);
  g.lineTo(x + r.w - lw * 0.5, y + r.h - lw * 0.5);
  g.lineTo(x + r.w - len, y + r.h - lw * 0.5);
  g.moveTo(x + len, y + r.h - lw * 0.5);
  g.lineTo(x + lw * 0.5, y + r.h - lw * 0.5);
  g.lineTo(x + lw * 0.5, y + r.h - len);
  g.stroke();
}

/**
 * 连线折成一条采样折线。三种样式：
 * - `straight`：两点。
 * - `elbow45`：**只允许 0° 与 ±45° 两段**（用户要的「每次转弯都是 45° 整倍数」）。
 * - `curve`：二次贝塞尔采 24 段 —— 流光要沿路径走，必须是折线才好取点。
 */
function linkPath(pa: Pt, pb: Pt, style: LinkStyle, rng: () => number): Pt[] {
  if (style === 'straight') return [pa, pb];

  if (style === 'curve') {
    const mx = (pa.x + pb.x) * 0.5;
    const my = (pa.y + pb.y) * 0.5;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = (rng() - 0.5) * len * 0.28;
    const cx = mx - (dy / len) * bend;
    const cy = my + (dx / len) * bend;
    const out: Pt[] = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const u = 1 - t;
      out.push({ x: u * u * pa.x + 2 * u * t * cx + t * t * pb.x, y: u * u * pa.y + 2 * u * t * cy + t * t * pb.y });
    }
    return out;
  }

  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const m = Math.min(Math.abs(dx), Math.abs(dy));
  if (m < 1) return [pa, pb];
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  return Math.abs(dx) >= Math.abs(dy)
    ? [pa, { x: pb.x - sx * m, y: pa.y }, pb]
    : [pa, { x: pa.x, y: pb.y - sy * m }, pb];
}

function polylineLength(pts: Pt[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return n;
}

/** 折线上距离起点 d 处的点（流光用）。 */
function pointAtDistance(pts: Pt[], d: number): Pt {
  let left = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg <= 1e-6) continue;
    if (left <= seg) {
      const k = left / seg;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    left -= seg;
  }
  return pts[pts.length - 1] ?? { x: 0, y: 0 };
}

/** 从方框中心朝目标点连线，取它与方框边界的交点（再外推 gap）。 */
function linkAnchor(
  b: TrackBox,
  tx: number,
  ty: number,
  w: number,
  h: number,
  gap: number,
): { x: number; y: number } {
  const cx = b.cx * w;
  const cy = b.cy * h;
  const hw = Math.max(1, b.hw * w);
  const hh = Math.max(1, b.hh * h);
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  // 与矩形边界的参数化解：沿 (dx,dy) 走到最近的边。
  const k = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  const ex = cx + dx * k;
  const ey = cy + dy * k;
  const len = Math.hypot(dx, dy) || 1;
  return { x: ex + (dx / len) * gap, y: ey + (dy / len) * gap };
}

/* mulberry32 的薄封装：这里只用来抽连线配对，不需要从 core 再导一次类型。 */
function mulberryOf(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
