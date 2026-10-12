import { mount } from 'svelte';
import App from './ui/App.svelte';
import './app.css';
// 控件族样式必须在 app.css 的兜底样式**之后**载入，否则同特异度的
// `button:hover` 会盖掉 `.ic-btn:hover`（纯图标按钮要保持透明底）。
import './ui/controls/controls.css';
import { ProjectStore } from './core/project-store';
import { createBlankProject, createDemoProject, DEMO_ASSET_ID } from './core/demo-project';
import { renderDemoAudio } from './audio/demo-audio';
import { computeWaveform } from './audio/decode';
import { appState } from './ui/app-state.svelte';
import { theme } from './ui/theme.svelte';
import { installTheme, applyFontScale } from './ui/theme-apply';
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
  openProjectPicker,
  refreshRecentProjects,
  registerDemoAssets,
  saveProjectNow,
} from './ui/project-actions';
import { defaultParams, listGenerators } from './algos/registry';
import { compileAll } from './effects/compile-all';
import { registerImageBytes } from './engine/media-assets';
import { applyMachine, currentCapacity, resetCapacity, setLimits } from './core/capacity';
import { loadCapacityProfile } from './ui/capacity-profile';
import { mascotStats } from './ui/mascot/squeak';
import { createControlPlane } from './agent/index';
import type { ControlContext, OpenProjectView } from './agent/types';
import type { Renderer } from './engine/renderer';

/* 装配顺序：主题 → store → mount。
   主题必须最先注入：它是内联 style，写在 :root 上，任何时候注入都生效，
   但放在 mount 前可以避免第一帧用默认值闪一下。 */
installTheme(theme.spec);
applyFontScale(theme.fontScale);

/* 首份工程先于 mount（组件挂载即读 appState.store.project），
   渲染服务在 Preview.onMount → appState.attachPreview 里随 canvas 惰性创建。 */
appState.init(new ProjectStore(createDemoProject()));

const app = mount(App, { target: document.getElementById('app')! });

// 最近工程列表：只填充 UI，**不自动打开**任何东西。
// 恢复一个工程需要 requestPermission()，而它必须有用户手势 ——
// 页面加载时做不到，所以只能等用户点。
refreshRecentProjects();

/*
 * 机器能力 → 容量预算。**起了不等**（见 ui/capacity-profile.ts）：
 * 各池子读的是 `getLimits()`，结果晚到也照样在下次取用时生效。
 */
void loadCapacityProfile();

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
    // 把原生句柄一起交出去，让句柄被持久化到 IndexedDB —— 与生产路径
    // （`showDirectoryPicker` → `putHandle`）一致，于是在这里打开的工程
    // 也能被「最近工程 / 恢复上次打开的工程」重新打开。
    const raw = (dir as { raw?: unknown }).raw;
    return openProjectDirectory(dir, { raw, key: `opfs:${name}` });
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

/**
 * 插件子系统的 E2E 入口。
 *
 * 与 `projectDebug` 同一条理由：界面上的「插件挂上了没有」要经过
 * 「打开面板 → 找那一行 → 读那一段字」三步，而**画面里那个特效真的生效了没有**
 * 根本没法从界面读。这里把宿主的清单与缺失扫描摊平成纯数据，
 * 让断言能精确到「哪一条 def 被剔除了、为什么」。
 */
const pluginDebug = {
  /** 当前挂载的全部插件（含加载失败的与停用的）。 */
  list: () => appState.plugins.list(),
  /** 已安装的插件 id。缺失扫描的判据是它。 */
  installed: () => [...appState.plugins.installedIds()],
  /** 当前工程引用了、但没装的插件。 */
  missing: () => appState.plugins.missing(appState.store.project),
  /** 子系统的版本号（插件集合变化时增长）。 */
  revision: () => appState.plugins.revision(),
};

/** 打开的工程列表：`__artmatic.projects()` 与控制平面共用一份口径。 */
function projectList(): OpenProjectView[] {
  return appState.projects.map((p) => ({
    name: p.store.project.name,
    dirty: p.savedVersion !== p.store.version,
    active: p.id === appState.activeProjectId,
    view: p.view.kind,
    saved: p.savedVersion >= 0,
    dir: p.dir?.name ?? null,
  }));
}

