# AGENTS.md

跨 Agent 协作备忘录。**修改架构、数据模型、构建方式或测试约定之前，先更新本文件。**

---

## 0. 这是什么

**Artmatic** —— 面向算法艺术与故障艺术的 Web 原生时间轴工具。

它存在的理由只有一条：**"把算法艺术和故障艺术按音乐结构编排起来"这件事没有替代品。**

跑得动的单独工具很多——网页里渲分形、模拟元胞自动机、算 logistic 分岔、做 datamosh、写排版——但没有一个能把它们当作**可编排的片段**放进同一条时间轴，并且按拍吸附、可打关键帧、确定性导出。

所以范围纪律是：

| 必须自己做 | 交给别人做 |
|---|---|
| 算法艺术片段（生成器注册表 + 关键帧） | 调色 → 达芬奇（导出 ProRes / PNG 序列） |
| 故障艺术特效链（实时可调） | 动态排版 → Cavalry（个人版免费，本机已装） |
| 按拍吸附的统一时间轴 | 精细图形 → Affinity（本机已装） |
| 确定性逐帧导出 | 3D / 粒子仿真 → 需要时单独做素材导进来 |
| 排版**编排**（片段化、关键帧、合成） | 排版**编辑器的极致体验** → 不做 |

**判据**：如果一个功能已经有稳定工作流且做得比我们好，就不要自己做，改为**提供高质量的输出与导入**。这条守住，12k–18k 行的目标才守得住。

---

## 1. 硬约束（不可协商）

违反其中任何一条，架构就已经坏了，且通常要到很晚才发现。

### 1.1 时间只有一个来源

- **唯一时钟是 `t`**（帧号 / fps）。任何渲染函数都不得接收 `Date.now()` / `performance.now()`。
- 预览用 rAF 驱动，导出用紧循环驱动，**两者走同一条求值路径**，差别只在分辨率。
- **禁止用 `requestAnimationFrame` 驱动导出。** 导出是 `for (let i = 0; i < totalFrames; i++)`，只受编码器背压约束。

### 1.2 随机必须带种子

任何随机都要走 `withSeededRandom(seed, fn)`。禁止裸 `Math.random()`。预览与导出必须是同一次随机。

### 1.3 有状态模拟必须确定

反应扩散、Physarum、真实 boids 这类**有状态**算法：

- 固定步长推进，与渲染帧率解耦；
- 每隔 N 帧写一次状态快照；
- seek 时从最近的快照重放。

angel-echo 的处理方式更极端（它干脆禁止状态，鸟群是构造出来的），我们允许状态，但必须满足上面三条。

### 1.4 主线程只做 rAF 和 uniform 写入

- 解码 → Worker
- 算法烘焙 → Worker
- 编码 → 独立进程（ffmpeg 子进程）
- 主线程每帧的工作量不得超过一帧预算

这是"UI 不许卡顿"唯一的实现方式。

### 1.5 渲染件与 Electron 解耦

内核是**标准 Web 应用**：能在 Chrome 里打开、能用 Playwright 跑 E2E、能热更新。
Electron 只在两件事上出现：**读写工程目录**、**跑 ffmpeg 子进程**。

所有平台能力走 `platform/` 接口。浏览器实现用内存 / File System Access，Electron 实现走 IPC。

> **任何"只能在 Electron 里跑起来才能测"的功能设计，都应当视为设计错误。**
> 这条直接来自 Tauri 那次彻底爆炸的教训。

### 1.6 禁用 `git stash`

沙箱与 git 交互有缺陷。需要腾空工作区就 WIP commit（可 `reset --soft` 回退）或新建分支。

### 1.7 工程文件是磁盘上的目录，不是 localStorage

真相只在磁盘。IndexedDB 只放可丢弃的东西（缩略图缓存、UI 状态）。

### 1.8 不引 AGPL / GPL 代码

- 禁止：`hydra-synth`（AGPL-3.0）、`Coollab`（GPL-3.0）
- 可用：`gl-transitions`（MIT）、`mediabunny`（MIT）、openmosh 全部（MIT）、`lucide`（ISC）

移植 MIT 代码必须登记到 `CREDITS.md`（含二级移植的来源）。这个账越拖越贵。

---

## 2. 技术栈（已定）

| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript（strict） | — |
| 构建 | Vite | 与 openmosh 同构，热更新成熟 |
| UI 框架 | **Svelte 5 runes**（2026-09-27 定） | 与 openmosh 同构；时间轴本体 Canvas2D 自绘，框架只管面板 |
| 渲染 | **WebGL2 + GLSL ES 3.00** | 两套参考代码都是这个；WebGPU 先不碰 |
| 打包 | Electron + electron-builder | 保守优先 |
| 导出编码 | **捆绑 `ffmpeg.exe` 子进程** | 见 ADR-001 |
| 音频分析 | 自研 TS 离线 FFT（对齐 `AnalyserNode` 的 dB 映射） | 见 ADR-002 |
| 排版出图 | **snapDOM + 字体子集化**（`dom-snap` 后端） | 见 ADR-003 |
| 图标 | **Lucide（`@lucide/svelte`）**（2026-10-01 换） | 描边风格与本项目视觉一致；ISC；按组件导出可 tree-shaking |
| 样式 | **Design Token 单一真源在 TS**（`ui/tokens.ts`） | 见 ADR-005 |
| 测试 | Playwright（E2E）+ vitest（纯逻辑单测） | 单测只测纯函数 |

---

## 3. 架构分层

```
renderer/                     标准 Web 应用，可在 Chrome 里独立运行
├── core/                     schema · 曲线求值 · 命令栈      ← 纯 TS，无 DOM / WebGL，必须可单测
├── engine/                   WebGL2：Program / Target / Pass 调度 · 纹理池 · 预览尺寸 · 确定性时钟
├── effects/                  声明式特效定义 + GLSL
├── algos/                    算法生成器注册表 + 烘焙 Worker
├── audio/                    离线 FFT · BPM 估计 · 拍网格 · 跟随包络
├── typography/               TypographyDocument 模型 + 光栅化后端
├── timeline/                 UI（Canvas2D 绘制 + DOM 片段）
├── exporters/                逐帧驱动 + FrameSink 抽象
└── platform/                 Platform 接口（浏览器实现 ↔ Electron 实现）

electron/
├── main/                     工程目录 fs · ffmpeg 子进程 · 菜单
├── preload/                  contextBridge 窄接口（不暴露 ipcRenderer）
└── ipc/                      类型化通道 · 大块数据走 SAB / MessagePort

shared/
└── ipc-contract.ts           两侧共用的通道名与载荷类型
```

**依赖方向**：`core` 不依赖任何东西；`engine` 只依赖 `core`；UI 层依赖全部；`platform` 被所有人依赖。

`core/` 是全局关键路径——**它定死之前不要写时间轴 UI**，否则等于把返工写进计划。

---

## 4. 关键决策记录

### ADR-001 · 导出用捆绑 ffmpeg.exe，不用 WebCodecs 编 H.264

**决定**：Electron 里捆绑 `ffmpeg.exe`，渲染帧经 `SharedArrayBuffer` 双缓冲送主进程，写进 ffmpeg stdin（`-f rawvideo -pix_fmt rgba -s WxH -r FPS -i -`），视频走 `h264_nvenc`（本机 4070）或 `libx264`，`-movflags +faststart`。

**理由**：
1. Chromium 默认构建不带专有编解码器（Chromium media 负责人明确说明需 `proprietary_codecs=true ffmpeg_branding="Chrome"`），Electron 里 `avc1` 的 WebCodecs 可用性有矛盾证据，不实测不能定论。ffmpeg 旁路**完全绕开这个不确定性**。
2. 都上 Electron 了就不必计较体积。
3. NVENC 让编码快到不是瓶颈；顺带白送 ProRes / DNxHR / H.265 / PNG 序列导出。

**强制配套**：所有导出走统一的 `FrameSink` 接口，三个实现共存——`ffmpeg-pipe`（主）、`webcodecs`（若实测可用则启用，作为无依赖快路径）、`png-sequence`（永远可用的兜底）。

```ts
interface FrameSink {
  configure(size: {w:number;h:number}, fps: number, codec: string): Promise<void>
  submit(frameIndex: number, source: HTMLCanvasElement | VideoFrame): Promise<void>
  finalize(): Promise<Blob | string>
}
```

**打包注意**：二进制在 asar 里无法执行，必须 `asarUnpack`，运行期路径做 `.replace('app.asar','app.asar.unpacked')`。挑带 `nvenc` 的构建（`ffmpeg -encoders | findstr nvenc` 验证）。

