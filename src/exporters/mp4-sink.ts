/**
 * mp4-sink.ts — MP4 视频导出（WebCodecs 编码 + mediabunny 封装）。
 *
 * ADR-001 的 `webcodecs` 后端。**本机 Chrome 实测可用**（2026-10-02）：
 * `avc1.4d0028`（H.264 Main L4）在 1920×1080@60 下 `isConfigSupported` 为 true
 * 且实编出真实码流；`mp4a.40.2`（AAC-LC）同样能实编。
 *
 * > ⚠️ **探测串必须是 L4，不能用 `avc1.42001f`。**
 * > baseline 3.1 的 coded area 上限是 921600（= 1280×720），1080p 直接被拒，
 * > 报错原文 `the maximum coded area (921600) supported by the AVC level (3.1)`。
 * > 看到这一条不要误判成「H.264 不支持」——那是本项目自己踩过的坑，
 * > 连带把 ADR-001 的探测串写错了（已在该 ADR 加补注）。
 *
 * 硬约束 1.1：导出走 `runExport` 的紧循环，`submit` 每帧 await =
 * 编码器背压。mediabunny 的 `CanvasSource.add()` 内部已按 VideoEncoder 的
 * `encodeQueueSize` 做流控，这里不自己判队列长度。
 *
 * 音视频同步：视频帧时间戳是 `i / fps`，音频长度是 `project.duration`，
 * 两者共用同一个 `fps`，不存在两套换算。
 */

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny';
import type { FrameSink, FrameSinkConfigureOptions } from './frame-sink';
import type { MixedAudio } from './mixdown';
import type { SaveStream } from '../platform/types';
import { EXPORT_SAMPLE_RATE, toAudioBuffer } from './mixdown';
import { tr } from '../i18n/index.svelte';

/**
 * 传给 mediabunny 的编码名。
 *
 * **不是 WebCodecs 的 codec 串。** mediabunny 要的是 `'avc'` / `'aac'` 这类
 * 家族名，level 串（`avc1.4d0028` 里的 `.4d0028`）由它自己按分辨率与帧率算。
 * 传 `avc1.4d0028` 会被 TS 拒绝 —— 这正好挡住了「照抄探测串」这个错误。
 *
 * 那条探测串仍然有意义：它是**探测**用的（本机 Chrome 认不认 H.264），
 * 不是**配置**用的。两者混用是本项目自己踩过的一个坑，见文件头。
 */
export const MP4_CODEC = 'avc1.4d0028';
/** FrameSink.configure 的 codec 参数值 —— 用来做运行期校验。 */
export const MP4_SINK_CODEC = 'avc1.4d0028';
const ENCODER_VIDEO_CODEC = 'avc';
const ENCODER_AUDIO_CODEC = 'aac';

export interface Mp4SinkOptions {
  /**
   * 离线混流好的音频。为 null 时不带音轨（而不是塞一条静音轨）。
   *
   * **为什么音频在这里「已经混好」而不是现算**：混流要读 AudioBuffer，
   * 而 `FrameSink` 接口只收画布。混流放在 UI 层（`ui/export.ts`），
   * 那段纯逻辑可单测，sink 只做编码与封装。
   */
  audio?: MixedAudio | null;
  /** 码率（bps）。不传则按分辨率分档。 */
  bitrate?: number;
  /** 音频码率。默认 192 kbps，AAC-LC 的甜点。 */
  audioBitrate?: number;
  /**
   * 流式落盘出口；null/缺省 = 整份 MP4 驻留内存（`BufferTarget`）再交给调用方。
   *
   * 走流式时用 mediabunny 的 `StreamTarget`（官方点名兼容 FSA 的
   * `FileSystemWritableFileStream`）：它把 moov 放在内存里，其余边产边写，
   * 所以 `fastStart: 'in-memory'` 的语义不变而**内存占用与时长无关**。
   * 触发条件见 `ui/export.ts` 的 `pickOutput` —— 按 `limits.exportMemoryMB` 判。
   */
  stream?: SaveStream | null;
}

/** 码率默认表。按像素数分档：低分辨率下别浪费码率，高分辨率下别被压糊。 */
function defaultBitrate(w: number, h: number): number {
  const px = w * h;
  if (px <= 1280 * 720) return 8_000_000;
  if (px <= 1920 * 1080) return 16_000_000;
  return 32_000_000;
}

export class Mp4Sink implements FrameSink {
  private output: Output | null = null;
  private video: CanvasSource | null = null;
  private audioSource: AudioBufferSource | null = null;
  private target: BufferTarget | null = null;
  private fps = 30;
  private audio: MixedAudio | null;
  private bitrate: number | undefined;
  private audioBitrate: number | undefined;
  private started = false;
  private readonly stream: SaveStream | null;
  /** 流式模式下已写出的字节数（`byteLength()` 的读数；`BufferTarget` 那条读 buffer）。 */
  private written = 0;

  constructor(opts: Mp4SinkOptions = {}) {
    this.audio = opts.audio ?? null;
    this.bitrate = opts.bitrate;
    this.audioBitrate = opts.audioBitrate;
    this.stream = opts.stream ?? null;
  }

