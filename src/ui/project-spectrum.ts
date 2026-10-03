/**
 * project-spectrum.ts — 主应用的频谱来源：**工程音频 → 频谱**。
 *
 * 与 `lab/spectrum.ts` 的合成频谱是同一个接口的两种实现，由 `render-core` 注入
 * （所以 `render-core` 本身依然不 import `audio/`）。
 *
 * 两条自愈逻辑（都不指望调用方记得调）：
 * - **换工程 → 重置**：比对 `getProject()` 返回的对象身份。归一化器是有状态的
 *   滚动窗，跨工程留着旧的地板/天花板会让新工程头几秒的高度全是错的。
 * - **拖动播放头 → 重置**：交给 `SpectrumFrames` 按时间跳变判定（见那里的注释）。
 */

import { computeSpectrum, SPECTRUM_BINS, type SpectrumTrack } from '../audio/spectrum';
import { SpectrumFrames } from '../audio/spectrum-frames';
import type { AudioClip, Project } from '../core/schema';

/** 找出覆盖工程时间 `t` 的音频片段（同一时刻有多条时取最靠后开始的那条）。 */
function audioClipAt(project: Project, t: number): AudioClip | null {
  let best: AudioClip | null = null;
  for (const track of project.tracks) {
    if (track.kind !== 'audio') continue;
    for (const clip of track.clips) {
      if (clip.kind !== 'audio') continue;
      if (t < clip.start || t >= clip.end) continue;
      if (!best || clip.start > best.start) best = clip;
    }
  }
  return best;
}

export class ProjectSpectrum {
  private readonly frames = new SpectrumFrames(SPECTRUM_BINS, (t, out) => this.rawAt(t, out));
  /** 算好的频谱轨（按素材 id）。**不缓存失败** —— 解码是异步的，早先的 null 会变。 */
  private readonly tracks = new Map<string, SpectrumTrack>();
  private readonly pending = new Set<string>();
  private lastProject: Project | null = null;

  constructor(
    private readonly getProject: () => Project,
    private readonly bufferFor: (assetId: string) => AudioBuffer | null,
  ) {}

  frameFor(
    instanceId: string,
    t: number,
    dt: number,
    smoothing: number,
  ): Uint8Array | null {
    const project = this.getProject();
    if (project !== this.lastProject) {
      this.lastProject = project;
      this.frames.reset();
    }
    return this.frames.frameFor(instanceId, t, dt, smoothing);
  }

  /** 实例消失时忘掉它的包络。 */
  drop(instanceId: string): void {
    this.frames.drop(instanceId);
  }

  /** 显式重置（导出开始、素材重算之后）。 */
  reset(): void {
    this.frames.reset();
  }

  private rawAt(t: number, out: Uint8Array): void {
    const clip = audioClipAt(this.getProject(), t);
    if (!clip) {
      out.fill(0);
      return;
    }
    const track = this.trackFor(clip.assetId);
    if (!track) {
      // 还没算好（首次请求会触发计算）—— 这一帧当静音。
      out.fill(0);
      return;
    }
    // 工程时间 → 素材时间：片段的 srcIn 是它在素材里的入点。
    track.at(clip.srcIn + (t - clip.start), out);
  }

  private trackFor(assetId: string): SpectrumTrack | null {
    const ready = this.tracks.get(assetId);
    if (ready) return ready;
    if (this.pending.has(assetId)) return null;
    const buffer = this.bufferFor(assetId);
    // 素材还没解码完 —— **不要把这个结论缓存下来**，解码完成后再问就有了。
    if (!buffer) return null;
    this.pending.add(assetId);
    void computeSpectrum(buffer).then((track) => {
      this.tracks.set(assetId, track);
      this.pending.delete(assetId);
      // 频谱换了，归一化器要重新播种（旧的地板属于另一段素材）。
      this.frames.reset();
    });
    return null;
  }
}