### ADR-002 · 音频分析与预览共用同一份实现

**决定**：自研 TS 离线 FFT（FFT_SIZE 2048、Blackman 窗、**刻意对齐 `AnalyserNode` 的 dB 映射**），预览与导出调同一份代码。BPM 估计沿用 angel-echo 的 `analyze_audio.py` 算法并翻译成 TS（约 400 行）。

**理由**：angel-echo 的分析管线质量高（自相关估 BPM + 相位锁定拍网格 + `pick_downbeat` 定下拍偏移 + 段落按小节锚定）。openmosh 的经验也证明必须共用一份实现，否则 60fps 预览与 30fps 导出的音频响应对不上。

**不打包 Python 运行时**——那会引入一个与 Electron 打包链正交的依赖，且每次启动都要冷启解释器。

**必须保留的概念**：`offset`（第 0 小节首拍秒数）是独立参数，不是从 0 开始。
`timeAtBeat(b) = offset + b * beatDur`，`beatAtTime(t) = (t - offset) / beatDur`。

**禁止**把作曲家给的秒数吸附到最近的强 onset——angel-echo 试过，会晚 1–2 小节。正确解法是**锚定小节**，而且它有一个算术自洽可验证：Drop II 恰为 32 小节 = Verse I+II+III 之和。

### ADR-003 · 排版出图用 snapDOM + 字体子集化

**决定**：排版层用 HTML+CSS 描述，经 snapDOM 光栅化为纹理。**中文字体必须子集化。**

**实测依据**（1920×1080，Chrome 154 headless，完整数据见 `docs/tech-note-html-css-rasterization.md`）：

| 配置 | 载荷 | 中位耗时 |
|---|---|---|
| snapDOM 默认 + simhei.ttf 9.74 MB | 13.0 MB | **129.3 ms** |
| snapDOM + `embedFonts:false` | 11.9 KB | 0.7 ms（**但字形回落，等于换字体**） |
| snapDOM + 子集字体 12 KB | 28.1 KB | **0.7 ms**（**逐像素零差异**） |

成本 ≈ 4 µs/KB 内联字体 + 0.7 ms 固定开销。"体积比 45.2× / 耗时比 47.5×"证明线性成立。

**四条实现规则**：

1. **字体子集化，按字形集哈希缓存。** 不做这条每帧 129 ms，做了每帧 0.7 ms。字形集只在用户打字时变化，命中率极高。
2. **不要用 `embedFonts:false` 换性能。** 实测它的差异量级（11.297%）与故意换成另一个字体（10.742%）几乎相同——等于换了字体。要性能就裁字体。
3. **导出前必须 `await document.fonts.ready`。** 否则首帧用回落字体量度，导出与预览不一致，且"看起来都正常"，极难定位。
4. **动画状态要烘焙，不要指望库读懂。** 实测 html2canvas-pro 会丢掉 CSS 动画状态（停在 x=100 却渲染在 x=8）。正确写法：WAAPI seek → 把计算值写进内联样式 → 停掉 animation → 再截图。这样三个库全部正确。

**Web Animations API 的 seek 是精确的**（实测误差 0），所以 CSS 动画可以做帧精确导出，但必须走烘焙路径。

**设计成可替换后端**：

```ts
interface TextRasterizer {
  rasterize(doc: TypographyDocument, size: {w:number;h:number}, t: number): Promise<ImageSource>
  cached(key: string): ImageSource | null
}
```

后端优先级：`hic`（HTML-in-Canvas，API 稳定后用）→ `dom-snap`（现在用）→ `canvas2d`（极简场景）→ `png-import`（逃生舱）。

**落地状态（M4，2026-10-01）**：

- 四条规则**全部落地**：① 由 HarfBuzz WASM 实现（见 ADR-010）；② 恒为 `true`/`'auto'`；
  ③ `FontRegistry.ensure()` 内部 await `document.fonts.ready`；④ `bakeAnimations()`。
- ⚠️ **本 ADR 上文引用的「0.7 ms/帧」是 snapDOM 自己的捕获耗时，不是整条链路的。**
  实测整条排版光栅化（建 DOM → 序列化 → SVG→Canvas）在 **1920×1080 下是 16.2 ms/帧**
  （子集字体，稳态中位数）。子集化**直接消掉的是字体内联那 155 ms**：
  同一文档在 `900×200` 下，全量 9.5 MB 中文字体 **165 ms/帧** vs 子集字体 **10 ms/帧**。
  引用这两个数时务必分清「内联成本」与「整条链路成本」。
- `hic` 的位置留好了，而且 snapDOM 3.x 自己就有 `engine: 'html-in-canvas'`（不支持时静默回退），
  等它在这个 Electron 版本上通了，改 `backends/dom-snap.ts` 的一个选项即可。
- `png-import` 没有做成独立后端：既有 `image` 源 + 「转为图片」动作已经覆盖它的全部用途
  （`ui/typography/actions.ts` 的 `flattenToImage`）。

### ADR-004 · HTML-in-Canvas 只留接口，不做依赖

**实测状态**（Chrome 154 + `--enable-features=CanvasDrawElement`）：

| API | 状态 |
|---|---|
| `HTMLCanvasElement.layoutSubtree` | 存在 |
| `requestPaint()` + `paint` 事件 | **可用**，改 DOM 到 paint 触发 **4.2 ms** @1080p（≈238 fps） |
| `captureElementImage(el)` | **可用**，返回 `ElementImage{width,height,close()}`，耗时 **~0 ms** |
| `texElementImage2D` | 存在但**拒绝所有入参**（穷举 12 种组合均失败） |
| `ctx.drawElementImage` | 存在但报 `No cached paint record for element` |
| WebGPU `copyElementImageToTexture` | 存在，未验证 |

**判断**：捕获路径快得惊人（比 snapDOM 快 20 倍以上，且无需序列化、无需内联字体），但上传路径在本版构建里不通，且 API 仍在改（入口已从 `drawElement` 改名）。**不为其设计架构，但在 `TextRasterizer` 后面留好位置。**

**Electron 里的优势**：网页需要 origin trial token，Electron 可直接 `app.commandLine.appendSwitch('enable-features', 'CanvasDrawElement')`，不依赖 trial 窗口。代价是钉死 Electron 版本——这也是不能把它做成硬依赖的原因。

---

### ADR-005 · Design Token 用 TS 当唯一真源，而不是只写 CSS 变量

**决定**：`src/ui/tokens.ts` 是 token 的唯一真源（纯数据 + 纯函数，**不碰 DOM**），
`src/ui/theme-apply.ts` 把它写成 `:root` 的内联自定义属性，`src/ui/theme.svelte.ts`
管运行时态（亮暗 + 品牌色 + 自定义 hex，持久化到 localStorage）。`app.css` **不再有
`:root` 变量块**。

**理由**：时间轴是 Canvas2D 自绘，`ctx.fillStyle` 写不了 `var(--x)`。改版前 `grid-draw.ts`
因此在 TS 里完整重抄了一份调色板（9 个字面量与 CSS 变量同值一一对应）——改一次配色要改
两处，改漏就是「面板变了、网格没变」这种极难定位的偏色。现在两边都从 `tokens.ts` 取
（Canvas 走 `canvasPalette(spec)`），物理上不可能不同步。

**四层**：primitive（`--p-*`，只描述值）→ semantic（`--surface-*` 等，描述用途，不含颜色词）
→ component（`--btn-*` 等，值必须是 `SemanticKey`，写错层直接编译报错）→
**content**（`--clip-*`，数据类别色，随亮暗变但**永不随品牌变**）。
最后一层是为解一个具体问题：片段类型色编码的是「这是哪类数据」，不是界面角色；挂进品牌组
的话用户换主题色时特效片段的样貌会跟着变，破坏对内容的心智映射。

**边界**：生成器默认色（`#3a6ea5` 之类）**不是 token**，那是 Project 文档内容（schema 字段）。
Inspector 里颜色控件的**外观**走 component 层，**值**走内容。

**视觉纪律**：零阴影零渐变，层次只靠 surface-0→3 的纯色深度 + 1px 实线；圆角 4/6px；
纯图标按钮永远 `background: transparent`，hover 只改图标颜色；主题色只出现在**选中/激活、
焦点环、播放头、底栏数字**这几处。默认**亮色**。

### ADR-006 · 轨道 z 序 = 列表位置取反（列表顶部 = 前景）

