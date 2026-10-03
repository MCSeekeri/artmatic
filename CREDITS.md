# CREDITS

Artmatic 的实现移植或参考了以下代码与库。本文件是硬约束（AGENTS.md §1.8）：移植必须登记，含二级来源。

## 代码移植

| 来源 | 许可 | 移植内容 | 落点 |
|---|---|---|---|
| `angel-echo`（本项目作者的姊妹项目） | 同作者，内部移植 | `js/gl.js` WebGL2 微工具箱（Kit/Program/Target、全屏三角形、上下文属性含 `preserveDrawingBuffer` 与 `UNPACK_ALIGNMENT=1`） | `src/engine/kit.ts` |
| 同上 | 同上 | `js/util.js` 的 mulberry32 / approach / follower / Impulse 包络原语 | `src/core/prng.ts`、`src/core/curve.ts` |
| 同上 | 同上 | `js/automata.js` 的 `LIVE=255` 约定、`elementary()`、`sheetSpec/sheetPut`、`gameOfLife/lifeStep`、R8 `upload()` | `src/algos/` |
| 同上 | 同上 | `js/post.js` 的 ECHO_FS 反馈回声思路（max 合成、floor-then-decay、ping-pong 历史） | `src/effects/glsl/echo.ts` |
| 同上 | 同上 | `js/scenes.js` 的 `LIB`（`hash11/hash21/hash31`、`vnoise`、6 阶 `fbm`、`ridge`、`rot`）与 `js/post.js` 的 `hash11`、`bayer2/4/8`、`disc()` | `src/effects/shader-def.ts` 的 `HASH_FAST_GLSL`、`FBM6_GLSL`、`BAYER_GLSL`、`DISC_GLSL`、`MATH_GLSL` |
| `openmosh` | MIT | `gl/effect-shaders.ts` 的 blend mode switch（`TEXT_BLEND_FRAG`）、`LAYER_BOX_GLSL` 层盒、`EffectShaderDef/PrePassDef` 协议、`HASH_GLSL` | `src/engine/blend.frag.ts`、`src/engine/placement.frag.ts`、`src/effects/shader-def.ts` |
| `openmosh` | MIT | `gl/effect-shaders.ts` 的 `BOUNCE_GLSL`、`HSV_GLSL`（`rgb2hsv/hsv2rgb`）、`HUE_ROTATE_GLSL`（罗德里格旋转） | `src/effects/shader-def.ts` 的共享 GLSL 头 |
| `openmosh` | MIT | 单 pass 特效（**Phase 1a·① 色彩与色调**，9 个）：`posterize`、`solarize`、`bleach`、`color-correction`、`duotone`、`thermal`、`color-halves`、`hsv-swap`、`trio-tone` | `src/effects/defs/*`、`src/effects/glsl/*` |
| `openmosh` | MIT | 单 pass 特效（**Phase 1a·② 几何与采样**，9 个）：`edges`、`neon-edges`、`sharpen`、`mirror`、`kaleido`、`polar`、`zoom`、`circle-warp`、`radial-blur` | 同上 |
| `openmosh` | MIT | 单 pass 特效（**Phase 1a·③ 风格化与形态**，7 个）：`emboss`、`stereoscopic`、`pixel-sort`、`sobel-neon`、`vignette`、`bulge`、`halftone` | 同上 |
| 同上，二级来源 `X-PostProcessing-Library` | MIT | 其中 `sobel-neon`、`rgb-burst` 是 openmosh 从 X-PostProcessing-Library 按行为重写的端口 | 同上 |
| `openmosh` | MIT | 单 pass 特效（**Phase 1b·① 位移与抖动**，9 个）：`jitter`、`wobble`、`shake`、`screen-jump`、`tile`、`swirl`、`ripple`、`pixel-shifter`、`transform-3d` | 同上 |
| `openmosh` | MIT | 单 pass 特效（**Phase 1b·② 频闪与时序故障**，8 个）：`strobe`、`rgb-strobe`、`rgb-burst`、`resize-glitch`、`stylize-glitch`、`shockwave`、`ring-warp`，以及从上游 `channel-split` 拆出的新特效 `channel-split-prism`（只列径向 / 棱镜两模式，着色器保留上游分支） | 同上 |
| 同上，二级来源 `Vidvox/ISF-Files` | MIT | 其中 `hsv-swap`、`trio-tone`、`circle-warp`、`pixel-shifter`、`rgb-strobe`、`ring-warp`、`shockwave`、`resize-glitch`、`stylize-glitch` 是 openmosh 从 Vidvox ISF 集合按行为重写的端口（非逐行复制） | 同上 |
| `openmosh` | MIT | 单 pass 特效（**Phase 1b·③ 信号与噪声**，9 个）：`grain`、`soft-glitch`、`data-bend`、`vhs`、`composite`、`optical-flow`、`smear`、`relief`、`fiber-displace` | 同上 |
| `openmosh` | MIT | 反馈类特效（**Phase 1c**，5 个）：`melt`、`tunnel`、`feedback`、`liquid-light`、`flow-contours`。上游靠「fragment 声明了 `u_feedback`」隐式分配历史，本项目改成显式 `feedback: true` | 同上 |
| `openmosh` | MIT | 多 pass 特效（**Phase 1d**，5 个）：`glow`、`blur`、`ghosting`、`fast-mosh`、`motion-mask`。用到 `prePasses` / `u_original` / pre-pass 级 `feedback`。其中 `blur` 与 `glow` 共用的两条高斯 pass 收进 `shader-def.ts` 的 `BLUR_H_PASS` / `BLUR_V_PASS`（`glsl/` 目录是按文件名与 `defs/` 一一配对的，不能放不对应的文件） | `src/effects/defs/*`、`src/effects/glsl/*`、`src/effects/shader-def.ts` |
| `openmosh` | MIT | **Phase 1e**：`petri`（循环反应扩散模拟，本项目里 `hdrFeedback` 的唯一使用者） | `src/effects/defs/petri.ts`、`src/effects/glsl/petri.ts` |
| `openmosh` | MIT | **音频频谱链路 + `audio-bars`**（Phase 1f）：`audio/spectrum.ts`（离线频谱提取，本项目自研：上游用实时 `AnalyserNode`）、`audio/spectrum-range.ts`（滚动归一化 + 逐实例包络平滑的移植，常数与时间常数逐条对应）、`audio/spectrum-frames.ts`、`engine/spectrum-texture.ts`、`src/effects/{defs,glsl}/audio-bars.ts` | 同左 |
| `openmosh` | MIT | **Phase 1g**：`lab/shaders/keijiro/*.fs` 与 `lab/shaders/pixi/*.fs` 的 ISF 端口 —— `godray`、`reflection`、`flash-glitch`、`kino-feedback`。ISF 的 `TIME` 是**秒**（不是 openmosh 那套累积相位），所以这批不需要相位折算 | `src/effects/defs/*`、`src/effects/glsl/*` |
| 同上，二级来源 `keijiro`（KinoDatamosh / FlashGlitch / KinoFeedbackURP） | **Unlicense**（公有领域） | `flash-glitch`、`kino-feedback` 的行为移植。`kino-feedback` 的**三个 pass 被精确折叠成单 pass + `u_feedback`**（等价变换，非近似）。`kino-datamosh` **未移植**：它有两个独立持久状态 + 一个上一帧输入，需要命名多目标的执行模型 | 同上 |
| 同上，二级来源 `PixiJS filters`（godray / reflection） | MIT | `godray`、`reflection` 的行为移植 | 同上 |
| `openmosh` | MIT | `gl/preview-size.ts` 预览尺寸策略（含 `UNMEASURED_MAX_PIXELS` 兜底） | `src/engine/preview-size.ts` |
| `openmosh` | MIT | `timeline/clips.ts` 片段几何（`moveClip` 钳制、`freeRangeAt`、`MIN_CLIP_LENGTH`、`clipFadeWeight`） | `src/core/clips.ts` |
| `openmosh` | MIT | `effects/types.ts` 参数定义类型（Range/Select/Checkbox/Color，去掉 mosh/volumeLink/fontPicker） | `src/effects/types.ts` |
| `openmosh` | MIT | **仅供参照，未逐行复制代码**：`lab/` 试炼场的信息架构（三栏 · 清单/舞台/参数）与三个机制——按住旁路看源、渲染分辨率档位、批量编译着色器。「全部编译」的具体做法是自研的（用 `Kit.quad` 的按名缓存命中运行期 program，不引 ISF 运行时） | `lab/`、`src/effects/compile-all.ts` |
| `openmosh` | MIT | `vite.config.ts` 的 `labRedirect()` 插件形态（`/lab` 无斜杠被 SPA fallback 吞掉 → 302 到 `/lab/`）。本项目改写了类型并**额外注册 `configurePreviewServer`**，因为 E2E 跑的是 preview 而 openmosh 只挂了 dev 那一侧 | `vite.config.ts` |
| `angel-echo-splitter` | 同作者，内部移植 | `store.js` 事务式撤销栈模式（snapshot + beginTx/endTx）、时间换算与拍吸附思路（吸附单位已统一为 `core/time.ts` 一张表，不再沿用其双表） | `src/core/commands.ts`、`src/core/time.ts` |

