/**
 * project-audio.ts — 主应用的**工程音频离线分析来源**：频谱 + 特征。
 *
 * 与 `lab/spectrum.ts` / `lab/features.ts` 的合成来源是同一个接口的两种实现，
 * 由 `render-core` 注入（所以 `render-core` 本身依然不 import `audio/`）。
 *
 * 频谱与特征**共用一趟 FFT 走查**（`computeSpectrum` 的 `onFrame` 钩子把
 * `audio/features.ts` 的累加器挂上去）—— 详见那两个文件的注释。
 *
 * 两条自愈逻辑（都不指望调用方记得调）：
 * - **换工程 → 重置**：比对 `getProject()` 返回的对象身份。归一化器是有状态的
 *   滚动窗，跨工程留着旧的地板/天花板会让新工程头几秒的高度全是错的。
 * - **拖动播放头 → 重置**：交给 `SpectrumFrames` 按时间跳变判定。
 */

import { computeSpectrum, planSpectrum, SPECTRUM_BINS, type SpectrumTrack } from '../audio/spectrum';
import { createFeatureAccumulator, type FeatureTrack } from '../audio/features';
import { SpectrumFrames } from '../audio/spectrum-frames';
import { zeroFeatures, type AudioFeatures, type AudioFeatureSource } from '../algos/feature-source';
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

interface Analysis {
  spectrum: SpectrumTrack;
  features: FeatureTrack;
}

/**
 * 实现 `SpectrumSource` 与 `AudioFeatureSource` 两个接口。
 *
 * 两者都由**同一次** `computeSpectrum` 产出，所以合成一个类 —— 拆成两个类的话
 * 要么各算一遍（两倍的 FFT），要么为了共享而互相持有，两条都不如现在清楚。
 */
export class ProjectAudio implements AudioFeatureSource {
  private readonly frames = new SpectrumFrames(SPECTRUM_BINS, (t, out) => this.rawAt(t, out));
  /** 算好的分析结果（按素材 id）。**不缓存失败** —— 解码是异步的，早先的 null 会变。 */
  private readonly analyses = new Map<string, Analysis>();
  private readonly pending = new Set<string>();
  private lastProject: Project | null = null;

  constructor(
    private readonly getProject: () => Project,
    private readonly bufferFor: (assetId: string) => AudioBuffer | null,
  ) {}

  /* ------------------------------------------------------------ SpectrumSource */

  frameFor(instanceId: string, t: number, dt: number, smoothing: number): Uint8Array | null {
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

  /**
   * 素材消失（关工程 / 删素材）时忘掉它的频谱分析。
   *
   * 这一条是**内存**而不是显存：分析结果是按 1025 bins × 50 字节/秒存的，
   * 一首 5 分钟的歌 ≈ 60 MB，而且 `analyses` 是按 assetId 记的、与「现在用不用
   * 它」无关 —— 不显式丢就会跟着页面一直长。
   */
  forget(assetId: string): void {
    this.analyses.delete(assetId);
    this.pending.delete(assetId);
  }

  /** 显式重置（导出开始、素材重算之后）。 */
  reset(): void {
    this.frames.reset();
  }

  /* --------------------------------------------------------- AudioFeatureSource */

  /** 工程时间 `t` 处的特征。没有音频片段 / 还没算好时给静音特征。 */
  at(t: number, out: AudioFeatures): void {
    const clip = audioClipAt(this.getProject(), t);
    const track = clip ? this.analysisFor(clip.assetId)?.features : undefined;
    if (!clip || !track) {
      zeroFeatures(out);
      return;
    }
    // 工程时间 → 素材时间：片段的 srcIn 是它在素材里的入点。
    track.at(clip.srcIn + (t - clip.start), out);
  }

  /* ------------------------------------------------------------------- internals */

  private rawAt(t: number, out: Uint8Array): void {
    const clip = audioClipAt(this.getProject(), t);
    if (!clip) {
      out.fill(0);
      return;
    }
    const track = this.analysisFor(clip.assetId)?.spectrum;
    if (!track) {
      // 还没算好（首次请求会触发计算）—— 这一帧当静音。
      out.fill(0);
      return;
    }
    track.at(clip.srcIn + (t - clip.start), out);
  }

  private analysisFor(assetId: string): Analysis | null {
    const ready = this.analyses.get(assetId);
    if (ready) return ready;
    if (this.pending.has(assetId)) return null;
    const buffer = this.bufferFor(assetId);
    // 素材还没解码完 —— **不要把这个结论缓存下来**，解码完成后再问就有了。
    if (!buffer) return null;
    this.pending.add(assetId);
    // 帧数 / hop 与 `computeSpectrum` 同源（`planSpectrum`）—— 抄一套算术迟早会漂，
    // 而漂的表现是「特征曲线尾部静默变成 0」。
    const plan = planSpectrum(buffer.sampleRate, buffer.length);
    const acc = createFeatureAccumulator({
      bins: plan.bins,
      hopSec: plan.hopSec,
      sampleRate: plan.sampleRate,
      frames: plan.frames,
    });
    void computeSpectrum(buffer, undefined, (mag, rms) => acc.push(mag, rms)).then((spectrum) => {
      this.analyses.set(assetId, { spectrum, features: acc.finish() });
      this.pending.delete(assetId);
      // 频谱换了，归一化器要重新播种（旧的地板属于另一段素材）。
      this.frames.reset();
    });
    return null;
  }
}