**决定**：`engine/stack.ts` 的 `buildStack` 里 `z = 视觉轨数 - 1 - 视觉轨下标`。
**编号只数视觉轨**（音频轨不参与合成，算进去会让 z 出现空洞）。

**理由**：`tracks[0]` 渲染在轨道列表最顶部，而列表顶部按 NLE 惯例就是最前景，所以它的 z
必须最大。这里原来是 `z = index`，后果是「列表越靠下的轨道画面越靠上」——与 Premiere / AE /
DaVinci 的直觉完全相反（用户实测报上来：「z 轴好像是轨道越往下越大，不符合直觉」）。

**配套**：`core/demo-project.ts` 的 tracks 数组必须一起倒序（现在是 V4→V3→V2→V1→A1），
否则原本的叠加关系会被整个翻掉。改这里时 `tests/unit/stack.test.ts` 会挡住。

### ADR-007 · 密度压紧到 28px 行高

**决定**：轨道行高 40 → 28px，标尺 26 → 24px，字号阶梯只留 10/11/12。数值在
`tokens.ts` 的 `DENSITY` 里，CSS 与 Canvas 数学（`timeline/view-model.ts`）都从它取，
不许各写一份。

**理由**：Terminal-Native 取向是「密度即特性」——同屏能多出 40% 的轨道，信息密度本身就是
这类工具的价值。

### ADR-008 · 排版编辑器 = 顶栏选项卡宿主，双击 Source 片段打开

**决定**：
1. 编辑器是**顶栏的一个临时页**（`appState.shellTabs`），不是 modal、也不是抽屉。
   时间轴页常驻且**永不卸载**（卸载 `Preview` 的 `<canvas>` 会丢 WebGL 上下文，
   `kit` 里所有 `Program`/`Target`/纹理一起失效，且无法恢复），所以切页只是
   `display:none`，并配 `appState.tick()` 早退。
2. **双击片段 = 打开它自己的编辑器，一律不切分。** 目前只有 `text` 源有独立页面，
   其余类型聚焦检查器。切分保留 `S` 键与检查器的「在播放头切分」两个入口。
3. **M4 不做 per-editor 脏标记。** 排版编辑全程直写工程（可撤销），编辑器内不存在
   「未提交的本地状态」，没有「关 tab 会丢」的东西。需要脏标记的是「工程 vs 磁盘」，
   那是 M5 的事。
4. 快捷键按**分流**处理而不是逐条加判断：`App.svelte` 的 `onKey` 在编辑器打开时
   整段交给 `ui/typography/keys.ts`。于是 `S`（切分）与 `Alt+↑↓`（移轨）在排版页
   **自然失效**，不需要在时间轴的每条分支上加 `if (!editorOpen)`。

**理由**：双击是最高误触的手势，把破坏性操作（切分）绑在上面迟早出事；而
「双击 = 打开」对四类片段是同一心智，M5 接入 video / image 的独立页面时只需要改
`appState.openClipEditor`，`ClipView` 一行都不用动。

**配套**：`appState.tick()` 在编辑器打开时早退（`.body` 隐藏后 `measureDisplaySize()`
会量到 0 并触发 `UNMEASURED_MAX_PIXELS` 兜底分配），但**播放头照常推进** ——
排版页的 CSS 动画就是靠 `playT` 驱动 seek 的。关 tab 时必须取消未结算的手势
（`registerGestureCancel`）：绝不能让 `beginTx` 悬空，否则之后每次 commit 都会被
并进那个事务里，撤销栈整个错乱。

### ADR-009 · 光栅化缓存键 =(docHash, 输出尺寸, 帧号)；静态文档走单帧快速路径

1. 缓存键 = `docHash(doc) | WxH | frame`。`docHash` **只哈希 `clip.source.doc`**，
   不掺 `store.version` —— 否则改一下无关片段的名字就把所有排版缓存击穿了。
2. **静态文档（`docIsAnimated === false`）的帧号是 `null`** ⇒ 尺寸相同就永远命中同一条缓存。
   带帧号会让一张标题卡每帧重做一遍，而且**看不出来**（只是慢）。
3. **默认不做预烘焙 PNG 序列。** 1080p 一帧 RGBA = 8.3 MB，150 帧 = **1.24 GB**；
   逐帧按需光栅 + LRU 常驻只需 1–2 张纹理。序列的唯一优势是「把昂贵的光栅化挪到导出前」，
   但 16 ms/帧不是瓶颈（瓶颈在编码器背压），静态文档本来就只付一次。
4. 内存预算：`MAX_RASTER_EDGE = 4096`、预览 48 MB / 32 条、**导出期收紧到 2 条**。
5. **分辨率不需要 `if (isExport)` 分支。** `renderW/renderH` 就是 `kit.w/kit.h`：
   预览时它已经是适配后的小尺寸，导出时它就是输出分辨率。光栅尺寸由 `drawSizeFor`
   反推，纹理宽高比与文档一致 ⇒ 摆放尺寸与光栅分辨率无关 ⇒ `previewScale`（1 / 0.5 / 0.25）
   只影响清晰度，不影响版式。

**与硬约束 1.1 的关系（必须写清，否则会被人误判为违宪）**：导出循环里新增了
`await renderer.prepareFrame(project, t)`。1.1 禁止的是**用 rAF 驱动导出**，并要求
for 循环只受编码器背压约束；这次 await 与已有的 `await sink.submit` 同类 —— 是
**渲染前准备 + 协作式背压**，没有引入第二个时钟。之所以必须有它：文字位图来自
**异步**光栅化，而预览允许「这一帧缺席」，导出不允许（缺席就是那一帧真的没有文字）。

### ADR-010 · 字体为引用而非内嵌 + HarfBuzz WASM 子集化

| 项 | 结论 |
|---|---|
| 工程文件里存什么 | **只存引用**（`FontRef`）。9 MB 中文字体 base64 进 `project.json` 会把工程文件变成不可用的大 blob |
| 内置字体 | 只内置 **OFL 的 Inter**（`public/fonts/inter-latin-{400,700}.woff2`，各 ~24 KB）+ 许可原文 |
| 中文字体 | **用户自行导入**（`platform.pickFontFiles()`），字节只存用户本机 |
| 子集化 | `harfbuzzjs`（MIT，**零传递依赖**，wasm 651 KB **懒加载**，不进主 bundle） |

**按 face 而不是按族组织**（踩过）：Inter 的 400 与 700 是**两个文件**。一族只存一份
字节的话，粗体只能由浏览器合成，而舞台用的是真正的 700 字面 —— 「预览是真粗体、
导出是合成粗体」，字宽与笔画都不同，逐像素一比就是几万个像素。所以最小单位是
`family + weight + style`，`localFonts()` 把一个族展开成多条。

**实测（2026-10-01，本机）**：

| 输入 | 全量 | 子集 | 冷路径耗时 |
|---|---|---|---|
| `simhei.ttf`（CJK） | 9517 KB | **6.4 KB（0.067%）** | 22.6 ms |
| `inter-latin-400.woff2` | — | **不可子集化**（`hb_subset_or_fail` 返回 0） | — |

- HarfBuzz 的 subset **只吃 SFNT（TTF/OTF）**；woff/woff2 走「原样内联」分支
  （`isSubsettable()`）。woff2 本身是压缩格式，体积可控。
- 本项目的 `harfbuzzjs` 构建**没有导出** `hb_subset_input_set_drop_hints`，hinting 被保留了 ——
  实测 6.4 KB 反而比技术笔记里 `pyftsubset --no-hinting` 的 12 KB 更小，不是问题。代码用 `?.` 容错。
- 缓存键 = `hash(faceId + 字形集)`，字形集由 `collectGlyphs` 产出（**已排序去重**），
  所以打字顺序不同不会产生不同的键。字形集只在打字时变化，命中率极高。

**四个必须写进注释的坑**（`typography/font/subset-hb.ts`）：
1. `memory.buffer` 的视图会在 wasm 内存增长后 detach。官方示例抓一次一路用到底是**运气**；
   每次用堆视图前都重取。
2. `hb_blob_get_data` 返回的是堆上指针，必须先 `.slice()` 再销毁 blob。
3. `hb_blob_create` 用了 `HB_MEMORY_MODE_WRITABLE`，源数据要到最后才 `free`。
4. 必须 `for (const ch of glyphs)`（按**码点**）；用 `.length` 索引会把代理对切碎。

**验证方式**：`FontRegistry.subsetting` 是可关的开关，关掉退回整体内联。
`tests/e2e/typography-font.spec.ts` 用它做对照组，断言**子集 vs 全量逐像素零差异** ——
这是唯一能证明「子集化没有改动字形或度量」的测试。

