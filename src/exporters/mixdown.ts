/**
 * mixdown.ts — 离线音频混流：把工程里所有启用的音频片段混成一条整段 PCM。
 *
 * 为什么必须有这一步（而不是把 AudioBuffer 直接塞给编码器）：
 * `AudioClip` 有 `start` / `end` / `srcIn` / `fadeSec` / `gain` 曲线，
 * 一次导出要求的是**一条从 0 开始、长度 = 工程时长的连续波形**。
 * 编码器只认连续 PCM，多片段的定位、裁剪、淡入淡出、增益包络全得先算完。
 *
 * 这里是预览播放（`AudioPlayer`，实时 WebAudio）与导出（离线 PCM）的
 * **唯一共用语义处**：两条路径对「片段在哪、响多少」的理解必须一致，
 * 否则导出声音对不上预览。playback 只做了 `srcIn + intoClip` 定位与
 * `when` 延迟，没做 gain 与 fade —— 那两个是本文件补上的。
 *
 * 纯函数、无 Web Audio 依赖（除了要读的 AudioBuffer），所以可单测。
 * 混流本身是 O(duration × sampleRate) 的循环，16s 立体声 48kHz 约 150 万次，
 * 毫秒级，不需要进 Worker。
 */

import type { Project } from '../core/schema';
import { evalCurve } from '../core/curve';
import { isAudioClip } from '../core/project-store';

/** 导出音频的统一采样率。48 kHz 是影视与 AAC 的通用值，浏览器也都支持。 */
export const EXPORT_SAMPLE_RATE = 48000;
/** 统一声道数。立体声是默认期望；单声道素材会被复制到双声道。 */
export const EXPORT_CHANNELS = 2;

/** 混流结果。取样数据与 `Web Audio` 的 `AudioBuffer.getChannelData` 同构。 */
export interface MixedAudio {
  sampleRate: number;
  channels: Float32Array[];
  /** 实际时长（秒）。工程被拖长而音频没跟上时，这里短于工程时长。 */
  duration: number;
  /** 峰值绝对值。用于 UI 提示与「是不是导出静音」的断言。 */
  peak: number;
}

/**
 * 单个片段在 `[0, duration)` 区间里的**线性淡入淡出包络**。
 *
 * `fadeSec` 存在 `ClipBase` 上但 player 一直没实现它（见文件头注释）。
 * 这里补上：导出的声音至少要有头尾淡入淡出，否则循环点会咔哒响。
 * fadeSec <= 0 视为不淡。
 */
function envelopeAt(posSec: number, clipDur: number, fadeSec: number): number {
  if (fadeSec <= 0) return 1;
  // 两个淡区不得相交——否则中间有一段被压到 fade/fade。
  const f = Math.min(fadeSec, clipDur / 2);
  if (posSec < f) return f > 0 ? posSec / f : 1;
  const fromEnd = clipDur - posSec;
  if (fromEnd < f) return f > 0 ? fromEnd / f : 1;
  return 1;
}

/** 读片段的 gain。缺曲线时约定为 1（不改变音量）而不是 0。 */
function gainAt(project: Project, assetClip: { curves: Record<string, import('../core/curve').Curve> }, tAbs: number): number {
  const curve = assetClip.curves.gain;
  if (!curve) return 1;
  return evalCurve(curve, tAbs, { grid: project.beatGrid, clipStart: 0 });
}

/**
 * 把工程混成一条整段波形。`resolve` 按 assetId 给出原始 AudioBuffer。
 *
 * 没有音频片段 / 全部 `track.enabled === false` 时返回 null（导出就不带音轨，
 * 而不是带一条全零的音轨——那会让播放器显示「有声音」但听不见）。
 */
export function mixdown(
  project: Project,
  resolve: (assetId: string) => AudioBuffer | null,
): MixedAudio | null {
  const clips = [];
  for (const track of project.tracks) {
    if (!track.enabled || track.kind !== 'audio') continue;
    for (const clip of track.clips) {
      if (isAudioClip(clip)) clips.push(clip);
    }
  }
  if (!clips.length) return null;

  const sampleRate = EXPORT_SAMPLE_RATE;
  const total = Math.max(1, Math.ceil(project.duration * sampleRate));
  const out: Float32Array[] = [];
  for (let c = 0; c < EXPORT_CHANNELS; c++) out.push(new Float32Array(total));

  let peak = 0;
  for (const clip of clips) {
    const buf = resolve(clip.assetId);
    if (!buf) continue; // 素材缺失：跳过，不中断整条混流
    const clipDur = clip.end - clip.start;
    if (clipDur <= 0) continue;

    // 片段在工程时间轴上的起点换算成样本下标。
    const startSample = Math.round(clip.start * sampleRate);
    const len = Math.round(clipDur * sampleRate);

    for (let i = 0; i < len; i++) {
      const dst = startSample + i;
      if (dst < 0 || dst >= total) continue; // 超出工程时长的部分不写
      // 源样本下标：`srcIn` 是片段内偏移，speed 恒为 1（schema 暂无 speed 字段）。
      const srcPos = clip.srcIn * sampleRate + i;
      const srcIdx = Math.floor(srcPos);
      if (srcIdx < 0 || srcIdx >= buf.length) continue;

      const tAbs = clip.start + i / sampleRate;
      const g = gainAt(project, clip, tAbs) * envelopeAt(i / sampleRate, clipDur, clip.fadeSec);

      for (let c = 0; c < EXPORT_CHANNELS; c++) {
        // 单声道素材复制到双声道，否则 srcIdx 可能越界。
        const src = buf.numberOfChannels > 1 ? buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)) : buf.getChannelData(0);
        const v = (src[srcIdx] ?? 0) * g;
        out[c]![dst] += v;
        const a = Math.abs(v);
        if (a > peak) peak = a;
      }
    }
  }
  return { sampleRate, channels: out, duration: project.duration, peak };
}

/**
 * 混流结果 → `AudioBuffer`，交给 `mediabunny` 的 `AudioBufferSource`。
 *
 * 不手工切 `AudioData` 分块：mediabunny 的 `add(AudioBuffer)` 自己管分块与
 * 背压（内部逐块 encode 并 await）。手工造 `AudioData` 只会多一层
 * interleaved/planar 的转换与一个「切多大块」的伪参数。
 *
 * `new AudioBuffer(...)` 在旧 Safari 上不存在，用标准 constructor 兜底。
 */
export function toAudioBuffer(mixed: MixedAudio, ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(
    EXPORT_CHANNELS,
    Math.max(1, mixed.channels[0]!.length),
    mixed.sampleRate,
  );
  for (let c = 0; c < EXPORT_CHANNELS; c++) {
    // 重建一次以抹掉 TS 5.7+ 的 `Float32Array<ArrayBufferLike>` 泛型差异
    // （`copyToChannel` 只收 `Float32Array<ArrayBuffer>`）。与 project-io 那次
    // 遇到的 SharedArrayBuffer assignable 问题同族。
    buf.copyToChannel(new Float32Array(mixed.channels[c]!), c);
  }
  return buf;
}
