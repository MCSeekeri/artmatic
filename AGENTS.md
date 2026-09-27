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

**同轨不重叠**，需要叠就加轨道。拖动策略（2026-09-27 用户拍板）：**可配置项** `overlapBehavior: 'push' | 'reject' | 'trim'`（挤开邻居 / 拒绝落点 / 吃掉邻居重叠部分），默认 `'reject'`。注意 reject 的语义是「落点非法就整次不动」（落点碰撞检测），**不是** openmosh `moveClip` 的「钳在当前空档里」——后者永远拖不过邻居，与本工具的 NLE 直觉不符。缩放（resize）永远只做钳制，不触发 push/trim 级联。

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

### M4 · 排版

- [ ] `typography/`：`TypographyDocument` 模型 + 独立编辑器（**只做静态版式 + 关键帧变换**，不做逐字动画）
- [ ] `TextRasterizer` 接口 + `dom-snap` 后端（ADR-003 的四条规则）
- [ ] `png-import` 后端（一等公民，第一天就有）
- [ ] 字体子集化流程：字形集收集 → 按哈希缓存 → 输出子集字体
- [ ] 中文禁则规则表 + 中西文自动间距
- [ ] 字形按需光栅化 + LRU 缓存（缓存键含字号）

**验收**：中英混排标题在 1920×1080 下，导出与预览逐像素一致；子集化后单帧光栅化 < 2 ms。

**明确不做**：OpenType 高级特性（small-caps / 旧式数字）、TeX 级断行、逐字动画。
**字体许可要提前定**：子集化属于修改，系统字体通常不允许随软件分发。正式产品用 OFL 字体（思源黑体 / Noto Sans CJK）或做成用户自备。

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
npm run test                # vitest，只测纯逻辑
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

1. ~~**UI 框架**~~（2026-09-27 已决）：**Svelte 5 runes**。时间轴本体 Canvas2D 自绘，框架只管面板。落地时注意：Svelte 5 的 `$derived` 靠 `===` 判断传播，store 原地改的对象必须「订阅 version + 派生返回新引用」，否则静默断更（MVP 实测踩过两次：轨道列表、片段位置）。
2. **`texElementImage2D` 的正确签名**：本机 Chromium 154 上试过的 12 种组合全失败。值得读 `github.com/WICG/html-in-canvas` 当前规范，或在 Chrome Canary 上再试。若通了，排版后端可以直接换掉。
3. **`texElementSubImage2D` 是否可用于"只更新变化的子区域"**：存在但未验证。如果可用，配合 `paint` 事件的 `changedElements` 可以做增量上传。
4. **长时导出稳定性**：数千帧连续截图的显存与缓存行为未测。
5. **遮罩 / matte**：M4 之后是否要做，取决于实际用起来缺不缺。
6. **ffmpeg 构建选择**：需确认所选的静态构建带 `nvenc`（`ffmpeg -encoders | findstr nvenc`）。

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