**纹理上传方向（不是 ADR，是必须记住的实现事实）**：`VERT_QUAD` 里 `vUv = aPos*0.5+0.5`，
v=0 是**底部**；而 `texImage2D` 默认把图像首行放到 v=0。排版纹理上传因此必须
`UNPACK_FLIP_Y_WEBGL = true`，否则文字与图形全上下颠倒。
`typography-export.spec.ts` 有一条**方向断言**钉着它（把图形放在文档顶部，断言它在
readPixels 里落在 y 靠后的位置）。⚠️ `SourceManager.setImage` 与 algo 的 R8 上传路径
**没有** flip —— 前者目前零调用方，后者只测过确定性、没测过方向，都值得复核。

## 5. 数据模型

**音频单独成轨**（已确认）。视觉轨道里混放画面来源与特效。

```ts
type Track = VisualTrack | SoundTrack        // 命名避开 WebAudio 的 AudioTrack

interface VisualTrack {
  kind: 'visual'
  id: string; name: string; enabled: boolean
  clips: (SourceClip | EffectClip)[]          // 同轨不重叠，按 start 排序
}
interface SoundTrack {
  kind: 'audio'
  id: string; name: string; enabled: boolean
  clips: AudioClip[]
  bus: 'master' | string
}

// 判别联合 —— 这就是"轨道不区分内容"的实现
type AnyClip = SourceClip | EffectClip | AudioClip

interface ClipBase {
  id: string; start: number; end: number; label: string
  fadeSec: number
  curves: Record<string, Curve>               // 参数名 → 关键帧曲线
}

/** 有画面来源，参与合成。被特效影响的就是它。 */
interface SourceClip extends ClipBase {
  kind: 'source'
  source:
    | { type: 'video';    assetId: string; srcIn: number; speed: number }
    | { type: 'image';    assetId: string }
    | { type: 'algo';     generator: GeneratorId; params: Record<string, unknown> }
    | { type: 'text';     doc: TextDocument }
    | { type: 'solid';    color: string }
  blend: BlendMode            // 14 种
  opacity: number
  transform: { x:number; y:number; sx:number; sy:number; rot:number }
  fit: 'contain' | 'cover' | 'stretch'
}

/** 无画面来源，把自己插进渲染链。所有特效都是它——含摄像机 / 画幅 / OSD。 */
interface EffectClip extends ClipBase {
  kind: 'effect'
  chain: EffectInstance[]     // 一条片段可携带一串效果，可拖拽重排
}

/** 声音事件，不参与视觉合成。 */
interface AudioClip extends ClipBase {
  kind: 'audio'
  assetId: string; srcIn: number
  gain: Curve
}
```

### 合成求值

```ts
function buildStack(project: Project, t: number): Stack {
  // 1. 收集所有命中 t 的 SourceClip，轨道序 → 轨道内序 决定 z
  // 2. 按 z 序合成（各自的 blend / opacity / transform / 曲线求值）
  // 3. 把命中的 EffectClip 的 chain 依 z 序插入到 step 2 之后
  // 4. 顶部叠加渲染：排版层
}
```

**EffectClip 的语义**：只作用于**z 序在它之下的所有 SourceClip 的合成结果**。
→ "调色放最顶层" = 作用于整幅画面；"故障放在两层之间" = 只坏一层。这是 AE 的 adjustment layer 语义。

**同轨不重叠**，需要叠就加轨道。拖动策略（2026-09-27 用户拍板）：**可配置项** `overlapBehavior: 'push' | 'reject' | 'trim'`（挤开邻居 / 拒绝落点 / 吃掉邻居重叠部分），默认 `'reject'`。注意 reject 的语义是「落点非法就整次不动」（落点碰撞检测），**不是** openmosh `moveClip` 的「钳在当前空档里」——后者永远拖不过邻居，与本工具的 NLE 直觉不符。

**策略结算的时序（2026-09-27 用户反馈后定死，改之前先读这段）**：

| 阶段 | 做什么 |
|---|---|
| `pointermove` | 只做**自由移动**（`liveMoveClip` / `liveResizeClip`）：被拖片段跟着鼠标走、可以压在邻居身上、跨轨也在这时实时生效。**策略一律不动。** |
| `pointerup` | 调 `settlePlacement` / `settleResize` **结算一次**：push 挤开、trim 吃掉、reject 拒绝（非法则 `cancelTx` 整次手势作废，回到起点） |

理由：策略如果在 pointermove 里生效，trim 会在拖过去的瞬间毁掉邻居——拖回来也回不来。拖动期间允许视觉重叠，但落点会被 reject 拒收时给红框预告（`appState.dragIllegal`），免得「松手弹回去」显得莫名其妙。

- **例外**：`resize` + `reject` 是单边钳制、非破坏性，仍然实时生效（拖不过去）。
- **resize 遵守全部三种策略**（`resizeSpan` 有 `behavior` 参数）。旧约定「缩放永远只做钳制」已作废：用户明确反馈三种策略在缩放时全退化成了拒绝落点。push 左边界往左推、右边界往右推，级联顶到工程两端时退回钳制（缩放不该改动被拖片段自己不动的另一条边）。
- 几何层的入口统一是 `placeSpan(干净 lane, 候选几何片段, duration, behavior)`。**lane 必须是干净的**：拖拽期间被拖片段已经压在邻居身上，把脏 lane 直接丢进策略函数会让 push 的扫掠把锚点自己推走。

**工程时长与素材长度无关**：`Project.duration` 只决定导出帧数范围与时间轴宽度；片段可以把它撑长（`addClip` / `liveMoveClip` / `liveResizeClip` 只增不减），用户也可以直接用工具条上的「时长」改小或用「贴合内容」收回。导入音频只是新片段的默认长度，**不许**被 `duration` 截断。

**跨轨**：`track.clips` 的兼容判据只有一条 `ProjectStore.canHost(track, clip)`（音频片段只进音频轨，画面/特效片段只进视觉轨），拖拽与 Alt+↑↓ 共用，不许各写一套。拖拽期间实时搬家（因此指针监听挂在 `window` 而不是 `setPointerCapture`——元素会在两个 `{#each}` 块之间重建，捕获随之失效）。

**布局约定**：针对时间轴的操作（播放、拍网格、吸附、重叠策略、时长、缩放）一律放在**轨道正上方**的工具条里，不要挪回窗口顶部。

**页面宿主（2026-10-01 补）**：顶栏的选项卡是**页面**级的容器（时间轴页常驻 + 排版编辑页临时）。
`.shell` 之下多了一层 `.content`，它有两列：**左侧是常驻的窄侧栏**（工程级动作、设置、
明暗切换不该随页面消失），右侧的 `.page` 才是页面宿主，用 `display:none` 在
「时间轴主界面」与「排版编辑页」之间切换（**主界面绝不卸载**，ADR-008 第 1 条）。
新增页面级编辑器时照这个形状加：`appState.shellTabs` 里一个判别联合分支 +
`.page` 里一个 `{#if}`。

**例外——工程级动作归窄侧栏**（2026-10-01 调整）：保存、导出这类「对整份工程」的动作放在最左侧的窄图标栏里，与「逐帧/逐拍」的时间轴操作分开。导出的**触发入口**因此从工具条搬进了侧栏的导出面板（`[data-testid=rail-export]` → `[data-testid=export-png]`）；工具条里只剩播放头与拍网格相关的东西。

### 关键帧要锚在拍上

```ts
interface Curve {
  keys: { t: number; v: number; interp: Interp; handles?: [number,number,number,number] }[]
  mode?: 'keyframe' | 'impulse' | 'follower'
  beatAnchor?: { beat: number } | null        // ← 关键
}
```

`beatAnchor` 必须在 `Curve` 结构本身里，不是事后补。改了 BPM 或微调 `offset` 之后，**所有卡点自动跟着走，不用重排**。

angel-echo 和 splitter 都做对了这件事（海报钉在小节号、段落锚在小节号、镜头表在拍网格上循环），这是"克制克点排布"的实现基础。

### 从 angel-echo 搬过来的三个包络原语

保留，作为 `Curve.mode` 的一种源，不是替代品：

```ts
class Impulse { hit(amount); step(dt) }              // 指数衰减冲击
approach(cur, target, halfLife, dt)                  // 帧率无关指数逼近
follower(attack, release)                            // 非对称攻放包络
```

它们天然帧率无关、天然 seek 安全，在"短促冲击"这类场景比关键帧更好写。运镜的缓动用 `approach`，不要用关键帧。

