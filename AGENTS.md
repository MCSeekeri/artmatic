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
| 导出编码 | **WebCodecs**（H.264 + AAC 封 MP4，mediabunny）+ PNG 序列逃生舱 |
| 音频分析 | 自研 TS 离线 FFT（对齐 `AnalyserNode` 的 dB 映射） |
| 排版出图 | snapDOM + HarfBuzz WASM 字体子集化 |
| 图标 | Lucide（`@lucide/svelte`，ISC，按组件导出可 tree-shaking） |
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
│                  schema · 曲线求值 · 命令栈 · 片段几何（clips）· 转场钳制 · prng · 颜色（color.ts）
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
│   └── shader-lib.ts     realtime 生成器的头（ALGO_HEAD）· intResParam · program 命名
├── render/        ★ 合成根，见下
├── audio/         离线 FFT · BPM/offset 估计 · 波形桶 · 播放器
├── typography/    TypographyDocument 模型 + 光栅化后端 + 字体注册表 / HarfBuzz 子集化
├── timeline/      时间轴 UI（Canvas2D 绘制 + DOM 片段）
├── exporters/     export-runner（逐帧驱动）+ frame-sink（webcodecs / png-sequence）+ mixdown
├── project/       工程目录格式 · 素材台账 · 原子写 · 句柄持久化
├── i18n/          文案表 + tr()
├── platform/      Platform 接口（浏览器实现）
├── types/         跨层共用类型
└── ui/            Svelte 组件 + 控件库（controls/）+ 主题与偏好状态

lab/               试炼场：第二个 HTML 入口（/lab/），见 §3.1
```

**依赖方向**：`core` 不依赖任何东西 → `engine` 只依赖 `core` →
`{effects, algos}` 依赖 `engine` → **`render` 依赖 `{engine, effects, algos}`** →
`ui` 与 `lab` 依赖全部。`platform` 被所有人依赖。

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
└── thumbs/             缩略图缓存（可丢弃）
```

- `src/project/layout.ts` 是路径规则的唯一真源。路径一律按**段数组**处理，不拼字符串再拆
  —— FSA 的 `name` 里不允许出现分隔符。
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
  - `linearFilter` 的实现是「设 LINEAR → draw → 还原」（`effects/runner.ts` 的 `forceLinear`）：
    GL 的采样参数在 **draw 那一刻**被捕获，单线程里前后夹住是安全的。改的是别人的贴图，务必还原。
  - `hdrFeedback` 走 `Target({ float: true })` → RGBA16F，缺 `EXT_color_buffer_float` 时**安静回落
    RGBA8**（8bit 会把逐帧低于量化步长的增量抹平，有状态模拟会 stall 成色块）。
- **`ParamDef.visibleWhen`** 控参数的条件可见性；特效检查器里 range / select / **checkbox** / color
  四种都必须有分支（缺 checkbox 的表现是「参数不显示」，不报错）。
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
- 烘焙是**异步就绪**的：未就绪时该层返回 `null`（「这一层缺席」）。试炼场工具栏把
  「源：等待中 / 就绪」显式化。
- openmosh 的 Rnd 按钮用裸 `Math.random()`；移植时换成 `mulberry32(hashSeed(...))`，
  于是「第 1 次点随机」在任何机器上都是同一组参数。
- 视频 / 音频这类**异步就绪**的东西，性能只能从**导出路径**量。预览缺帧时用最近的帧顶上
  （很快），所以「连着渲 N 帧再计时」量到的是渲染缓存纹理的成本 —— 会得到荒谬数字。
  `ExportOptions.onFrame`（`export-runner.ts`）给出每帧真实耗时，`__artmatic.exportTiming(n)`
  是它的 E2E 出口。

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

### 5.8 导出

- 所有导出走统一 `FrameSink`（`exporters/frame-sink.ts`）：`webcodecs`（主路径）、
  `png-sequence`（永远可用的逃生舱）。
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

---

## 6. 开发与测试

```bash
npm run dev          # Vite dev server（纯浏览器，http://localhost:5173）
npm run build        # 生产构建（产出 dist/，静态站点）
npm run preview      # 预览构建产物（http://localhost:4173）
npm run check        # svelte-check 类型检查
npm run test         # vitest，只测纯逻辑（配置里限死 tests/unit，不收 e2e）
npm run test:e2e     # scripts/e2e.mjs：自 build + 自起 preview + Playwright（系统 Chrome）
```

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
  （`src/ui/typography` + `src/ui/ribbon` + `lab`）里所有 `.svelte` 的 `class=` / `class:xxx`，
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
| `angel-echo` | `js/gl.js`（WebGL2 微工具箱）、`js/automata.js`（7 类数学生成器）、`js/post.js`（回声→故障→调色三连）、`js/util.js`（三个包络原语）、`tools/analyze_audio.py` 的算法 | `plan.js` / `direction.js` / `app.js` 里的硬编码内容表（那是**一部片**的编排，不是引擎） |
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
