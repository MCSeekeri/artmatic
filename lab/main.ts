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
import { previewRecipe } from '../src/algos/catalog';
import { getGenerator, listGenerators } from '../src/algos/registry';
import { defaultValues } from '../src/effects/types';

installTheme(theme.spec);

mount(LabApp, { target: document.getElementById('lab')! });

/** 缩略图渲染器：模块级单例，整个页面生命周期复用一个 WebGL 上下文。 */
const algoThumbRenderer = new AlgoThumbRenderer();

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
};