### 从 splitter 搬过来的债要一起修

`AE.SNAP.*.unit`（1 / 0.25 / 0.5 / 0.01）与 `store.js` 的 `snapUnit` 是两套并存且数值不一致的吸附单位，且 `unit` 字段**全仓库从未被读取过**。搬过来之前先统一成一套。

---

## 6. MVP 路线图

原则：**每个里程碑都以"能导出一段片子"为终点**（纵向切片），而不是"某一层写完"（横向分层）。

### M0 · 骨架与时间模型 ✅（2026-09-27 完成）

**为什么先做这个**：`core/` 是全局关键路径，它定死之前写时间轴 UI 等于把返工写进计划。

- [x] `core/schema.ts`：§5 的模型 + `schemaVersion`
- [x] `core/curve.ts`：求值 + `beatAnchor` + 三种 envelope 模式（impulse/follower 为闭式解）
- [x] `core/commands.ts`：事务式撤销栈（`beginTx` / `endTx`，拖拽时 coalesce）
- [x] `engine/kit.ts`：WebGL2 微工具箱（从 angel-echo `js/gl.js` 282 行移植）
- [x] `engine/clock.ts`：`t` 求值 + 种子 PRNG
- [x] 一个能在 Chrome 里打开的最小页面：给定工程 JSON + `t`，画出一帧
- [x] `.gitignore` 含 `.workbuddy/`；`CREDITS.md` 建立

**验收**：同一工程 + 同一 `t`，连续求值 100 次结果逐像素一致。曲线求值有单测。
**实测**：E2E `determinism.spec.ts` 100 次零差异通过（含反馈特效的「同历史状态」语义修正：求值前清反馈历史）。

### M1 · 剪辑闭环 ✅（2026-09-27 完成，一处偏差）

- [x] `timeline/`：Canvas2D 网格 + DOM 片段，拖动 / 吸附到拍 / 切分（双击切分 + 播放头切分）
- [ ] `audio/`：离线 FFT + BPM 估计 + 拍网格（含 `offset` 与下拍偏移）
  - **偏差（用户拍板）**：MVP 只做手动 BPM + offset 拍网格；自动估计推到后续里程碑。已落地：导入音频 + min/max 波形 + 播放与工程时间同步。
- [x] 多轨、增删轨、同轨不重叠约束（重叠策略为可配置项，见 §5）
- [x] `exporters/`：`FrameSink` 接口 + `png-sequence` 后端（第一天就做，逃生舱）

**验收**：导入一首曲子 → 自动出拍网格 → 摆出"底图 + 局部故障 + 全屏调色"三层 → 导出 5 秒 PNG 序列，与预览逐帧差在噪声级。
**实测**：拍网格为手动（见偏差）；demo 工程四层齐备；5 秒 150 帧 1080p 导出 6.0s，导出帧 vs 预览帧 mean diff ≈ 1.6e-6（E2E `export.spec.ts` + 验收探针）。

### M2 · 算法艺术 ✅（2026-09-27 完成，生成器数量收敛为 3 个代表）

- [x] `algos/registry.ts`：注册表 + 参数定义（与特效共用类型系统）
- [x] bake 型：Rule 30/90/110（select 切换，Worker 烘焙 sheet 纹理）
- [x] sim 型：生命游戏（固定步长 + 每 16 步快照 + seek 重放，单测钉死 seek≡顺序推进）
- [ ] bake 型其余：Langton 蚂蚁、L-system（后续补，模式已立）
- [x] realtime 型：Mandelbrot（逐帧实时，参数关键帧打通）
- [ ] realtime 型其余：Burning Ship、Menger 海绵（后续补）
- [x] 烘焙跑在 Worker；`R8` 纹理；二值纹理 `NEAREST` 过滤；`LIVE = 255` 常量（angel-echo 血泪注释已移植）
- [x] 参数 → 关键帧打通（烘焙入参不可打关键帧，防每帧重烘）

> 搬 `automata.js` 时注意：`elementary()` / `gameOfLife()` 早年把活细胞写成 `1` 而不是 `255`，进 R8 纹理后被归一化成 0.0039，所有阈值把它抹成 0。源码里现在只有一个 `LIVE` 常量——**移植时保留这个常量，不要写裸 `1`**。

### M3 · 故障特效 ◐（2026-09-27 部分完成，协议与骨架就位）

- [x] 移植 openmosh 的 `EffectShaderDef` 协议（精简版；`feedback` 第一天打通，`hdrFeedback` 留协议字段）
- [x] 特效 ×5 覆盖四类：channel-split（参数）、slices（seeded）、pixelate（几何）、echo（ping-pong 反馈）、scanlines（调色）
- [ ] 特效 ×12 全词汇（后续按「两个文件」纪律逐个加）
- [x] 合成模式 8 种（normal / multiply / add / screen / overlay / difference / exclusion / subtract，CPU 参考实现钉死）
- [ ] 摄像机 / 画幅做成 `EffectClip`（参数化，不是枚举具名动作）
- [ ] `gl-transitions` 接进来
- [ ] 特效试炼场（照抄 openmosh 的 `lab/`）

**验收**：能在一个片段的参数上实时拖动并看到画面变化，UI 不掉帧。
**实测**：检查器滑杆实时拖动 + 关键帧打点（可锚拍）可用；「新增特效 = 两个文件」由 `effects/registry.ts` 的 glob 配对强制执行，缺一半启动报错。

> **新增一个特效 = 两个文件**（定义 + GLSL）。这是 openmosh 的官方纪律，当作硬指标。摩擦成本决定了这个工具三年后还有没有生命力。

> **警告**：angel-echo 里没有"分形靠 10 帧跳帧"这回事——分形是逐帧实时算的，全仓库唯一的 `stride` 是频谱图**行**降采样。带着错误预设做帧缓存会破坏确定性。真正的性能手段是：内部半分辨率 + nearest 放大、90 帧均值超 30ms 自动降档、粒子预算随档位缩放 `[1, 0.55, 0.3]`、渲染目标尺寸不变则复用。

> **新增一个特效 = 两个文件**（定义 + GLSL）。这是 openmosh 的官方纪律，当作硬指标。摩擦成本决定了这个工具三年后还有没有生命力。

> **警告**：angel-echo 里没有"分形靠 10 帧跳帧"这回事——分形是逐帧实时算的，全仓库唯一的 `stride` 是频谱图**行**降采样。带着错误预设做帧缓存会破坏确定性。真正的性能手段是：内部半分辨率 + nearest 放大、90 帧均值超 30ms 自动降档、粒子预算随档位缩放 `[1, 0.55, 0.3]`、渲染目标尺寸不变则复用。

### M4 · 排版 ✅（2026-10-01 完成）

**编辑器形态**：一个独立的**顶栏选项卡页**，UI 参考 PowerPoint 的 Ribbon（数据驱动的
Tab / 分组 / 按钮，含 Contextual Tab 与横向滚动）。原文「只做静态版式 + 关键帧变换」
被升级为「静态版式 + CSS 动画 + 可编排变换」，「逐字动画」仍然明确不做。

| 原计划项 | 处置 |
|---|---|
| `typography/` 模型 + 独立编辑器 | **完成 + 升级**（Ribbon 范式；见 ADR-008） |
| `TextRasterizer` + `dom-snap`（ADR-003 四条规则） | **完成**，①②③④ 全部落地（ADR-003 落地状态） |
| `png-import` 后端（一等公民） | **改写**：不做独立后端，由 `image` 源 + 「转为图片」动作覆盖 |
| 字体子集化流程 | **完成**（HarfBuzz WASM，见 ADR-010） |
| 中文禁则 + 中西文自动间距 | **推迟**：`TextStyle.textAutospace` 已留字段，等 CSS `text-autospace` 普及 |
| 字形按需光栅化 + LRU | **改写**：字形级交给 HarfBuzz 子集 + 浏览器；本项目做**位图级 LRU**（ADR-009） |

**验收（实测 2026-10-01）**：
- 导出与预览的一致性是**结构证明**的：舞台与光栅化共用同一个 `buildDocDom` 与同一份
  `css.ts` 声明表，物理上不可能不同步；「光栅预览」开关是用来**验证**这一点的。
- 子集化把 9.5 MB 中文字体裁到 6.4 KB（0.067%），**子集 vs 全量逐像素零差异**（E2E 对照组）。
- 单帧光栅化：900×200 下 10 ms、**1920×1080 下 16.2 ms**（稳态中位数）。原计划写的
  「< 2 ms」是只算 snapDOM 捕获的数字，整条链路达不到也不必要 —— 静态文档只付一次。

