# src/core/ —— 纯 TS 内核

无 DOM / 无 WebGL，**必须可单测**。数据模型 · 曲线求值 · 命令栈 · 片段几何（clips）·
转场钳制 · prng · 颜色 · 位掩码 · 容量预算。它是**全局关键路径** —— 它定死之前不要写时间轴 UI。

**何时读我**：改 `core/**`；动**片段几何 / trim / 切分 / 重叠策略 / 关键帧 / 容量上限**；
动 `Project` 结构或 `SCHEMA_VERSION` 时。

相关：`src/engine/AGENTS.md`（合成求值 · z 序）、`src/timeline/AGENTS.md`（同一套策略在手势层的落点）、
根 `AGENTS.md` 的硬约束（时钟 / 随机 / 确定性 / 真相在磁盘）。

---

## 数据模型与求值

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
  /** 出画转场，见 `src/effects/AGENTS.md`。窗口以 clip.end 为中心。 */
  transitionOut?: { defId: string; duration: number; values: Record<string, number> }
}

/** 无画面来源，把自己插进渲染链。所有特效都是它 —— 含摄像机 / 画幅 / OSD。 */
interface EffectClip extends ClipBase {
  kind: 'effect'
  chain: EffectInstance[]                     // 一条片段可携带一串效果，可拖拽重排
  /** 影响深度：只作用于下方最近的 N 条启用视觉轨；0 / 缺省 = 下方全部（见 `src/engine/AGENTS.md`）。 */
  affectDepth?: number
}

