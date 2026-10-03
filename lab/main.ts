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

installTheme(theme.spec);

mount(LabApp, { target: document.getElementById('lab')! });

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
};