**明确不做**：OpenType 高级特性（small-caps / 旧式数字）、TeX 级断行、逐字动画。

**字体许可**：内置的只有 OFL 的 Inter；中文字体由用户自备（系统字体通常不允许再分发）。
见 CREDITS.md。

### M5 · Electron 壳与工程文件

- [ ] 工程目录格式（`project.json` + `assets.json` + `analysis/` + `thumbs/`）
- [ ] **原子写**：`project.json.tmp` → `fsync` → `rename`；保留 `.bak`
- [ ] `schemaVersion` + 迁移函数表（第一天就有，不要事后打补丁）
- [ ] **素材用引用而非拷贝**：绝对路径 + 内容哈希；路径失效提示重定位，哈希不符提示文件被改
- [ ] preload + 类型化 IPC；大块数据走 SAB
- [ ] ffmpeg 打包（`asarUnpack`）+ `ffmpeg-pipe` 后端 + NVENC
- [ ] 音频解码 → 离线 FFT → 喂给依赖音频的参数

**验收**：保存 / 重开工程内容一致；素材改路径后能重定位；导出 5 秒 1080p MP4，音画同步。

### M6 · 打包与打磨（MVP 之后）

稳定 Electron 版本、错误处理、进度条与可取消、长时导出稳定性、性能档位 UI。

---

## 7. 开发与测试

```bash
# 开发（纯浏览器，不需要 Electron）
npm run dev                 # Vite dev server
npm run test                # vitest，只测纯逻辑（配置里限死 tests/unit，不收 e2e）
npm run test:e2e            # scripts/e2e.mjs：自 build + 自起 preview + Playwright（系统 Chrome）
npm run build               # 生产构建
npm run electron            # 起 Electron 壳（M5 才有）
npm run dist                # electron-builder 打包（M5 才有）
```