## 已核对许可、尚未落地的来源（2026-10-03 核）

移植这两批之前**不必再查许可**，直接对照下表登记即可。清单与取舍见实施方案
（`.workbuddy/plans/`，AI 侧记录，不入库）。

| 来源 | 许可 | 内容 |
|---|---|---|
| `Vidvox/ISF-Files` | **MIT**（GitHub licensee 判定仓库级 LICENSE） | openmosh 的 12 个端口：`hsv-swap`、`rgb-strobe`、`trio-tone`、`circle-warp`、`pixel-shifter`、`ring-warp`、`shockwave`、`ghosting`、`fast-mosh`、`resize-glitch`、`stylize-glitch`、`motion-mask`。**二级来源**：openmosh 已按行为匹配重写，不是逐行复制 |
| `QianMo/X-PostProcessing-Library` | **MIT** | openmosh 的 3 个端口：`rgb-burst`、`screen-jump`、`sobel-neon` |
| `keijiro/FlashGlitch`、`keijiro/KinoDatamosh`、`keijiro/KinoFeedbackURP` | **Unlicense**（公有领域） | openmosh `lab/shaders/keijiro/` 的三个手写 ISF 端口（含 **Kino Datamosh**）。文件头自带 `CREDIT`/`LICENSE`/`SOURCE` |
| `pixijs/filters` | **MIT** | openmosh `lab/shaders/pixi/` 的 `Godray`、`Reflection` |

