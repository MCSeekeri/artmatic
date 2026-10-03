/**
 * render-core.ts — 合成根（composition root）：把「源解析 + 算法运行时 + 特效执行器」
 * 装到一台 Renderer 上。
 *
 * 为什么单独一层：本模块 import `engine` + `algos` + `effects`，而
 * `algos/`、`effects/` 本就位于 `engine/` **之上**（见 effects/runner.ts、
 * algos/runtime.ts 的 import）。若把它塞进 `engine/`，就会形成
 * `engine → algos/effects → engine` 的层次倒挂。
 *
 *   core ← engine ← {effects, algos} ← render ← {ui, lab}
 *
 * 被两个宿主共用：
 *   - 主应用 `ui/app-state.svelte.ts::attachPreview`
 *   - 试炼场 `lab/lab-state.svelte.ts`
 * 所以这里的装配必须是**唯一真源**——两边各写一份的 bug 形态是
 * 「lab 里好好的，主应用里某类源不工作」，而且不会有任何报错。
 *
 * 刻意**不** import `typography/` `audio/` `exporters/`：
 * 那些是主应用专属，拉进来会把整棵排版/音频子树拖进 lab 的 bundle 图。
 * 主应用在自己的 attachPreview 里对返回的 renderer/sources 继续装它们。
 */

import { Renderer } from '../engine/renderer';
import { SourceManager } from '../engine/sources';
import { createVideoSourceManager, type VideoSourceManager } from '../engine/video-source';
import { BakeClient } from '../algos/bake-client';
import { AlgoRuntime } from '../algos/runtime';
import { createEffectRunner } from '../effects/runner';
import { createTransitionRunner } from '../effects/transitions/runner';
import type { Kit } from '../engine/kit';
import type { Project } from '../core/schema';

/**
 * 装配只需要工程里的这几项：拍网格（曲线上下文）、种子（确定性随机）、
 * 帧率（`u_delta` = 1/fps）。
 */
export type RenderCoreProject = Pick<Project, 'beatGrid' | 'seed' | 'fps'>;

export interface RenderCoreOpts {
  /**
   * **点访问**，不是传值。两个理由：
   *   - 主应用：`store.project` 会随切换工程而变，装配时取一次就冻住了；
   *   - lab：project 每帧重新合成，根本没有一个稳定的对象可以提前给。
   */
  getProject: () => RenderCoreProject;
  /**
   * 异步就绪回调（algo 烘焙 / 视频取帧）。主应用 → `store.touch()`；
   * lab → 请求重绘一帧。
   */
  onAlgoReady: () => void;
}

export interface RenderCore {
  renderer: Renderer;
  sources: SourceManager;
  /** 视频取帧器。导出前要逐帧 `prepare()`，关闭工程时 `dispose()`。 */
  video: VideoSourceManager;
  kit: Kit;
}

export function createRenderCore(
  canvas: HTMLCanvasElement,
  opts: RenderCoreOpts,
): RenderCore {
  // resolve / runEffect 先给空实现：Renderer 的构造要求它们在场，
  // 真正的实现在下面几行装配完才有（renderFrame 之前必须装完）。
  const renderer = new Renderer(canvas, () => null, () => {});
  const sources = new SourceManager(renderer.kit);
  const bake = new BakeClient(renderer.kit, opts.onAlgoReady);
  const algos = new AlgoRuntime(renderer.kit, bake);

  sources.setAlgoResolver((clip, t, frame) => {
    const p = opts.getProject();
    // 渲染尺寸是 renderer 的状态（预览 ≈960、导出 1920），不是片段的属性。
    return algos.resolve(clip, t, frame, p.beatGrid, p.seed, p.fps, renderer.kit.w, renderer.kit.h);
  });

  /*
   * 视频：上传宽度取当前渲染宽度（预览 ≈960 时内存小一个量级，导出 1920
   * 时自动拿到全分辨率）。`kit.w` 是**取帧那一刻**的尺寸，不是装配时的。
   */
  const video = createVideoSourceManager(
    renderer.kit,
    (src, w, h) => sources.uploadImage(src, w, h),
    { onFrameReady: opts.onAlgoReady },
  );
  sources.setVideoResolver((clip, t) => video.frameFor(clip, t, renderer.kit.w));

  renderer.setResolver(sources.resolve);
  renderer.setEffectRunner(createEffectRunner(renderer.kit, () => opts.getProject().seed));
  renderer.setTransitionRunner(createTransitionRunner(renderer.kit));

  return { renderer, sources, video, kit: renderer.kit };
}
