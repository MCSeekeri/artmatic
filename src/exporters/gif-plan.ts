/**
 * gif-plan.ts — GIF 导出的**纯计算**：输出尺寸、区间、抽帧步长、逐帧延迟、体积口径。
 *
 * 为什么单独成文件而不是塞进 `ui/export.ts`：那一边 import 了 `appState`
 * （Svelte runes + WebGL 装配），vitest 拖不动；而这里全是纯函数，可以直接测。
 * 与 `exporters/mixdown.ts`（纯混流，不碰 AudioContext 的装配）是同一个分工。
 *
 * 没有 DOM、没有 WebGL、没有 appState —— 只吃数字、吐数字。
 *
 * > **秒 → 帧号的换算只在这里发生一次。** `runExport` 收的是帧号
 * > （`GifPlan.frameRange`），面板上显示的帧数与真正渲的帧数因此不可能各算一套。
 */

/** GIF 的显示时长单位是**厘秒**（1/100 秒）。这是下面所有取整的根。 */
const CENTISECONDS_PER_SECOND = 100;

/** 局部色表：GIF 的色表长度必须是 2 的幂，256 色 = 768 字节。 */
const COLOR_TABLE_BYTES = 768;

/** 每帧的块开销：图形控制扩展 8 字节 + 图像描述符 10 字节 + 子块/编码余量。 */
const FRAME_OVERHEAD_BYTES = 24;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface GifPlanInput {
  /** 工程分辨率。 */
  srcSize: { w: number; h: number };
  /** 工程帧率。 */
  srcFps: number;
  /** 工程总时长（秒）。口径与 `runExport` 的 `duration × fps` 一致。 */
  duration: number;
  /**
   * 只导出工程时间轴上的这一段（秒，左闭右开）。省略 = 整段。
   *
   * **不必自己 clamp**：这里的值直接来自输入框，用户可能填负数或超出时长。
   * `planGif` 会把它夹进 `[0, duration]`，并保证区间内至少有一帧。
   */
  range?: { start: number; end: number };
  /** 目标宽度（像素）。高度按工程宽高比换算。 */
  width: number;
  /** 目标帧率。GIF 只该取能整除 100 的值（见 `gifFrameDelays`）。 */
  fps: number;
}

export interface GifPlan {
  /** 输出尺寸。渲染分辨率就是它 —— 不做事后重采样。 */
  size: { w: number; h: number };
  /** 渲染步进：只渲 `t = timeOf(from), timeOf(from + step), …`。 */
  frameStep: number;
  /** 实际写进 GIF 的帧数。 */
  frameCount: number;
  /**
   * 区间对应的**源帧号**，左闭右开。`runExport` 直接吃它。
   *
   * 已经 clamp 过：`from ∈ [0, total-1]`、`to ∈ [from+1, total]`。
   */
  frameRange: { from: number; to: number };
  /** 逐帧延迟（**毫秒**），长度 = `frameCount`。 */
  delaysMs: number[];
  /**
   * 体积口径：**索引数据的未压缩大小** + 色表 + 块开销。
   *
   * 刻意不叫「预计体积」。LZW 对索引数据的压缩率完全取决于画面内容
   * （大块平色能压到百分之几，满屏噪点几乎压不动），给一个"预计值"就是在编数字。
   * 而"未压缩大小"是确定的、可以手算复核的 —— 与导出面板里 PNG 那条
   * 「未压缩约 …」是同一个口径，也是同一套理由。
   */
  rawBytes: number;
}

/**
 * 逐帧延迟（毫秒），用**累计取整求差**算出，误差不累积。
 *
 * 为什么不能每帧都写 `round(1000 / fps)`：GIF 只能存整数厘秒，而 `100 / n` 的
 * 帧率里只有 n 能整除 100 时才是整数。以工程 60fps、抽帧步长 2（即 25fps）为例，
 * 每帧真值 3.333cs，逐帧取整会**每一帧都往下掉 0.333cs**，300 帧下来漂掉整整
 * 1 秒 —— 而 GIF 最常见的用途恰恰是「跟着音乐走」，这种漂移在静态截图上完全
 * 看不出来。
 *
 * 改成「第 k 帧显示到 `round(100·(startFrame + k·step)/srcFps)` 厘秒」再取相邻
 * 差，每帧的取整误差正负互补，累计时长精确到 1 厘秒。
 *
 * `startFrame` 也要过同一遍取整：区间不从 0 开始时，首帧的结束时刻必须落在与
 * 整段导出**同一个**厘秒网格上，否则同一段素材裁两半分别导出再拼起来会差几厘秒。
 *
 * 返回的是**毫秒**（gifenc 的 `delay` 收毫秒，内部再除 10 存厘秒）。
 */
export function gifFrameDelays(
  startFrame: number,
  count: number,
  step: number,
  srcFps: number,
): number[] {
  const out: number[] = [];
  let prevCs = Math.round((CENTISECONDS_PER_SECOND * startFrame) / srcFps);
  for (let k = 1; k <= count; k++) {
    const endCs = Math.round((CENTISECONDS_PER_SECOND * (startFrame + k * step)) / srcFps);
    out.push((endCs - prevCs) * 10);
    prevCs = endCs;
  }
  return out;
}

/**
 * 工程帧率 → 抽帧步长。**至少 1**：GIF 帧率高于工程帧率时不许把帧插出来。
 *
 * 取整用的是 `round` 而不是 `ceil`：目标是「尽量贴近用户选的帧率」。60fps 工程
 * 选 25fps，`ceil` 会跨 3 帧（实际 20fps），`round` 跨 2 帧（实际 30fps，更近）。
 * 真正写给 GIF 的时长由 `gifFrameDelays` 按**实际步长**算，所以不管落点偏到哪，
 * 播放总时长都与所选区间对齐 —— 偏差只在「帧的疏密」，不在「整段快慢」。
 */
export function gifFrameStep(srcFps: number, fps: number): number {
  if (!(fps > 0)) return 1;
  return Math.max(1, Math.round(srcFps / fps));
}

export function planGif(input: GifPlanInput): GifPlan {
  const { srcSize, srcFps, duration, width, fps } = input;

  // 下限 2：1px 的 GIF 各浏览器表现不一，而且宽度 0 会让 LZW 直接空转。
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round((w * srcSize.h) / Math.max(1, srcSize.w)));

  // 与 runExport 的 totalFrames 同口径，否则进度条与帧数会各说各话。
  const total = Math.max(1, Math.ceil(duration * srcFps));
  const startFrame = clamp(Math.round((input.range?.start ?? 0) * srcFps), 0, total - 1);
  const endFrame = clamp(
    Math.round((input.range?.end ?? duration) * srcFps),
    startFrame + 1,
    total,
  );

  const frameStep = gifFrameStep(srcFps, fps);
  const frameCount = Math.max(1, Math.ceil((endFrame - startFrame) / frameStep));

  return {
    size: { w, h },
    frameStep,
    frameCount,
    frameRange: { from: startFrame, to: endFrame },
    delaysMs: gifFrameDelays(startFrame, frameCount, frameStep, srcFps),
    rawBytes: frameCount * (w * h + COLOR_TABLE_BYTES + FRAME_OVERHEAD_BYTES),
  };
}
