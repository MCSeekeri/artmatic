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
import { Mp4Sink, MP4_CODEC } from './exporters/mp4-sink';
import { mixdown } from './exporters/mixdown';
import { unzipSync } from 'fflate';
import { opfsRoot, readBytesIfExists, resolveDir, writeBytesAtomic } from './project/fs';
import { splitRelPath } from './project/layout';
import {
  attachProjectDirectory,
  openProjectDirectory,
  refreshRecentProjects,
  registerDemoAssets,
  saveProjectNow,
} from './ui/project-actions';
import { defaultParams, listGenerators } from './algos/registry';

/* 装配顺序：主题 → store → mount。
   主题必须最先注入：它是内联 style，写在 :root 上，任何时候注入都生效，
   但放在 mount 前可以避免第一帧用默认值闪一下。 */
installTheme(theme.spec);

/* 首份工程先于 mount（组件挂载即读 appState.store.project），
   渲染服务在 Preview.onMount → appState.attachPreview 里随 canvas 惰性创建。 */
appState.init(new ProjectStore(createDemoProject()));

const app = mount(App, { target: document.getElementById('app')! });

// 最近工程列表：只填充 UI，**不自动打开**任何东西。
// 恢复一个工程需要 requestPermission()，而它必须有用户手势 ——
// 页面加载时做不到，所以只能等用户点。
refreshRecentProjects();

// 演示音频：程序生成（无外部文件依赖），解码/波形都在后台完成。
const demoBuffer = await renderDemoAudio();
appState.player.register(DEMO_ASSET_ID, demoBuffer);
// 登记成 generated：它是几行代码算出来的，存进 assets/ 反而是让工程目录
// 带着一份可以随时重建的字节。（`newProject(true)` 走的是同一个函数。）
registerDemoAssets();
appState.waveforms = {
  ...appState.waveforms,
  [DEMO_ASSET_ID]: await computeWaveform(demoBuffer),
};
appState.renderer.renderFrame(appState.store.project, appState.playT);

// 调试 / E2E 钩子。
/**
 * 工程持久化的 E2E 入口。
 *
 * **OPFS 不是 mock。** `navigator.storage.getDirectory()` 返回的就是一个
 * `FileSystemDirectoryHandle`，与用户从选择器拿到的同类 —— 所以从这里进去的
 * 保存/打开链路与生产**完全同一条**，差别只在「根从哪来」。
 *
 * 之所以必须这么绕：`showDirectoryPicker()` 是系统对话框，Playwright 驱动不了。
 * 硬约束 1.5 说「任何只能在 Electron 里跑起来才能测的功能设计，都应当视为
 * 设计错误」—— 这里更进一步，不装 Electron 也能把持久化端到端跑通。
 */
const projectDebug = {
  /** 把 OPFS 下的一个子目录接成当前工程位置（不弹对话框）。 */
  async useOpfs(name = 'e2e-project'): Promise<string> {
    const root = await opfsRoot();
    const dir = await root.openDir(name, { create: true });
    attachProjectDirectory(dir, `opfs:${name}`);
    return dir.name;
  },
  save: () => saveProjectNow(),
  async open(name = 'e2e-project'): Promise<boolean> {
    const root = await opfsRoot();
    const dir = await root.openDir(name, { create: true });
    return openProjectDirectory(dir, { key: `opfs:${name}` });
  },
  /** 读工程目录里的一个文件（相对路径，POSIX 斜杠）。 */
  async read(path: string): Promise<string | null> {
    const root = await opfsRoot();
    const segs = splitRelPath(path);
    const file = segs.pop();
    if (!file) return null;
    const dir = await resolveDir(root, segs, false);
    const bytes = await readBytesIfExists(dir, file);
    return bytes ? new TextDecoder().decode(bytes) : null;
  },
  async list(path = ''): Promise<{ name: string; kind: string }[]> {
    const root = await opfsRoot();
    const dir = await resolveDir(root, splitRelPath(path), false);
    return dir.list();
  },
  /** 删掉测试目录，保证用例之间互不干扰（上一轮的残留会让断言假绿）。 */
  async wipe(name = 'e2e-project'): Promise<void> {
    const root = await opfsRoot();
    await root.remove(name, { recursive: true }).catch(() => {});
  },
  /** 删掉工程目录里的一个文件（测「素材丢失」这类场景）。 */
  async remove(path: string): Promise<void> {
    const root = await opfsRoot();
    const segs = splitRelPath(path);
    const name = segs.pop();
    if (!name) return;
    const dir = await resolveDir(root, segs, false);
    await dir.remove(name);
  },
  /** 直接往工程目录里写一个文件（模拟外部程序替换了素材）。 */
  async write(path: string, bytes: number[]): Promise<void> {
    const root = await opfsRoot();
    const segs = splitRelPath(path);
    const name = segs.pop();
    if (!name) return;
    const dir = await resolveDir(root, segs, true);
    await writeBytesAtomic(dir, name, new Uint8Array(bytes), { verify: true });
  },
};