> **hash 函数的署名**：`HASH_FAST_GLSL` 属于 Dave Hoskins 风格的无 sin hash
> （`p * 0.1031` / `12.9898,78.233,43758.5453` 那一族），在 Shadertoy / MIT 圈广泛流传、
> 通行的做法是视为公有领域惯例。**两个上游源码里都没有署名**，这里补一句出处说明以便追溯。
> 本项目自己的 `HASH_GLSL` 只是在该族写法上掺了 `u_seed`，属本项目改动。

## 依赖库

| 包 | 许可 | 用途 |
|---|---|---|
| `fflate` | MIT | PNG 序列导出打 zip |
| Lucide | ISC | UI 图标（`@lucide/svelte`，按组件 tree-shaking） |
| `@zumer/snapdom` | MIT | 排版层光栅化（ADR-003 的 `dom-snap` 后端）。把 DOM 子树序列化并栅格化为位图 |
| `mediabunny` | **MPL-2.0** | MP4 封装（ADR-001 的 `webcodecs` 后端）。见下方说明 |
| `harfbuzzjs` | MIT | 字体子集化（ADR-010）。按文档用到的字形集裁字体，中文字体 9.5 MB → KB 量级 |
| `gl-transitions` | MIT | 转场。122 条第三方 GLSL 转场（见下方说明）。集合内逐条许可另行核对 |
| Inter（`public/fonts/inter-latin-{400,700}.woff2`） | OFL-1.1 | 内置西文字体。随软件分发，许可原文见 `public/fonts/OFL.txt` |