/**
 * ★ Agent 控制平面（方案：`docs/agent-control-plane.md`）。
 *
 * **装配点放在这里**（而不是 `src/agent/` 内部）：`appState` 是 `ui/` 层的
 * `$state` 类，让控制平面直接 import 它会把 `src/agent/` 反向绑在 `ui/` 上，
 * 将来 `/lab/` 或独立入口想复用控制平面时会成环（方案 §2.2）。注入点只有
 * 这一处，代价极小。
 *
 * 与 `__artmatic` 的关系是**同源演进，不是替换**：后者是控制平面的前身
 * （E2E / 试炼场专用），方案 §2.3 明确「保留 `__artmatic` 及其全部现有键不动」
 * —— `tests/e2e/_stage.ts` 与 `scripts/gen-*-thumbs.mjs` 依赖它们。
 *
 * > 关于「生产构建不注册」（方案 §6.4 第 3 条）：那条约束的对象是**页面内
 * > WebSocket 服务**（它开了监听端口，是真正的新攻击面）。控制平面对象本身
 * > 不比已有的 `__artmatic` 多给任何能力 —— 能执行 `window.__artmatic.control`
 * > 的脚本本来就能执行 `window.__artmatic.appState.store.commit`。而路径 A
 * > （headless 驱动）恰恰跑在 `vite preview` 的**生产产物**上，注册被门住
 * > 就等于把唯一跑得通的自动化通道拆掉。所以这里与 `__artmatic` 一样无条件注册；
 * > 页面内 WS（§6.2，方案标为可选）没有实现，那条边界因此没有失守。
 * > 生产构建确实**没有** WebSocket / 任何监听端口（断言见 `tests/e2e/agent.spec.ts`）。
 */
const controlContext: ControlContext = {
  // `store` / `assets` 是 getter，永远指向当前前台那份；**每次调用都重新取**
  // （多工程下缓存它必然错，见 AGENTS §5.2 的纪律）。
  getStore: () => (appState.hasProject ? appState.store : null),
  getRenderer: () => (appState.renderer as Renderer | undefined) ?? null,
  getAssets: () => (appState.hasProject ? appState.assets : null),
  getPlayT: () => appState.playT,
  setPlayT: (t) => {
    appState.playT = t;
  },
  getAudioBuffer: (id) => appState.player?.buffer(id) ?? null,
  listProjects: projectList,
  saveProject: () => saveProjectNow(),
  // 给 name 走 OPFS（headless 驱动可用）；不给就弹系统对话框（必须有用户手势）。
  openProject: (name) => (name ? projectDebug.open(name) : openProjectPicker()),
  cancelPendingGesture: () => appState.cancelGesture(),
  refreshPreview: () => appState.refreshPreview(),
};

const control = createControlPlane(controlContext);

