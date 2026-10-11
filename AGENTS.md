# AGENTS.md

跨 Agent 协作备忘录。**改架构、数据模型、构建方式或测试约定之前，先更新本文件。**

> 本文件每次任务都进模型上下文。**只写「动手前必须知道」的东西**：约束、不变量、
> 架构坐标、会再咬人的坑。已解决问题的来龙去脉、被推翻的方案、开发过程一律不写 ——
> 那些在 `git log` 与代码注释里。

---

## 0. 这是什么

**Artmatic** —— 面向算法艺术与故障艺术的 Web 原生时间轴工具。存在的理由只有一条：
**把算法艺术与故障艺术按音乐结构编排起来，这件事没有替代品。**

| 必须自己做 | 交给别人做 |
|---|---|
| 算法艺术片段（生成器注册表 + 关键帧） | 调色 → 达芬奇 |
| 故障艺术特效链（实时可调） | 动态排版 → Cavalry |
| 按拍吸附的统一时间轴 | 精细图形 → Affinity |
| 确定性逐帧导出 | 3D / 粒子仿真 → 单独做素材导进来 |
| 排版**编排**（片段化、关键帧、合成） | 排版**编辑器的极致体验** → 不做 |

**判据**：一个功能若已有稳定工作流且做得比我们好，就不要自己做，改为**提供高质量的输出与导入**。

---

## 1. 硬约束（不可协商）

违反其中任何一条，架构就已经坏了，且通常要到很晚才发现。

### 1.1 时间只有一个来源

- **唯一时钟是 `t`**（帧号 / fps）。任何渲染函数都不得读 `Date.now()` / `performance.now()`。
- 预览用 rAF 驱动，导出用紧循环驱动，**两者走同一条求值路径**，差别只在分辨率。
- **禁止用 rAF 驱动导出。** 导出是 `for (i = 0; i < totalFrames; i++)`，只受编码器背压约束。

### 1.2 随机必须带种子

一律走 `core/prng.ts`：`withSeededRandom(seed, fn)`（JS 侧）/ `frameSeed()`；GLSL 侧用 `u_seed`。
禁止裸 `Math.random()`。预览与导出必须是同一次随机。

### 1.3 有状态模拟必须确定

反应扩散 / Physarum / 真实 boids 这类**有状态**算法：固定步长推进（与渲染帧率解耦）、
每隔 N 帧写状态快照、seek 时从最近快照重放。`algos/game-of-life.ts` 是现有实现，
注释里承诺 `seek(f) ≡ 从 0 顺序 step f 次`。

**帧记账与句柄状态是两件事，跳帧后必须对齐。** `AlgoRuntime` 用 `entry.frame` 记
「句柄在哪一帧」，并在 `show === entry.frame` 时**跳过 seek** 复用句柄状态 —— 这条
优化的前提是两者一致，而 `Renderer.onSeek()`（跳帧 / 清反馈）之后它**不保证**成立；
表现是「同一 t 连渲两次得到两张不同的画面」（不报错、只在回溯时才看得出）。
所以 `onSeek()` 经 `Renderer.setSeekExtra` 钩子调 `alignSims()` 强制对齐一次
（幂等，同帧时零代价）。**任何新增的 seek 路径都不许绕过 `Renderer.onSeek()`**。

**「同一 t 两渲逐字节相同」在 GPU 上不是免费的**（2026-10-10 排查）。两只已知的鬼：

1. **非整数倍缩放采样**：源尺寸 → 帧尺寸不是整数比时（生命游戏 64×64 → 558×314、
   lab 的 853×480 → 640×360），同一帧会在**启动窗口内**出现两个稳定态；
   而 2× 精确缩放稳定。差异极小（单通道差 ≤5、几百个像素）且预热几十帧后消失，
   **视觉不可见**。实测已排除 sim 状态、uniform 派发、反馈残留（完整状态哈希逐字节
   相同）、`NEAREST` 采样。细节见 `engine/compositor.ts::placeLayer` 的注释。
2. **大参数 sin**：`fract(sin(x) * 43758.5453)` 家族（`HASH_GLSL` / `HASH_PLAIN_GLSL`）
   在自变量上百之后低位不稳 —— `slices` 的位移图案会在帧间跳，**用户能看见闪烁**
   （已改用无 sin 的 `HASH_FAST_GLSL`）。**新增 hash 优先用 `HASH_FAST_GLSL`**；
   要用 `sin` 就先做相位归约（`scanlines` 那处的写法）。

两只都会把「同帧两渲逐像素相等」的断言打成**偶发**失败（`lab.spec.ts` / `algo-pattern.spec.ts`
各有一条）。**别为它们改渲染代码** —— 要断言确定性，就在测量前多渲一帧丢弃。

### 1.4 主线程只做 rAF 与 uniform 写入

解码 → Worker；算法烘焙 → Worker；排版光栅化 → 异步；编码 → WebCodecs 编码器。
主线程每帧的工作量不得超过一帧预算。这是「UI 不许卡顿」唯一的实现方式。

### 1.5 内核与宿主解耦

内核是**标准 Web 应用**：能在 Chrome 里打开、能用 Playwright 跑 E2E、能热更新。
所有平台能力走 `platform/` 接口。

> **任何「只能在某个宿主壳里跑起来才能测」的功能设计，都视为设计错误。**

### 1.6 禁用 `git stash`

沙箱与 git 交互有缺陷，几乎必然损坏 git 库。需要腾空工作区就 WIP commit
（可后续 `reset --soft` 回退）或新建分支；只读对比用 `git show <ref>:<path>`。

### 1.7 工程真相在磁盘目录，不在 localStorage

IndexedDB 只放可丢弃的东西（缩略图缓存、UI 状态、目录句柄）。

### 1.8 不引 AGPL / GPL 代码

- 禁止：`hydra-synth`（AGPL-3.0）、`Coollab`（GPL-3.0）
- 可用：`gl-transitions`（MIT）、openmosh（MIT）、`lucide`（ISC）、
  `mediabunny`（MPL-2.0 —— 文件级弱 copyleft，本项目 npm 装、不改其源、不分发它，因此无义务）
- **「包是 MIT」≠「每条都能用」**：`gl-transitions` 集合内每个条目自带 `license` 字段。
  `effects/transitions/catalog.ts` 有许可白名单把非宽松许可挡在目录外（测试同时断言），
  明细见 `CREDITS.md`。
- 移植 MIT 代码必须登记到 `CREDITS.md`（含二级移植来源）。这个账越拖越贵。

---

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 语言 / 构建 | TypeScript（strict）+ Vite |
| UI 框架 | Svelte 5 runes（时间轴本体 Canvas2D 自绘，框架只管面板） |
| 渲染 | WebGL2 + GLSL ES 3.00 |
| 导出编码 | **WebCodecs**（H.264 + AAC 封 MP4，mediabunny）+ PNG 序列逃生舱 + GIF（`gifenc` 软编） |
| 音频分析 | 自研 TS 离线 FFT（对齐 `AnalyserNode` 的 dB 映射） |
| 排版出图 | snapDOM + HarfBuzz WASM 字体子集化 |
| 图标 | Lucide（`@lucide/svelte`，ISC）。UI 图标走 `ui/icons.ts` 的按组件导出（可 tree-shaking）；排版编辑器的「插入图标」走全量清单 + 懒加载，见 §5.7 |
| 样式 | Design Token 单一真源在 TS（`ui/tokens.ts`） |
| 工程持久化 | File System Access API；E2E 跑在 OPFS 上 |
| 文案 / i18n | 自研 `src/i18n/`，无第三方库 |
| 测试 | Playwright（E2E）+ vitest（**只测纯函数**） |

**打包分发：目前不做。不要复活 Electron 壳** —— 它原本只为捆绑 ffmpeg 存在，
而实测 Chrome 品牌构建带 H.264 / AAC，纯浏览器即可编码。将来要做分发走 PWA，
不走 Electron（Chromium / Electron 构建反而不带专有编解码器）。

---

## 3. 架构分层

```
src/
├── core/          纯 TS，无 DOM / WebGL，必须可单测
│                  schema · 曲线求值 · 命令栈 · 片段几何（clips）· 转场钳制 · prng
│                  · 颜色（color.ts）· 位掩码（bitmask.ts：位序映射 + B/S 打包）
├── engine/        WebGL2：Program / Target / Pass 调度 · 纹理池 · 预览尺寸 · 确定性时钟
│   ├── media-assets.ts   运行期素材登记（图片 = 已解码 canvas；视频 = Blob / File 引用）
│   └── video-source.ts   视频取帧：mediabunny + WebCodecs + 有界纹理缓存
├── effects/       声明式特效定义 + GLSL
│   ├── defs/ · glsl/     「一个特效 = 两个文件」，glob 配对，缺一半启动报错
│   ├── shader-def.ts     着色器协议：EFFECT_HEAD · 共享 GLSL 头 · floats/colorVec3 · program 命名
│   ├── registry.ts       glob 配对 + 批量编译
│   ├── compile-all.ts    全量编译守卫（E2E 与按钮用，不在启动路径上）
│   └── transitions/      gl-transitions 目录 + GLSL 规范化 + runner
├── algos/         算法生成器注册表 + 烘焙 Worker
│   ├── shader-lib.ts     realtime 生成器的头（ALGO_HEAD）· intResParam · program 命名
│   ├── pattern-codec.ts  手绘位图的编解码（永不抛 / 自带尺寸 / 跨环境稳定）
│   └── pattern-presets.ts 标准种子图案（滑翔机 / 滑翔机枪 / 脉冲星 …）
├── render/        ★ 合成根，见下
├── audio/         离线 FFT · BPM/offset 估计 · 波形桶 · 播放器
├── typography/    TypographyDocument 模型 + 光栅化后端 + 字体注册表 / HarfBuzz 子集化
├── timeline/      时间轴 UI（Canvas2D 绘制 + DOM 片段）
├── exporters/     export-runner（逐帧驱动）+ frame-sink（webcodecs / png-sequence / gif）
│                  + mixdown（纯混流）+ gif-plan（GIF 的纯计算：尺寸 / 抽帧 / 延迟）
├── project/       工程目录格式 · 素材台账 · 原子写 · 句柄持久化（含 plugins/ 读写）
├── plugins/       插件子系统（清单校验 · blob 动态 import · 宿主与引用计数 · 缺失扫描），见 §5.10
├── i18n/          文案表 + tr() + Label 契约
├── platform/      Platform 接口（浏览器实现）
├── types/         跨层共用类型
└── ui/            Svelte 组件 + 控件库（controls/）+ 主题与偏好状态

lab/               试炼场：第二个 HTML 入口（/lab/），见 §3.1
```

**依赖方向**：`core` 不依赖任何东西 → `engine` 只依赖 `core` →
`{effects, algos}` 依赖 `engine` → **`render` 依赖 `{engine, effects, algos}`** →
`ui` 与 `lab` 依赖全部。`platform` 被所有人依赖。
`plugins/` 在 `render` **之上**：它往 `effects`/`algos` 的注册表里写，只被
`ui` 装配（`render-core` 与 lab **不认识插件**，所以 lab 不需要插件也能跑）。

> **`render/` 为什么必须单独一层**：它装配 Renderer + SourceManager + AlgoRuntime +
> EffectRunner，因而要 import `algos/` 与 `effects/` —— 而这两者本就在 `engine/`
> **之上**。放进 `engine/` 会形成 `engine → algos/effects → engine` 的层次倒挂。
> 它是**合成根**：主应用与 `/lab/` 共用同一份 `createRenderCore`，两边各写一份的
> bug 形态是「试炼场里好好的、主应用里某类源不工作」，而且不会有任何报错。
> 它刻意**不 import** `typography/` `audio/` `exporters/` —— 那会把整棵排版 / 音频
> 子树拖进 lab 的 bundle 图。

`core/` 是全局关键路径 —— **它定死之前不要写时间轴 UI**。

### 3.1 试炼场（`/lab/`）

第二个 Vite HTML 入口，与主应用**完全隔离**（独立 canvas、独立 Renderer、不引导主应用）。
存在理由只有一条：**决定哪些特效 / 生成器值得留下、默认参数该定多少**。

- **进 build**（`vite.config.ts` 的 `rollupOptions.input` 双入口），不是 dev-only ——
  E2E 走 build → preview 管线，产物里没有它就没有任何自动化覆盖。
- `/lab`（无尾斜杠）会被 SPA fallback 静默端上**主应用**，所以 `labRedirect()` 必须
  **同时**注册 `configureServer` 与 `configurePreviewServer`。E2E 一律访问 `/lab/`。
- 素材只能是**算法生成器 + `lab/patterns.ts` 的程序化测试图**，用 `lab:` 前缀伪
  generator id 由 lab 内层 resolver 拦截；**不注册进 `algos/registry.ts`、不改 `schema.ts`**。
- 分辨率档位靠 `renderer.setExportSize()` 钉死后备缓冲 —— `preview-size.ts` 的
  `k = Math.min(1, scale)` **只缩不放**，中间舞台列在常见视口下会被悄悄缩小。

---

## 4. 数据模型与求值

音频单独成轨。视觉轨道里混放画面来源与特效。

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
  blend: BlendMode
  opacity: number
  transform: { x: number; y: number; sx: number; sy: number; rot: number }
  fit: 'contain' | 'cover' | 'stretch'
  /** 出画转场，见 §5.7。窗口以 clip.end 为中心。 */
  transitionOut?: { defId: string; duration: number; values: Record<string, number> }
}

/** 无画面来源，把自己插进渲染链。所有特效都是它 —— 含摄像机 / 画幅 / OSD。 */
interface EffectClip extends ClipBase {
  kind: 'effect'
  chain: EffectInstance[]                     // 一条片段可携带一串效果，可拖拽重排
}