  async configure(
    size: { w: number; h: number },
    fps: number,
    codec: string,
    opts?: FrameSinkConfigureOptions,
  ): Promise<void> {
    if (codec !== MP4_CODEC) {
      throw new Error(tr('err.export.sinkCodec', { want: MP4_CODEC, got: codec }));
    }
    if (!opts?.canvas) {
      // 不能静默建一个占位 canvas：CanvasSource 在构造时读尺寸并缓存
      // VideoFrame 工厂，尺寸错了症状是画面被 letterbox 或裁切，控制台无提示。
      throw new Error(tr('err.export.sinkNoCanvas'));
    }
    this.fps = fps;
    if (this.stream) {
      // 边编边写：`StreamTarget` 负责顺序与回填（moov 仍在内存里，语义同 fastStart）。
      const target = new StreamTarget(this.stream.writable as unknown as ConstructorParameters<typeof StreamTarget>[0]);
      target.on('write', ({ end }) => {
        if (end > this.written) this.written = end;
      });
      this.output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target,
      });
    } else {
      this.target = new BufferTarget();
      this.output = new Output({
        format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
        target: this.target,
      });
    }

    const canvas = opts.canvas;
    // 交叉校验：传进来的 canvas 尺寸必须与声明的 size 一致。
    // 不一致说明调用方忘了先 setExportSize —— 直接报，不产出一个错尺寸的文件。
    if (canvas.width !== size.w || canvas.height !== size.h) {
      throw new Error(
        tr('err.export.canvasSizeMismatch', {
          cw: canvas.width,
          ch: canvas.height,
          dw: size.w,
          dh: size.h,
        }),
      );
    }

    this.video = new CanvasSource(canvas, {
      codec: ENCODER_VIDEO_CODEC,
      bitrate: this.bitrate ?? defaultBitrate(size.w, size.h),
    });
    this.output.addVideoTrack(this.video, { frameRate: fps });

    // 音频轨必须在 output.start() 之前**建好**（mediabunny 硬约束），
    // 但 PCM 必须在 start() 之后**灌入**（`add()` 会断言已 started）。
    // 所以这里只建源 + 加轨，灌 PCM 挪到 `startIfNeeded()`。
    if (this.audio) {
      this.audioSource = new AudioBufferSource({
        codec: ENCODER_AUDIO_CODEC,
        bitrate: this.audioBitrate ?? 192_000,
      });
      this.output.addAudioTrack(this.audioSource);
    }
  }

  /**
   * mediabunny 的生命周期顺序：**加轨 → start() → add(样本) → finalize()**。
   *
   * `Output.start()` 只能在所有 track 都 addVideoTrack/addAudioTrack 之后调，
   * 而源的 `add()` 又要求已 started。所以 start 必须在「track 建完」与
   * 「第一帧灌入」之间 —— 也就是 `submit` 的第一次调用。
   *
   * 为什么不干脆把 start 放进 finalize：那样所有 `add()` 都会撞上
   * `Output has not started`（踩过）。为什么不在 configure 里 start：
   * 那时视频轨的源已建但还没有样本，start 本身允许，只是音频 PCM
   * 灌不进去 —— 真正的原因是 start 属于「产物生命周期」，
   * 放在第一次 submit 前语义更清楚。
   */
  private async startIfNeeded(): Promise<void> {
    if (this.started || !this.output) return;
    await this.output.start();
    this.started = true;
    if (this.audio && this.audioSource) {
      // OfflineAudioContext 只需一个「能建 buffer」的壳，不做渲染；
      // 真实 AudioContext 在用户未手势时是 suspended，反而会出问题。
      const ctx = new OfflineAudioContext(1, 1, EXPORT_SAMPLE_RATE);
      const buf = toAudioBuffer(this.audio, ctx);
      // startTimestamp 固定 0：混流已把 clip.start 折进 PCM 位置里了，
      // 这里再偏移会造成音轨整体平移。
      await this.audioSource.add(buf);
    }
  }

  async submit(frameIndex: number, _source: HTMLCanvasElement): Promise<void> {
    if (!this.video) throw new Error(tr('err.export.notConfigured'));
    await this.startIfNeeded();
    // 时间戳只在这里算一次：i / fps，duration 固定 1/fps。
    await this.video.add(frameIndex / this.fps, 1 / this.fps);
  }

  async finalize(): Promise<Blob | string> {
    if (!this.output) throw new Error(tr('err.export.notConfigured'));
    // 零帧的工程（duration 极短）不会走到 submit，start 得在这里补上。
    await this.startIfNeeded();
    await this.output.finalize();
    if (this.stream) {
      await this.stream.close();
      // 流式路没有 Blob 可交：返回文件名（`FrameSink.finalize` 的 `string` 分支）。
      return this.stream.name;
    }
    const buffer = this.target?.buffer;
    if (!buffer) throw new Error(tr('err.export.noBuffer'));
    return new Blob([buffer], { type: 'video/mp4' });
  }

  /**
   * 取消时释放编码器。
   *
   * **不留着会泄漏**：VideoEncoder 内部持有硬件编码会话，GC 之前不会归还。
   * 连续取消几次导出就能在任务管理器里看到 GPU 占用不降。
   * 判 `started` 是因为 `cancel()` 在 start 之前调会抛。
   */
  async cancel(): Promise<void> {
    // 流式路还要把目标丢掉：不 abort 的话 FSA 的 siloed 写入会一直占着临时文件
    // （而 abort 之后**目标文件保持原样**，这正是取消该有的语义）。
    await this.stream?.abort().catch(() => {});
    if (!this.output || !this.started) return;
    try {
      await this.output.cancel();
    } catch {
      /* 已经结束（finalize 跑过）*/
    }
  }

  /** 产物字节数。UI 用来提示「这次导出占多大」（流式路按已写出的范围计）。 */
  byteLength(): number {
    return this.stream ? this.written : (this.target?.buffer?.byteLength ?? 0);
  }
}
