---
title: 架构分层与依赖方向
description: 顶层目录各自负责什么，以及为什么依赖只能朝一个方向走。
sidebar:
  order: 1
---

这份手册面向要改代码的人。它讲的是「哪一层可以 import 哪一层」，以及三处必然踩到的边界。

## 一张图

```
core ← engine ← { effects, algos } ← render ← { ui, lab }
                                       ↑
                       agent ──────────┘（在 render 之上、ui 之下）
```

横向读：左边是右边的基础。`core` 不依赖任何会拖进 DOM / WebGL 的东西，`engine` 只依赖 `core`，`effects` 与 `algos` 依赖 `engine`，`render` 把前三者装配起来，`ui` 和 `lab` 在最上面。

## 每一层负责什么

| 目录 | 职责 | 规模 |
| --- | --- | --- |
| `core/` | 数据模型、曲线求值、命令栈、片段几何、容量预算、位掩码、颜色。纯 TS，可单测 | 24 文件 / 7.3k 行 |
| `engine/` | WebGL2 底层：Program / Target / Pass 调度、纹理池、预览尺寸、确定性时钟 | 18 / 5.8k |
| `effects/` | 声明式特效定义 + GLSL。一个特效 = 两个文件（`defs/` + `glsl/`） | 180 / 9.7k |
| `algos/` | 生成器注册表 + 烘焙 Worker。四种型：bake / sim / realtime / recall | 45 / 10.1k |
| `render/` | **合成根**：装配 Renderer + SourceManager + AlgoRuntime + EffectRunner | 6 / 1.4k |
| `typography/` | 排版文档模型、光栅化后端、字体注册表、HarfBuzz 子集化 | 67 / 22.0k |
| `ui/` | Svelte 组件、控件库、主题与偏好状态 | 180 / 55.4k |
| `timeline/` | 时间轴本体：Canvas2D 绘制 + DOM 片段 | 7 / 3.6k |
| `agent/` | Agent 控制面（能力、场景、工具表、排版写入）+ 应用内模型运行时 | 33 / 14.1k |
| `exporters/` | 逐帧驱动 + FrameSink（webcodecs / png / gif）+ 混流 | 7 / 1.2k |
| `project/` | 工程目录格式、素材台账、原子写、句柄持久化 | 17 / 5.2k |
| `plugins/` | 插件清单校验、动态 import、宿主与引用计数 | 4 / 1.4k |
| `audio/` | 离线 FFT、BPM / offset 估计、波形桶、播放器 | 9 / 1.6k |
| `platform/` | 宿主能力接口（浏览器 / Electron 两套实现） | 4 / 0.7k |
| `i18n/` | 自研 `tr()` + 扁平键表。**真叶子，零出边** | 26 / 5.4k |

数字是 v0.3.0 的实测计数，会变；结构不会。

## 为什么 `render/` 必须单独一层

它要把 Renderer、SourceManager、AlgoRuntime、EffectRunner 装到一起，所以必然 import `algos/` 和 `effects/` —— 而这两者本来就在 `engine/` 之上。**把它们塞进 `engine/` 就会形成 `engine → algos → engine` 的层次倒挂。**

它是合成根，主应用和 `/lab/` 共用同一份 `createRenderCore`。两边各写一份装配的 bug 形态很难查：**试炼场里那个特效好好的，主应用里同一类源不工作，而且没有任何报错。**

同一条纪律的另一面：`render-core.ts` 刻意不 import `typography/`、`audio/`、`exporters/`。它们全部通过接口注入（频谱源、音频特征源、脱机素材判据），这样 lab 的 bundle 图里不会拖进整棵排版子树。

## 三处「文档说的不完全对」的地方

`AGENTS.md` 里那张图是目标，不是现状。改代码之前值得知道下面这些例外：

**1. `core` 不是零依赖。** 它 import 了 `i18n`（4 个文件取 `tr`）和 `typography`（2 个文件，`schema.ts` 里还有一处运行期函数调用）。这没有违反「core 无 DOM / 无 WebGL、必须可单测」，但它意味着 `core → typography/theme → core/color` 是一个真实的目录级环。`schema.ts` 里那处刻意写字面量而不是调工厂函数，就是为了不把环变成运行期循环依赖。

**2. `platform` 不是「被所有人依赖」。** 实际只有 `ui`（10 处）、`timeline`、`exporters` 和入口 `app-boot.ts` 用它。而且 `platform` 自己也依赖 `core` 的类型和 `i18n` 的 `tr`。它不是最底层，是**宿主能力的注入点**。

**3. `ui` 与 `timeline` 是同一层的两个包，不是上下层。** `timeline` 的组件直接 import `ui/app-state`、`ui/controls`、`ui/effect-picker`；`ui` 也 import `timeline`。把它们画成上下层会让每次改时间轴手势都不知道该把文件放哪边。

另外两处弱反向边，改到的时候别惊讶：`agent` 依赖 `exporters`（导出工具），`project/agent-history` 从 `agent/history` 借类型。

## 这套分层没有编译期守卫

没有 ESLint 规则、没有 dependency-cruiser、没有针对 import 边界的测试。`svelte-check` 查类型，单测查行为，两者都不看「谁 import 了谁」。

也就是说：**分层靠约定和 review 维持。** 新增一条跨层依赖之前，先回来读这张图；如果那条依赖确实合理，就顺手把这张表和 `AGENTS.md` 一起改了 —— 一张只存在于文档里的架构图，一旦和代码不同步，就会开始骗人。

## 加东西之前先找「唯一真源」

这个项目里最贵的 bug 都不是写错的代码，而是**同一件事写了两遍**。几个已经收口的位置：

- 合成只走 `createRenderCore`
- 导出只走 `runExport` + `FrameSink`
- Agent 的一切写操作只走控制平面
- 设计令牌只有 `src/ui/tokens.ts` 一份
- 特效清单只有 `effects/catalog.ts` 一份，缺项由单测挡住

新增一条路径之前，先确认它不是在第二遍实现上面某一个。
