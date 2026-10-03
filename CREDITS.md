# CREDITS

Artmatic 的实现移植或参考了以下代码与库。本文件是硬约束（AGENTS.md §1.8）：移植必须登记，含二级来源。

## 代码移植

| 来源 | 许可 | 移植内容 | 落点 |
|---|---|---|---|
| `angel-echo`（本项目作者的姊妹项目） | 同作者，内部移植 | `js/gl.js` WebGL2 微工具箱（Kit/Program/Target、全屏三角形、上下文属性含 `preserveDrawingBuffer` 与 `UNPACK_ALIGNMENT=1`） | `src/engine/kit.ts` |
| 同上 | 同上 | `js/util.js` 的 mulberry32 / approach / follower / Impulse 包络原语 | `src/core/prng.ts`、`src/core/curve.ts` |
| 同上 | 同上 | `js/automata.js` 的 `LIVE=255` 约定、`elementary()`、`sheetSpec/sheetPut`、`gameOfLife/lifeStep`、R8 `upload()` | `src/algos/` |
| 同上 | 同上 | `js/post.js` 的 ECHO_FS 反馈回声思路（max 合成、floor-then-decay、ping-pong 历史） | `src/effects/glsl/echo.ts` |
| `openmosh` | MIT | `gl/effect-shaders.ts` 的 blend mode switch（`TEXT_BLEND_FRAG`）、`LAYER_BOX_GLSL` 层盒、`EffectShaderDef/PrePassDef` 协议、`HASH_GLSL` | `src/engine/blend.frag.ts`、`src/engine/placement.frag.ts`、`src/effects/shader-def.ts` |
| `openmosh` | MIT | `gl/preview-size.ts` 预览尺寸策略（含 `UNMEASURED_MAX_PIXELS` 兜底） | `src/engine/preview-size.ts` |
| `openmosh` | MIT | `timeline/clips.ts` 片段几何（`moveClip` 钳制、`freeRangeAt`、`MIN_CLIP_LENGTH`、`clipFadeWeight`） | `src/core/clips.ts` |
| `openmosh` | MIT | `effects/types.ts` 参数定义类型（Range/Select/Checkbox/Color，去掉 mosh/volumeLink/fontPicker） | `src/effects/types.ts` |
| `openmosh` | MIT | **仅供参照，未逐行复制代码**：`lab/` 试炼场的信息架构（三栏 · 清单/舞台/参数）与三个机制——按住旁路看源、渲染分辨率档位、批量编译着色器。「全部编译」的具体做法是自研的（用 `Kit.quad` 的按名缓存命中运行期 program，不引 ISF 运行时） | `lab/`、`src/effects/compile-all.ts` |
| `openmosh` | MIT | `vite.config.ts` 的 `labRedirect()` 插件形态（`/lab` 无斜杠被 SPA fallback 吞掉 → 302 到 `/lab/`）。本项目改写了类型并**额外注册 `configurePreviewServer`**，因为 E2E 跑的是 preview 而 openmosh 只挂了 dev 那一侧 | `vite.config.ts` |
| `angel-echo-splitter` | 同作者，内部移植 | `store.js` 事务式撤销栈模式（snapshot + beginTx/endTx）、时间换算与拍吸附思路（吸附单位已统一为 `core/time.ts` 一张表，不再沿用其双表） | `src/core/commands.ts`、`src/core/time.ts` |

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