/** 声音事件，不参与视觉合成。 */
interface AudioClip extends ClipBase {
  kind: 'audio'
  assetId: string; srcIn: number
  gain: Curve
}
```

### 4.1 合成求值

```ts
function buildStack(project: Project, t: number): Stack {
  // 1. 收集所有命中 t 的 SourceClip，轨道序 → 轨道内序 决定 z
  // 2. 按 z 序合成（各自的 blend / opacity / transform / 曲线求值）
  // 3. 把命中的 EffectClip 的 chain 依 z 序插入到 step 2 之后
  // 4. 顶部叠加渲染：排版层
}
```

**EffectClip 是 adjustment layer 语义**：只作用于 z 序在它**之下**的所有 SourceClip 的
合成结果。「调色放最顶层」= 作用于整幅画面；「故障放在两层之间」= 只坏一层。

> **z 序 = 列表位置取反**（`engine/stack.ts` 的 `buildStack`：`z = 视觉轨数 - 1 - 视觉轨下标`）。
> `tracks[0]` 渲染在轨道列表最顶部，按 NLE 惯例就是最前景 ⇒ 它的 z 必须最大。
> **编号只数视觉轨**（音频轨不参与合成）。
> 写反的表现是**「特效完全无效且不报错」**。`core/demo-project.ts` 的 tracks 数组
> 必须一起倒序，`tests/unit/stack.test.ts` 会挡住。

### 4.2 重叠策略与结算时序

**同轨不重叠**，需要叠就加轨道。拖动策略是可配置项
`overlapBehavior: 'push' | 'reject' | 'trim'`（挤开 / 拒绝落点 / 吃掉邻居重叠部分），
默认 `'reject'`。reject 的语义是「落点非法就整次不动」，**不是**「钳在当前空档里」。

| 阶段 | 做什么 |
|---|---|
| `pointermove` | 只做**自由移动**（`liveMoveClip` / `liveResizeClip`）：片段跟着鼠标走、可压在邻居身上、跨轨也实时生效。**策略一律不动。** |
| `pointerup` | 调 `settlePlacement` / `settleResize` **结算一次**：push 挤开、trim 吃掉、reject 拒绝（非法则 `cancelTx` 整次手势作废） |

理由：策略若在 `pointermove` 里生效，trim 会在拖过去的瞬间毁掉邻居，拖回来也回不来。
拖动期间允许视觉重叠，落点非法时给红框预告（`appState.dragIllegal`）。

- **例外**：`resize` + `reject` 是单边钳制、非破坏性，仍然实时生效。`resize` 遵守全部三种策略。
- 几何层入口统一是 `placeSpan(干净 lane, 候选几何片段, duration, behavior)`。
  **lane 必须是干净的** —— 拖拽期间被拖片段已压在邻居身上，脏 lane 会让 push 的扫掠
  把锚点自己推走。
- **跨轨**兼容判据只有一条 `ProjectStore.canHost(track, clip)`（音频片段只进音频轨），
  拖拽与 `Alt+↑↓` 共用，不许各写一套。拖拽期间实时搬家 ⇒ 指针监听挂在 `window`
  而不是 `setPointerCapture`（元素会在两个 `{#each}` 块之间重建，捕获随之失效）。
- **框选出来的多个片段一起走**（`drag.ts` 的 `peers`，单片段是它长度为 0 的特例）。
  三条不变量：位移 `dt` 由**指针**算、与成员无关（相对位置天然保持）；换轨是
  **整组平移 d 格**（`legalDelta`），不是逐成员各找各的轨道；兼容判据仍然只有
  `canHost`。于是「组里含音频就不许上下跨轨」是这条判据的**推论**（音频片段平移
  后会落到视觉轨），**不要**再写一条「组里有没有音频」的独立规则。
  缩放**不做组版本**（`peers` 传进去也被忽略）：一组片段的「那条边」没有唯一定义。
  按下已选中的片段时**先保持整个选中集**，松手若没移动过（<4px）再收敛成单选 ——
  否则整组拖动无从谈起。这条判断只能放在拖拽层（`DragOptions.onClick`）。

### 4.3 trim-in 与切分

**判据只有一条：起点动、终点也动 = 整体平移（`push` 挤开邻居），不动 `srcIn`；
起点动、终点不动 = 头部被裁 / 被拉长，`srcIn += Δ × speed`。**

实现是 `core/clips.ts` 的 `applyTrimIn` / `earliestTrimStart` / `trimInOf`。

| 场景 | 期望 |
|---|---|
| 拖片段中部 | 整体平移，`srcIn` 不变 |
| 拖左边界往右（裁掉 1s） | 长度 −1s，**`srcIn` +1s** |
| 拖左边界往左 | 只有在 `srcIn > 0` 时才能扩 —— 素材头部没有更多内容 |
| 视频 | 按 `speed` 折算：2× 的片段裁 1s 时间轴 = 素材 2s |
| `trim` 吃掉邻居的**头部** | 邻居的 `srcIn` 跟着进 |
| `push` 挤开邻居 | 邻居两端一起动 ⇒ `srcIn` **不能**动 |

**`splitClipAt` 是同一族的第三处落点**：右半段必须补 `srcIn += atRel × speed`，
否则切开后后半段从头重放。

### 4.4 工程时长与素材长度无关

`Project.duration` 只决定导出帧数范围与时间轴宽度；片段可以把它撑长
（`addClip` / `liveMoveClip` / `liveResizeClip` 只增不减），用户也可以手动改小或用
「贴合内容」收回。导入音频只是新片段的默认长度，**不许**被 `duration` 截断。

### 4.5 关键帧锚拍与包络

```ts
interface Curve {
  keys: { t: number; v: number; interp: Interp; handles?: [number, number, number, number] }[]
  mode?: 'keyframe' | 'impulse' | 'follower'
  beatAnchor?: { beat: number } | null
}
```

`beatAnchor` 必须在 `Curve` 结构本身里，不是事后补 —— 改了 BPM 或微调 `offset` 之后
**所有卡点自动跟着走，不用重排**。

`core/curve.ts` 另有三种闭合解包络（帧率无关、天然 seek 安全）：
`impulse`（指数衰减冲击）、`follower`（非对称攻放）、`approach`（帧率无关指数逼近）。
**运镜的缓动用 `approach`，不要用关键帧。**

### 4.6 旋转几何

- **选中框必须带 `rot`**：单个元素绕自身中心旋转时 `x/y/w/h` **一点没变**（只有 `rot` 变），
  用未旋转 AABB 画框会纹丝不动。单选 → 元素自己的框（含 rot）；多选 → 整个选区的 AABB。
- **旋转后的缩放走 `resizeFramesRotated`**，不能直接用轴对齐的 `scaleFrames`
  （否则「拖右边却往斜上方长」）。`rot === 0` 时两者逐位等价（有单测钉着）。
- 测这类手势的 E2E 时注意：细长元素转 90° 后把手会跑到视口外，用正方形元素测。
  旋转本身断言 `getComputedStyle(el).transform` 矩阵的非对角项，别用「外接矩形变大」。

---

## 5. 关键约定

### 5.1 工程持久化（File System Access）

```
<工程目录>/
├── project.json        工程本体（§4 的 Project），真相的唯一载体
├── project.json.bak    上一版成功保存的副本
├── assets.json         素材台账（引用路径 + 内容哈希 + 原始文件名）
├── assets/             素材字节（文件名 = <assetId>.<原始扩展名>）
├── analysis/           可重算的离线分析缓存（音频波形 / BPM / 拍网格）
├── plugins/            这个工程挂的插件（一个插件 = 一个 .js），见 §5.10
└── thumbs/             缩略图缓存（可丢弃）
```

- `src/project/layout.ts` 是路径规则的唯一真源。路径一律按**段数组**处理，不拼字符串再拆
  —— FSA 的 `name` 里不允许出现分隔符。`plugins/` 也走这一套
  （`pluginPathSegments` / `safePluginId`），并已加入 `PROJECT_DIRS`。
- **`project.json` 不写 `savedAt`**：写进去会让「内容没变 → 字节没变」失效。
- **原子性由浏览器提供**：`createWritable()` 默认 siloed 模式（同目录写 `.crswap`，
  `close()` 时才 rename）。Web 上**没有 fsync**。我们能自己做的只有两件：
  维护 `.bak`，以及 `close()` 之后读回来校验一遍（抓「磁盘满而 close 没报错」这类静默损坏）。
- 多标签页并发写用 `createWritable({ mode: 'exclusive' })`。降级重试**只认 TypeError**
  —— 把「已经有 writer」一起吞掉的话，并发写就退化成静默互相覆盖。
- 素材用**工程根相对路径 + sha256**，不是绝对路径（FSA 不向页面暴露真实路径）。
  随之而来的翻转：**「引用而非拷贝」在 Web 上变成「拷贝进 `assets/`」**，因为
  `<input type=file>` 只给字节不给句柄，而 `showOpenFilePicker()` 给的句柄不能被序列化成
  可移植路径。哈希缓存的键是**字节对象的引用**，`put()` 换字节就自然失效，不需要显式
  invalidate。超 `MAX_HASH_BYTES`（256 MB）记 `hash: null`，退化成「大小 + 修改时间」弱指纹
  （`crypto.subtle.digest` 无法流式，GB 级素材峰值能破 5 GB）。不做纯 JS 哈希回退。
- **写入顺序就是全部的安全性**：素材 → 台账 → 工程 → 删旧素材。崩在中间任何一步都
  无害（孤儿文件只占空间），而「工程引用了已删素材」是有害的。**只有台账里被显式移除的
  素材才删文件** —— 仅仅「没被片段引用」不算（那多半是临时从时间轴上拿下来的）。
- 台账**可以丢**：文件名就是 `<assetId>.<ext>`，从 `assets/` 目录本身就能重建（哈希现场算）。
  所以 `parseLedger` 对损坏输入降级成空台账 + 警告，而不是抛错。`assets/` 里的未跟踪文件
  **只提示不删**。
- 三个根来源（`project/fs.ts` 定义最小句柄接口）：`fsaRoot`（生产，首次需点一次）/
  `opfsRoot`（E2E 与 dev，无授权）/ `memoryRoot`（单测，**模拟 swap 语义** + `setFault()` 注入失败）。
  句柄存 IndexedDB，跨会话保留，但**权限不一定跟着** —— 新会话里 `queryPermission()`
  通常是 `'prompt'`，要 `requestPermission()` 且那一下必须有用户手势。所以「打开最近工程」
  天然只能由点击触发，**页面加载时不能自动恢复**。同名目录靠 `isSameEntry()` 区分。
- **脏标记是近似但方向安全**：`savedVersion !== version` 即视为有未保存改动
  （假阳性只是多问一句，假阴性才是丢工作）。
  `ProjectStore.replaceProject()`（打开 / 新建）**会清空撤销栈**，`loadFrom()`（工程内换内容）
  不会 —— 否则撤销会把两份工程的片段混在一起，而每一步看起来都合法。

### 5.2 顶栏选项卡是**工程**

一个网页里可以同时开多份工程。`OpenProject` 承载所有「跟这一份工程走」的状态：
`store` / `assets` / `view` / `dir` / `savedVersion` / `playT` / `selectedClipId`。
**切换工程 = 换一个 `activeProjectId`**，不是把一堆散落状态逐个同步一遍（后者每加一个
工程级状态就多一个漏同步的机会）。

- `appState.store` 与 `appState.assets` 是 **getter**，永远指向当前前台那份 ——
  所有写库代码本来就写 `appState.store.xxx`，所以调用点一行都不用改。
  **代价是一条纪律：`const store = appState.store` 之后不能跨越工程切换**，需要跨就重新取。
- 每份工程有自己的 `AssetStore`（`createAssetStore()`）。**任何地方都不许再 import 模块级
  素材仓**（已经没有那个单例，编译期强制）。共用一份的后果不是「看起来不对」，是数据损坏：
  保存 A 时会把 B 导入的素材一起写进 A 的台账。
- **切换工程的顺序不能改**：
  ```
  if (playing) pause()       ← 必须最先：pause 把播放位置写回「当前工程」，
                               而 getter 在改完 id 之后就指向新工程了
  pendingGestureCancel?.()   ← 绝不能让 beginTx 悬空，否则撤销栈整个错乱
  activeProjectId = id
  subscribeActive()          ← version 是 per-工程的，必须换订阅
  refreshPreview()           ← 两份工程分辨率可能不同，必须重同步显示尺寸
  player?.stop()             ← 音频位置属于上一份工程
  ```
- **新建 / 打开 = 再开一份**（`appState.adoptProject()`），不是替换。装配顺序是
  「**先把素材读进来，再登记**」—— 读盘失败时不会在顶栏留下一个半成品 tab。
  因此加号**不需要脏检查**（它不覆盖任何东西）。
- **关闭**：`closeProject(id, { force })` 返回 `'ok' | 'dirty' | 'missing'`。脏的返回 `'dirty'`
  由 UI 弹 `ConfirmDialog`，确认后才带 `force` 再调一次。**不是拒绝** —— 拒绝等于死胡同
  （关不掉，又不知道下一步干什么）。确认框要说清后果是**丢失**。
- **工程列表允许为空**。`appState.hasProject` 是唯一判据；空集时 `activeProject` 回落到一个
  **丢弃用的 `placeholder` 空白工程**，既不是抛错也不是「自动补一份新的」（后者正是
  「关掉空工程看起来没反应」的根因）。空界面（`ui/EmptyState.svelte`）是 `position: fixed`
  盖在主界面上的一层，主界面挂 `inert`。
  > ⚠️ **主界面（尤其 `<canvas>`）绝不能在空状态下卸载** —— WebGL 上下文会永久失效。
  > 并且 `appState.tick()` 在无工程时直接返回（否则背后那台渲染器一直按占位工程出帧）。
- **关页面 / F5 要拦**：`beforeunload` 判据是 `anyDirty`（**任何一份**脏就拦，因为关页面会
  把**所有**打开的工程一起丢掉）。弹**浏览器自己的**确认框 —— 页面内伪造一个会撒谎，
  它挡不住真正的离开。
- 排版视图是**工程内部的第二个视图**（`OpenProject.view`），不是 modal、也不是新 tab。
  时间轴视图**常驻且永不卸载**（卸载 `Preview` 的 `<canvas>` 会丢 WebGL 上下文，且无法恢复），
  所以切视图只是 `display:none` + `appState.tick()` 早退。
- 工程 tab 里可能同时有「回到时间轴」与「关闭工程」两个动作，所以前者用 `arrow-left`
  （`project-tab-timeline-N`），后者用 `x`（`project-tab-close-N`）—— 两个 `×` 会让人分不清。
- **用词约定**：Artmatic 产出的那个目录一律叫「**工程**」，不叫「项目」。
  「项目」只用于指代**这个软件本身**。代码标识符仍是 `project` / `Project`。

### 5.3 i18n

- 唯一入口是 **`tr()`**，**不叫 `t`** —— 本项目 `t` 是**帧号**的专名（硬约束 1.1），
  拿它当翻译函数等于在每个渲染函数里制造命名冲突。
- key 是**扁平点分命名**（`'tl.importAudio'`），`keyof typeof zhCN` 直接就是 `MessageKey`，
  编译期可检查，不需要类型体操。按域拆文件只是为了让 600+ 条找得到，合并后就是一张平表。
  域清单见 `tests/unit/i18n.test.ts` 的 `DOMAINS`（common · media · app · project · timeline ·
  inspector · typography · ribbon · shortcuts · errors · lab）。
- **`i18n/index.svelte.ts` 必须是 `.svelte.ts`**：locale 是 `$state`，而 `tr()` 每次调用都读它
  ⇒ 模板里任何一处 `tr()` 都自动建立依赖，切语言时整棵树重渲。用普通模块 + 订阅回调的做法
  有一个很明确的失败形态：加了新文案却忘了订阅那处 ⇒ 界面静默停在旧语言。
- **数据表存 `labelKey` / `nameKey`，由 UI 侧解析**：`effects/defs/*`、`algos/*`、
  `typography/{shapes,animation,document}.ts`、`ui/shortcuts.ts` 都是**模块加载时求值一次**的表，
  里面直接写 `tr('…')` 会把值冻结在导入那一刻的语言上，而且症状极具误导性：**只有那几项不动**。
  字段名带 `Key` 后缀是刻意的 —— 改名让所有使用点编译报错，一个也漏不掉。
- **什么不进语言文件**：参数名 / 保留字（`opacity`、`transform.x`、curve 键、generator id、
  assetId）、`console.*` 与启动期不变量（判据是**用户有没有可能看到它**）、纯数值格式化
  （`1920×1080`、`12 ms`）。**含「词」的带数字文案要进**（`{n} 帧` 里的「帧」要翻译）。
- 占位符只认 `{名字}`，缺参数时**原样保留**（返回 `已打开「{name}」` 而不是空串 ——
  后者看起来像数据本身为空）。**禁止用模板字符串拼句子**（翻译时无法重排语序）；
  三元表达式里的两句话也拆成两个 key。
- **加一门语言**：复制 `locales/zh-CN/` 整个目录 + 在 `locales/index.ts` 登记一行，
  **不改任何组件代码**。键集必须完全一致（单测挡）。

### 5.4 设计 Token 与视觉

- **唯一真源是 `src/ui/tokens.ts`**（纯数据 + 纯函数，不碰 DOM），由 `theme-apply.ts` 写成
  `:root` 的内联自定义属性，`theme.svelte.ts` 管运行时态（亮暗 + 品牌色 + 自定义 hex）。
  **`app.css` 没有也不该有 `:root` 变量块** —— 时间轴是 Canvas2D 自绘，`ctx.fillStyle`
  写不了 `var(--x)`，只写 CSS 必然在 TS 侧养出一份同值的影子副本（改漏就是「面板变了、
  网格没变」这种极难定位的偏色）。Canvas 走 `canvasPalette(spec)`。
- **四层**：primitive（`--p-*`，只描述值）→ semantic（`--surface-*`，描述用途，不含颜色词）
  → component（`--btn-*`，值必须是 `SemanticKey`，写错层直接编译报错）
  → **content**（`--clip-*`，数据类别色，随亮暗变但**永不随品牌变** ——
  它编码的是「这是哪类数据」，不是界面角色）。
- **生成器默认色（`#3a6ea5` 之类）不是 token**，那是 Project 文档内容（schema 字段）。
  Inspector 里颜色控件的**外观**走 component 层，**值**走内容。
- **z 刻度（`tokens.ts` 的 `z-*`）有个非显然的约束：抽屉（`z-drawer`）必须比
  时间轴内部那一整套（`z-grid`..`z-ruler`，0..5）都大。** 抽屉是**层叠上下文**，
  从它里面打开的 modal（特效选择器）会被困在那一层：backdrop 写的是
  `--z-modal`（150）也没用，只要抽屉比时间轴内部刻度低，**ruler（5）与播放头（4）
  就会盖到 modal 上面**。实际表现是「选择器开着，缩略图上横着一条白色标尺 +
  一根播放头」—— 排查时盯着时间轴的 z 看是找不到的，问题在 modal 被关得太低。
  规则：**根上下文里除 modal/tooltip 之外的 z 都必须 < `z-drawer`**
  （工具栏 3、底栏 2、时间轴内部 ≤5）。守卫在 `modal-layering.spec.ts`。
- **视觉纪律**：零阴影零渐变，层次只靠 surface-0→3 的纯色深度 + 1px 实线；圆角 4/6px；
  纯图标按钮永远 `background: transparent`，hover 只改图标颜色；主题色只出现在
  **选中 / 激活、焦点环、播放头、底栏数字**这几处。默认**亮色**。
- **密度**：轨道行高 28px、标尺 24px、字号阶梯只有 10/11/12。数值在 `tokens.ts` 的
  `DENSITY`，CSS 与 Canvas 数学（`timeline/view-model.ts`）都从它取，不许各写一份。

### 5.5 特效与转场

- **新增一个特效 = 两个文件**（定义 + GLSL）。由 `effects/registry.ts` 的 glob 配对强制执行，
  缺一半启动报错。这是硬指标 —— 摩擦成本决定这个工具三年后还有没有生命力。
- **着色器是惰性编译的**：语法错误在你点到它之前不报。所以有
  `__artmatic.compileAll()`（`effects/compile-all.ts`）覆盖特效（**主 pass + 每一环 pre-pass**）+
  realtime 算法 + 转场，E2E 断言 `failures == []`。**目录层的静态检查只能挡「结构性不可能」，语法 / 版本问题
  只有真编一次才知道。** 它是按钮与 E2E 的动作，**不在启动路径上**（122 次编译是秒级）。
  - program 名由 `effectProgramName(defId, preIndex?)` / `algoProgramName(id)` 生成，**只有一处**。
    预编译与运行期不同名 = `Kit.quad` 另编一份，预编译白做且不报错。
- **特效能拿到什么**（`EFFECT_HEAD`，`effects/shader-def.ts`；fragment 里**不得重复声明**）：
  `u_texture`（本环输入）/ `u_feedback`（本实例跨帧历史）/ `u_original`（**pre-pass 之前**的链输入）/
  `u_time`（**秒**）/ `u_delta`（= 1/fps）/ `u_seed` / `u_resolution` / `in vec2 vUv` / `out vec4 outColor`。
  - **`u_time` 没有「累积相位」这回事。** openmosh 里带 `speed` 的特效用 `phase += dt * speed` 累加，
    那是 dt 驱动的有状态量 —— 与硬约束 1.1 冲突且 seek 不可复现。**移植时把相位算成闭式**：
    常速就在 fragment 里写 `u_time * u_speed`；要按拍同步就在 `setUniforms` 里用
    `beatAtTime(ctx.t, ctx.grid) * division` 算好当普通 uniform 传（那里拿得到 `BeatGrid`）。
  - `u_original` 堵的是「需要未处理的源」那一类（glow / ghosting / fast-mosh / motion-mask）。
- **`prePasses`**（主 pass 之前的全屏 pass 链）：第一环读本特效输入，最后一环的输出就是主 pass 的
  `u_texture`。非 `feedback` 的 pre-pass 渲染在**半分辨率浮点草稿**上，`u_resolution` 仍传全分辨率
  —— 降采样只改 tap 密度、**不改模糊半径**。带 `feedback` 的 pre-pass 用**自己的**全分辨率浮点历史
  （键 `${instanceId}:${index}`，`compositor.preFeedbackFor`）。两种历史都由 `clearFeedback()` 清。
  - **特效参数会派发到每个 pass**（上游 `drawPass` 就是这么做的）：`glow` 的 `u_cutoff`/`u_radius`、
    `blur` 的 `u_radius`、`ghosting` 的 `u_bias`/`u_scale`、`fast-mosh` 的 `u_hold`、
    `motion-mask` 的 `u_persistence`/`u_erode`/`u_blur` **都只声明在 pre-pass 里**。
    漏派发的表现是这些参数恒为 0 —— 画面明显不对但不报错。守卫：`lab.spec` 的
    「pre-pass 的参数真的生效」（`blur` 的 radius 只活在 pre-pass 里，是最干净的探针）。
  - 主 pass 与 pre-pass 的 `u_original` **都指向链输入**（pre-pass 之前的那一份），
    不是上一环的输出 —— `fast-mosh` 就靠这个区别：`u_texture` 是 pre-pass 交出的关键帧，
    `u_original` 才是当前帧。
  - **`delayedInput: true`**：这一环的 `u_texture` 换成**上一帧的链输入**。给「要拿当前帧
    和上一帧输入做帧间差分」的特效用（`kino-datamosh` 的运动估计）。链里本来拿不到它
    （`u_texture` 是上一环输出、`u_feedback` 是自身上一帧输出、`u_original` 是当前帧输入），
    而 pre-pass 自己用 `feedback` 存一帧输入也不行 —— 那存的是「上一帧它自己的输出」，
    **永远差一帧**。存储由 runner 在整条链跑完后写入（`compositor.delayedInputFor`），
    只改输入不改输出。守卫：`lab.spec` 的「delayedInput」（用 `velocity` 当探针）。
  - `linearFilter` 的实现是「设 LINEAR → draw → 还原」（`effects/runner.ts` 的 `forceLinear`）：
    GL 的采样参数在 **draw 那一刻**被捕获，单线程里前后夹住是安全的。改的是别人的贴图，务必还原。
  - `hdrFeedback` 走 `Target({ float: true })` → RGBA16F，缺 `EXT_color_buffer_float` 时**安静回落
    RGBA8**（8bit 会把逐帧低于量化步长的增量抹平，有状态模拟会 stall 成色块）。
- **`ParamDef.visibleWhen`** 控参数的条件可见性；特效检查器里 range / select / **checkbox** / color
  四种都必须有分支（缺 checkbox 的表现是「参数不显示」，不报错）。

#### 新增一种 `ParamDef` 变体时（2026-10-04 加 `bitmask` / `pattern` 之后总结）

**参数类型有四个消费方，必须一起改 —— 漏掉任何一个都不报错**：

| 消费方 | 漏掉的症状 |
|---|---|
| `ui/Inspector.svelte`（源参数 + 特效参数**两个循环**） | 参数在检查器里**什么都不显示**（`{#if}` 链没有 `else`） |
| `lab/LabParams.svelte`（同样两个循环） | 参数在试炼场里被 `{:else}` 兜成**一个颜色选择器** |
| `lab/lab-state.svelte.ts` 的 `randomizeParams` | 「随机」按钮**不随机这一项**（静默回落 defaultValue） |
| `effects/types.ts` 的 `defaultValues` | 新片段写入时缺这个键 —— 只有自带 `defaultValue` 才没事 |

- 试炼场是「新参数类型的 testbed」：**它和产品端不一致，等于这个类型没有被测过**。
  所以新参数类型要在 lab 侧也加一条 DOM 断言。
- 守卫：`tests/unit/algo-params.test.ts` 遍历所有注册的生成器与特效，断言参数类型在
  已知集合内、`labelKey`/选项文案能解析、`select.defaultValue` 在选项里、
  `bitmask` 的分组位数之和 = `bits` 且默认值 < 2^bits、`visibleWhen` 引用的键
  **真的存在于同一张参数表**（`v.seedModeX` 这种拼写错误类型系统拦不住 —— `v` 是 `Record`）。
- **自研控件必须 `data-exempt`**（见 §6.5）——位表与绘画 canvas 都踩这条。

#### 从外部移植一个特效时（2026-10-03 移植 51 个之后总结）

**照抄会静默坏掉的三类，按出现频率排**：

1. **重复声明 head 里的 uniform。** 上游 shader 常在自己的 fragment 里再写一遍
   `uniform sampler2D u_texture;` / `uniform float u_time;` / `uniform vec2 u_resolution;`
   —— 与 `EFFECT_HEAD` 重复，**直接编译失败**。移植前先搜一遍 head 里那几个名字。
   （`u_resolution` 这一条在 51 个里出现了 **6 次**。）
2. **`u_time` 是秒还是相位，以及 `speed` 是「时间倍率」。** openmosh 的
   `getEffectTime` **只对有 `speed` 参数的特效**把 `u_time` 换成累积相位
   （`phase += dt * speed`，`sync === 'beat'` 时读拍网格），**同时**把
   `u_delta` 换成 `dt * speed`。所以：def 里有 `speed` 而上游 shader 直接用
   `u_time` ⇒ **移植时必须自己把它乘出来**（`u_time * u_speed`，或用 `clockPhase()`），
   否则那个滑杆**完全失效且不报错**。反过来，shader 里本来就写了 `u_time * u_speed`
   的，**不要再乘一次**。**若 shader 还读 `u_delta`，它也要乘**（`melt` 是典型：
   只乘一个的话「下淌速度」与「愈合速度」会以不同比例跑，画面就散了）。
   - 口径：**`u_delta` 是「本特效用于动画的那个量」的每帧增量，不是固定的秒。**
     非 clock 特效那个量是秒（runner 直接给 `1/fps`）；clock 特效那个量是相位，
     `clockUniforms()` 会按 `speed` / `division` 换算好。
3. **hash / noise 的形状与 seed。** `HASH_GLSL`（掺 seed，逐帧换图案）与
   `HASH_PLAIN_GLSL`（坐标的纯函数）用途不同，拿错会让图案从「随时间爬行」变成
   「逐帧闪烁」。`NOISE_GLSL` / `FBM6_GLSL` 建在**不掺 seed** 的那支上。
   上游 shader 自带 hash 时**优先保留自带实现**：常数不同（`127.1/311.7` vs
   `12.9898/78.233`）就是不同的图案，换过去是改画面，不是「统一实现」。
   另外注意 `HUE_ROTATE_GLSL` 的 `hueRotate` 收的是**度**，上游有些 shader 自带的
   `hrot` 收的是**弧度**。
4. **`u_feedback` 要显式开。** openmosh 是「fragment 用了 `u_feedback` 就自动分配
   历史缓冲」（它查 program 的活跃 uniform），Artmatic 的协议要求写
   `feedback: true`。漏写的表现是 sampler 没人绑、采样读回未绑定纹理 ——
   像「没有拖尾」，不报错。同理任何 runner 绑不了的 sampler（如 `u_spectrum`）
   都会被 `effect-uniforms.test.ts` 拦下。
5. **上传纹理不许用「当前激活单元」，而且「创建」与「上传」两条路都要走 scratch。**
   `bindTexture` / `texImage2D` / `texSubImage2D` 都作用在当前激活的纹理单元上，
   而 `Program.tex()` 会把采样本依次绑到 0..n 并留下最后一个为激活态。更阴的是：
   采样器**没被编译器保留**时（如 `audio-bars` 用不到 `u_original`）`tex()` 会提前返回
   **且不递增 `texUnit`**，激活单元可能停在任何位置 —— 于是上传把某个 sampler
   指到了错的纹理上。
   - 事故一（已修）：上传把 `u_texture` 换成频谱纹理，画面变成一片红竖线
     （R8 读作 rgba=(r,0,0,1)）。修法是上传走 `scratchUnit`。
   - **事故二（2026-10-04，同一个 bug 的另一半）**：修了「上传」却漏了「**创建**」——
     `makeTexture()` 里的 `bindTexture` 同样作用在当前激活单元上，而它发生在
     `prog.tex('u_texture', ...)` **之后**，于是首次建纹理那一帧 u_texture 被顶掉，
     画面整片发红。**只在每个实例的第一帧发生**（第二帧起走已存在分支），
     所以任何连续渲染的用例都看不见它 —— 而缩略图 / 单帧导出 100% 命中。
   - **教训**：这条协议的正确形式是「**任何** bind / upload 之前先切到 scratch」，
     不是「上传时记得切」。改一个 GL 状态 helper 时，要顺着找**所有**动那个状态的地方。
   - 守卫：`effect-picker.spec.ts` 的「频谱类特效没把链输入顶掉」——
     `audio-bars` 的缩略图里「红主导像素占比」必须 < 20%（修好前后实测 0.76% vs 近乎整幅）。

#### 反馈类特效与「渲染帧」

带 `feedback: true` 的特效（含 pre-pass 级的）**按渲染帧累积状态** —— 每个 pass
只在渲染时步进一次，而 `u_delta` 是名义 `1/fps`。所以**渲染率必须等于工程帧率**，
否则仿真会随时间轴漂：预览跑满 rAF（60）而工程 30fps → 仿真比时间轴快一倍。
对不稳定系统（`petri`）尤其明显，直接表现成「狂闪」。

- 主应用：`app-state.tick()` 播放时把渲染节流到 `project.fps`，并把 `playT`
  **吸附到帧栅格**（`round(playT·fps)/fps`）—— 于是每个预览帧就是一个导出帧。
  暂停时不吸附（拖播放头要的是连续）。
- 试炼场：`lab-state` 的循环同样节流到 `LAB_FPS`（漏过这条，是 petri 那份 2× 的来源）。
- **已知缺口**：预览的「帧率档位」低于 100%（`previewFpsDiv > 1`）时会少渲染帧，
  反馈类特效的演化同比变慢 —— 那个档位是**性能档，不是时间档**。

**判定「参数有没有接上」的自动关卡**：`tests/unit/effect-uniforms.test.ts` ——
用伪 gl 跑一遍每个特效的 `setUniforms`，断言「fragment 里声明的每个 uniform 都被写到」
且「写它的函数类型与声明一致」。它守的是**协议层**（`shader-def.ts` 的 setter 助手），
新加一个助手或改一个 uniform 声明都会在这里被拦下。

> **写 uniform 的类型必须与 fragment 的声明逐字对应。** 对 `uniform float` 调
> `gl.uniform1i`（或反过来）会触发 GL `INVALID_OPERATION` 并且**静默不写** ——
> 值保持 0，功能像没做。真实事故：`clockUniforms()` 用 `uniform1i` 写 `u_sync`，
> 8 个 clock 特效的「按拍对齐」全部退回 `speed`，无任何报错（2026-10-03）。
> 自动冒烟的 `compileAll` **看不见这一类**，所以要靠上面那份静态自检。
- **出画转场**挂在 `SourceClip.transitionOut`，剪切点 `cut = clip.end`，窗口**以剪切点为中心**
  `[cut - d/2, cut + d/2)`。入画片段 = 同轨 `start` 紧邻（`|Δ| ≤ 1e-6`）的下一个 SourceClip，
  **按相邻关系解析、不存 id** —— 存 id 会引入悬空引用与它的一整套清理，而片段几何
  （push / trim）本来就会保持相邻。
  - 全部钳制在 `core/transitions.ts` 一处（窗口上限 = `2 × min(左侧可用, 右侧可用)`，
    两侧各扣掉相邻转场已占的半宽）；渲染 / store / 检查器 / 时间轴共用一份。
  - `transitionAt()` 必须在 span 过滤**之前**判 —— 窗口后半段的 t 已越过 `from.end`，
    先过滤就整段漏掉（表现是「转场只在前半段生效」）。命中后 `i++` 跳过入画片段。
  - 两侧各自把 `opacity` 烘进各自 alpha（转场着色器只认贴图，没地方接收「这一侧的不透明度」）；
    合成用**入画片段**的 blend（窗口结束后下一帧就是它，不会有跳变）。
  - 窗口内 `fadeSec` 照常生效，不做特判（会叠加成二次淡出，检查器给提示而不改机制）。
  - `SCHEMA_VERSION` 抬版本时迁移可以是**恒等**的 —— 加可选字段不需变换，抬版本号是为了让
    「旧版打开新版工程」显式报错，而不是静默丢掉转场再保存。
  - **明确不做**：跨轨转场、转场参数打关键帧、`transitionIn`。
- **GLSL 规范化**（`transitions/glsl.ts`，**运行时、不改上游文件**）两类改写：
  1. `texture2D` → `texture`、`gl_FragColor` → `outColor`。
  2. **「依赖 uniform 的全局变量初始化」→ `#define`**（ES 1.00 允许、ES 3.00 不允许：
     `global variable initializers must be constant expressions`）。这类变量是只读派生量，
     宏展开语义相同。
  判据收窄到「可机械判定」：只改引用 uniform 的初始化式，真常量全局变量一律不动。
- **目录准入**（`catalog.ts`）：许可白名单 + 名字唯一 + `vec4 transition(` 入口 +
  **`paramsTypes` 覆盖检查**（body 声明了但 metadata 里没有的 uniform → 运行时恒为 0，
  而 0 往往是退化取值）。拒收是**数据驱动**的，不是黑名单 —— 上游改了会自动放行。
- **已知陷阱**：集合里 `dissolve` 其实是**亮度驱动的烧灼**（`show = burn(from) - progress`），
  纯红 `from` 在 `p=0.5` 时整帧仍是红的。拿它写「p=0.5 应红蓝各半」会得到一个看起来像
  bug 的假失败。

#### 特效选择器（`添加特效`，2026-10-04）

特效到七十多个之后，检查器里用一个 `<select>` 加特效已经不能用了：搜不了、筛不了、
看不见效果。现在换成一个 modal（`src/ui/effect-picker/`）。

- **目录表在 `effects/catalog.ts`，不在各 `defs/`**：七十多条说明要**成批读一遍**
  才能保证语气与长度一致，散在七十多个文件里做不到；而且它是**展示信息**，
  不是 shader 协议。代价是「新增特效 = 三个地方」，由 `effect-catalog.test.ts`
  断言「每个注册的特效都有条目」+「没有孤儿条目」变成明确报错。
- **标签分两半**：`overlay` 与 `category` 是手工的；`feedback` / `multipass` /
  `audio` / `animated` / `hdr` **从 shader def 推导**（`structuralTags`）——
  手工维护这些必然与代码漂掉。**「是否为叠加层」在本项目里没有区分度**
  （所有特效片段本来就是 adjustment layer），所以改成「叠加型 = 在输入之上加东西」。
  分类名与标签名是**拼出来的键**（`fx.cat.${c}`），TS 覆盖不到 ——
  由 `effect-catalog.test.ts` 的一条运行期断言兜。
- **缩略图底图的选择规则**（`effects/thumbnails/bases.ts` 顶部有表）：
  先问这个特效改的是**颜色 / 阶调 / 形状 / 细节 / 径向 / 运动**，再选底图。
  两条被需求点名、且已经写进 E2E 的：
  **去饱和度必须用高饱和彩条**（参考稿这里就是错的：一个把画面变灰的特效配一张
  本来就灰的底图 = 缩略图上看不出任何变化），**通道错位必须用纯黑白底图**
  （它在彩条上是一堆分不开的色块）。
  `mandel` 底图走**注册的** `mandelbrot` 生成器，所以它的默认色改成了纯黑白
  （顺带改正了 `colorA/colorB` **标签反了**：`t` 随迭代次数增大，`colorA` 是快逃逸端）。
  `scroll` 底图是唯一会动的 —— `motion-mask` / `fast-mosh` / `kino-datamosh` 在
  **静止**底图上运动量恒为 0，缩略图会是纯黑。
- **缩略图用独立的离屏 render-core 渲染**（`ui/effect-picker/thumbnails.ts`），
  与 lab 同款：`createRenderCore` 挂在一块 320×180 的离屏 canvas 上，`thumb:` 前缀的
  伪 generator id 由它自己的 resolver 拦截。**不借预览那台** —— 借的话要
  `setExportSize` 改画布尺寸再还原，一不小心就把预览留在错的尺寸上。
  建不出上下文时卡片退化成「只有名字与说明」，功能仍可用。
- **`readPixels` 是自下而上的，必须翻行**（GL 原点在左下，`ImageData` 第 0 行在顶部）。
  守卫：E2E 拿 `pixelate`（底图 `ramp` 上半灰、下半彩）比上下两半的饱和度，
  翻转之后关系会反过来。
- **懒渲染**：IntersectionObserver 只给滚到可见的卡片排队（用 `peek` 而不是 `get`
  读缓存，否则 `{#each}` 一渲染就把七十多张全排上队）。渲染按**时间预算**分块
  （10 ms/帧），因为 `relief` 那类重着色器 × 12 帧会一次占住主线程一百多毫秒。
  有历史的特效（反馈 / 用到「上一帧输入」/ 会动的底图）要**连渲 12 帧**才有内容。
- **多选**：底部「保存并应用（N）」，按**点击顺序**追加到链尾，**只算一笔撤销**
  （逐个 push 各自成一笔的话，按一次撤销只退掉最后一个）。
- **离屏渲染器住在 `render/effect-thumb-renderer.ts`**（不是 `effects/` 也不是
  `ui/effect-picker/`）：它要 `createRenderCore`，而 `render → effects` 是唯一合法的
  方向；放 `effects/` 会成环。**只有 lab 的批量导出在用**（选择器读静态资源，见下）。

#### 缩略图资源（`src/assets/effect-thumbnails/`）

- 打包进 `src/assets/`（**不是** `public/`），由 `ui/effect-picker/thumb-assets.ts` 用
  `import.meta.glob('../../assets/effect-thumbnails/*.webp', { eager: true, query: '?url' })`
  取：**URL 同步可得**（组件里不需要「加载中」状态），图片字节由浏览器的
  `<img loading="lazy">` 自己懒加载。**选择器不再现渲** —— 第一版现渲要临时编
  七十多个着色器，实测帧数 240 → 190。
- 格式 **WebP**。640×360 q84 实测**整套 1.11 MB**（原始 PNG 6.6 MB），
  所以不必为了省体积降到 256 高：卡片显示宽约 208 CSS px，360 高在任何 DPI
  都清晰，且不重采样就是零损失。
- **仓库里这一套是逐张手挑的**（连同参数一起调，例如 `bleach` 拉到完全去色才是
  它最好的示意），**不是** `EFFECT_CATALOG[id].base` 那套自动底图。
  `lab` 的「批量导出缩略图」用的是自动底图 —— 它会给**另一套**图，
  **别当成「重建同名资源」直接覆盖**。
- 守卫（`tests/unit/effect-thumb-assets.test.ts` + `effect-picker.spec.ts`）：
  每个注册的特效都有资源、没有孤儿资源、只放 WebP、整套 < 2.5 MB、
  界面上**每张卡片都有 `<img>` 而不是占位条**。加特效时忘了导出会明确报错。
- 渲染侧的两个坑（翻行 / 频谱顶掉链输入）的守卫在 `tests/e2e/lab-shot.spec.ts`
  —— 它们属于**导出这条渲染路径**，不属于选择器。
- **lab 的「导出截图」**（`lab/export-thumbs.ts`）：
  - 单张 = 当前画面存成 `<特效 id>.png`（比右键另存为省事）；
  - 批量 = 按目录底图逐个渲一张，打成一个 zip（**一个下载**，不触发浏览器的
    「是否允许下载多个文件」，也不用往下载目录丢七十多个散文件）。
  - 文件名是**特效 id**，不是显示名 —— id 是这份素材的主键，显示名会随文案变。
  - 高度可选（128/192/256/384，默认 256）。默认比「128 px / 20 KB」那套算得高，
    因为缩略图会被显示成 ≈200 CSS px 宽，128 高在 2× 屏上要放大 1.75 倍。
  - 单个渲染器 **`thumbSize()` 先做 `isFinite` 兜底再取整**：
    `Math.max(16, Math.round(NaN))` 是 `NaN`，会造出一张 NaN 尺寸的 canvas、
    导出静默得到 0 字节文件。

#### 转场缩略图资源（`src/assets/transition-thumbnails/`）

- **两张底图在 `effects/transitions/thumbnails.ts`**，是 GLSL 而不是图片文件：
  渲染侧要用**恰好等于渲染尺寸**的两张纹理，GLSL 同步且零资产。两条硬要求 ——
  **冷暖两极的色相**（dissolve / 亮度类靠它读出来）、**强结构 + 一条亮边框**
  （滑移 / 擦除类靠边框的位移读出来；纯色画面上只看得出「颜色变了」）。
  接入方式与特效底图一致：`trthumb:` 伪 generator id，由
  `render/transition-thumb-renderer.ts` 的 resolver 拦截，**不注册、不改 schema**。
- **渲染是「造一张最小工程让真转场跑出来」**：`from` 源 → `to` 源相邻、
  `transitionOut` 挂在 `from` 上，在**剪切点**渲一帧 ⇒ `progress` 恰好 0.5。
  所以它走的是预览同一条 `buildStack → runTransition` 路径，**不是**另写一套混合。
- **一条命令落盘**：`node scripts/gen-transition-thumbs.mjs`（build → preview →
  `/lab/` 的 `__lab.renderTransitionThumb`）。**不用 lab 按钮** —— 特效那套打完 zip
  还要人工解压，素材跟着代码走时那一步是多一次「导出了但忘了解压」的机会。
- **有几条转场的中点本来就是退化状态**：`circle` / `CircleCrop` / `Rectangle` /
  `RectangleCrop` 在 progress=0.5 时半径恰好为 0（整屏只剩底色），`SimpleFlip`
  在 0.5 时只留中间一条缝，`StereoViewer` 在 0.48–0.52 之间是纯黑。
  渲染器因此**先在 0.5 拍，只有拍出一张纯色才换邻近进度重拍**
  （`PROGRESS_CANDIDATES`，亮度极差 < 24/765 判为纯色），脚本会把挪过的条目打进日志。
  **不挪的表现是「7 张纯色缩略图」** —— 那种图等于白做。
- **编译失败的转场不写盘并让脚本非零退出**：`runner.ts` 对上编译不过的着色器会
  退化成内置 dissolve，那样导出的缩略图**不代表这条转场**。
- 守卫：`tests/unit/transition-thumb-assets.test.ts`（资源与目录对齐、只放 WebP、
  整套 < 4 MB）+ `tests/e2e/transition-picker.spec.ts`（每张卡片都有 `<img>`、
  左右两半真的不是同一张图）。
- **中文名与说明在 `effects/transitions/catalog-info.ts` + 语言表 `tns.*`**
  （新域 `src/i18n/locales/zh-CN/transitions.ts`，`i18n.test.ts` 的 `DOMAINS` 要一起加）。
  这是对「转场名不翻译」那条老约定的**破例**：转场过百 + 有缩略图之后，全是英文 id
  的列表扫不动了。折中是**两个都给** —— 显示中文名，**上游 id 一并保留**
  （列表视图 / 检查器里的等宽小字），「回上游查这条转场」的路没被堵上。
  **参数名仍然不翻译**（`pixelSize` 是 GLSL uniform 的名字，翻了就对着文档找不到）。
  `transition-catalog-info.test.ts` 守「每条转场都有条目 / 没有孤儿条目 /
  名字与说明互不重复 / 语言表里没有孤儿键 / 规模恰好 = 转场数 × 2」。
- **选择器在 `ui/transition-picker/`，与特效选择器同构但有三处不同**：**单选**
  （一个片段只有一条出画转场）、**没有分类 / 标签筛选**（转场目录里没有这两项数据，
  硬造就是假选项）、**带一个「无转场」磁贴**（对应旧下拉的第一项「无」）。
- **两个选择器的列表形态都是 `repeat(auto-fill, minmax(340px, 1fr))`**：
  模态宽 `min(920px, 94vw)`，一排到底只用掉左半幅。窄屏（窗口 < 约 720px）自然退回
  一列 —— 所以 E2E 断的是「前两张同一行、左右并排」，**不是**某个固定列数。

### 5.6 算法生成器
- 二值纹理（元胞自动机）走 **R8**，活性值用 `LIVE = 255` 常量。
  **移植时保留这个常量，不要写裸 `1`** —— 早年写成 `1` 的版本进 R8 后被归一化成 0.0039，
  所有阈值把它抹成 0（画面全黑）。
- bake 型在 **Worker** 烘焙 sheet 纹理；sim 型固定步长 + 每 16 步快照 + seek 重放；
  realtime 型逐帧算。**烘焙入参不可打关键帧**（防每帧重烘）。
  - **realtime 型的 fragment 不含头**，由 `ALGO_HEAD`（`algos/shader-lib.ts`）拼在前面；
    def 必须自带 `setUniforms` 把参数派发到 uniform —— **没有它参数永远拿不到值且不报错**，
    只是恒用默认值。`u_resolution` 是**内部**渲染尺寸，`u_aspect` = w/h。
  - **`realtime` 生成器就是「全屏程序化场景」**（angel-echo 的 `scenes.js` 那一型）。
    `AlgoSource.generator` 是自由字符串、realtime 本就渲染整帧，**不需要新的 SourceClip 类型**。
  - 内部渲染高度统一走 `intResParam()`（键 `intRes`，文案 `algo.intRes*` 共用一套），
    别再一个生成器写一份 select。内部低分辨率再放大是性能手段，**不是跳帧缓存**（那破坏确定性）。
- **bake 型的「揭示」有三种轴**（`types.ts` 的 `BakeReveal` → reveal shader 的 `u_reveal`）：
  `'front-y'`（默认，输出纵坐标，如 Rule 110 逐代向上）/ `'front-x'`（输出横坐标，如分岔图逐列算出来）/
  `'value'`（**像素值本身**，如 L-system 的离根距离场 —— 生长顺序编在值里）。
  三者共用 `cell * step(量, u_front)` 的形状，所以值为 0 的背景在任何模式下都不会被点亮。
  `BakeResult.frontMax` 的口径随轴变（行数 / 列数 / 255）。守卫：`algo-uniforms.test.ts`
  断言三种模式都至少被一个生成器用到。
  - ⚠️ **`'value'` 用来编「揭示顺序」时，那个量必须真的随揭示单调**。挑错了不会报错，
    只会让动画在第一帧演完。两条实测踩过的选错法（现在写在各自文件头）：
    **按命中密度**（混沌游戏 —— 它的不变测度在吸引子上本来就是均匀的，密度只是
    覆盖不全的泊松噪声，归一化后挤在一档）与**按落点序号**（前几千个点就铺满了）。
  - ⚠️ **新增 bake 型生成器要改 `algos/bakers.ts`**，不是 `bake.worker.ts`。
    那张表原来是硬编码在 worker 文件里的，而 worker 挂了 `self.onmessage` ⇒
    Node 里 import 就炸 ⇒ **没有任何测试读得到它 ⇒ 漏登记不报错**：`BakeClient`
    只在控制台打一行，画面永远空帧。实测代价是「批量导出缩略图 25 张成功、
    2 张纯黑，而整套单测全绿」。现在表在 `bakers.ts`，由 `bake-registry.test.ts` 钉住。
- **程序化场景 = `realtime` 生成器，共用 `SCENE_GLSL`**（`shader-lib.ts`）。
  它 = 已登记的 `FBM6_GLSL` + `MATH_GLSL`（就是 angel-echo 的 `LIB`，**不要抄第二份**）
  + 音频特征 uniform 块 + `edge()`。所以场景体里写 **`fbm6(...)`**，不是上游的 `fbm(...)`。
  场景 id 一律带 **`scene-`** 前缀 —— 特效注册表里已有 `tunnel`，另有 `kino-datamosh` /
  `audio-bars` / `flow-contours` 这些近似名；两张表技术上不冲突，但试炼场左栏（源）与
  右栏（特效）同时出现两个「隧道」是纯粹的误导。
  - `setUniforms` 一律用共用的 `sceneUniforms(extra)`；编排量（密度 / 扭曲 / 色调 / 切段 / 升调 / 进度）
    是 `arrangementParam()` 造的**普通 range 参数**，用户自己打关键帧 ——
    **不要**把 angel-echo 的 `plan.js` 段落表搬进来（AGENTS §8 明确「不要拿」）。
    `extra` 是**该场景私有的 range 参数键**（如 `scene-ripple` 的 spacing / drive / sharp…）。
    ⚠️ **`realtime` 生成器的 select 参数派发不了**：`floats()` 里是 `Number(v[key]) || 0`，
    字符串值会静默变成 0。realtime 要区分形态就用 **0..1 的 range**，不要用 select。
  - **`scene-pulse` / `scene-tunnel` / `scene-dissolve` 已合并成 `scene-ripple`**（2026-10）。
    三条的主项都是 `f(r)` 的环，肉眼几乎不可分；合并后环距 / 驱动 / 锐度 / 辐条 / 噪点
    全是参数。别再去找那三个 id。
- **音频特征层**（`audio/features.ts` + `algos/feature-source.ts`）：
  - **必须离线预计算**。上游的 `Impulse.step(dt)` / `approach` 是逐帧按 `dt` 推进的有状态量，
    与硬约束 1.1 冲突（seek 不可复现）。这里给的是**曲线的查表**：`at(t)` 是 t 的纯函数。
  - 与频谱**共用一趟 FFT 走查**：`computeSpectrum(buffer, onProgress, onFrame)` 的钩子挂上
    特征累加器。帧数 / hop 由 `planSpectrum()` 唯一定义 —— 自己抄一遍那套算术，
    表现是「特征曲线尾部静默变成 0」。
  - 接口注入（`AlgoFeatureSource`），`render-core` 依然不 import `audio/`。主应用给
    `ProjectAudio`（频谱 + 特征一次算完），lab 给 `createLabFeatures()` 的合成特征。
  - **冲量是闭式的**：`exp(-距今多久 / decay)`，不是累加器。kick / bar 由**拍网格**给
    （JS 侧才拿得到 `BeatGrid`），hit 由 **onset 年龄**给。
  - `u_ages` 是 `vec4`（最近四个 onset 的年龄），没有 onset 时给哨兵 9。
- **生成器也有接线自检**：`tests/unit/algo-uniforms.test.ts`（与 `effect-uniforms.test.ts`
  共用 `_uniform-probe.ts` 的伪 GL 骨架）。判据：realtime 的 fragment **没有重复声明 head**
  / **声明的都被写** / **写入类型与声明一致** / **没摸到未声明的名字**。
  这一类失效全是静默的（拼错名字、`uniform1f` 写 `int`），`compileAll` 看不见。
- 烘焙是**异步就绪**的：未就绪时该层返回 `null`（「这一层缺席」）。试炼场工具栏把
  「源：等待中 / 就绪」显式化。
- openmosh 的 Rnd 按钮用裸 `Math.random()`；移植时换成 `mulberry32(hashSeed(...))`，
  于是「第 1 次点随机」在任何机器上都是同一组参数。
- 视频 / 音频这类**异步就绪**的东西，性能只能从**导出路径**量。预览缺帧时用最近的帧顶上
  （很快），所以「连着渲 N 帧再计时」量到的是渲染缓存纹理的成本 —— 会得到荒谬数字。
  `ExportOptions.onFrame`（`export-runner.ts`）给出每帧真实耗时，`__artmatic.exportTiming(n)`
  是它的 E2E 出口。

#### 参数类型：`bitmask` 与 `pattern`（2026-10-04）

两个新变体是为「规则可调 / 种子可画」加的，它们**都不需要抬 `SCHEMA_VERSION`**
（运行期逐键 `?? defaultValue` 合并，见 `runtime.evalParams`）。代价是参数表多了一个键
→ bake/sim 的缓存哈希变了一次 → 老工程第一次打开会重烘一遍。**这是正确行为，不是 bug。**

- **`bitmask`**（`bits` / `groups` / `slider?` / `presets?`）：一个 `0..2^bits-1` 的整数，
  UI 是「可点击的位表 + 数值框」。存在的理由是**同一个控件要服务两种规则**：一维 CA 的
  规则号（8 位）与生命类 CA 的 B/S 掩码（18 位 = 出生 9 + 存活 9）。做成 `range` 的话
  B/S 会得到一条 `0..262143` 的滑杆（毫无语义），而且 `evalParams` 对 `range` 有关键帧
  分支，混进来会让「这参数能不能打关键帧」说不清。
  - 位号 → 行的映射在 **`core/bitmask.ts` 唯一定义**：`'eca'` **高位在前**（111 那一行是
    bit7，`Rule 30 = 00011110₂` 就是这么读的）／`'count'` 低位在前（邻居数 0 起）。
    界面点亮的位与生成器生效的规则必须是同一套映射，各写一份的 bug 形态是
    「点亮的位与画面不符」，看代码看不出来。
  - B/S 的打包：**出生占低 9 位、存活占高 9 位**（`masksFromBS` / `birthFromMask` /
    `surviveFromMask`）。Conway = 6152、HighLife = 6216，**用 `masksFromBS([3],[2,3])`
    算，不要写魔数**。
  - `rule = 0` 是**合法**规则。读值一律 `clampMask(v, bits)`，**绝不要写 `Number(v) || 110`**
    （那会把用户选的 0 换成 110）。

- **`pattern`**（`defaultValue` 是串、`editorSize?`、`mode: '2d'|'1d'`）：一枚
  `WxH:<base64>` 编码串，**空串 = 没有图案**。编解码在 `algos/pattern-codec.ts`，三条纪律：
  1. **永不抛异常。** 它读的是磁盘上的 `project.json`（手改过、旧版本写过、截断过）——
     一律降级成 `null` / 补 0 / 截断，绝不把工程卡在打不开的状态。
  2. **自带尺寸。** 图案不是网格的附属：同一张 32×32 的图案要能盖到 112² 或 256² 上。
  3. **跨环境逐位稳定。** 自带 base64 实现（不用 `btoa`），于是浏览器 / Worker / Node
     三处一致，且能在 vitest 里纯测。
  - **全零图案是合法值**（语义是「清空」），与 `null`（坏串 → 回退随机）是两回事。
  - 盖印一律 `stampCentered`（**居中 + 裁剪**，不缩放）；一维 CA 用 `stampRow`（只取第 0 行）。
    居中而不是左上角对齐：网格远大于手绘图案时，左上角对齐会让图案缩在角落，
    而且改网格尺寸时位置会漂。
  - `seedMode` 语义：`game-of-life` 是 `random | pattern`，`rule110` 是
    `single | random | pattern`。**pattern 模式不消耗 RNG** —— 于是 `seek ≡ 顺序 step`
    这条不变量与旧实现同构，不需要额外的确定性论证。
  - 编辑器（`ui/pattern/PatternEditorModal.svelte`）是**精简版**：涂/擦（经典拖拽语义，
    没有独立笔刷开关）、清空/反相/随机、网格尺寸、几个标准预设。**刻意不做**
    旋转/镜像/平移/洪水填充 —— 它存在的唯一理由是「画出随机撒种给不出的初始条件」。
  - 画布必须 `data-exempt`、DPR 比较必须 `Math.round`、随机走 `mulberry32(hashSeed(…))`
    （§1.2 禁止裸 `Math.random()`）。全部改动是**本地草稿**，只有「应用」才回写参数
    → 整个编辑过程是一笔撤销。

#### sim 多通道 与 realtime 辅助纹理（协议形状已定，等第一个使用者）

- **`SimHandle.channels?: 1|2|4`** + `current()` 返回**交错**字节（长 = `w*h*channels`）。
  `undefined/1` 必须**逐字节走旧的 R8 路径** —— 这是 `algos.spec.ts` 的 seek 确定性用例
  与「生命游戏逐像素不变」的前提。选交错而不是分平面：`texSubImage2D` 一次上传就吃。
  3 通道**不支持**（没有 24 位内部格式，多出来那一通道浪费掉比造一个奇怪格式划算）。
- **`sim def.tintFragment` / `setTintUniforms`**：自定义着色，**只写 `main`** ——
  `runtime.ts` 抽出的 `TINT_HEAD` 已经声明了 `u_tex` / `u_colorBg` / `u_colorLive` /
  contain 适配。多通道模拟（Gray-Scott 的 u/v）就读 `u_tex.g`。
  program 名由 `algoTintProgramName(id)` 生成（`algo-tint-*`，与 `algo-*` 分开 ——
  撞名就意味着另编一份或者拿错的那份）。
- **`realtime def.auxTextures`** + `AlgoUniformCtx.aux?`（**必须可选** ——
  `algo-uniforms.test.ts` 用 `satisfies AlgoUniformCtx` 构造 ctx，加必填字段会编译失败）。
  目前只有 `glyph-atlas`：运行时用 Canvas2D + 系统等宽字体画出来，**不引任何字体资产**。
  - ⚠️ 用 aux 的 def 落地时，要把它声明的 uniform 名并进 `algo-uniforms.test.ts` 的
    `HEAD_OWNED` —— 那些 sampler 由运行时绑，不经 `setUniforms`，会被误判成「漏写」。
- 建纹理 / 上传纹理前**先切到 scratch 单元**（见 §5.5 的 GL 状态事故）。

#### `SimDef.volatile`：哪些参数**不该**参与「算一次、缓存起来」那段

`bake` 的烘焙入参与 `sim` 的构造参数都会进一个哈希（`runtime.ts` 的 `cacheHash`），
哈希变了就重烘 / 重建。`volatile?: string[]` 里的键被排除在哈希之外。

**为什么需要**：`rate`（速度）、`colorBg`/`colorLive`（配色）、`palette`、`contrast`、
显示开关都**不参与** `create()` / `bake()` —— 它们只在渲染期读。不排除的话，
拉一下配色滑杆就会重建整个模拟。

> ⚠️ 代价说准一点：模拟是**确定性**的，重建之后 `seek(t)` 会从 0 重放到同一个状态 ——
> **画面完全一样**，状态不会丢。重建的真实代价是**时间**：每次重放 `elapsed × rate` 步，
> 长片子上是秒级卡顿。所以这是一个**延迟**问题，不是数据丢失问题。
> （也正因如此，它没有 E2E —— 墙钟断言在 headless 里必然 flaky。机制由
> `tests/unit/reaction-diffusion.test.ts` 的 `cacheHash` 用例钉住。）

**家族约定**：sim 的速度参数一律叫 `rate`，运行时每帧从**当前**参数读它
（`liveRate`）。所以「改速度」连重建都不需要，只是重新映射 `t → step`。

#### sim 的状态精度与快照

- **内部用高精度 typed array**（`Float32Array` / `Uint16Array` / `Uint32Array`），
  只有 `current()` 做 8 位量化。**快照必须存内部精度**——存量化后的输出会把每一步的
  舍入误差累积进重放路径，`seek(f) ≡ 顺序 step f 次` 就不成立了。
- 量化的口径逐生成器写在自己的 `current()` 里（如反应扩散把 v 乘 3 拉开窄动态范围、
  沙堆用 `sqrt(h)·96` 让 2 与 3 的差别可见）。**这些是显示处理，不影响状态。**
- **快照用 `sim-util.ts` 的 `SnapshotRing`**，它做**抽稀阶梯**而不是「只留最近 N 张」：
  第 0 帧恒存（任何回退都能从它重放），超过 cap 就把阶梯加倍。
  只留最近 N 张的话，回退到很早的帧就退化成「从第 0 帧重放几万步」。
- **别在回退时丢弃 newer 快照**：`step` 是确定性的，同一帧的旧快照与重算出来的
  状态逐位相同，留着还能省一次重放。

#### 元胞自动机家族：默认值必须**实测**选定

Wave 2 加了 7 个 CA / 人工生命生成器（反应扩散、Brian's Brain、循环 CA、沙堆、
雪花、Lenia、Wireworld）。它们的默认值**不是从文献抄来的就完事** —— 有四处是
实测才发现的：

| 生成器 | 文献/直觉的默认 | 实测 | 结论 |
|---|---|---|---|
| 反应扩散 · 撒点密度 | 15%（看着像噪声） | 整场 ×10% / ×60% **8 个预设全空**；×30% 只有 3 个活着 | 改成**只在中间 60% 区域**撒、密度 0.4 |
| 反应扩散 · 预设表 | 8 个 (F,k) | `bubbles` 在标准种子下**任何尺寸任何密度都全空**（需强种子） | **删掉 bubbles**；`spots` 要**小**种子（r=4 才得到稳定斑点，r≥8 崩） |
| 循环 CA | K=12 / θ=2 / Moore（网上常见） | **一步冻死**（8 个邻居落在指定状态的概率只有 1/12） | 改成 **K=8 / θ=2 / Moore**（8.6% 的格子每步在变 = 局域化波前） |
| Lenia | σ=0.015（Orbium 那套） | 在任何 μ 下**一步就死** | 改成 **σ=0.03**（那套窄 σ 配的是 Orbium 自己的环形位图） |

**判据是「画面活不活」**，而它有个陷阱：`ink = 非零格数` 对多态/连续场是**无意义指标**
（循环 CA 的 92% 格子非零、雪花的 100% 格子非零）。要按生成器选判据：
循环 CA 用「相邻两步变了几格」（能抓「冻住」），雪花用「冰的格数」（能抓「不结晶」），
多通道用「某个通道的非零格数」。

#### Reiter 雪花：两个**单测抓不到**的 bug（2026-10 修）

第一版文件头写着「长得像不像雪花只能靠眼睛」，而**没有看** —— 于是带着两个 bug 发布：

1. **扩散均值用了原始 `s`，没用 `u` 场**。Reiter 原文把含水量拆成 `s = u + v`，
   **receptive 格（冰 + 冰的紧邻）在扩散场里贡献 0** —— 它们是吸收汇。用原始 `s`
   等于让冰格以 1.0 参与邻居平均 ⇒ 晶体反过来向周围**供水** ⇒ 生长速度与几何无关
   ⇒ **只能长成实心圆盘**（实测 β 0.15→0.55、γ 扫三个量级，全是圆盘）。
   改对之后枝隙里只看到少数非零邻居，界面张力（Mullins–Sekerka）才建立得起来。
2. **六角邻域本身是错的**：偶数列写成 `{(±1,-1),(±1,0),(±1,+1)}`（**本列反而没有邻居**），
   奇数列又是另一套，两套互不对称 ⇒ 邻接关系不满足双向 ⇒ 那根本不是一张六角格。
   后果是长出一个朝左张开的**楔形**。

守卫（都在 `cellular-automata.test.ts`）：邻域的**双向 + 镜像对称**可枚举；u 场规则用
「紧邻吸水 / 次邻被抽干 / 远场不动」三点钉住；再加一条**质心偏移 < 8% 半径**的行为判据。
三条都做过「把 bug 改回去看它真的变红」。

另外两条口径：**边界条件不是装饰** —— 远场钉在 β（`r > 0.92·n/2` 每步重置），
没有它环面会把整个未冻区稀释掉、生长几十步就停摆；**α 的两种写法在 α=1 时重合**
（`u + (α/2)(mean−u)` 与 `(α/2)(u+mean)`），只有前者对任意 α 都是显式欧拉离散化 ——
写成后者时 α<1 会整体按 α 衰减，实测 α=0.4 跑 1600 步只结出 7 个冰格。


**两个生成器被推迟，不是因为难写，是因为实测证明它们不成立**：

- **SmoothLife**：我拿不到一个有把握的转移函数表述，而错的表述只会在「死」与「炸」
  之间二选一 —— 那等于发布一个坏掉的生成器。它同时也是最慢的（ra=20 约 11M MAC/步）。
- **可激发介质（Barkley）**：实现了、也调了 ε×dt 的网格（12 组），但**螺旋与靶形波
  都在 t≈2000 熄掉**，而真正的可激发介质螺旋是**持续**的。要修得先做对的螺旋初始
  位形（半平面加缺口那套不产生持续螺旋）与参数搜索 —— 那是独立的一轮工作。

沙堆还带一条**防卡死的闸门**：`stabilize(..., maxTopple)`。逼近饱和时一粒沙能引发
极大的雪崩（实测能跑几十秒），没有闸门就意味着「撒沙量拉满 + 网格调小」可以直接
卡死主线程。闸门**不影响确定性**（上限是步数的固定函数），代价只是雪崩特别大的
那几步堆暂时没稳。撒沙量另外按 `n²/32` 收了口。

⚠️ **闸门截断是静默的**：被截断时格子里会留下 `h >= 4` 的塔，画面**不再表达模型
状态**，但没有任何报错。判据：`current()` 的映射是 `v = min(255, round(sqrt(h)*96))`，
稳定态 `h <= 3 ⇒ v <= 166`，所以 **`v > 166` 的格子就是没塌完的**。
有一条单测钉着「出厂默认跑满一整条时间轴不许出现这种格子」。

⚠️ **沙堆的成本 ∝ (总沙量)^1.5，与网格大小无关**（中心落点把所有沙倒进同一个格子，
只能靠崩塌把它推向边界）。于是「默认值把网格铺到多满」直接决定能不能算完：

| 配置（24 秒轴） | 总沙量 | 沙/容量 | 整条轴 | 最坏未稳定格 |
|---|---|---|---|---|
| 256² 200/步@30（旧默认） | 144,000 | 73% | 3.39 s | **418** ← 撞闸门 |
| 160² 60/步@60 | 172,800 | 75% | 1.28 s | **192** ← 撞闸门 |
| **160² 60/步@30（新默认）** | 43,200 | 56% | **0.52 s** | 0 |

判据是**绝对沙量**：四万多粒随便跑，十四万粒必截断。

⚠️ **`stabilize` 曾经只塌一次就停手**（崩塌之后不重新入队，只靠「邻居推高它时才
入队」）。它看起来正常纯属巧合：`stepOnce` 的中心落点把同一格重复推进队列
`batch` 次，那些重复条目凑出了够用的弹出次数。**一格 `h=40` 会被弹一次、塌到 36，
然后队列空掉、稳定化就此结束**（实测 `done=1`、`maxH=170`）。有回归守卫。

⚠️ 「阿贝尔性」（顺序不影响稳定态）只在**总沙量 ≤ 容量**（`3 × 格数`）时成立 ——
超过容量时环面上不存在稳定态，稳定化永不终止、只能被闸门截断，而截断点与顺序
有关。那条单测原先用 4000 粒跑 24²（容量 1728），是**靠运气**过的。

#### 拖动播放头：步进预算（`AlgoRuntime.setStepBudget` / `planSimStep`）

`SimHandle.seek(f)` 是**精确**语义（`seek(f) ≡ 从 0 顺序 step f 次`，硬约束 1.3），
所以向前跳必须**真的把中间每一步算完** —— 迭代系统没有闭式解，也没有能直接跳到
`t(n)` 的算法。实测一条 24 秒时间轴从头走到尾：**Lenia 1.04 s、沙堆 0.53 s、
反应扩散 0.51 s**，其余 ≤ 0.3 s。整段同步算完 = 主线程冰住几秒（这正是一开始
「向前拖卡、向后拖不卡」的原因：向后被快照环兜住，代价有上界）。

**没有改 `seek` 的语义**，改的是「这一帧渲哪一帧」：拖动期间只推进付得起的步数，
画面显示模拟**真实经过**的某一帧（只是比播放头早），松手后按追赶档继续推进，
追上（`simLag === 0`）就回到精确。三层结构：

| 层 | 在哪 | 职责 |
|---|---|---|
| 令牌桶算术（纯） | `planSimStep` | 决定这一帧想推到哪一帧；余额有上限，不会攒出大跳 |
| 分块执行 + 看表 | `AlgoRuntime.advanceBudgeted` | 单步成本会突变（雪崩），按估算一口气推完会做出几百毫秒的毛刺 |
| 三档策略 | `app-state.syncSimBudget` | 导出/播放 0（精确）、拖动 6 ms、追赶 12 ms |

- **`budgetMs = 0` 是精确路径，且是默认**：导出、播放、lab 静止态、全部单测都走它。
  改动时**不要**在 `budgetMs > 0` 分支里顺手改精确路径那个 `seek`。
- **导出期间预算必须是 0**：导出是逐帧权威输出，渲一张落后于播放头的帧就是错的。
  `syncSimBudget` 因此放在 `tick()` **所有提前返回之前**，lab 那边放在节流 `return`
  之前。
- 拖动时画面会比播放头早 —— 底栏有 `statusbar-simlag` 段做提示（`app.simCatchUp`），
  没有它用户会以为预览坏了。
- lab 的「手势信号」直接是 `setT()`（时间滑杆每次 pointermove 都调它），收回在渲染
  **之后**（要先看到真实滞后）；批量导缩略图因此不受影响。
- 用到的 `performance.now()` 与 `tick()` 里那个降帧率节流同类：**传输层节流，不参与
  内容求值**（硬约束 1.1 管的是内容）。

#### 生成器预览缩略图（静态 WebP + 菜单悬停浮层）

二十多个生成器光看名字（「李雅普诺夫分形」）没人知道插进去长什么样，所以
「插入片段 → 算法片段」二级菜单在**悬停某一项时**给一张缩略图 + 一句话说明。

- **素材预先导出、静态存放**：`node scripts/gen-algo-thumbs.mjs` →
  `src/assets/algo-thumbnails/<id>.webp`（640×360，26 张共 518 KB）。
  脚本自己 build + 起 preview + 用 Playwright 调 `__lab.renderThumb()`，
  **直接落盘**（不像特效那套打完 zip 还要人工解压——素材跟着代码走，
  多一步人工就多一次「导出了但忘了解压」）。
- 渲染器 `render/algo-thumb-renderer.ts`（与 `effect-thumb-renderer.ts` 同一
  手法：另起一台离屏 render-core）。**翻行那一步直接复用后者的
  `pixelsToCanvas`** —— 抄第二份的下场是「特效图是正的、生成器图是倒的」。
- ⚠️ **`sim` 的采样时刻单位是「步数」不是「秒」。** 决定形态的永远是
  `t × rate`，而各生成器的默认步频差 40 倍（雪花 10、兰顿蚂蚁 400）。按秒
  给必然得到一堆「刚开始长」的图 —— 第一版就是这么错的：雪花 t=16s 只有
  160 步（一个孤点）、蚂蚁 2400 步（一小团）、反应扩散 1680 步（一个环）。
  配方表与目标步数见 `algos/catalog.ts` 头注。
- ⚠️ **bake 是异步的，必须重试。** 第一次调用时烘焙还没好，`renderFrame`
  渲出空帧。**从 Node 侧轮询**（20 × 300ms）：在 page 里自旋会把主线程占住，
  而 bake 的 Worker 要主线程跑消息循环才会被唤醒。
- ⚠️ **频谱与音频特征都要给**（`staticSpectrum()` + `staticFeatures()`）：
  这条链上「不传也能跑」的注入点全是静默退化 —— 吃频谱的只剩底图，
  `scene-*` 读到全零特征会又平又暗。缩略图是给人挑东西用的，必须代表真实长相。
- 三条守卫：`algo-thumb-assets.test.ts`（资源与注册表对齐 / 非空 WebP /
  **sim·bake 必须显式给 `previewT` 且 > 0** / 说明长度 ≤ 44 字）、
  `algo-preview.spec.ts`（浮层出现 + **图真的加载出来**（`naturalWidth > 0`）+
  换项换图 + **浮层不许盖住高亮项**（`elementFromPoint`）+ 关闭后无孤儿）。
  （同一个文件里还有「展示信息目录与注册表对齐」那批：缺条目 / 孤儿 /
  `previewParams` 里的键不存在 / 说明文案解析不出或过长。）

**菜单浮层的实现**（`ui/controls/Menu.svelte`）：`MenuItem.thumb` / `.desc`
有值就渲染浮层，贴在**当前高亮项**右侧 —— 复用 `computePopoverPosition`
（含贴边翻转），位置在同一个 `$effect` 里算，与子菜单面板同一套 `data-menu-index`
量 rect 的手法。**不引入额外的 hover 状态**：`menu.levels` 就是唯一真源，
鼠标划过与方向键都会更新它，于是浮层自动跟着键盘导航走。三条踩过的：

1. `submenu()` 不接 `testid` —— 二级菜单父项原本没有 testid，测试点不到它。
   在 `clipItems` 里展开时补一个。
2. 浮层的 testid 用**固定**的 `menu-preview`，不跟 `testid` 拼：拼出来的名字
   （`track-menu-panel-preview`）会让测试绑死「从哪个入口打开的菜单」。
3. `bind:this` 挂可变 `let` 会被 svelte-check 报 `non_reactive_update` →
   用**单元素数组**（与同文件的 `panels` 同一手法）。

#### 2D 分形（Wave 4 批次 2）：newton / kleinian / lyapunov

三个都是 `realtime`，几何全在 fragment 里。三条只有踩过才知道的：

- **Newton 的 `z ← z − a·f/f'` 必须显式写复数除法。** GLSL 里 `vec2 / vec2` 是
  **逐分量**除法 —— 写成 `a / b` 能编译、能跑、不报错，只是结果完全不是牛顿法。
  实测：正确实现画面平均亮度 **125.2**，换成逐分量除法后塌成均匀色（**12.8**，
  `spread` 直接归零）。守卫两条：`fractals2d.test.ts` 的结构断言（fragment 里
  必须有 `cdiv(...)` 调用点）+ `algos2d.spec` 的 `mean > 80`。
- **`cpow` 走极坐标前必须挡 `r < eps`**：`pow(0, 0)` 与 `pow(0, 负)` 都是 NaN。
- **Kleinian 的常数有适用范围。** 判据出自 Unity Graphics Programming 卷 4 第 2 章
  （Jos Leys 的 2-cycle 逃逸时间法），其中 Line3 的分界公式里 `1.95 / 7.2 / 15`
  是按 `u ≈ 1.94` 标定的 —— 所以 `real` 的参数区间刻意只给 1.80..2.10，
  放开就会从「圆链」退化成一片条纹。**这次的 DE/判据是照权威来源逐字写的，
  不是凭记忆**（`apollonian` 那条 DE 就是凭记忆写错的）。
- **Lyapunov 的序列用 `pattern`（1D）而不是 `bitmask`**：序列的身份由「位模式
  **和** 长度」共同决定（`AB` 与 `ABB` 编成同一个整数），而 `pattern` 自带宽度。
  shader 侧用 `floor(bits / exp2(k)) mod 2` 取位（GLSL ES 3.00 没有整数位运算），
  所以 **24 位是硬上限**（float32 的精确整数界，单测钉着它）。三条回退规则都
  回退到 `AB`：解不出 / 长度 < 2 / **一位都没点亮**（全是 B 会让 a 区间完全
  失去作用 —— 用户拖 a 的上下限却什么都不动）。

**这一批最贵的教训是「判据本身也会骗人」**，两条都实测过：

1. **把颜色压成一个标量之后，有些调色板会变成常量。** 余弦调色板的三个通道
   恒差 2π/3 ⇒ `(R+G+B)/3` 对**任何** t 都是 127.5。Lyapunov 换序列明明换了图，
   用亮度比出来的 L1 只有 **0.086**（正好是那条读回竞态的量级），判据完全失效。
   现在 `_stage.gridStats` 的 `samples` 存**逐点 RGB 三通道**，`sampleL1` 逐通道比；
   「有没有结构」用 `spread`（单通道最大跨度），**不用 `mean`**。
2. **分块均值对「铺满整幅的彩色渐变」同样不敏感**（3D 那边是「黑底 + 一块亮
   形体」，分块均值在那里才有效）。要按图的统计特性选判据。

#### 3D 内核（`algos/sdf-lib.ts`）

四个 3D 物体（`menger` / `mandelbulb` / `apollonian`，以及将来的场景系统）共用
**相机 + 步进 + 法线 + 光照 + 雾**；生成器只写自己的 SDF 与 `main`。

- **`sdfKernel(sd)` 是模板函数，不是 `#define`。** GLSL 没法把函数当参数传，
  所以共享的步进循环必然要知道调哪个 SDF。`#define ART_SD(p) sdX(p)` 那条路
  还得配一句**前向声明**（使用点在定义之前），两处要同步；模板只有一个真源。
  ⚠️ 但模板也**必须自带前向声明** `float sdX(vec3 p);` —— 忘了就是
  `no matching overloaded function`，而报错行指向内核里那句调用，像内核写错了。
- **共享 uniform 12 个**（`u_steps/u_maxDist/u_stepScale/u_eps/u_fov/u_light/
  u_gain/u_fog/u_ao/u_palette/u_color/u_colorB/u_bg`），由 `sdfUniforms()` 一次派发；
  参数与文案键共用 `sdfParams()` / `algo.sdf.*`。`menger` 的 `steps/fog/ao`
  默认值刻意不同（保住上游那张画面），**但文案键必须同源**。
- **`u_stepScale` 不是「越接近 1 越好」**：分形 DE 多是**过估**，按 1.0 走会
  在结构内部直接穿过去，表现为整块噪点。Menger 0.9 够用，其他分形按需压。
- **光方向用两个角度**（`lightAz`/`lightEl`）而不是 vec3 —— `ParamDef` 没有
  vec3 这一档。默认 (-45°, 44°) 复现 `menger` 上游那个固定光向。
- **`menger` 保留自己的相机**（同时转 `ro` 与 `rd`，上游写法）：与 `sdfOrbitCam`
  数值等价但参数化不同，换过去取景就变了 —— 它是唯一有上游参考画面的对象。
- 成本实测（headless，720p / 70 步 / 5 级递归）：比纯色只贵 **约 3 ms/帧**，
  读出同步才是大头。**不需要为 3D 降 `intRes` 默认**；要盯的是 `iter`/`depth`
  （每步的 SDF 成本）而不是像素数。

**两条只有真 GL 才能发现的坑**（都实际踩过）：

1. **`u_twist` 声明了、派发了，但 SDF 里没读它** —— uniform 被链接器丢掉、
   `getUniformLocation` 返回 null、`Program.u()` 静默跳过：滑杆能动、画面不动。
   伪 GL 的单测看不见（那边的 location 永远有效）。守卫是 `lab.spec` 里那条
   **「声明了但没被读过」**（`compile-all` 用 `ACTIVE_UNIFORMS` 算出来）。
   修法：扭转**写在 SDF 内部**，不要包在 5 个调用点上。
2. **Apollonian 的 DE 里 `k` 的分子写成了累积量** —— 参考实现
   （iq，ShaderToy `4ds3zn`）里 `k = s / r²` 的 `s` 是**固定参数**，只有 `scale`
   累积。写成累积量会让它指数发散、DE 一路趋零，于是整片空间都判定为命中：
   画面外围是一大块平坦的灰「墙」（y=0 平面被当成表面）。**单帧截图看不出
   公式错**，是「外围为什么有一块平面」这个疑问带出来的。

#### Lenia 的卷积（`sim-util.TorusField`）

- **环状核在 `width=0.15` 下实际是**整个圆盘**：峰值在 d=0.5，而 d=0 处权重仍是
  `exp(-5.6) ≈ 3.8e-3`，远大于 `eps=1e-4`。实测 R=10 → 317 抽头 = πR²。所以成本是
  Θ(n²·πR²)（R 从 10 调到 16 就是 2.5 倍），**调 `eps` 一点用都没有**。
- `TorusField` 给场加一圈 R 宽的 halo，内层循环只剩一次乘加、零分支：
  112²/R=10 实测 **7.82 → 3.80 ms/次（2.06×）**，且**逐位相同**（`maxDiff === 0`）。
  halo 最容易错的是**四个角**（上下两条 halo 只复制中段、不连左右一起复制），
  有单测与朴素回绕实现逐位对拍。
- 偏移表按核预计算 —— 每步重建会把 2× 的收益吃回去。


### 5.7 排版

- 编辑器形态：**工程内部的一个视图**，UI 是数据驱动的 Ribbon（Tab / 分组 / 按钮，
  含 Contextual Tab 与横向滚动 —— 窄窗口横向滚动是设计如此，Office 也是这么做的）。
- **双击片段 = 打开它自己的编辑器，一律不切分**（切分保留 `S` 键与检查器的按钮）。
  双击是最高误触的手势，把破坏性操作绑在上面迟早出事。
- 快捷键按**分流**处理：`App.svelte` 的 `onKey` 在编辑器打开时整段交给
  `ui/typography/keys.ts`。于是 `S`（切分）与 `Alt+↑↓`（移轨）在排版页**自然失效**，
  不需要在时间轴的每条分支上加 `if (!editorOpen)`。
- **编辑器内不做脏标记** —— 排版编辑全程直写工程（可撤销），不存在「切走就丢」的东西。
  需要脏标记的是「工程 vs 磁盘」（`savedVersion`）。
- **四条实现规则**（不遵守会静默出错）：
  1. **字体子集化，按字形集哈希缓存**。不做这条每帧上百毫秒，做了是毫秒级。
     字形集只在打字时变化，命中率极高。
  2. **不要用 `embedFonts:false` 换性能** —— 实测它的差异量级与「故意换成另一个字体」
     几乎相同，等于换了字体。要性能就裁字体。
  3. **导出前必须 `await document.fonts.ready`**，否则首帧用回落字体量度，导出与预览
     不一致，且「看起来都正常」，极难定位。
  4. **动画状态要烘焙，不要指望库读懂**：WAAPI seek → 把计算值写进内联样式 →
     停掉 animation → 再截图。（WAAPI 的 seek 实测误差为 0，所以 CSS 动画可以帧精确导出，
     但必须走烘焙路径。）
- **字体按 face 而不是按族组织**（最小单位 `family + weight + style`）：一族只存一份字节的话，
  粗体只能由浏览器合成，而舞台用的是真正的 700 字面 —— 「预览是真粗体、导出是合成粗体」，
  字宽与笔画都不同，逐像素一比就是几万个像素。
- 字体**只存引用**（`FontRef`）：9 MB 中文字体 base64 进 `project.json` 会把工程变成
  不可用的大 blob。内置只有 OFL 的 Inter；中文字体由用户自行导入。
- HarfBuzz 的 subset **只吃 SFNT（TTF/OTF）**，woff / woff2 走「原样内联」分支。
  四个 wasm 坑写在 `typography/font/subset-hb.ts`：`memory.buffer` 的视图会在 wasm 内存
  增长后 detach（每次用堆视图前都重取）、`hb_blob_get_data` 返回堆指针要先 `.slice()`、
  `HB_MEMORY_MODE_WRITABLE` 的源数据要最后才 free、遍历字形必须按**码点**（`.length` 索引
  会把代理对切碎）。
- **光栅化缓存键 = `docHash(doc) | WxH | frame`**。`docHash` **只哈希 `clip.source.doc`**，
  不掺 `store.version` —— 否则改一下无关片段的名字就把所有排版缓存击穿了。
  **静态文档（`docIsAnimated === false`）的帧号是 `null`** ⇒ 尺寸相同就永远命中同一条缓存
  （带帧号会让一张标题卡每帧重做一遍，而且**看不出来**，只是慢）。
  **默认不做预烘焙 PNG 序列**：1080p 一帧 RGBA = 8.3 MB，150 帧 = 1.24 GB；逐帧按需光栅 +
  LRU 常驻只需 1–2 张纹理。内存预算：`MAX_RASTER_EDGE = 4096`，预览 48 MB / 32 条，
  **导出期收紧到 2 条**。
- **纹理上传方向**：`VERT_QUAD` 里 `vUv = aPos*0.5+0.5`，v=0 是**底部**；而 `texImage2D`
  默认把图像首行放到 v=0。所以排版纹理上传必须 `UNPACK_FLIP_Y_WEBGL = true`，否则文字
  上下颠倒（`typography-export.spec.ts` 有方向断言钉着）。
  ⚠️ **`UNPACK_FLIP_Y_WEBGL` 对 `ImageBitmap` 源在 Chromium 上被忽略** ⇒
  图片 / 视频的上传源统一成 **canvas**，翻转在 `SourceManager.uploadImage` 一处定义。
- **两个测试钩子**：`FontRegistry.subsetting` 可关（退回整体内联），
  `typography-font.spec.ts` 用它断言**子集 vs 全量逐像素零差异** —— 这是唯一能证明
  「子集化没有改动字形或度量」的测试。光栅化另有 `typoRasterize`（不经过 GPU）。
- **插入图标 = 插入 `ShapeElement(shape:'svg')`**（`typography/icon-shapes.ts` +
  `ui/typography/icon-library.ts` + `IconPickerModal.svelte`）。Lucide 的语义
  （无填充 + 圆头描边）正好落在 ShapeElement 的表达力里 ⇒ 描边色 / 线宽 / 混合
  这些既有控件插入后立刻可用，也不占素材表。图标 authored 在 24×24 而
  `shape:'svg'` 按 0..100 authored（见 `shapes.ts` 的 `scaleFrom100`），统一乘
  `100/24`，线宽用 `ICON_STROKE_WIDTH`（= 100/12）。三个会再咬人的坑：
  1. **多个图元的 `d` 不许拼成一条字符串再解析**：相对命令（`m` / `a` / `l`）的
     当前点在各自的 `<path>` 里从 `(0,0)` 起算，拼接后会接着上一条子路径的终点 ——
     图标整体错位几十个单位（`a-large-small` 这类以 `m` 开头的片段必中）。合并只能
     发生在**子路径层**：逐个图元 `parsePathNodes` → 合并 → `serializePathNodes`。
  2. **SVG `A` 命令的两个 flag 是单字符**，会与相邻数字粘连：`a7 7 0 011.412 7.872`
     里的 `011.412` 是 `0`、`1`、`1.412`。通用数字正则读成 `11.412` ⇒ 这组少一个
     参数 ⇒ **整条弧被丢掉且当前点不推进** ⇒ 后续相对命令全体错位。`path-ops.ts::tokenize`
     现在对 `A`/`a` 走逐字符扫描（这一处修好连带修正了布尔运算与顶点编辑的同类输入）。
  3. **图标数据必须分块，不要逐图标成 chunk**：1800+ 个 chunk 会让每次 `vite build`
     的 `prepareOutDir` 删除量顶爆开发机的批量删除保护（`[safe-delete]` 阈值 500），
     **第二次构建起必然失败**。`vite.config.ts` 的 `manualChunks` 按**首字母**分组。
- 图标清单 / 内容是 `import.meta.glob` 对 `@lucide/svelte` **源文件**的 `?raw` 懒加载：
  glob 的 key（= 图标名）在构建期静态解析，零打包成本；每个 `.svelte` 里有一行
  `const iconData = {...}` 由该包的构建模板写死。**升级这个包之后先跑
  `typography-icon-shapes.test.ts` 的全量守卫**（1800+ 个图标逐个转换、坐标必须落在
  0..100）—— 模板变了的话表现是「选择器里那一格是空的」，没有任何报错。

### 5.8 导出

- 所有导出走统一 `FrameSink`（`exporters/frame-sink.ts`）：`webcodecs`（主路径）、
  `png-sequence`（永远可用的逃生舱）、`gif`（**分享格式**：256 色、无音轨，
  但哪儿都能直接播）。**浏览器没有 GIF 硬件编码**，它是唯一纯 CPU 的后端，
  也是唯一会**主动降分辨率与降帧率**的格式。
- **`runExport` 的 `opts.size` / `opts.frameStep` / `opts.frameRange` 只该给 GIF
  这类自带尺寸、帧率与区间约定的格式用。** 渲染分辨率就是 `size`（不做事后重采样
  —— 缩放是又一次采样，而且像素少一个量级、后面量化与 LZW 的成本跟着低）；
  `frameStep` 跳过源帧，但每个被渲的帧仍按**绝对帧号**求值，所以
  「seek(f) ≡ 顺序 step f 次」不受影响。真正的副作用是**反馈类特效
  （`u_feedback`）的帧历史步长会变大** —— 与预览的降帧率档位是同一件事，代价已知。
  进度分母必须换成 `ceil((to - from) / step)`，否则 step > 1 时进度条永远到不了 100%。
- **区间传帧号（`frameRange`，左闭右开），不传秒。** 秒 → 帧号的换算只允许有
  一处（`gif-plan.ts`），否则「面板说 6 帧、实际渲出 7 帧」这类错位迟早出现；
  `runExport` 只负责再夹一次（它是公共入口，不能指望调用方都夹好）。
- **GIF 的体积 ≈ 帧数 × 像素数**，所以面板上真正的两个旋钮是「宽度」和**「区间」**
  （只导几秒）。24 秒的片子整段导成 480px GIF 是十几 MB —— 那已经超出「能发出去」
  的范围了。区间输入框的 min/max 互相钳制（`start.max = end`），但**别指望它挡住
  一切**：`planGif` 自己会把区间夹进 `[0, duration]` 并保证至少留一帧，
  0 帧会让 GifSink 写出那个 1 字节文件。
- **GIF 的逐帧延迟必须用「累计取整求差」**（`exporters/gif-plan.ts::gifFrameDelays`）：
  GIF 只存整数厘秒，逐帧写 `round(1000 / fps)` 会**每帧都往同一个方向掉**。
  实测 60fps → 25fps（步长 2，每帧真值 3.333cs）跑 300 帧会漂掉**整整 1 秒** ——
  静态截图上完全看不出来，只有跟着音乐看才会发现。所以 GIF 的帧率档位**只能取
  能整除 100 的值**（10 / 12.5 / 20 / 25），15 这种无论怎么取整都会漂。
- **GIF 用逐帧局部色表**（每帧 +768 字节）：全局色表要么把整段 RGBA 屯在内存里，
  要么渲两遍；而对逐帧色彩剧变的算法 / 故障素材，局部色表的画质也明显更好。
- **gifenc 是惰性写头的**：`GIF89a` + 逻辑屏描述符 + 色表 + NETSCAPE 循环块都由
  **第一帧**的 `writeFrame` 顺带写出。一帧都没写就 `finish()`，得到的是**只有
  trailer 的 1 字节文件** —— 那是次「成功」的空下载，比报错更难查。
  `GifSink.finalize` 在这里挡死。
- **数 GIF 帧数绝不能按 0x2C 字节计数**：那是图像描述符的标记，但 LZW 压缩数据里
  同样大量出现，实测能数出上千「帧」。唯一可靠的办法是按块结构遍历
  （`tests/e2e/export-gif.spec.ts` 的 `parseGif`，顺带也证明了结构合法）。
- **纯 CPU 编码的路径要把 `yieldEvery` 调小**（GIF 传 1）：量化一帧就是几十毫秒，
  默认的「10 帧让渡一次」会让取消按钮半秒才响应。默认值 10 是给 GPU 路径定的。
- **顺序纪律：`runExport` 里 `setExportSize` 必须早于 `configure`。**
  `configure` 需要 `opts.canvas` —— `Output` 只有 `addVideoTrack`、**没有
  `removeVideoTrack`**，而 mediabunny 的 `CanvasSource` 在**构造时**读 canvas 尺寸并缓存
  `VideoFrame` 工厂，所以不可能「先建源、事后再换 canvas」。顺序反了会产出错尺寸文件
  且控制台无提示。`Mp4Sink.configure` 会**交叉校验** `canvas.width/height` 与声明的 `size`。
- mediabunny 生命周期：加轨（`addVideoTrack` / `addAudioTrack`）→ `output.start()` →
  源 `.add(样本)` → `finalize()`。音频**建源 + 加轨**在 `configure`（start 前必须建好），
  灌 PCM 在第一次 `submit` 之前（`add()` 断言已 started）。灌早了报 `Output has not started`。
- **探测 H.264 用 `avc1.4d0028`（Main L4）**。`avc1.42001f` 是 **baseline 3.1**，
  其 coded area 上限 921600 = **720p**，1080p 直接被拒并报
  `the maximum coded area (921600) supported by the AVC level (3.1)` ——
  **别把这条读成「H.264 不支持」**。另：`about:blank` 不是 secure context，
  `VideoEncoder` 压根不存在，探测必须起 `http://localhost`。
- 无头环境里硬件编解码会失效 ⇒ E2E 只能断言产物**可解析**（ftyp/moov/avc1/mp4a），
  不能断言编码速度。「盒子对」也不等于「能播」—— 真正验证要把产物喂给浏览器 `<video>`
  读出 duration / 尺寸 / 非黑像素。
- **磁盘纪律**（这个项目的导出是会产生真实大文件的）：E2E 一律 320×180 / 0.5s（15 帧），
  产物落 `os.tmpdir()`，`afterEach` **无条件**删目录（断言失败时也删），并有体积上限断言
  （`< 1 MB`）。**不要为了「看得更清楚」把 E2E 时长调大** —— 长时导出稳定性是手工验一次的事。

### 5.9 预览

- 预览降质档位（帧率 1×/½/⅓、画质 100/75/50/25%、暂停回全质）**只影响预览**。
  缩放乘在 `fitPreviewSize` 的结果上，**不能走 `setExportSize`** —— 那会让 `syncSize`
  直接 return，窗口缩放 / 切工程 / 改分辨率全都不会再适配。而且**不动 CSS 盒**：
  canvas 不设 CSS 尺寸时，显示尺寸等于缓冲像素数，只缩后备缓冲画面会跟着变小。
- 帧率节流只在**播放中**生效：暂停时永远渲，那是「改一个参数立刻看到结果」的路径。

### 5.10 插件（`plugins/`）

一个插件 = **工程目录 `plugins/` 下的一个 ESM `.js` 文件**，导出一个清单对象
（`format:'artmatic-plugin'` + `id` + `name` + `effects[]` / `generators[]`）。
运行期 `import(blob:)` 挂载，所以插件能带任意函数（`setUniforms`、以及
`bake`/`sim` 将来可能的工厂）—— 也所以**它跑在主 realm 里，没有沙箱**。

- **注册表是双层**：内置层（effects 走 `import.meta.glob`，algos 走显式清单）
  + 插件层。插件内的 def id 一律注册成 **`${pluginId}/${localId}`** ——
  program 名（`fx-${id}` / `algo-${id}`）因此不可能与内置撞名，
  而「缺插件」也能靠前缀判定。
- **标签契约是 `Label`，不是 `MessageKey`**（`src/i18n/label.ts`）。
  插件的名字/说明是运行期字符串，给不出编译期键。`ParamDef.labelKey` /
  `EffectEntry.nameKey` / `GeneratorDef.nameKey` 都是 `Label`，
  **必须过 `labelOf(label, tr)`**，不许直接 `tr(x.labelKey)`。
  内置的一行都不用改（字符串天然满足 `MessageKey` 分支），而所有旧的
  `tr(...)` 调用点会**编译报错** —— 那是刻意的，它保证不漏改。
- **加载挂在 `ui/project-actions.ts::openAt`**：素材读进来之后、`adoptProject`
  **之后**（引用计数的键是 `OpenProject.id`，而 id 是那一步才产生的）。
  `adoptProject` 自己不挂插件。关闭工程走 `closeProject` → `host.release(id)`，
  引用计数归零才真卸载。
- **编译校验用与运行期同名的 program**（`compileEffect` / `compileAlgoShader`
  走 `effectProgramName` / `algoProgramName`），命中的就是运行期那一份。
  需要真 GL，所以 `PluginHost` 持有可选的 `Kit`：预览装配好时
  `appState.attachPreview` 调 `host.attachKit(core.kit)` 补做校验。
  **编不过的 def 不入注册表**（保持「缺失」语义，渲染层自动透传 / 返回 null），
  只记一条 issue。
  > `dropped-uniform` 在插件这一侧**只对参数名报**（`u_<param.key>`）。
  > `compileAlgoShader` 原本把 head 的 `u_time`/`u_delta`/`u_seed`/
  > `u_resolution`/`u_aspect` 也算「被丢掉」，那对内置生成器有意义，
  > 但一个纯色插件生成器合法地什么都不读 —— 照搬会让它凭空得到 5 条
  > 「参数不会有反应」并把状态打成「部分可用」。
- **按 `LoadedPlugin.fileName` 寻址，不许按 `${id}.js` 拼**。磁盘上的文件名
  可以与插件 id 不同（外部放进去的文件、用户改过名、我们自己写的是 `<清单 id>.js`
  而用户选的文件叫什么都有可能）。`importBytes` 那条路走完写盘后必须调
  `host.markPersisted(id, fileName)`。按 id 拼的表现是「点了停用/移除，
  文件没动，重开工程它又回来了」，且**没有任何报错**。
- **停用 = 把文件改名成 `<name>.js.disabled`**，不在 json 里另记一份清单
  （两份真相立刻带来「不一致时听谁的」）。代价要写在面板上：重开后那一行
  **只剩 id**，因为不导入它就读不到名字 —— 这是刻意的，停用不该再执行它的代码。
- **缺失降级已经存在于渲染层**：未知特效原样透传（`effects/runner.ts`），
  未知生成器返回 null（`algos/runtime.ts`）。缺的只是 UI 解释，
  由 `PluginMissingBanner` 补上。`findMissingPlugins` 是**插件级**的：
  装了插件但 def id 写错不会被报出来。
- **导入 / 移除插件不改工程的脏标记**。文件在写进 `plugins/` 那一刻就落盘了，
  标脏会逼用户去点保存、而保存写的是没变的 `project.json` —— 那是个骗人的动作。
  真正要提示的是「工程还没保存，插件只能临时加载」，由 flash 直说。
- **安全边界如实告知，且只有一个告知点**：`PluginImportDialog`
  （面板与提示条共用）。文案在 `pl.risk.*` —— 别弱化它。
  插件是第三方任意代码，项目**不对它做许可校验**（`CREDITS.md` 管的是
  我们自己移植进来的代码，不覆盖插件）。
- **插件 id 只是字符串，不进 `schema`**：`schemaVersion` 不抬，`project.json`
  格式完全不变。
- **测试分工**：单测管纯的部分（`plugin-manifest` / `plugin-missing` /
  `plugin-panel-model` / `plugin-files`）；`import(blob:)`、真 GL 编译、
  「特效真的画到屏幕上了」三件事**只能**在 E2E 测（`tests/e2e/plugins.spec.ts`，
  真实浏览器 + OPFS）。
- **新增一类可被插件扩展的东西**（比如将来的转场）要一次做齐三件：
  注册表双层化 + 标签放宽成 `Label` + 校验分支。少任何一件的表现都是
  「插件里写了、但界面上/画面上没有」。

---

## 6. 开发与测试

```bash
bun install          # 唯一的装依赖方式（真源是 bun.lock）
bun run dev          # Vite dev server（纯浏览器，http://localhost:5173）
bun run build        # 生产构建（产出 dist/，静态站点）
bun run preview      # 预览构建产物（http://localhost:4173）
bun run check        # svelte-check 类型检查
bun run test         # vitest，只测纯逻辑（配置里限死 tests/unit，不收 e2e）
bun run test:mutate  # Stryker 变异测试（见 §6.9）：逐处改错源码再跑测试，报出「假守卫」
bun run test:e2e     # scripts/e2e.mjs：自 build + 自起 preview + Playwright（系统 Chrome）
bunx vitest run tests/unit/xxx.test.ts    # 只想跑一个测试文件
```

> **包管理器只有 bun。** `package.json` 的 `packageManager` 声明了版本，lockfile
> 只有 `bun.lock` 一份（`package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` 已进
> `.gitignore`）。**不要用 `npm` / `yarn` / `pnpm`** —— 它们会写出自己的 lockfile，
> 与 `bun.lock` 分叉；两边版本一旦不一致，症状是「本机好好的、别人装出来不一样」，
> 而且**不会有任何报错**。
>
> 这不是假想：`b32d191`（引入 MCP 那次）用 npm 装了 `@modelcontextprotocol/sdk`，
> 只更新了 `package-lock.json`，`bun.lock` 从此落后一个提交 —— 直到 2026-10-11
> 才补上（补齐时只多出 4 个包，说明缺的就是那一次）。**装了依赖就一定要更新
> `bun.lock` 并一起提交。**
>
> **`bun test` ≠ `bun run test`**：前者是 Bun 自带的测试运行器，**不读 vitest 配置**，
> 跑出来的结果没有意义。脚本一律写 `bun run <script>`。
>
> 本机（ServBay）bun 在 `C:\ServBay\bin\bun.cmd`，已在 PATH 上。
> 若 `bun install` 长时间没有任何输出是正常的（它在干活）；在需要看进度的场合
> 用 `bun install --verbose`。

> `test:e2e` **不走** playwright 的 `webServer` 配置：它经 shell spawn 长驻进程，
> 在部分沙箱里整个进程树会收到 SIGTERM（runner 零输出暴毙）。`scripts/e2e.mjs`
> 全部用 `process.execPath` 直接 spawn node 绕开。
> Playwright 浏览器下载慢 / 不稳时，装依赖用 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
> （我们用系统 Chrome，`channel: 'chrome'`）。

### 6.1 测试约定

- **单测只测纯函数**：曲线求值、时间换算、命令栈、schema 迁移、颜色 / 合成数学、
  片段几何。不测 DOM、不测 WebGL。
- **文案改动只需跑 `vitest run tests/unit/i18n.test.ts`**。**改一句中文绝不应该需要改组件代码。**
- **E2E 走 Playwright + 系统 Chrome**（`channel: 'chrome'`），不需要 `playwright install`。
  E2E 服务器要正确返回 `.mjs` 的 `text/javascript` MIME，否则 ESM import 会被拦掉。
- **加了一个新参数类型 / 新守卫之后要在这里补一条**：
  - `tests/unit/algo-params.test.ts` —— 遍历**所有**注册生成器与特效的参数表：
    类型在已知集合内、文案键能解析、`select.defaultValue` 在选项里、`bitmask` 位数自洽、
    `visibleWhen` 引用的键存在。**「加了参数忘了接 UI / 忘了加文案」在这里变成失败。**
  - `tests/unit/algo-tint-uniforms.test.ts` —— **`sim` 的自定义着色**（`def.tintFragment`）
    的接线自检。`algo-uniforms.test.ts` 的 `probeGenerator` 遇到 `kind !== 'realtime'`
    直接返回 null，所以**它对 sim 的 tint 一无所知**；而 tint 走的是同一套手工派发，
    同一类静默失效（声明了没写 / 对 vec3 调 uniform1f / 名字拼错）原样存在。
    它有一条**刻意会红**的非空断言：没有任何 sim 用自定义着色时，
    上面几条 `test.each` 全是空转 —— 空转的守卫比没有守卫更坏。
  - `tests/unit/pattern-codec.test.ts` / `bitmask.test.ts` / `pattern-paint.test.ts` ——
    纯函数（编解码往返、非法输入降级、位序、Bresenham 补线、居中裁剪）。
  - `tests/unit/cellular-automata.test.ts` / `lenia-wireworld.test.ts` /
    `reaction-diffusion.test.ts` —— Wave 2 那 7 个 sim。里面有几条**解析不变量**
    才算真守卫：反应扩散 `F=k=0` 时 `Σ(u+v)` 守恒、沙堆的**阿贝尔性**（fifo 与 lifo
    两种崩塌顺序的终止态逐格相同）、雪花「冰只增不减」、循环 CA「默认参数下相邻两步
    必须有格子在变」（这条直接抓「冻死」）。
  - `tests/e2e/algo-sim.spec.ts` —— sim 的渲染断言。**sim 一律用 `settle`，
    不要用 `waitForSourceReady`**（后者的 minMean 判据是给整幅非黑准备的）。
    ⚠️ **空转探针红旗**：任何「两个配置 hash 不同」的断言，前面必须先有一条
    `meanAt > 阈值` —— 否则两张黑图不同也会「通过」。
  - **`.spec` 后缀不能省**：`scripts/e2e.mjs` 的位置参数是按完整路径做正则匹配的，
    而本机路径里有 `\Projects\`（见 §6.1 的 ⚠️）。
- **新守卫必须被验证过才算守卫**。**纯函数层用 `bun run test:mutate` 自动验（见 §6.9）；
  手工 A/B 只留给你够不到的那一层 —— E2E 的 GPU 读回标量。** 下面这些是手工跑过的样本：
  - 位表行序守卫：把 `bitRows` 的 `'eca'` 改成低位在前 → `bitmask.test.ts` 变红。
  - codec 越界守卫：拿掉尺寸上限那一行 → 「坏头部 → null」变红。
  - `visibleWhen` 引用守卫：把 `v.seedMode` 改成 `v.seedModeX` → `algo-params.test.ts` 变红
    （**类型系统拦不住**：`v` 是 `Record<string, number|string>`）。
  - 边界参数守卫：让 `lifeStepRule` 忽略 `wrap` 恒走环面 → 「固定边界改变下一代」变红。
  - `volatile` 守卫：把 `cacheHash` 改回 `JSON.stringify(params)` → 「改配色不换哈希」变红。
  - **sim tint 守卫**（两条都实际跑过）：删掉 `setTintUniforms` 里的一行
    → 「声明了却没写」变红；把 `set1f('u_contrast', …)` 换成 `set1i`
    → 「写入类型与声明不匹配」变红。
  - **步进预算**（`tests/unit/sim-scrub.test.ts`）：让 `planSimStep` 直接返回
    `target`（等于没压预算）→ 3 条变红；让 `afford` 恒为 0（计划不前进）
    → 「每帧都前进 / 一定能收敛」变红。
  - **沙堆出厂默认**：把 `size`/`batch` 改回 256/200 → 「跑满时间轴不许有
    `v > 166` 的格子」变红（实测 185 个）。
  - **沙堆崩塌后重入队**：删掉那一行 → 「预先堆高的格子会一路塌到稳定」变红
    （`done` 从 1 起、`maxH` 停在 170）。
  - **`TorusField` 的 halo**：把上下两条 halo 改成只复制中段（不连左右一起）
    → 与朴素回绕逐位对拍的用例变红（四个角错了）。
  - **「声明了但没被读过」**（`lab.spec`，唯一能抓「参数拨了没反应」的地方）：
    把 `menger` 里 `p = twistY(p, u_twist);` 删掉 → 红（`menger: u_twist`）。
    这条的**允许清单从源码推**（`ALGO_HEAD` 的键任意丢弃；`SCENE_GLSL` 那批
    音频/编排 uniform 只对 `scene-*` 放行），不留硬编码列表。
  - **3D 家族契约**（`tests/unit/fractals3d.test.ts`，14 条）：覆盖面自检
    （正好是 apollonian/mandelbulb/menger）、前向声明存在、共用参数不缺不重、
    文案键同源、palette 选项都在映射表里、内核里不出现任何具体生成器的参数名。
  - **3D 的「换了画面」判据**：`algos3d.spec` 用**分块均值的 L1**。判据选错的
    代价实测过 —— 拿「覆盖像素数之差」当形状代理，幂次 3 与 8 的**面积接近而
    形态完全不同**，那条断言直接把正确的实现判死。噪声底实测 **0.000**
    （同配置两次独立加载逐块一致），而换幂次是 80.8、换迭代是 14.2。
  - **预览浮层的覆盖**（`algo-preview.spec.ts`）：把浮层的定位锚点从「行的右边」
    改成「行的左边」→ 「浮层不盖住当前高亮的那一项」变红（`elementFromPoint`
    命中浮层而不是菜单项）。这条**不能只断浮层存在** —— 压在菜单上的浮层
    在 DOM 断言与可见性断言下全都正常，只是那一项点不到。
  - **缩略图资源对齐**：把一个 `.webp` 改名 → `algo-thumb-assets.test.ts` 同时
    报「缺缩略图」与「孤儿资源」；把某个 sim 的 `previewT` 改成 0 →
    「sim·bake 必须显式给 previewT 且 > 0」变红。**把 `thumb` 从菜单项上去掉**
    → `algo-preview.spec.ts` 四条全红。
  - **modal 的层叠**（`modal-layering.spec.ts`）：判据**不是比 z-index**（那不看
    层叠上下文），而是算**有效层级** —— 自己那层与沿途每个上下文的 z 取最小，
    然后把「与 modal 面板相交、又不在 modal 子树里」的元素全算一遍，断言没有
    一个更高。后面那条用例**内建了反向验证**：把抽屉压回出事的 `z-index: 1`，
    断言 `ruler` 确实会盖上来。
  - 以上都是**改回去 → 看红 → 恢复 → 看绿**跑过一遍的。
- **持久化的 E2E 跑在 OPFS 上，那不是 mock**：`navigator.storage.getDirectory()` 返回的
  就是一个 `FileSystemDirectoryHandle`，与 `showDirectoryPicker()` 是同类对象。
  `__artmatic.project.useOpfs(name)` 把 OPFS 下的一子目录接成当前工程位置，之后走的是与
  生产**完全同一条**链路，唯一差别是「根句柄从哪来」。`showDirectoryPicker()` 是系统对话框、
  Playwright 驱动不了 —— 这是绕开它的唯一诚实办法。
  - ⚠️ **`scripts/e2e.mjs` 的位置参数是按「完整路径」做正则匹配的**，而本机路径里有
    `\Projects\` —— 所以 `node scripts/e2e.mjs project` 会匹配到**全部** spec。
    要限定文件就写 `project.spec`。
- **单测里的文件系统是 `memoryRoot()`，它模拟了 swap 语义**（写入进临时缓冲、`close()` 才提交），
  所以「写到一半失败不损坏原文件」在单测里是被真测到的。它还支持
  `setFault(op => Error | null)` 注入失败、`inspect(path)` 直接看磁盘状态 ——
  写这类测试时**别去 mock `FileSystemDirectoryHandle`**，用这个。
- **选择器一律优先 `data-testid`**，不要绑 CSS 类名。所有自研控件都暴露了稳定 testid
  （`param-row` / `param-slider` / `param-number` / `select` / `menu-item-*` /
  `track-side-row` / `tl-row` / `tl-scroll` / `ctx-menu` …）。绑类名的那批断言在换控件时
  全碎过一次，不值得再来一遍。
  - 顶栏工程页签带**序号**：`project-tab-N`（切换）/ `project-tab-timeline-N` /
    `project-tab-close-N` / `project-tab-dirty-N`，加上全局的 `topbar-new-project`。
    用序号而不是 id，因为 id 是运行时 uuid，测试拿不到。
  - 约定：`NumberInput` 的 `testid` 落在**内部 `<input>`** 上（保住 `fill()` /
    `inputValue()`），拖拽热区的 testid 是 `testid + '-wrap'`。
- **手势类断言必须走 `page.mouse`**，不要直接调 store —— 策略结算时序、跨轨、右键菜单
  这些问题全在手势层，直接调 store 会把它们整个绕过去。
- **断言要写成不变量，不要写成两点相等**。修「暗色下太阳图标是主题色」时，只比
  「主题切换 vs 设置图标」两个够不到同批引入的「`/lab` 入口用浏览器默认链接蓝」那个 bug；
  改成「**rail 上所有图标必须同色**」之后它一次就抓住了。配套：量颜色前先把指针移开，
  hover 态是另一套颜色，点完直接量到的是 hover 色。
- **片段 id 在 E2E 里不能写死**：`ProjectStore.findClip` 返回**第一个** id 匹配的片段，
  同一个页面里搭两次同 id 的舞台时，第二次的操作会落到第一次那条轨道上 —— 画面里根本没有
  那东西，断言却「看起来过了」。`_stage.ts::buildTransitionStage` 因此给每次调用加了序号后缀。
- **点轨道菜单别用 `.first()`**：demo 的轨道还在列表里（只是被禁用），`.first()` 会点到它们，
  片段落进看不见的轨里，断言随后以令人困惑的方式失败。用 `.last()`（新建的轨在末尾），
  或按轨名定位。
- **检查器抽屉浮在时间轴右侧**：拖拽 / 点击的起手点若落在抽屉覆盖区内，
  `elementFromPoint` 拿到的是 `.drawer`，**手势被静默吞掉**（不报错、几何不变）。
  写涉及时间轴的指针测试时，起手点取靠左的位置。
- **轨道行数多时轨道区会出纵向滚动条**，`boundingBox()` 拿到的行可能落在视口外
  （鼠标事件被钳到视口边界）。要么把 viewport 开高，要么先 `scrollTop = scrollHeight` 再量。
- **分层回归**（不要盲目全量）：

  | 级别 | 改动 | 跑什么 |
  |---|---|---|
  | A | core / engine / 共享类型 | 全量 E2E |
  | B | 单个模块 / 单个特效 | 该模块 E2E + 单测 |
  | C | 数据 / 文档 / 常量 | engine 单测 + JSON 校验 |
  | D | 只改语言文件 | `vitest run tests/unit/i18n.test.ts` |

  D 级是刻意留的：如果改文案还要跑 E2E，说明有断言绑在了渲染后的字符串上
  （如 `toContainText('已保存')`）。那种断言只有**跨语言**才会失效，允许存在，
  但要意识到它把文案变成了契约。

### 6.2 渲染类 E2E 的三条硬规矩（`tests/e2e/_stage.ts` 已封好）

1. **从空舞台起步**：用 `buildStage`（关掉 demo 全部轨道），不要往 demo 工程上叠。
2. **被测特效必须在源之上**：`buildStage` 会把它提到数组最前。
   **写反了不会报错，只是「什么都没测到」**（见 §4.1 的 z 序）。
3. **「同帧一致」类断言必须每次渲前 `onSeek()`**（`renderTwiceDiff` 默认如此），
   且在测量前 `settle()`。两个坑：
   - `page.evaluate` 的回调**读不到模块作用域** —— 每个回调里就地写
     `(window as never as { __artmatic: StageApi }).__artmatic`，别指望抽个 `api()` 助手。
   - warm-up **不能用固定帧数**（一次性过渡的时机随负载浮动），要用收敛判据
     `settle()`（渲到连续 `SETTLE_FRAMES` 帧完全一致为止）。
4. 等异步烘焙要**从 Node 侧**轮询（`waitForSourceReady`）；在 page 里忙轮询会把 worker
   回包饿死。
5. **昂贵的性能类测试只从导出路径量**（见 §5.6）。

### 6.3 界面实时性（本项目最容易反复踩的一类 bug）

症状统一是「store 改了、界面没改，退出重进才更新」，控制台一片安静、不抛任何错。
**测试抓不到这类问题，除非你按下面的纪律写断言。**

**根因一：Svelte 5 的 `$derived` / `{#each}` 靠 `===` 判断传播。**
元素是**原地改**的普通对象（`clip.frame.x = ...`），引用不变 ⇒ 派生重跑了但「值没变」
⇒ 依赖它的模板 effect 静默断更。

> **规则：模板里凡是读嵌套对象字段的地方，来源派生必须换引用。**
> 写法是 `$derived.by(() => { void appState.version; return xs.map(e => ({ ...e, ...e.frame })); })`
> —— `map` / `filter` / 显式字面量都会产生新引用，`return xs` 不会。
> 判据：**模板里凡是 `{@const}` 取的嵌套对象，来源派生就必须让它换引用。**

**根因二：改了文档，但没改 DOM。** 排版编辑器里文档是数据、舞台是 DOM，中间靠
`syncDocDom()` 同步。两次踩坑：传错根节点（函数只看**直接子节点**，外层容器传进去就
全部 `continue`，表现是「拖了半天画面纹丝不动」且不报错）；容器与选择层坐标系不一致
（`toBeVisible()` 抓不到，它只要求元素在 DOM 里有尺寸）。
**能让错误不可能发生，就别指望调用方记得传对。**

**根因三：读的是「类实例」的字段 —— 那个读取压根不可追踪。**
`$state` 只深代理**普通对象与数组**；类实例（`ProjectStore`、`AssetStore`）原样留着，
于是 `p.store.version` 是一次普普通通的属性访问，**不产生任何依赖**。

> **规则：派生里凡是要读类实例的字段，必须同时 `void` 一个可追踪的信号。**
> 本项目的标准信号是 `void appState.version`（「当前工程 version 的镜像」，每次 commit 都变）。
> 判据：问一句「这个字段变的时候，**谁会通知 Svelte**？」答不上来就是漏了。

**配套的测试纪律（比上面三条更重要）**：

> **E2E 只负责「操作」，不看「UI 表现」—— 所以上面这一整类 bug 它一条都抓不到。**
> 断言 store 是必要的，但**不等于验证了功能**：文档改了 ≠ 用户看得见。

- **凡是用户能看见的状态，就断言 DOM**：内联样式、`getBoundingClientRect()`、
  子节点类型 / 顺序、`innerHTML`（图标是否换了）。`typography-ribbon.spec.ts` 里那几条
  「实时跟随」用例是模板。
- **图标切换必须真的换图标**，不要只改颜色 —— 只改颜色的话 DOM 里什么都看不出来。

### 6.4 时间轴重绘：两条不变式

> **① 单次绘制的工作量只与可见区宽有关，与工程时长无关。**
> 每条绘制都被 `clip` 到 `view`；拍线只从可见区间左端起头；波形只算可见列，
> 并且同轨所有片段合成**一条**闭合包络路径后 `fill()` 一次。

> **② 位图面积只与视口和轨道数有关，与工程时长和缩放都无关。**
> 画布只覆盖 `[winFrom, winFrom + winW)`（`winW = min(内容宽, 3 × 视口宽)`），
> 跟着视口挪位置，**不是整幅工程宽**。

② 必须存在的原因：整幅宽时内存 = 时长 × 缩放 × 轨道数 × dpr²，**无上界**。

改 `grid-draw.ts` / `Timeline.svelte` 的 `paint` 前必读：

1. **一条跨整幅画布的超长多子路径是 Skia 最坏的输入形态**（N 个**小**路径反而快一个
   数量级）。不要在 `paint` 之外直接 `ctx.stroke()`。波形是主犯：同轨合成一条闭合包络再
   `fill()` 一次。
2. **`canvas.width !== w * dpr` 的比较必须 `Math.round`**：`canvas.width` 是整数，
   dpr=1.5 遇到奇数 `w` 是 `.5` 结尾，直接比会**永远不等**，于是每次重绘都重建位图。
3. **`painted` 的失效条件要跟着「画了什么」走**，包含 `activeProjectId` —— 切工程时
   `subscribeActive` 只是把 `version` 换成新工程的计数，**两份工程 version 撞号时赋值不
   产生变化**，effect 不跑，画布就停在上一份工程的内容上。
4. **窗口挪位置必须在绘制之前落定**（`style.left` / `style.margin-left`），否则绘制原点与
   元素位置对不上。
5. **坐标系有两套，别混**：`content`（x=0 是工程起点）与 `canvas`（x=0 是位图左缘），
   差一个 `origin = winFrom`。`view` 一律用 content 坐标传，`grid-draw.ts` 内部减掉 origin。
   **探针 / 测试读像素时也必须减** —— 直接拿 `scrollLeft * dpr` 当画布 x 会在窗口外读到
   全透明，得出「波形丢了」的假结论。
6. **超限时 `canvas.width = …` 是静默失败的**（留下「位图宽 ≠ style.width」的错位、画面被
   压扁，控制台一句话都没有）。所以内存必须**由构造保证**，而不是靠「设个阈值再降级」。
   Chrome 对细长画布**单边不设 65535 上限**，真正卡的是**面积**。
7. **标尺不随 BPM 变**：拍线画在 `b * pxPerBeat` 处，BPM 决定的是「一拍几秒」，只影响
   波形 / 片段的像素位置。要动标尺看 `beatsPerBar`。
8. **E2E 别断言耗时，也别断言跨操作序列的逐位像素相同**：Skia 在抗锯齿边缘会给出
   ±3/255 的舍入差（同一序列重复则逐位相同）。断言用「最大通道差 ≤4 + 墨迹量 ±0.1%」。
   `timeline-ui.spec.ts` 跑在 `deviceScaleFactor: 1.5`（本机真实 dpr），dpr=1 会把噪声放大十倍。

### 6.5 前端实现坑

1. **别把变量命名成 `state` / `props` / `derived` / `effect`** —— svelte2tsx 会把
   `$state` 当成「订阅名为 `state` 的 store」，报一堆看不懂的错。
2. **`use:` action 的 `destroy` 与 `pointerleave` 都可能跑在卸载流程里**：组件被移除时
   浏览器会**被动触发** `pointerleave`，那一刻仍在 Svelte 的 flush 内，同步写 rune 会抛
   `state_unsafe_mutation`。状态写入要挪进 `queueMicrotask`，并用代际号防止迟到的
   clear 抹掉新 hint。
3. **grid 子项要显式约束列**：隐式列默认是 `auto`，会被子项的**最小内容宽度**撑开
   （工具条里几乎全是 `flex-shrink: 0` 的控件）。修法是
   `grid-template-columns: minmax(0, 1fr)`。
4. **自研控件必须带 `data-exempt`**：全局快捷键原来只对 `INPUT/SELECT/TEXTAREA` 放行，
   而自研下拉 / 滑杆 / 数字框都不是原生元素 —— 在它们上面按 Space 会「打开下拉 + 开始播放」
   同时发生。判据统一在 `ui/focus.ts` 的 `isExempt()`。
5. **`NumberInput` 键入的值不要做 step 量化**：`min=0.1 step=0.5` 时键入 30 会被吸附成 30.1。
   量化只留给拖动 / 方向键（`commitValue(raw, cfg, { quantize: false })`）。
6. **删掉组件再新建同名文件，Vite dev server 会继续提供旧模块**（HMR 不报错，表现为
   「改了半天界面纹丝不动」）。验证方法：`curl` 那个模块 URL 搜新代码里的字符串。
   **修法是重启 dev server**（必要时连 `node_modules/.vite` 一起删）。正常编辑不会这样。
7. **样式没热更新时，别急着改选择器**。判据是**同一个元素上「JS 驱动的部分变了、CSS 驱动的
   部分没变」**（图标更新 = 组件逻辑是新的；颜色没更新 = 样式表是旧的）。验证要
   **dev 与 prod 各跑一遍**：Vite dev 把 `<style>` 注入成标签、prod 走独立 CSS 文件，
   两条路径的 scoping 类名都不一样，**只验一边等于没验**。
8. **浮层里不要用 `transform` / `filter` / `backdrop-filter`**：它们会让祖先成为 `position:
   fixed` 后代的**包含块**，于是 `Select` 弹层按视口算出的坐标被当成「相对祖先」解释 ——
   表现是弹层整体偏到一边。居中请用 `left/right: 0 + margin-inline: auto + width: fit-content`。

### 6.6 CSS 命名空间：组件类名会被全局样式命中

`src/app.css` 与 `src/ui/controls/controls.css` 是**全局**样式表（`main.ts` 直接 import）。
Svelte 组件的 `<style>` 是 scoped 的，组件规则不会外泄 —— **但反过来成立：
组件里用的类名会被全局规则命中。**（真事：排版选中框用了 `class="sel"`，而编译器里
`.sel` 是 Select 控件类名，于是选中框变成一个不透明白块把图形整个盖住。）

- **跨组件的复用类名加前缀**（`typo-sel` / `rcolor-swatch`），别用
  `sel` / `swatch` / `box` / `row` / `item` 这种通用词。
- **有守卫**：`tests/unit/css-namespace.test.ts` 解析那两张全局表，再扫 `SCANNED_DIRS`
  （`src/ui/typography` + `src/ui/ribbon` + `src/ui/effect-picker` + `src/ui/mascot` +
  `src/ui/pattern` + `lab`）里所有 `.svelte` 的 `class=` / `class:xxx`，
  撞车即失败。加新目录时要把它加进 `SCANNED_DIRS`。
- 这类 bug 只在「那个元素正好被选中」时才出现，控制台没有任何提示 —— 所以必须靠守卫。

### 6.7 界面约定

- **操作按「逐帧/逐拍」与「对整份工程」分工**：播放、拍网格、吸附、重叠策略、工程时长、
  缩放这些**时间轴操作**一律放在轨道正上方的工具条里（不要挪回窗口顶部）；保存、导出这类
  **工程级动作**放在最左侧的窄图标栏。新增入口时先想清楚它属于哪一边。
- **菜单不要无谓地加层级**：一级平铺能放下的就平铺，只有**会变长**的列表才收进子菜单。
- **窄侧栏的入口用全屏 modal，不是 flyout**：flyout 只有两百多像素宽，快捷键清单或导出
  信息塞进去就成了带滚动条的小盒子。
- **工具条的 tooltip 朝上**（`tipPlacement="top"`）：工具条紧贴轨道区，下方没空间。
  `tip.ts` 在 `pointerdown` 时会收起气泡 —— 否则点开的下拉会被悬停气泡挡住第一项。
- **UI 文本一律 `user-select: none`**（`app.css` 在 `html,body` 上设，输入类元素单独放行）。
- **drag-to-tweak 撞到视口边缘时上 Pointer Lock**：检查器在屏幕右侧，往右拖几下就撞边、
  位移不再增加。只在 `clientX` 贴边（3px 内）时才启用，所以普通拖动的手感完全不变；
  锁定被解除（Esc / 失焦）＝取消这次拖动。
- **音频片段的底色必须半透明**：波形画在 `canvas.grid` 上，而那张画布在片段 DOM **下面**；
  填充不透明就会把波形整个盖住，看起来是纯色块。
- **列表拖曳排序只有一份实现**（`ui/drag-reorder.ts`）：顶栏选项卡（横向）、时间轴轨道行、
  排版图层面板（纵向）都用它。两条硬约定：位移超 4px 才算拖（否则按钮点按被 1~2px 抖动吃掉）；
  拖完那一次 `click` 必须吞掉（否则「拖一下选项卡」会顺带切一次工程）。图层列表是**倒序**
  渲染的，视觉下标 → 数组下标要 `len - 1 - i`，换算只在调用处做一次。
- **设置面板 = 草稿 + 保存并应用**（`ui/SettingsModal.svelte`）：工程参数与界面偏好只在
  Apply 时写回，取消 = 什么都不做。标签前的 `*` 表示「与**打开面板时**的值不同」。
  那份基准快照是**普通 const，不是 `$derived`** —— 做成派生的话 `version` 一动基准就变，
  星号会在自己刚亮起时又熄掉。
- **`.editor` 这类 grid 的行数必须与子项数一一对应**。条件渲染的子项一律先包一层再进 grid，
  否则缺席时后面的子项会落到错误的行上（表现为某条 bar 被拉高或被挤出屏幕）。
- **`$derived` 返回新对象时，读它的 `$effect` 会每轮重跑**。需要「只在 X 真的变化时做一次」
  的动作（如 Ribbon 归零）必须用普通 `let` 记住上一次的值，不能靠 effect 依赖。
- **禁用必须同时是功能上的与视觉上的**：看着能点、点了没反应只会被判定成卡死。
- **操作提示分三级**：`appState.flash(text, level)`，`level ∈ info | success | error`，
  默认中性，颜色与图标都跟着 level 走。不要只有红色 —— 「已保存」也是红的会让人以为失败。

### 6.8 品牌资源

`ui/Brand.svelte` 内联 SVG（不用 `<img src>` —— 那是独立文档，页面 CSS 进不去），
按 `variant` + 当前主题取用，把资源里写死的品牌紫换成 `var(--accent)`，**墨色保持资源原值**。
标记在 `size >= 44px` 时换成 3×3 版（20px 的位子放 3×3 会糊成一团）。

> ⚠️ **文件名说的是「墨色」，不是「目标模式」** —— 这里极容易搞反：
> `-dark` 里的墨是深灰，配**亮背景**（亮色主题）；`-light` 里是近白，配**暗背景**。
> 也就是 `mode === 'light'` 取 `-dark` 文件，反之亦然。
> 搞反的后果不是「颜色不太对」而是 **logo 整块隐形**，肉眼验收很容易放过 ——
> 所以有 `tests/e2e/brand.spec.ts` 钉着（查墨色取值 + 与底色的对比度）。

### 6.9 变异测试（测试的测试）

`bun run test:mutate` 走 **Stryker**：把源码逐处改错（一个 mutant = 一处改动）再跑测试。
测试挂了 = **killed**（守卫有效）；测试照样绿 = **survivor**（守卫其实没挡住）。
这就是「把 bug 改回去、看它红不红」那件事的自动化版本，也是 §6.1 那条纪律的执行者。

```bash
bun run test:mutate -- --mutate src/core/bitmask.ts    # 单文件（秒级）
STRYKER_MUTATE=src/core/curve.ts bun run test:mutate   # 或走环境变量
bun scripts/mutate-triage.mjs --diff HEAD              # 只看本次改动命中的行
```

- 配置在 `stryker.config.mjs`：`testRunner: 'vitest'` + `vitest.configFile: 'vite.config.ts'` +
  **`coverageAnalysis: 'perTest'`**（每个 mutant 只跑覆盖到它的那几条测试，5–10× 提速）。
  `mutate` 默认 `src/core/**/*.ts`。
- **范围要收窄到本次改动** —— 全量 `src/core/**` 会明显更慢。这正是上游实践的粒度：
  Google 是**只变异本次 changelist 涉及的行**、并在代码评审时增量跑。
- `.stryker-report.json` 是 200KB 级，**别直接读**。`scripts/mutate-triage.mjs` 压成
  「一行一条」，`--diff <ref>` 只留改动命中的行，`--limit N` 截断，`--json` 给上层脚本。
  用 `bun` 跑它（个别沙箱里 node 起不了 git，脚本会降级成不过滤并提示）。
- ⚠️ **survivor 只有三种成因，必须靠「补一条候选测试再重跑」来判，不能眼看行号推断**：

  | 成因 | 判据 | 处置 |
  |---|---|---|
  | 真缺口 | 补一条能区分的输入 → 变 Killed | 测试留下 |
  | 等价 mutant | 任何输入都不可区分（末尾有 `clampMask` 兜底、`undefined` 为 falsy 之类） | 忽略，用源码内 `Stryker disable` 注释钉掉 |
  | 不可达 | 分支被调用方契约钳死 | 同上 |

- ⚠️ **同一个 `replacement` 会在同一行出现多次，只有 start/end 列不同** ——
  `ConditionalExpression` 对 `a || b` 的**每个操作数**都生成 mutant。按行号去重或推断必错。
- ⚠️ **survivor 是 backlog，不是 gate。** 看前 3-5 条就停，别追 100% 分数 ——
  等价 mutant 是天花板的一部分。
- ⚠️ `UpdateOperator` 的 `i-- → i++` 会 **Timeout**（死循环）。那是**真信号**，别当噪声丢掉。
- **边界**：Stryker 只覆盖 vitest 那一层（纯函数，`test.include` 限死 `tests/unit`）。
  E2E 的 GPU 读回标量它够不到 —— 那层要么继续手工 A/B，要么把已知 buggy 的输出录成
  **负样本 fixture**，让守卫在 CI 里自证。
- 环境：`node_modules/.bin` 里只有 `stryker.bunx` / `stryker.exe`（**没有裸 `stryker`**），
  `bunx` 也不在 PATH —— 一律走 `bun run test:mutate` 或 `bun x`。
  `.stryker-tmp/` 与报告产物已 gitignore。

---

## 7. 未决问题

1. **`ProjectStore.addTrack` 的命名与位置自相矛盾**：命名 `V${n}`（暗示 V 号越大越靠前）
   与 `push` 到数组末尾（z 最低）冲突。用户新建轨道后加特效片段会踩到「特效看不见」。
   改法二选一：保留位置改命名，或改成 `unshift`。**未拍板。**
   相关的 E2E 缓解已落地（用 `.last()` 或按轨名定位，见 §6.1）。
2. **有状态模拟的 seek 回放与顺序播放不一致（真问题，未定位）**：
   `生命游戏：seek 回退再前进与顺序播放逐像素一致` 偶发 `diff = 102`，
   差异形状完全固定（34 个像素、同一行 y=78、x ∈ [195,359]），**先于转场功能存在**。
   单测里 `seek ≡ 顺序推进` 被钉死，所以嫌疑在**渲染路径**（R8 上传 / tint pass / `outPool`
   复用）而不在 `lifeStep` 本身 —— 但那只是排除法。
   用户可见性：单行 34 像素、只在「先回退再前进」路径上出现，预览几乎看不出。
   **但导出与预览走的正是这两条不同路径，所以它不是纯粹的测试噪声。**
   **不要为了绿而放宽这条断言。** 复现：`for i in 1 2 3; do node scripts/e2e.mjs algos.spec; done`
   （单跑常常绿，全量跑才挂 —— 负载相关）。
   > **2026-10-04 补到的新证据（Wave 2）**：新建的 `sim` 生成器上有**更便宜的复现**——
   > **根本不用回退**，同一个 t 连渲两次就会差：Brian's Brain 恒差 **15 字节**、
   > 沙堆恒差 **489 字节**（出界 700848 字节里），2/3 的运行失败，**每次数值都一样**。
   > 几个已知量：
   > - `renderer.onSeek()` 只调 `compositor.clearFeedback()`，**不碰 sim** —— 模拟侧被排除；
   > - 单元测试里 `seek(f) ≡ 顺序 step f 次` 逐字节相等（`cellular-automata.test.ts` 等），
   >   所以状态机是确定的；
   > - 「差异每次都是同一个数」排除了随机噪声，指向一处**固定的渲染层竞态**
   >   （嫌疑仍是 R8 上传 / tint pass / `outPool` 复用这条链）。
   > 处置：`tests/e2e/algo-sim.spec.ts` **不断**这条（头注里写了完整理由），
   > 确定性交给单元测试。**这不等于问题解决了** —— 它只是被放在能精确断言的那一层。
3. **素材重定位 UI**：`auditLedger` 能检出 `missing` / `changed` 并在「工程」面板列出来，
   但**只能报告不能修**。缺的动作是「重选这个文件」→ `showOpenFilePicker()` → 比对哈希 →
   更新台账并回写工程。
4. **打开工程时素材是全量读进内存的**：`AssetStore.loadFrom()` 把每一条 bundled 素材都读了
   回来（视频也在内）。音频 + 图片量级没问题，含 2 GB 视频的工程会一次性吃 2 GB 堆。
   修法是把素材字节改成**流式**：`AssetStore` 存 `File` / `Blob` 引用（`FsFile` 加
   `readBlob()`）、`SaveInput.bytesFor` 允许返回 `Blob`、`writeBytesAtomic` 接受 Blob。
   动的是保存 / 打开的公共路径，需要单独一轮回归。
5. **`analysis/` 与 `thumbs/` 只建了目录**，路径规则就位，缓存还没落地。
6. **视频解码在无 GPU / 不支持的容器时没有兜底文案**：失败只记进 `stats().failures` 与
   `console.error`，界面表现为「这一层不出画面」。应当在底栏给一条 `err.video.unreadable`。
7. **OPFS 的配额**：E2E 跑在 OPFS 上，而 OPFS 受浏览器存储配额约束（用户选的目录不受限）。
   现在只有几 KB 假素材所以没碰到；将来给 E2E 塞真实视频素材前先看
   `navigator.storage.estimate()`。
8. **`tr()` 的响应式路径尚未被真正验证过**：只有 zh-CN 一门语言，`setLocale()` 没有可切换的
   目标，所以「切语言 → 界面自动重渲」**只有设计依据、没有实测**。在那之前不要把 §5.3 的
   机制描述当成已验证的事实。
9. **`html-in-canvas`（排版后端的下一个档）**：本机 Chromium 上捕获路径可用且快得多，
   但上传路径（`texElementImage2D` 等）拒绝所有入参，API 仍在改。
   **不为其设计架构，但在 `TextRasterizer` 后面留好了位置**（snapDOM 3.x 自己就有
   `engine: 'html-in-canvas'`，通了一个选项就能切）。
10. **不可子集化的字体（woff2）+ 动画文档的逐帧成本**未测。woff2 通常只有 TTF 的 30–50%，
    所以不是「上百毫秒」那个量级。真要遇上，对策是引导用户换 TTF/OTF，或用「转为图片」
    把它冻成静态资源。
11. **两处近义提示没有统一**：`app.beatAnchorTip` 与 `insp.anchorTip` 只差斜杠两边的空格。
    抽取时按「逐字保留」原则没动它，但同一个功能的 tooltip 有两份文案本身就是维护负担。
    合并需要一次独立的、显式的文案改动。

---

## 8. 参考代码地图

三个只读参考目录（在新工作区里需另行获取）：

| 目录 | 拿什么 | 不要拿什么 |
|---|---|---|
| `angel-echo` | `js/gl.js`（WebGL2 微工具箱）、`js/automata.js`（7 类数学生成器）、`js/scenes.js`（`LIB` + 程序化场景 + 音频特征均匀块，**已移植**）、`js/post.js`（回声→故障→调色三连）、`js/util.js`（三个包络原语）、`js/analysis.js` 的特征口径、`tools/analyze_audio.py` 的算法 | `plan.js` / `direction.js` / `app.js` 里的硬编码内容表（那是**一部片**的编排，不是引擎）。**还没搬**：`Kit.points()` 与粒子 5 模式（含 flock/eye）、`mathfield` 的 mode 0/1/2/4/5（烘焙图集的闭式揭示器）、`bars` 与 `datamosh` 的频谱条（依赖 `Kit.spectrogram()` 的整轨频谱纹理）、排版/OSD 全套、摄像机 `MOVES/ASPECTS/TINTS` |
| `openmosh` | 声明式特效协议、66 个 GLSL、ping-pong + hdrFeedback 渲染器、`timeline/clips.ts` 泛型片段几何、`gl/preview-size.ts`、`audio/offline-audio.ts`、`video/decode.ts`、约 40 个 UI 原子件、`lab/` 试炼场模式 | 轨道模型（按类型分轨 + 数量上限，与我们的统一模型相反）、WebM-only 导出、IndexedDB 存工程 |
| `angel-echo-splitter` | `store.js` 的时间换算与拍吸附、`timeline.js` 的 canvas 网格绘制与拖拽、四档吸附语义 | localStorage 持久化、单轨模型（`assignLanes` 只是重叠时自动分道） |

> 搬 `splitter` 之前有一笔债要先还：`AE.SNAP.*.unit`（1 / 0.25 / 0.5 / 0.01）与 `store.js`
> 的 `snapUnit` 是两套并存且数值不一致的吸附单位，且 `unit` 字段全仓库从未被读取过。

---

## 9. 协作约定

- **改架构 / 数据模型 / 构建方式 → 先更新本文件。**
- 多个 Agent 可能并行操作本项目。`core/` 的接口变更是高冲突操作，动手前在 commit message
  里写清楚。
- 提交信息用中文，格式：`模块: 做了什么`。例：`core: Curve 增加 beatAnchor 与三种 envelope 模式`
- **不要把 `.workbuddy/` 的路径写进任何项目文件**（本文件、README、代码注释都不行）。
  项目开发和规范不该绑定某一个开发者的某一个软件。
- **优先留注释解释「为什么」**，尤其是踩过的坑。那是参考代码里最有价值的部分。