(window as unknown as Record<string, unknown>).__artmatic = {
  renderer: appState.renderer,
  appState,
  theme,
  /**
   * `store` 与 `assets` 是 **getter**，指向当前激活工程那一份。
   *
   * 多工程下它们不能是固定引用 —— 测试里 `A.store.project` 必须始终
   * 等于「用户现在看到的这份」，与 UI 走的是同一个 getter。
   */
  get store() {
    return appState.store;
  },
  get assets() {
    return appState.assets;
  },
  project: projectDebug,
  /** 打开的工程列表，摊平成纯数据（page 里能直接断言，且可序列化）。 */
  projects: () =>
    appState.projects.map((p) => ({
      name: p.store.project.name,
      dirty: p.savedVersion !== p.store.version,
      active: p.id === appState.activeProjectId,
      view: p.view.kind,
      saved: p.savedVersion >= 0,
      dir: p.dir?.name ?? null,
    })),
  renderFrame: (t: number) => appState.renderer.renderFrame(appState.store.project, t),
  readPixels: () => {
    const { data, w, h } = appState.renderer.readPixels();
    return { data: Array.from(data), w, h };
  },
  /** E2E 专用：跑一遍真实导出管线并把 zip 解开——大像素数据不出 page。 */
  exportFrames: async () => {
    const blob = (await runExport(appState.renderer, appState.store.project, {
      sink: new PngSequenceSink(),
    })) as Blob;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const files = unzipSync(buf);
    return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Array.from(v)]));
  },
  /**
   * E2E 专用：跑一遍真实的 MP4 导出管线，**只回传标量摘要**。
   *
   * 为什么不给字节：MP4 是二进制大对象，`Array.from` 一遍就是几 MB 的
   * JSON 传输，E2E 会被撑爆。要验的内容（大小、ftyp/moov 魔数、是否含音轨）
   * 在 page 内判完，只回传结论。需要原始字节的断言走真实下载路径。
   */
  exportMp4Probe: async () => {
    const project = appState.store.project;
    const audio = mixdown(project, (id) => appState.player.buffer(id));
    const blob = (await runExport(appState.renderer, project, {
      sink: new Mp4Sink({ audio }),
      codec: MP4_CODEC,
    })) as Blob;
    const buf = new Uint8Array(await blob.arrayBuffer());
    // latin1 逐字节转字符串，只在 page 内做一次，用来搜 box 名。
    let latin = '';
    for (let i = 0; i < buf.length; i++) latin += String.fromCharCode(buf[i]);
    return {
      bytes: buf.length,
      ftyp: latin.slice(4, 8),
      hasMoov: latin.includes('moov'),
      hasAudio: latin.includes('mp4a') || latin.includes('soun'),
      hasVideo: latin.includes('avc1') || latin.includes('vide'),
      audioPeak: audio ? audio.peak : null,
    };
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