> `test:e2e` 不走 playwright 的 `webServer` 配置：它经 shell spawn 长驻进程，在部分沙箱里整个进程树会收到 SIGTERM（runner 零输出暴毙）。`scripts/e2e.mjs` 全部用 `process.execPath` 直接 spawn node 绕开。
> Playwright 浏览器下载慢/不稳时，装依赖用 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`（我们用系统 Chrome，`channel: 'chrome'`）。

### 测试约定

- **单测只测纯函数**：曲线求值、时间换算、命令栈、schema 迁移、颜色/合成数学。不测 DOM、不测 WebGL。
- **E2E 走 Playwright + 系统 Chrome/Edge**（`channel: 'chrome'`），不需要 `playwright install`。E2E 服务器要正确返回 `.mjs` 的 `text/javascript` MIME，否则 ESM import 会被拦掉。
- **选择器一律优先 `data-testid`**，不要绑 CSS 类名。所有自研控件都暴露了稳定 testid
  （`param-row` / `param-label` / `param-slider` / `param-number` / `select` / `menu-item-*` /
  `track-side-row` / `tl-row` / `tl-scroll` / `ctx-menu` …）。迁移前那批「绑 `.kf`、`.lbl`、
  `input[type=range]`、`button[title=删除]`」的断言在换控件时全碎了一次，不值得再来一遍。
  - 约定：`NumberInput` 的 `testid` 落在**内部 `<input>`** 上（保住 `fill()` / `inputValue()`），
    拖拽热区的 testid 是 `testid + '-wrap'`。
- **E2E 选择器两条坑**：
  1. ~~检查器的 `.kf > .row` 与时间轴的 `.row` 同名~~ —— 已由 `Field` 组件消除（参数行不再用 `.row`）。选轨道行仍写 `[data-testid=tl-row]`。
  2. 轨道行数多时轨道区会出纵向滚动条，用 `boundingBox()` 拿到的行可能落在视口外（鼠标事件会被钳到视口边界，`elementFromPoint` 返回 `html`）。要么把 `viewport` 开高，要么先 `scrollTop = scrollHeight` 再量。

### ⚠️ 界面实时性（2026-10-01 一轮 bug 后立，条条都真咬过）

**这是本项目最容易反复踩的一类 bug，而且测试抓不到。** 症状统一是「store 改了、
界面没改，退出重进才更新」，控制台一片安静、不抛任何错。一次用户验收报了 5 个
bug，其中 4 个是同一个根因。

**根因一：Svelte 5 的 `$derived` / `{#each}` 靠 `===` 判断传播。**

元素是**原地改**的普通对象（`clip.frame.x = ...`），引用不变 ⇒ 派生重跑了但
「值没变」⇒ 依赖它的模板 effect 静默断更。

- **规则：模板里凡是读嵌套对象字段的地方，来源派生必须换引用。**
  写法是 `$derived.by(() => { void appState.version; return xs.map(e => ({...e, ...e.frame})); })`
  —— `map` / `filter` / 显式字面量都会产生新引用，`return xs` 不会。
- **典型反例**：`LayersPanel` 的 `items` 直接 `return editorState.elements`
  （同一个数组、同一批对象）⇒ 点眼睛图标，图标不变。
  修法是 `return editorState.elements.map(e => ({...e}))`。
- 这条在 §8 记过三次同族事故（轨道列表、片段位置、检查器），现在升级为**硬规则**。

**根因二：改了文档，但没改 DOM。**

排版编辑器里文档是数据、舞台是 DOM，中间靠 `syncDocDom()` 同步。它踩过两次：

1. **传错根节点。** `syncDocDom(host, ...)` 里曾经传的是 `.paper`（外层容器），
   而函数只看**直接子节点**里带 `data-el-id` 的 —— 外层容器的唯一子节点是
   `.typo-doc`（不带该属性），于是循环全部 `continue`。表现是「拖了半天画面
   纹丝不动」，**不报任何错**。修法是让 `syncDocDom` 自己往下找一层
   （`DOC_ROOT_ATTR`），把这类传参错误从「静默失效」变成「不可能发生」。
2. **容器与选择层的坐标系不一致。** `SelectionLayer` 的把手坐标按文档原点算，
   却挂在 `.paper-wrap` 外面 ⇒ 整体偏移、把手点不中（拖拽变成框选）。
   `toBeVisible()` 抓不到 —— 它只要求元素在 DOM 里有尺寸。

**配套的测试纪律（比上面两条更重要）**：

> **E2E 只负责「操作」，不看「UI 表现」—— 所以上面这一整类 bug 它一条都抓不到。**
> 断言 store 是必要的，但**不等于验证了功能**：文档改了 ≠ 用户看得见。

- **凡是用户能看见的状态，就断言 DOM**：内联样式、`getBoundingClientRect()`、
  子节点类型/顺序、`innerHTML`（图标是否换了）。
  `tests/e2e/typography-ribbon.spec.ts` 里那几条「实时跟随」用例就是模板。
- **图标切换必须真的换图标**，不要只改颜色 —— 只改颜色的话 DOM 里什么都看不出来，
  测试没法断言，用户也容易漏看。锁用了 `lock` / `lock-open` 而不是同一图标变色。
- **手写一次「传错父节点」式的防御**：能让错误不可能发生，就别指望调用方记得传对。

### ⚠️ CSS 命名空间：组件类名会被全局样式命中（2026-10-02 立）

`src/app.css` 与 `src/ui/controls/controls.css` 是**全局**样式表（`main.ts` 直接 import）。
Svelte 组件的 `<style>` 是 scoped 的，组件规则不会外泄 —— **但反过来成立：
组件里用的类名会被全局规则命中。**

真事：排版画布的选中框用了 `class="sel"`，而 `controls.css` 里 `.sel` 是 Select 控件的
类名（`background: var(--input-bg)` + 1px 边框）。scoped 规则只声明了 `outline`，
背景没被覆盖 → **选中框变成一个不透明白块，把图形整个盖住**。
同样的问题还有 `.swatch`（Ribbon 色块 ↔ 全局 swatch）。

- **规则：跨组件的复用类名加前缀**（`.typo-sel` / `.rcolor-swatch`），
  别用 `sel` / `swatch` / `box` / `row` / `item` 这种通用词。
- 全局类名清单（供参考）：`btn ic-btn field cbx cbx-box sel sel-pop sel-opt sel-label
  sel-arrow menu menu-item menu-sep menu-head pop pop-row pop-title pop-sep sld sld-track
  sld-fill sld-thumb num num-suffix swatch swatch-row tip tip-key kbd`。
- **有守卫**：`tests/unit/css-namespace.test.ts` 会解析这两张全局表，再扫
  `src/ui/typography` + `src/ui/ribbon` 里所有 `.svelte` 的 `class=` / `class:xxx`，
  撞车即失败。加新组件时会自动被覆盖。
- 这类 bug 只在「那个元素正好被选中」时才出现，控制台没有任何提示 —— 所以必须靠守卫。

### 几何：旋转出来的框与旋转下的手势

- **选中框必须带上 `rot`**。单个元素绕自身中心旋转时 `x/y/w/h` **一点没变**（只有 `rot` 变），
  所以用未旋转 AABB 画框会纹丝不动，看起来像「只有图形在转，框没跟上」。
  单选 → 用元素自己的框（含 rot）；多选 → 用整个选区的 AABB（那一堆角度没有统一说法）。
- **旋转后的缩放要走 `resizeFramesRotated`**，不能直接用 `scaleFrames`：后者是轴对齐的，
  把位移当作世界坐标轴的 dx/dy。元素转了角度之后，把手在屏幕上指的方向不再是世界轴，
  直接喂世界位移会得到「拖右边却往斜上方长」。
  做法是把位移反向旋转进本地坐标、缩放、再把本地中心正向旋转回世界。
  `rot === 0` 时它与 `scaleFrames` 逐位等价（有单测钉着）。
- 写了这类手势的 E2E 时注意：**细长元素转 90° 后把手会跑到视口外**（默认文本框是
  1536×173，转 90° 后「右边把手」在中心下方 469px）。要测旋转下的缩放就用正方形元素。
  旋转本身的断言也别用「外接矩形变大」—— 细长条转 90° 后外接矩形反而变窄，
  直接看 `getComputedStyle(el).transform` 矩阵的非对角项。

### 排版编辑器（M4）

**入口**：双击排版片段，或检查器的「编辑排版」按钮。快捷键见 `shortcuts.ts` 的
「排版编辑器」组；`S` 与 `Alt+↑↓` 在那边**故意失效**（分流机制见 ADR-008）。

**测试注意**：
- 「开始」Tab 有 6 组 30 多个项，在 **1280 宽下会横向溢出**（面板是横向滚动的）——
  这是设计如此。测对齐/属性时先把视口开宽
  （`page.setViewportSize({width:1920,height:900})`），否则你测的是滚动不是功能。
- 窄窗口单独有一条用例：断言面板**只有横向滚动、没有纵向滚动**（面板高度一旦随
  内容变化，舞台高度就会随窗口宽度抖动），且滚到最右后最后一组的按钮仍然可点。
- **曾经做过「更多」溢出 popover 的版本，拆掉了**：面板为了固定高度必须裁剪，
  而任何开在面板内部的弹层都会被这个裁剪吃掉 —— 用户反馈「更多按钮没有用」。
  隐藏起来的按钮也等于功能消失。Office 同样是横向滚动条。
- **图库（gallery）类控件也一并拆了**：7 个形状排成一列塞在 114px 高的面板里
  就是「离谱的列表挤在一个极小的区域」。形状与动画预设现在都是下拉。
- **`SelectionLayer` 必须挂在 `.paper-wrap` 里面**。它的把手坐标按文档原点算，
  挂到 `.viewport` 上会以 viewport 左上角为基准，而 paper 是水平居中且带边距的 ——
  结果是选择框整体偏移、把手完全点不中（拖拽会变成框选）。
  `toBeVisible()` 抓不到这个，所以另有一条**位置断言**（比对 `boundingBox()` 与
  元素真实屏幕矩形）。改动那段 DOM 结构时它会挡住你。
- **⚠️ 已知 flaky（2026-10-01 实测确认，非本次改动引入）**：`determinism.spec.ts`、
  `algos.spec.ts`、`effects.spec.ts` 里凡是断言「同一 t 多次求值逐像素一致」的用例，
  **约 60–75% 的失败率**，且**与代码版本无关**——用 `git worktree` 检出改动前的提交
  实测同样失败（基线 8 次：通过 3 失败 5；当前 8 次：通过 2 失败 6，统计上无差别）。
  症状固定：**个别 1–2 个像素**（如 (279,17) 由 `[47,58,72]` 变 `[109,156,182]`），
  差值量级 ~110，与预览尺寸无关（同尺寸下 HEAD 布局也不复现）。怀疑是 demo 特效栈
  （`echo` 反馈 + `glitch`）在 GPU 侧的边界采样竞态，未定位到确切层。
  **排查时注意**：用探针包一层 `renderer.kit.size` / `syncSize` 会让它「变得通过」——
  时序敏感，别被这个假象骗到。
  ```bash
  # 复现（跑 8 次看通过率）
  for i in $(seq 1 8); do node scripts/e2e.mjs determinism; done
  ```

### 前端实现坑（2026-10-01 UI 改版实测，条条都真咬过）

1. **别把变量命名成 `state`。** `let state = $state(initial())` 会让 svelte2tsx 把 `$state`
   当成「订阅名为 `state` 的 store」，报 `Block-scoped variable '$state' used before its
   declaration` + `Cannot use 'state' as a store`。改叫 `menu` / `panel` 之类即可。同理避开
   `$props` / `$derived` / `$effect` 这几个名字。
2. **`use:` action 的 `destroy` 与 `pointerleave` 都可能跑在卸载流程里。** 组件被移除时
   浏览器会**被动触发** `pointerleave`，那一刻仍在 Svelte 的 flush 内，同步写 rune 会抛
   `state_unsafe_mutation`（实测「关掉检查器抽屉」必现）。tooltip 的 `clear()` 因此把状态
   写入挪进了 `queueMicrotask`，并用代际号防止迟到的 clear 抹掉新 hint。
3. **grid 子项要显式约束列。** `.stage { grid-template-rows: ... }` 的**隐式列默认是 `auto`**，
   会被子项的**最小内容宽度**撑开：工具条里几乎全是 `flex-shrink: 0` 的控件，实测在 1280 宽
   窗口下把这一列撑到 1058px 而父格只有 936px——preview / toolbar / tracks 一起溢出到右侧
   抽屉底下，还会把预览宿主撑成一个不受网格约束的尺寸。修法是 `grid-template-columns:
   minmax(0, 1fr)`（必要时再让工具条 `flex-wrap: wrap`）。
4. **自研控件必须带 `data-exempt`。** 全局快捷键（Space / Delete / Ctrl+Z…）原来只对
   `INPUT/SELECT/TEXTAREA` 放行，而自研下拉、滑杆、数字框都不是原生元素——在它们上面按
   Space 会「打开下拉 + 开始播放」同时发生。判据统一在 `ui/focus.ts` 的 `isExempt()`；
   另外 `ownsSpaceKey()` 处理「聚焦在 `<button>` 上时 Space 会激活按钮」的二重触发。
5. **`NumberInput` 键入的值不要做 step 量化。** 时长 `min=0.1 step=0.5` 时，键入 30 会被
   吸附成 30.1（30 不在 `0.1 + k*0.5` 网格上）。`commitValue(raw, cfg, { quantize: false })`
   用于键入，量化只留给拖动/方向键。
6. **`rm` 掉组件再新建同名文件，Vite dev server 会继续提供旧模块。** 实测：删掉
   `Rail.svelte` 重写后，页面拿到的仍是旧版本（`curl http://localhost:5173/src/ui/Rail.svelte`
   里搜不到新字符串），HMR 日志也不报错，表现为「改了半天界面纹丝不动」。
   验证方法就是 curl 那个 URL 搜新代码里的字符串。**修法是重启 dev server**
   （必要时连 `node_modules/.vite` 一起删）。正常编辑不会这样，只有删+建同路径才会。

### 视觉与交互约定（2026-10-01 补充）

- **菜单不要无谓地加层级。** 一级平铺能放下的就平铺（`+ 纯色片段` / `+ 特效片段` /
  `+ 算法片段`），只有**会变长**的列表（算法生成器）才收进子菜单。曾经把三个都塞进
  「添加片段」二级，反而多一次悬停才点得到。
- **窄侧栏的四个入口用全屏 modal，不是 flyout。** flyout 只有两百多像素宽，快捷键清单
  或导出信息塞进去就成了带滚动条的小盒子。
- **工具条的 tooltip 朝上**（`tipPlacement="top"`）：工具条紧贴轨道区，下方没空间。
  另外 `tip.ts` 在 `pointerdown` 时会收起气泡——否则点开的下拉会被悬停气泡挡住第一项。
- **UI 文本一律 `user-select: none`**（`app.css` 在 `html,body` 上设，输入类元素单独放行）。
- **drag-to-tweak 撞到视口边缘时上 Pointer Lock。** 检查器在屏幕右侧，往右拖几下鼠标就撞到
  窗口边缘、位移不再增加，值卡住。达芬奇那类工具靠光标回绕解决，浏览器里做不到（拿不到
  屏幕外的位移），但 Pointer Lock 等价：光标隐藏后 `movementX` 不受屏幕边界约束。
  只在 `clientX` 贴边（3px 内）时才启用，所以普通拖动的手感完全不变；
  锁定被解除（Esc / 失焦）＝取消这次拖动，与 Esc 的语义一致。
- **音频片段的底色必须半透明。** 波形画在 `canvas.grid` 上，而那张画布在片段 DOM **下面**；
  填充不透明就会把波形整个盖住，看起来是纯色块——只有片段自己变半透明时才「忽然」露出来
  （拖动被拒的 0.7、轨道静音的 0.5），用户就是这么报的。

### 品牌资源（brand/）

六个文件，三组形状 × 亮暗两版，`Brand.svelte` 按 `variant` + 当前主题取用：

| 形状 | 文件 | viewBox | 用在哪 |
|---|---|---|---|
| 2×2 标记 | `artmatic-small-{light,dark}.svg` | 143×163 | 侧栏（<44px） |
| 3×3 标记 | `artmatic-main-{light,dark}.svg` | 1280×1251 | 「关于」里的大图（≥44px） |
| 字标 | `artmatic-fonttype-{light,dark}.svg` | 1218×260 | 顶栏 |

`switchMode` 的判据只有一个：`Brand.svelte` 按 `theme.mode` 选文件，`size >= largeFrom` 决定
标记用大版还是小版（20px 的位子放 3×3 会糊成一团）。加新变体就照着改 `SOURCES` 那张表。

> ⚠️ **文件名说的是「墨色」，不是「目标模式」**——这里极容易搞反：
> `-dark` 里的墨是 `rgb(47,47,47)` 深灰，配**亮背景**（亮色主题）；
> `-light` 里的墨是 `rgb(248,248,248)` 近白，配**暗背景**（暗色主题）。
> 也就是 `mode === 'light'` 取 `-dark` 文件，反之亦然。
> 搞反的后果不是「颜色不太对」而是 **logo 整块隐形**（只剩那点紫色），肉眼验收很容易放过，
> 所以有 `tests/e2e/brand.spec.ts` 钉着（查墨色取值 + 与底色的对比度）。

`Brand.svelte` 内联而不是 `<img src>`（`<img>` 是独立文档，页面 CSS 进不去），
并把资源里写死的品牌紫 `rgb(111,100,239)` 换成 `var(--accent)`，好跟着可换主题色走；
**墨色保持资源原值**——那正是成对导出的意义。

favicon 同样成对（`public/brand/`），用 `media="(prefers-color-scheme: …)"` 让浏览器自己挑。

- **手势类断言必须走 `page.mouse`**，不要直接调 store：策略结算时序、跨轨、右键菜单这些问题全在手势层，直接调 store 会把它们整个绕过去。
- **确定性测试是对本项目最有价值的一类测试**：
  - 同一工程 + 同一 `t` → 逐像素一致
  - 导出帧 vs 预览帧 → 差异在噪声级
  - 帧间变化量审计（参考 angel-echo `flicker.py`：平滑段落 0.005–0.02，硬切单帧 0.15–0.40，持续 >0.15 就是在频闪）
- **分层回归**（沿用 WTP 的策略，不要盲目全量）：
  | 级别 | 改动 | 跑什么 |
  |---|---|---|
  | A | core / engine / 共享类型 | 全量 E2E |
  | B | 单个 tab / 单个特效 | 该模块 E2E + 单测 |
  | C | 数据 / 文档 / 常量 | engine 单测 + JSON 校验 |

---

## 8. 未决问题

1. ~~**UI 框架**~~（2026-09-27 已决）：**Svelte 5 runes**。时间轴本体 Canvas2D 自绘，框架只管面板。落地时注意：Svelte 5 的 `$derived` 靠 `===` 判断传播，store 原地改的对象必须「订阅 version + 派生返回新引用」，否则静默断更（MVP 实测踩过三次：轨道列表、片段位置、**检查器**）。第三次的形态最阴：`found = $derived(() => ({ track, clip }))` 外层包装是新对象，但 `{@const clip = found.clip}` 编译成 `$.derived(() => found.clip)`，**内层 clip 引用没变 → 整块模板 effect 不再重跑**，表现是「加/删特效链只改 store、右侧面板纹丝不动，重选片段才刷新」。判据：**模板里凡是 `{@const}` 取的嵌套对象，来源派生就必须让它换引用**（Inspector 现在是浅拷 track + 深拷 clip）。
2. **`texElementImage2D` 的正确签名**：本机 Chromium 154 上试过的 12 种组合全失败。值得读 `github.com/WICG/html-in-canvas` 当前规范，或在 Chrome Canary 上再试。若通了，排版后端可以直接换掉。
3. **`texElementSubImage2D` 是否可用于"只更新变化的子区域"**：存在但未验证。如果可用，配合 `paint` 事件的 `changedElements` 可以做增量上传。
4. **长时导出稳定性**：数千帧连续截图的显存与缓存行为未测。
5. **遮罩 / matte**：M4 之后是否要做，取决于实际用起来缺不缺。
6. **ffmpeg 构建选择**：需确认所选的静态构建带 `nvenc`（`ffmpeg -encoders | findstr nvenc`）。
7. **不可子集化的字体（woff2）+ 动画文档的逐帧成本**：HarfBuzz 只吃 SFNT，woff2 只能整体内联。
   woff2 通常只有 TTF 的 30–50%，所以还不是「129 ms/帧」那个量级，但也没测过。真要遇上，
   对策是引导用户换 TTF/OTF，或者用「转为图片」把它冻成静态资源。
8. **`SourceManager.setImage` 与 algo 的 R8 上传是否需要 `UNPACK_FLIP_Y_WEBGL`**：
   排版纹理已经确认需要（否则上下颠倒），这两条路径当时没测过方向。
   `setImage` 目前零调用方，R8 只测过确定性 —— 真要用它们之前先补一条方向断言。

---

## 9. 参考代码地图

三个只读参考目录，各自的定位：

| 目录 | 拿什么 | 不要拿什么 |
|---|---|---|
| `angel-echo` | `js/gl.js`（WebGL2 微工具箱）、`js/automata.js`（7 类数学生成器）、`js/post.js`（回声→故障→调色三连）、`js/analysis.js`（Timeline 查询）、`js/util.js`（三个包络原语）、`tools/analyze_audio.py` 的算法 | `plan.js` / `direction.js` / `app.js` 里的硬编码内容表（那是**一部片**的编排，不是引擎） |
| `openmosh` | 声明式特效协议、66 个 GLSL、ping-pong + hdrFeedback 渲染器、`timeline/clips.ts` 泛型片段几何、`gl/preview-size.ts`、`audio/offline-audio.ts`、`video/decode.ts`、`encode-pool/`、约 40 个 UI 原子件、`lab/` 试炼场模式 | 轨道模型（按类型分轨 + 数量上限，与我们的统一模型相反）、WebM-only 导出、零 IPC 的壳、IndexedDB 存工程 |
| `angel-echo-splitter` | `store.js` 的时间换算与拍吸附、`timeline.js` 的 canvas 网格绘制与拖拽、四档吸附语义 | localStorage 持久化、单轨模型（`assignLanes` 只是重叠时自动分道，不是真多轨）、两套并存的吸附单位 |

各参考项目的**可复用内核边界**是天然存在的：angel-echo 的 `SCENES` / `SECTIONS` / `LOOKS` 都是纯数据表，最容易被抽成配置；openmosh 的 `EffectDefinition` ↔ `EffectShaderDef` 是全套系统最优雅的部分。

---

## 10. 协作约定

- **改架构 / 数据模型 / 构建方式 → 先更新本文件。**
- 多个 Agent 可能并行操作本项目。`core/` 的接口变更是高冲突操作，动手前在 commit message 里写清楚。
- 提交信息用中文，格式：`模块: 做了什么`。例：`core: Curve 增加 beatAnchor 与三种 envelope 模式`
- **不要把 `.workbuddy/` 的路径写进任何项目文件**（本文件、README、代码注释都不行）。项目开发和规范不该绑定某一个开发者的某一个软件。
- **优先留注释解释"为什么"**。angel-echo 的七个坑都以注释形式留在代码里，那是它最有价值的部分。踩到坑就写下来。
