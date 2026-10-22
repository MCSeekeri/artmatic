/**
 * preclip-preview.ts — 预剪辑弹窗里的视频预览（v13）。
 *
 * **刻意不接 `createRenderCore`**：这里只需要「某一秒的一帧」，接进渲染核心会把
 * 整棵 effects / algos 子树拖进这个弹窗（lab 的 bundle 也会跟着涨）。mediabunny
 * 的 `VideoSampleSink` 就是为这种稀疏访问准备的。
 *
 * 播放只服务于「听着 / 看着打点」，所以用顺序迭代器（`samples(from, to)`）而不是
 * 每帧 `getSample`：后者每帧重建一次解码管线，4 秒素材就能卡成幻灯片。
 *
 * 生命周期必须显式 `dispose()`：`Input` 持有解码器，不释放会一直占着硬件解码槽。
 */

import { ALL_FORMATS, Input, VideoSampleSink, type Source, type VideoSample } from 'mediabunny';
import type { VideoMedia } from '../../engine/media-assets';
import { videoSourceOf } from '../../engine/video-source';

type Ctx2D = CanvasRenderingContext2D;

export class PreClipPreview {
  private input: Input<Source> | null = null;
  private sink: VideoSampleSink | null = null;
  private token = 0;
  /**
   * 稀疏取帧的「最新一次请求」令牌。
   *
   * 拖动 in/out 时每个 pointermove 都会改 cursor → 触发一次 `drawAt`；快速拖动
   * 会有多帧同时等在 `getSample` 上。只保留最新一次，旧的解出来直接丢掉 ——
   * 否则晚到的旧帧会盖掉新帧（画面回跳），而且白白占着解码队列。
   */
  private drawToken = 0;

  width = 0;
  height = 0;

  get ready(): boolean {
    return this.sink !== null;
  }

  /** 打开素材并读显示尺寸。失败返回 false（调用方显示一行「解不出画面」）。 */
  async open(media: VideoMedia): Promise<boolean> {
    try {
      const input = new Input({ formats: ALL_FORMATS, source: videoSourceOf(media) });
      this.input = input;
      if (!(await input.canRead())) return false;
      const track = await input.getPrimaryVideoTrack();
      if (!track) return false;
      this.width = await track.getDisplayWidth();
      this.height = await track.getDisplayHeight();
      this.sink = new VideoSampleSink(track);
      return true;
    } catch (e) {
      console.warn('[preclip] open failed:', e instanceof Error ? e.message : e);
      return false;
    }
  }

  /** 画某一秒（稀疏取帧）。同一帧的重复请求由 sink 自己的缓存吸收。 */
  async drawAt(sec: number, canvas: HTMLCanvasElement): Promise<void> {
    const sink = this.sink;
    if (!sink) return;
    const mine = ++this.drawToken;
    let sample: VideoSample | null = null;
    try {
      sample = await sink.getSample(Math.max(0, sec));
      if (!sample || mine !== this.drawToken) return;
      this.drawSample(sample, canvas);
    } catch {
      // 稀疏取帧在关键帧边界上偶尔失败：保留上一帧即可，不弹错。
    } finally {
      sample?.close();
    }
  }

  /**
   * 从 `fromSec` 顺序播放到 `toSec`。
   *
   * `onTick` 给的是**源内秒**（不是工程秒），调用方自己换算帧号与界面位置。
   * 再次调用会取消上一次播放；`stop()` 同样。
   */
  play(
    fromSec: number,
    toSec: number,
    canvas: HTMLCanvasElement,
    onTick: (sec: number) => void,
    onEnd: () => void,
  ): void {
    const sink = this.sink;
    if (!sink || toSec <= fromSec) {
      onEnd();
      return;
    }
    const mine = ++this.token;
    // 进行中的稀疏取帧不能盖到播放画面上。
    this.drawToken += 1;
    void (async () => {
      /*
       * ⚠️ 必须按**墙钟**配速，不能「解出一帧就画一帧」。
       *
       * `samples()` 是顺序解码器，吞吐远高于实时：60fps 素材在台式机上能
       * 以 4–8 倍速吐帧，表现就是「快进」。这里的时间只用于**等待** ——
       * 画面内容仍然完全由 `sample.timestamp`（源内时间）决定，所以不影响
       * 任何确定性渲染路径（那一条的铁律见根 AGENTS §1.1）。
       */
      /*
       * 基准取**第一帧真正到手**的时刻，而不是发起播放的时刻：首帧要等解码器
       * 起来，按发起时刻算的话那几百毫秒会被当成「已经过去」，开头一小段
       * 会追帧（看起来又是一次突然加速）。
       */
      let startedAt = -1;
      let baseSec = fromSec;
      try {
        for await (const sample of sink.samples(Math.max(0, fromSec), toSec)) {
          if (mine !== this.token) {
            sample.close();
            return;
          }
          if (startedAt < 0) {
            startedAt = performance.now();
            baseSec = sample.timestamp;
          }
          const deadline = startedAt + Math.max(0, sample.timestamp - baseSec) * 1000;
          await this.paceUntil(deadline, mine);
          if (mine !== this.token) {
            sample.close();
            return;
          }
          this.drawSample(sample, canvas);
          onTick(sample.timestamp);
          sample.close();
        }
      } catch {
        // 播放中途 seek / 关闭都会走到这里：按正常结束处理。
      }
      if (mine === this.token) onEnd();
    })();
  }

  /**
   * 等到墙钟时刻 `deadline`。
   *
   * 分片等待（≤20ms）是为了让 `stop()` 能在一帧内退出；一次 `setTimeout` 到
   * 很远的未来会让关闭弹窗后解码循环还挂在那里。
   */
  private async paceUntil(deadline: number, mine: number): Promise<void> {
    while (this.token === mine) {
      const left = deadline - performance.now();
      if (left <= 0) return;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(20, left)));
    }
  }

  stop(): void {
    this.token += 1;
    this.drawToken += 1;
  }

  dispose(): void {
    this.stop();
    this.sink = null;
    this.input?.dispose();
    this.input = null;
  }

  private drawSample(sample: VideoSample, canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d') as Ctx2D | null;
    if (!ctx) return;
    if (canvas.width !== this.width || canvas.height !== this.height) {
      canvas.width = this.width;
      canvas.height = this.height;
    }
    sample.draw(ctx, 0, 0, canvas.width, canvas.height);
  }
}
