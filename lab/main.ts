/**
 * lab/main.ts — 试炼场的引导。
 *
 * 顺序照抄 `src/main.ts`：主题 → 全局样式 → mount。
 * 样式载入顺序有硬要求：`controls.css` 必须在 `app.css` **之后**，
 * 否则同特异度的 `button:hover` 会盖掉自研控件的 `.ic-btn:hover`
 * （主应用那条注释记过这个坑）。
 *
 * 这个页面**不引导主应用**（不 import main.ts / app-state / App.svelte）：
 * 试炼场是独立入口，它和主应用只共享 `render-core` 的装配与同一个
 * i18n/控件/token 体系。`window.__artmatic` 在这里不存在 —— E2E 有一条
 * 断言钉这一点。
 */

import { mount } from 'svelte';
import LabApp from './LabApp.svelte';
import '../src/app.css';
import '../src/ui/controls/controls.css';
import './lab.css';
import { installTheme } from '../src/ui/theme-apply';
import { theme } from '../src/ui/theme.svelte';
import { labState, LAB_SCALES, NO_EFFECT_ID } from './lab-state.svelte';
import { AlgoThumbRenderer, thumbSize } from '../src/render/algo-thumb-renderer';
import { EffectThumbRenderer } from '../src/render/effect-thumb-renderer';
import { TransitionThumbRenderer } from '../src/render/transition-thumb-renderer';
import { previewRecipe } from '../src/algos/catalog';
import { getGenerator, listGenerators } from '../src/algos/registry';
import { listTransitions } from '../src/effects/transitions/registry';
import { transitionCompileFailures } from '../src/effects/transitions/runner';
import { defaultValues } from '../src/effects/types';

installTheme(theme.spec);

mount(LabApp, { target: document.getElementById('lab')! });

/** 缩略图渲染器：模块级单例，整个页面生命周期复用一个 WebGL 上下文。 */
const algoThumbRenderer = new AlgoThumbRenderer();
/** 转场缩略图渲染器：另一台离屏上下文（两张底图 + 一条转场）。 */
const transitionThumbRenderer = new TransitionThumbRenderer();
/** 特效缩略图渲染器：与选择器 / 批量导出共用同一台（`EffectThumbRenderer`）。 */
const effectThumbRenderer = new EffectThumbRenderer();

/**
 * E2E 钩子。约定与 `window.__artmatic` 一致：暴露**纯数据**与少量动作，
 * 像素留在 page 内 reduce，只回传标量（几 MB 的数组过界会把 E2E 撑爆）。
 */
