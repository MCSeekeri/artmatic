/**
 * player.ts — 预览播放：音频时钟 → 工程时间 t。
 *
 * 播放对齐用 AudioContext.currentTime 映射帧号——但只发生在预览
 * Transport 层；渲染函数永远只收 t（硬约束 1.1 的边界在这里守住）。
 * 导出是无声的（MVP 只做画面导出，声音对齐留给 M5 的 ffmpeg 混流）。
 */

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

  has(assetId: string): boolean {
    return this.buffers.has(assetId);
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
        src.connect(ctx.destination);
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