> **`gl-transitions` 的许可要点（2026-10-03 核对）**
>
> 包本身是 MIT（`npm view gl-transitions license`）。**但集合内的条目逐条自带
> `author` / `license` 字段，所以「包是 MIT」推不出「每条都能用」** —— 这是
> 「不在禁止清单 ≠ 查过」的又一个实例。逐条统计 `gl-transitions@1.71.0`：
> 125 条 = **MIT 123 + BSD 3 Clause 1 + BSD 2 Clause 1**，全部宽松。
>
> 落地方式：
> - 按依赖引入（`src/effects/transitions/catalog.ts` 是**唯一** import 它的文件），
>   **不复制源码入库、不修改其源文件**。许可原文随 `node_modules/gl-transitions/LICENSE` 分发。
> - 目录层有一道**白名单**（`PERMISSIVE_LICENSES`）：上游将来加进一条 GPL 的，
>   会自动被挡在门外并进 `CATALOG_ISSUES`，不会悄悄混进产物。
>   `tests/unit/transition-catalog.test.ts` 同时断言这条，双保险。
> - 检查器里显示每条转场的 `作者 · 许可证`（署名要求 + 可追溯性）。
>
> **有两类改写，都在运行时、不改上游文件**（`src/effects/transitions/glsl.ts`）：
> 1. `texture2D` → `texture`、`gl_FragColor` → `outColor`（ES 1.00 → ES 3.00）
> 2. 「依赖 uniform 的全局变量初始化」→ `#define`（ES 1.00 合法、ES 3.00 非法）
>
> **被拒收的 3 条**（判据是数据驱动的，不是黑名单）：
>
> | id | 原因 |
> |---|---|
> | `luma` | 声明了 `sampler2D luma` —— 需要规范之外的额外贴图输入，给不出 |
> | `displacement` | 声明了 `sampler2D displacementMap` —— 同上 |
> | `burn` | 声明了 `vec3 color` 但 `paramsTypes` 里没有它（上游生成器只认 `// =`，不认规范同样支持的 `/* = */`），拿不到可信默认值。`burn0` 是同一意图的完整实现 |

> **`mediabunny` 的许可要点**：MPL-2.0 是**文件级弱 copyleft**，不是 AGPL 那种
> 「传染整个程序」的网络 copyleft。
> - 自用、本地工具、闭源分发：**零义务**。
> - 唯一的触发条件是「修改了它的源文件并把改动分发出去」——本项目不这么做。
> - MPL-2.0 不在 AGENTS.md §1.8 的禁止清单里（那里禁 AGPL / GPL）。
>
> 之所以专门写一段：AGENTS.md 早先把它的许可**误记为 MIT**（2026-10-02 更正）。
> **「不在禁止清单」不等于「查过」**——这条是查 `npm view mediabunny license`
> 之后写的，不是推断。

> **字体许可**：系统字体（simhei / msyh 等）通常**不允许**随软件分发，所以
> 内置的只有 OFL 的 Inter；中文字体由用户自行导入，字节只存在用户本机。

## 明确不使用（许可冲突）

- `hydra-synth`（AGPL-3.0）
- `Coollab`（GPL-3.0）