(window as unknown as { __lab: unknown }).__lab = {
  list: () => labState.listIds(),
  current: () => ({
    sourceId: labState.sourceId,
    effectId: labState.effectId,
    bypass: labState.bypass,
    scale: labState.scale,
    t: labState.t,
    // 实际渲染帧率读数。播放时它应当等于 LAB_FPS（渲染节流），
    // 而不是显示器刷新率 —— 反馈类特效按渲染帧累积状态，这条是它的前提。
    fps: labState.fps,
  }),
  selectSource: (id: string) => labState.selectSource(id),
  selectEffect: (id: string | null) => labState.selectEffect(id ?? NO_EFFECT_ID),
  setParam: (scope: 'source' | 'effect', key: string, v: number | string) =>
    labState.setParam(scope, key, v),
  setT: (t: number) => labState.setT(t),
  setScale: (s: number) => {
    if ((LAB_SCALES as readonly number[]).includes(s)) {
      labState.setScale(s as (typeof LAB_SCALES)[number]);
    }
  },
  setBypass: (on: boolean) => labState.setBypass(on),
  setAudioFeatures: (on: boolean) => labState.setAudioFeatures(on),
  setSearch: (q: string) => {
    labState.search = q;
  },
  play: (on: boolean) => {
    if (labState.playing !== on) labState.togglePlay();
  },
  /** 按 t 渲一帧（默认先清反馈历史 → 同 t 可复现）。 */
  renderAt: (t: number, clearFeedback = true) => labState.renderAt(t, clearFeedback),
  onSeek: () => labState.renderAt(labState.t, true),
  readPixels: () => labState.readPixels(),
  renderSize: () => labState.renderSize(),
  trackerStats: () => labState.trackerStats(),
  compileAll: () => labState.runCompile(),
  compileState: () => labState.compileResults,

  /**
   * **批量导出生成器缩略图**的调用口（`scripts/gen-algo-thumbs.mjs` 用）。
   *
   * 为什么在这里而不是主应用：缩略图的渲染要与试炼场**同一套装配**
   * （`render-core`），而主应用的 `__artmatic` 钩子不该为了一个构建期脚本
   * 把离屏渲染器拖进主 bundle。
   *
   * 只回传一个 **WebP data URL**（base64）而不是像素数组：640×360 的 WebP 约
   * 15KB，而原始 RGBA 是 900KB —— 与 `__lab` 其余部分同一条纪律（大像素数据
   * 不出 page）。data URL 由 Node 侧解成字节直接落盘，中间没有下载/解压步骤。
   *
   * `lit === 0` 表示这一帧还没长出来（bake 未就绪、或采样时刻太早），
   * **调用方要重试** —— 异步就绪从宿主侧轮询，见 `algo-thumb-renderer.ts` 头注。
   */
  /**
   * 待导出的清单：每个注册生成器的 **id + 采样时刻**。
   *
   * 采样时刻由 `algos/catalog.ts` 的配方给（sim / bake 在第 0 秒是空屏，
   * 不能一刀切），所以这个清单必须从代码里取 —— 脚本侧硬编码一份就会与
   * 配方漂掉，而漂掉的形态是「某个生成器导出一张黑图」。
   */
  thumbJobs: () =>
    listGenerators().map((g) => ({ id: g.id, t: previewRecipe(g.id)?.t ?? 0 })),

  renderThumb: (id: string, height: number, t: number) => {
    const recipe = previewRecipe(id);
    if (!recipe) return null;
    const def = getGenerator(id);
    if (!def) return null;
    const size = thumbSize(height);
    // 默认值 + 配方覆盖：与运行期 `evalParams` 的 `?? defaultValue` 同一口径。
    return algoThumbRenderer.renderOnce(id, { ...defaultValues(def.params), ...recipe.params }, size, t);
  },

  /**
   * **批量导出转场缩略图**的调用口（`scripts/gen-transition-thumbs.mjs` 用）。
   *
   * 与 `renderThumb` 同一套纪律（大像素不出 page，只回传一张 WebP data URL），
   * 差别是这里**不需要重试**：转场是同步渲染，没有 bake 那种异步就绪。
   *
   * `progress` 是实际采样进度：正常是 0.5，这一条的中点退化成纯色时会挪一点
   * （理由见 `render/transition-thumb-renderer.ts` 的 `PROGRESS_CANDIDATES`）。
   * 脚本据此在日志里标出来，免得「为什么这条不是 50%」变成一个查不出来的谜。
   *
   * `failed: true` 表示这条转场的着色器编译失败、跑的是内置 dissolve 兜底 ——
   * 那样的缩略图**不能代表这条转场**，脚本据此报错退出（与 `compileAllTransitions`
   * 在 E2E 里守的是同一件事）。
   */
  transitionThumbJobs: () => listTransitions().map((e) => e.id),

  renderTransitionThumb: (id: string, height: number) => {
    const shot = transitionThumbRenderer.renderShot(id, thumbSize(height));
    if (!shot) return null;
    return {
      dataUrl: shot.canvas.toDataURL('image/webp', 0.84),
      // 采样进度：0.5 是主选；这一条的中点退化成纯色时会是候选里的另一个值。
      progress: shot.progress,
      failed: transitionCompileFailures().has(id),
    };
  },

  /**
   * **单张特效缩略图**（`scripts/gen-effect-thumb.mjs` 用）。
   *
   * 与选择器、以及 lab 的批量导出**同一个渲染器**（`EffectThumbRenderer`），
   * 所以拿到的就是缩略图卡片里会显示的那张图；不会另写一套近似实现。
   * 只回传 WebP data URL（大像素不出 page，与 `__lab` 其余部分同一条纪律）。
   */
  effectThumb: (id: string, height: number) => {
    const canvas = effectThumbRenderer.renderCanvas(id, thumbSize(height));
    if (!canvas) return null;
    return canvas.toDataURL('image/webp', 0.84);
  },
};