/** 声音事件，不参与视觉合成。 */
interface AudioClip extends ClipBase {
  kind: 'audio'
  assetId: string; srcIn: number
  gain: Curve
}
```

---

## 重叠策略与结算时序

**同轨不重叠**，需要叠就加轨道。拖动策略是可配置项
`overlapBehavior: 'push' | 'reject' | 'trim'`（挤开 / 拒绝落点 / 吃掉邻居重叠部分），
默认 `'reject'`。reject 的语义是「落点非法就整次不动」，**不是**「钳在当前空档里」。

| 阶段 | 做什么 |
|---|---|
| `pointermove` | 只做**自由移动**（`liveMoveClip` / `liveResizeClip`）：片段跟着鼠标走、可压在邻居身上、跨轨也实时生效。**策略一律不动。** |
| `pointerup` | 调 `settlePlacement` / `settleResize` **结算一次**：push 挤开、trim 吃掉、reject 拒绝（非法则 `cancelTx` 整次手势作废） |

**片段剪贴板**（`core/clipboard.ts`，纯逻辑）：

- 载荷是自有 JSON：`{ kind: 'artmatic/clips', version: 1, clips: [{ trackId, clip }] }`。
  `start` **与 `end` 一起**归一成「相对第一个片段」（只搬 start 会把片段拉到另一个长度）。
- `parseClipboard` **永不抛**：非 JSON / 外来 JSON / 版本不对 / 片段形状不对一律 null
  （调用方必须整段放行，见 `src/ui/AGENTS.md` 的粘贴纪律）。
- 落点优先级：**复制时的原轨位** → 选中片段所在轨 → 第一条装得下的轨；一条都不行就
  跳过那个片段并说明（不静默丢弃）。同轨重叠的顺延/裁切**复用 `ProjectStore.placeInto`**
  （`addClip` 与 `pasteClips` 的唯一实现）—— 各写一份的形态是「从池里插会压邻居、
  粘贴却不会」。粘贴是**一笔撤销**，片段一律换新 id（留原 id 会让 `findClip` 找到源片段）。
- 跨工程 / 素材被删：`planPaste` 只打 `assetMissing` 标记，画面按「脱机媒体」占位符
  表现（见 `src/typography/AGENTS.md`）。**静默丢弃是更难查的坏法**（用户看到「粘贴了但什么都没有」）。

理由：策略若在 `pointermove` 里生效，trim 会在拖过去的瞬间毁掉邻居，拖回来也回不来。
拖动期间允许视觉重叠，落点非法时给红框预告（`appState.dragIllegal`）。

- **例外**：`resize` + `reject` 是单边钳制、非破坏性，仍然实时生效。`resize` 遵守全部三种策略。
- 几何层入口统一是 `placeSpan(干净 lane, 候选几何片段, duration, behavior)`。
  **lane 必须是干净的** —— 拖拽期间被拖片段已压在邻居身上，脏 lane 会让 push 的扫掠
  把锚点自己推走。
- **跨轨**兼容判据只有一条 `ProjectStore.canHost(track, clip)`（音频片段只进音频轨），
  拖拽与 `Alt+↑↓` 共用，不许各写一套。拖拽期间实时搬家 ⇒ 指针监听挂在 `window`
  而不是 `setPointerCapture`（元素会在两个 `{#each}` 块之间重建，捕获随之失效）。

---

## trim-in 与切分

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

## 工程时长与素材长度无关

`Project.duration` 只决定导出帧数范围与时间轴宽度；片段可以把它撑长
（`addClip` / `liveMoveClip` / `liveResizeClip` 只增不减），用户也可以手动改小或用
「贴合内容」收回。导入音频只是新片段的默认长度，**不许**被 `duration` 截断。

## 关键帧锚拍与包络

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

---

## 容量预算（内存 / 显存）

**唯一策略处是 `core/capacity.ts`。任何地方都不要再写容量常数。**

这条是补出来的：内存 / 显存类上限曾经散落成字面量（`DEFAULT_BUDGET_BYTES = 192MB`、
`MAX_RASTER_BYTES = 48MB`、`EXPORT_ENTRIES = 2` …），而它们本质是
**「这台机器有多宽裕」的函数**，于是 16 GB 台式机与 8 GB 轻薄本共用同一组数字。
更要命的是容量不足的表现**通常静默**：画面缺层、变糊、context lost，**不报错**。

### 数字从哪来（浏览器测不准，所以由 Node 测）

```
scripts/capacity.mjs  （Node：os.freemem + nvidia-smi / 注册表）
      ↓ /__capacity.json（vite.config.ts 的中间件注入）
ui/capacity-profile.ts（启动期取一次，**起了不等**）
      ↓ applyMachine()
core/capacity.ts      （deriveLimits：share × 份额 → 夹进 [floor, cap]）
      ↓ getLimits()     ← 所有消费方都在**用到时**读，不抄进字段
```

- 页面侧拿不到可信数字：`navigator.deviceMemory` 粗到 GB 且只有 Chromium 有，
  `performance.memory` **只统计 JS 堆**，WebGL 连显存大小都不肯说
  （`MAX_TEXTURE_SIZE` 是格式上限，不是容量）。**别在页面里猜。**
- 探测不到（纯静态部署 / 探测失败）就退回 `DEFAULT_LIMITS` —— 那组值刻意等于
  「改造之前的行为」，所以**不会因为探测失败而回归**，只是拿不到更好的利用。
- 要更大的值：写 `artmatic.capacity.json`（路径见 `scripts/capacity.mjs`，
  可用 `ARTMATIC_CAPACITY` 覆盖），或在宿主里 `setLimits()`。
  **不要回来改 `deriveLimits` 的比例** —— 那是所有机器共享的策略。
- 新预算 = 加到 `CapacityLimits` + `deriveLimits`（写明 share / floor / cap 的
  理由）+ `RANGE` + `DEFAULT_LIMITS`（等于旧行为），再让消费方读 `getLimits()`。

### 两条不变量（谁违反谁出「静默故障」）

1. **上限必须罩得住「当前实际要画的东西」。** 与预算冲突时**保画面 + 报超支**，
   不许让上限赢：
   - 排版：`protectedKeys()` = 当前帧 ∪ 上一帧在屏的键，永不淘汰；
     超出预算就置 `overBudget`（`stats()` 里可见）。
   - 视频：`planEviction()` 两级裁决，**每条缓存至少留一帧**（那是正在显示的画面），
     连这都放不下就停手并置 `overBudget`。
   - 特效池：反馈历史与 `delayedInput` 是**状态**不是中间结果，在用的那份淘汰
     就是画错，同样停手 + `poolOverBudget`。
2. **作用域要写对：全局 vs 每项。** `new FrameCache(192MB)` 建在**每条素材**的
   条目里 = N × 192 MB（实测一次 4 秒导出就吃掉 398 MB 显存）。声明是全局就必须
   只有一份，裁决只能有一处（`rebalance()` / `evict()` / `trimPools()`）。

### 生命周期：有 `forget`/`dispose` 就必须有调用方

注册处的接口齐全但**零调用方** = 完全等于没写。素材级资源（视频解码器 + 帧缓存、
图片 canvas + 纹理、AudioBuffer、频谱分析、波形）在 `closeProject` 时经
`releaseProjectAssets()` 释放；片段级的模拟状态纹理走 `AlgoRuntime.forget()`。
模拟状态**不能**靠预算淘汰 —— 它装的是状态，删了就得从第 0 帧重推（违反根 `AGENTS.md` 硬约束 1.3）。

### 消费与验证

- 淘汰是**延迟结算**的（upload / 模式切换 / 帧末 / 每次解码），所以改完预算要
  触一次才会看到；`overBudget` 类读数就是给这件事留的证据。
- E2E 里**把预算钉死**（`__artmatic.capacity.set({...})`），否则用例行为会跟着
  跑测试的机器变。注意 `RANGE` 有下限：写 `1` 会被夹回 floor，用例会变成假绿。
- 导出体积超 `exportMemoryMB` 时改走**流式落盘**（`Platform.saveStream` +
  mediabunny 的 `StreamTarget` / fflate 增量 zip）。这条路要用户先选保存位置
  （`showSaveFilePicker` 要求瞬时激活），拿不到时明确提示风险并继续 ——
  理由见 `ui/export.ts::pickOutput`。
