/**
 * player.ts — 预览播放：音频时钟 → 工程时间 t。
 *
 * 播放对齐用 AudioContext.currentTime 映射帧号 —— 但只发生在预览
 * Transport 层；渲染函数永远只收 t（硬约束 1.1 的边界在这里守住）。
 *
 * **响度与导出同源**：每个片段挂一个 `GainNode`，曲线由
 * `core/audio-envelope.ts::sampleAudioEnvelope` 采样（gain 曲线 × fadeSec ×
 * `fadeIn` / `fadeOut`）。导出走 `exporters/mixdown.ts` 的逐样本求值，两条路
 * 对「这一秒响多少」用的是同一个表达式 —— 各写一份的形态是「预览听着对、
 * 导出多了一段渐入」，没人会去逐帧比对。
 */

import { sampleAudioEnvelope } from '../core/audio-envelope';
import type { Project } from '../core/schema';
import { isAudioClip } from '../core/project-store';

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private sources: AudioBufferSourceNode[] = [];
  private startCtxTime = 0;
  private startT = 0;
  private playing = false;

  register(assetId: string, buffer: AudioBuffer): void {
    this.buffers.set(assetId, buffer);
  }

  /**
   * 放掉一个素材的解码结果（关工程时调）。
   *
   * AudioBuffer 是**摊开在内存里的 PCM**：一段 5 分钟的立体声 48 kHz 就是
   * ~110 MB，它不会自己消失（`buffers` 是按 assetId 记的进程级表）。
   * 正在播的那条**不用管** —— 关闭工程前调用方已经 `stop()` 过了。
   */
  forget(assetId: string): void {
    this.buffers.delete(assetId);
  }

  has(assetId: string): boolean {
    return this.buffers.has(assetId);
  }

  /**
   * 取已解码的音频，供**导出离线混流**用（`exporters/mixdown.ts`）。
   *
   * 返回的是原始 buffer 的引用 —— 混流只读不写，所以共享是安全的。
   * 没有这一条的话，导出侧只能从素材字节重新 `decodeAudio` 一遍，
   * 而 demo 音频的字节是程序生成的（`putGenerated`，仓里没有字节），
   * 根本无从解码 —— 那条路对 demo 是断的。
   */
  buffer(assetId: string): AudioBuffer | null {
    return this.buffers.get(assetId) ?? null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** 从 fromT 秒开始播放工程里所有启用的音频片段。 */
  async play(project: Project, fromT: number): Promise<void> {
    this.stop();
    if (!this.ctx) this.ctx = new AudioContext();
    const ctx = this.ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    const startAt = ctx.currentTime + 0.03;

    for (const track of project.tracks) {
      if (!track.enabled || track.kind !== 'audio') continue;
      for (const clip of track.clips) {
        if (!isAudioClip(clip)) continue;
        const buffer = this.buffers.get(clip.assetId);
        if (!buffer) continue;
        if (fromT >= clip.end) continue;
        const when = Math.max(0, clip.start - fromT);
        const intoClip = Math.max(0, fromT - clip.start);
        const remain = clip.end - Math.max(fromT, clip.start);
        if (remain <= 0) continue;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        /*
         * 增益包络：采样「从片段内 intoClip 秒到结尾」这一段。
         *
         * 用 `setValueCurveAtTime` 而不是一串 `linearRampToValueAtTime`：
         * 淡变时长是用户随手拖出来的小数，逐段排 ramp 要自己算拐点，而曲线上
         * 的拐点只有 `core/audio-envelope.ts` 知道。128 点是采样下限的折中
         * （WebAudio 内部本来就按采样点线性插值）。
         */
        const gain = ctx.createGain();
        const curve = sampleAudioEnvelope(clip, project.beatGrid, intoClip, intoClip + remain);
        gain.gain.setValueCurveAtTime(curve, startAt + when, remain);
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start(startAt + when, clip.srcIn + intoClip, remain);
        this.sources.push(src);
      }
    }
    this.startCtxTime = startAt;
    this.startT = fromT;
    this.playing = true;
  }

  /** 当前工程时间（播放中）；未播放返回 null。 */
  currentT(): number | null {
    if (!this.playing || !this.ctx) return null;
    return this.startT + Math.max(0, this.ctx.currentTime - this.startCtxTime);
  }

  stop(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch { /* 已停止 */ }
    }
    this.sources = [];
    this.playing = false;
  }
}
