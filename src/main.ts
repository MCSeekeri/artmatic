import { mount } from 'svelte';
import App from './ui/App.svelte';
import './app.css';
// 控件族样式必须在 app.css 的兜底样式**之后**载入，否则同特异度的
// `button:hover` 会盖掉 `.ic-btn:hover`（纯图标按钮要保持透明底）。
import './ui/controls/controls.css';
import { ProjectStore } from './core/project-store';
import { createDemoProject, DEMO_ASSET_ID } from './core/demo-project';
import { renderDemoAudio } from './audio/demo-audio';
import { computeWaveform } from './audio/decode';
import { appState } from './ui/app-state.svelte';
import { theme } from './ui/theme.svelte';
import { installTheme } from './ui/theme-apply';
import { runExport } from './exporters/export-runner';
import { PngSequenceSink } from './exporters/png-sequence';
import { unzipSync } from 'fflate';
import { defaultParams, listGenerators } from './algos/registry';

/* 装配顺序：主题 → store → mount。
   主题必须最先注入：它是内联 style，写在 :root 上，任何时候注入都生效，
   但放在 mount 前可以避免第一帧用默认值闪一下。 */
installTheme(theme.spec);

/* store 先于 mount（组件挂载即读工程），渲染服务在
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
  theme,
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
  algo: { listGenerators, defaultParams },
  /**
   * E2E 专用：直接调排版光栅化，**不经过 compositor / GPU**。
   *
   * 这样测的是「光栅化本身确定不确定」，而不是「整条 GPU 链路确定不确定」——
   * 后者是 AGENTS §7 记录在案的 flaky 区（echo/glitch 的边界采样竞态，
   * 60–75% 失败率，与代码版本无关）。P7 验证「子集字体 vs 全量字体逐像素
   * 零差异」也走这个入口。
   */
  typoRasterize: async (doc: unknown, w: number, h: number, localSec: number) => {
    const canvas = await appState.textRaster.rasterizeOnce(
      doc as Parameters<typeof appState.textRaster.rasterizeOnce>[0],
      w,
      h,
      localSec,
    );
    const ctx = canvas.getContext('2d')!;
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // 只回传标量：像素留在 page 内。
    let sum = 0;
    let ink = 0;
    let h32 = 0x811c9dc5;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3]!;
      if (a > 8) ink += 1;
      sum += px[i]! + px[i + 1]! + px[i + 2]!;
      h32 = (Math.imul(h32 ^ px[i]!, 0x01000193) ^ a) >>> 0;
    }
    return { w: canvas.width, h: canvas.height, ink, sum, hash: h32.toString(16).padStart(8, '0') };
  },
  typoStats: () => appState.textRaster.stats(),
  /**
   * E2E 专用：从字节注册一个字体（本机系统字体不进仓库，测试从 Node 侧读盘传进来）。
   */
  typoRegisterFont: async (name: string, bytes: Uint8Array | number[]) => {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const face = await appState.fonts.registerFile(name, u8.buffer as ArrayBuffer);
    appState.refreshFontFamilies();
    return face.id;
  },
  typoFontStats: () => ({
    ...appState.fonts.subsetStats,
    faces: appState.fonts.faceReports(),
  }),
  /** ADR-003 规则 ① 的对照组开关：关掉子集化后光栅化必须**逐像素相同**。 */
  typoSetSubsetting: (on: boolean) => {
    appState.fonts.subsetting = on;
    appState.fonts.invalidatePrepared();
  },
};

export default app;