(window as unknown as Record<string, unknown>).__artmatic = {
  renderer: appState.renderer,
  appState,
  theme,
  /**
   * ★ 协议化的控制平面（agent 的唯一操作面）。每个方法都返回
   * `{ ok: true, data } | { ok: false, error: { code, message } }`，**不抛异常**
   * —— 异常跨传输层会丢掉类型，agent 就拿不到可判别的 `code` 了。
   */
  control,
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
  plugins: pluginDebug,
  /** 打开的工程列表，摊平成纯数据（page 里能直接断言，且可序列化）。 */
  projects: (): OpenProjectView[] => projectList(),
  renderFrame: (t: number) => appState.renderer.renderFrame(appState.store.project, t),
  readPixels: () => {
    const { data, w, h } = appState.renderer.readPixels();
    return { data: Array.from(data), w, h };
  },
  /**
   * E2E / 试炼场专用：把当前 WebGL 上下文里**所有**着色器预编译一遍
   * （特效 + realtime 算法 + 122 条转场），返回逐条成功/失败。
   *
   * 之所以要暴露到 `__artmatic`：artmatic 的着色器是惰性编译的，语法错误在你
   * 点到它之前不会报。E2E 靠这条断言「全量转场在这台机器上都能编译」——
   * 这是 122 条第三方 GLSL 唯一的自动化防线（见 effects/compile-all.ts）。
   */
  compileAll: () => {
    const { results, okCount, total } = compileAll(appState.renderer.kit);
    return { okCount, total, failures: results.filter((r) => !r.ok) };
  },
  /**
   * E2E 专用：**现场编一段真视频**当测试素材（红 1s → 蓝 1s，160×90 @10fps）。
   *
   * 为什么不往仓库里塞一个 mp4 当 fixture：二进制素材会一直躺在版本库里，
   * 而它本来就能用项目自己的编码链路生成。顺带这条路径还证明了「导出的
   * MP4 能被自己的解码链路读回来」—— 这是两个子系统之间一次真实的往返。
   *
   * 回传 `number[]`：20 帧的 160×90 只有几 KB，远低于 E2E 的传参上限；
   * 拿到之后用 Playwright 的 `setFiles({buffer})` 灌进真实的选择器，
   * 走的就是导入视频的**真实路径**。
   */
  makeTestVideo: async () => {
    const p = createBlankProject('e2e-test-video');
    p.resolution = { w: 160, h: 90 };
    p.fps = 10;
    p.duration = 2;

    /*
     * 内容的形状是刻意的：**上下两半不同色**，而且颜色随时间变。
     *
     *   t ∈ [0,1)： 上半红 / 下半蓝      t ∈ [1,2)： 上半绿 / 下半蓝
     *
     * 于是这一份素材同时能验两件事：
     *   · 取帧跟着 t 走（红 → 绿，纯色视频过不了这一条）
     *   · 上下方向正确（上半红/绿、下半蓝；上下颠倒会立刻被抓到）
     *
     * 两半靠**两条视觉轨 + transform** 做出来（solid 源不能上色曲线），
     * 顺带也把 placement 的 uv 语义钉住了。
     */
    const mk = (id: string, start: number, end: number, color: string, y: number) => ({
      kind: 'source' as const,
      id,
      start,
      end,
      label: color,
      fadeSec: 0,
      curves: {},
      source: { type: 'solid' as const, color },
      blend: 'normal' as const,
      opacity: 1,
      transform: { x: 0.5, y, sx: 1, sy: 0.5, rot: 0 },
      fit: 'stretch' as const,
    });
    const top = p.tracks.find((t) => t.kind === 'visual');
    if (!top || top.kind !== 'visual') return [];
    // 上半：红 → 绿
    top.clips.push(mk('tv-top-a', 0, 1, '#ff0000', 0.75), mk('tv-top-b', 1, 2, '#00ff00', 0.75));
    // 下半：蓝（贯穿两秒）
    p.tracks.push({
      kind: 'visual',
      id: 'tv-bottom',
      name: 'V2',
      enabled: true,
      clips: [mk('tv-bottom-a', 0, 2, '#0000ff', 0.25)],
    } as never);

    const blob = (await runExport(appState.renderer, p, {
      sink: new Mp4Sink({ audio: null }),
      codec: MP4_CODEC,
    })) as Blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // 导出会临时钉死 canvas 尺寸，导完要还回去，否则预览停在导出分辨率上
    appState.renderer.clearExportSize();
    appState.renderer.syncSize(appState.store.project.resolution);
    return Array.from(bytes);
  },
  /** E2E 专用：视频帧缓存的读数（证明解码真的发生了、缓存是有界的）。 */
  videoStats: () => appState.video.stats(),
  /** E2E / 诊断：特效池与模拟状态的容量读数（失败模式是静默的，所以要有读数）。 */
  poolStats: () => appState.renderer.poolStats(),
  algoStats: () => appState.algos.stats(),
  /**
   * 容量预算的读数与写入。
   *
   * 读：`capacity()` 给出 `{ machine, limits, source }` —— 回答「这台机器上
   * 实际生效的预算是多少、数字从哪来」。
   * 写：`capacity.set({...})` 覆盖几项（E2E 用它把预算钉死，否则一条用例的
   * 行为会跟着跑测试的机器变）；`capacity.probe()` 重新问一次服务端。
   */
  capacity: {
    get: () => currentCapacity(),
    set: (patch: Parameters<typeof setLimits>[0]) => {
      setLimits(patch, 'override');
      return currentCapacity();
    },
    probe: () => loadCapacityProfile(),
    apply: (machine: Parameters<typeof applyMachine>[0]) => {
      applyMachine(machine);
      return currentCapacity();
    },
    reset: () => {
      resetCapacity();
      return currentCapacity();
    },
  },
  /**
   * E2E 专用：把一个 Blob 登记成图片素材（等价于导入图片 / 排版「转为图片」
   * 走的那一步）。E2E 里造不出真实文件，但可以造真实 PNG 字节。
   */
  registerImageAsset: (assetId: string, blob: Blob) => registerImageBytes(assetId, blob),
  /**
   * E2E / 性能探针专用：跑真实导出管线但**丢掉帧**，只回传耗时。
   *
   * 为什么需要它：视频解码是**异步就绪**的，而预览缺帧时会拿最近的帧顶上，
   * 所以「连着渲 N 帧然后计时」量到的是渲染缓存纹理的成本，不是解码成本
   * （实测会得到 3 万 fps 这种荒谬数字）。导出循环每个都 `await prepareFrame`
   * —— 那才是解码+上传的真实成本，也正是用户关心的「导出要多久」。
   *
   * 回传标量摘要：帧数、总耗时、每帧中位数。
   */
  exportTiming: async (frames: number) => {
    const project = { ...appState.store.project, duration: frames / appState.store.project.fps };
    const per: number[] = [];
    // 空 sink：只计时，不编码（编码是另一条链路，会把数字搅在一起）
    const sink = {
      configure: async () => {},
      submit: async (i: number) => {
        void i;
      },
      finalize: async () => new Blob(),
    };
    await runExport(appState.renderer, project, { sink: sink as never, onFrame: (ms) => per.push(ms) });
    appState.renderer.clearExportSize();
    appState.renderer.syncSize(appState.store.project.resolution);
    const sorted = [...per].sort((a, b) => a - b);
    return {
      frames: per.length,
      totalMs: Math.round(per.reduce((s, v) => s + v, 0)),
      medianMs: Math.round((sorted[Math.floor(sorted.length / 2)] ?? 0) * 10) / 10,
      maxMs: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10,
    };
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
   * 彩蛋的 E2E 读数：捏了几次、最近一次是不是已经坏成噪音。
   *
   * Web Audio 的**输出**在 Playwright 里读不到（没有可靠的取音路径），
   * 能证实的是「点击真的走到了合成器，并且每次的计划都不同 / 越点越坏」。
   */
  mascotStats,
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
