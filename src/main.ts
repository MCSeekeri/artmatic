import { mount } from 'svelte';
import App from './ui/App.svelte';
import './app.css';
import { ProjectStore } from './core/project-store';
import { createDemoProject, DEMO_ASSET_ID } from './core/demo-project';
import { renderDemoAudio } from './audio/demo-audio';
import { computeWaveform } from './audio/decode';
import { appState } from './ui/app-state.svelte';
import { runExport } from './exporters/export-runner';
import { PngSequenceSink } from './exporters/png-sequence';
import { unzipSync } from 'fflate';

/* 装配顺序：store 先于 mount（组件挂载即读工程），渲染服务在
   Preview.onMount → appState.attachPreview 里随 canvas 惰性创建。 */
const store = new ProjectStore(createDemoProject());
appState.init(store);

const app = mount(App, { target: document.getElementById('app')! });

// 演示音频：程序生成（无外部文件依赖），解码/波形都在后台完成。
const demoBuffer = await renderDemoAudio();
appState.player.register(DEMO_ASSET_ID, demoBuffer);
appState.waveforms = {
  ...appState.waveforms,
  [DEMO_ASSET_ID]: await computeWaveform(demoBuffer),
};
appState.renderer.renderFrame(store.project, appState.playT);

// 调试 / E2E 钩子。
(window as unknown as Record<string, unknown>).__artmatic = {
  renderer: appState.renderer,
  store,
  appState,
  renderFrame: (t: number) => appState.renderer.renderFrame(store.project, t),
  readPixels: () => {
    const { data, w, h } = appState.renderer.readPixels();
    return { data: Array.from(data), w, h };
  },
  /** E2E 专用：跑一遍真实导出管线并把 zip 解开——大像素数据不出 page。 */
  exportFrames: async () => {
    const blob = (await runExport(appState.renderer, store.project, {
      sink: new PngSequenceSink(),
    })) as Blob;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const files = unzipSync(buf);
    return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Array.from(v)]));
  },
};

export default app;
