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
| `angel-echo-splitter` | 同作者，内部移植 | `store.js` 事务式撤销栈模式（snapshot + beginTx/endTx）、时间换算与拍吸附思路（吸附单位已统一为 `core/time.ts` 一张表，不再沿用其双表） | `src/core/commands.ts`、`src/core/time.ts` |

## 依赖库

| 包 | 许可 | 用途 |
|---|---|---|
| `fflate` | MIT | PNG 序列导出打 zip |
| Lucide | ISC | UI 图标（`@lucide/svelte`，按组件 tree-shaking） |

## 明确不使用（许可冲突）

- `hydra-synth`（AGPL-3.0）
- `Coollab`（GPL-3.0）
