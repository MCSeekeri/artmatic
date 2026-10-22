# CREDITS

移植与参考的来源登记（AGENTS.md §1.8）。

## 代码移植

**openmosh**（MIT）——除另注外，以下均移植自它。

渲染基础设施：

- `gl/effect-shaders.ts` 的 blend mode switch、`LAYER_BOX_GLSL`、`EffectShaderDef` / `PrePassDef` 协议、`HASH_GLSL` → `src/engine/blend.frag.ts`、`src/engine/placement.frag.ts`、`src/effects/shader-def.ts`
- `BOUNCE_GLSL`、`HSV_GLSL`、`HUE_ROTATE_GLSL` → `src/effects/shader-def.ts`
- `gl/preview-size.ts` → `src/engine/preview-size.ts`
- `timeline/clips.ts` → `src/core/clips.ts`
- `effects/types.ts` 的参数定义类型 → `src/effects/types.ts`
- `vite.config.ts` 的 `labRedirect()` → `vite.config.ts`
- `lab/` 的信息架构（三栏布局、按住旁路看源、分辨率档位、批量编译）—— 仅参照，未复制代码

特效，落点均为 `src/effects/defs/*` 与 `src/effects/glsl/*`：

- 色彩与色调：posterize、solarize、bleach、color-correction、duotone、thermal、color-halves、hsv-swap、trio-tone
- 几何与采样：edges、neon-edges、sharpen、mirror、kaleido、polar、zoom、circle-warp、radial-blur
- 风格化与形态：emboss、stereoscopic、pixel-sort、sobel-neon、vignette、bulge、halftone
- 位移与抖动：jitter、wobble、shake、screen-jump、tile、swirl、ripple、pixel-shifter、transform-3d
- 频闪与时序故障：strobe、rgb-strobe、rgb-burst、resize-glitch、stylize-glitch、shockwave、ring-warp、channel-split-prism
- 信号与噪声：grain、soft-glitch、data-bend、vhs、composite、optical-flow、smear、relief、fiber-displace
- 反馈类：melt、tunnel、feedback、liquid-light、flow-contours
- 多 pass：glow、blur、ghosting、fast-mosh、motion-mask
- `petri`
- ISF 端口：godray、reflection、flash-glitch、kino-feedback

音频：

- `audio/spectrum-range.ts`、`audio/spectrum-frames.ts`、`engine/spectrum-texture.ts`、`effects/{defs,glsl}/audio-bars.ts`

以上若干条是 openmosh 从别处按行为重写的端口，非逐行复制，二级来源：

- Vidvox/ISF-Files（MIT）：hsv-swap、trio-tone、circle-warp、pixel-shifter、rgb-strobe、ring-warp、shockwave、resize-glitch、stylize-glitch、ghosting、fast-mosh、motion-mask
- QianMo/X-PostProcessing-Library（MIT）：rgb-burst、screen-jump、sobel-neon
- keijiro（Unlicense）：flash-glitch、kino-feedback
- pixijs/filters（MIT）：godray、reflection

> `HASH_FAST_GLSL` 用的是 Dave Hoskins 风格的无 sin hash（`p * 0.1031` 那一族），在 Shadertoy / MIT 圈通行，上游源码未署名，这里补记出处。

## 镜头光晕（`src/effects/{defs,glsl}/lens-flare.ts`）

**自写，没有复制代码。** 移植前读了两份公开实现，只取「有哪些光学分量」这一层：

- [BetterLensFlare](https://github.com/polincdev/BetterLensFlare)（MIT）：鬼影沿
  「光源 → 画面中心」的轴排布、逐通道错位做色散、横向拉丝的胶囊形衰减。
- Anderson Mancini 的 *Ultimate Lens Flare*（Shadertoy 上的公开实现）：星芒来自
  `atan` 角度乘条数后取幂，光圈叶片的六边形边。

亮部检测（32×32 分格扫描 + 亚格加权质心，单 fragment 归约）是本项目自己的做法：
上面两份都需要外部传入光源位置。

## 文本转路径（`src/typography/text-outline.ts`）

**只参照思路，没有复制代码**：`tooooools/html-to-svg`（MIT）的 text 渲染器用
Range API 做布局、用 `rect.top + ascent` 反推基线。本项目的位置测量沿用这两条
公开技法，字形轮廓与字体选择走自己的 `FontRegistry` + HarfBuzz（`glyphToPath`），
没有引入 opentype.js，也没有取用它的任何源码或字体表。

## SVG 素材生成器（`src/typography/svg-gen/`）

一期 20 + 二期 2（`motif` / `contour`）共 **22 个生成器全部自写**，没有复制任何
第三方源码或形状数据。算法来源只到「公开技法」这一层：

- 10 PRINT 斜纹网格（`tenprint`）：公开的 Commodore 64 单行程序；
- Catmull-Rom → 三次贝塞尔（`blobs / waveband / squiggle / globe`）：公开的样条公式；
- 阿基米德螺旋、等距（30°）轴测投影、正交经纬球投影：教科书公式；
- 刻度盘 / 条码 / HUD 刻度：按 `rahoo.online` **导出的 SVG 结构**归纳出的几何做法
  （逐图元 `<circle>` / `<line>` / `<path>`），未取其源码与任何资产。

明确**未使用**（许可与产品判断，详见 `.workbuddy/analysis-1017/REPORT.md` §0.2 / §10）：

- fffuel 的形状文件与生成结果 —— 许可禁止再分发；
- `rahoo.online` 的 canvas 实现代码 —— 无许可声明（默认保留），只参考了算法思路；
- `pattern.monster` / `svelte-svg-patterns` 的 476 条 tile 数据 —— 一期不做策展层，
  二期若接入需按 MIT 边界逐条筛选并在此登记。

## 品牌图标素材（`src/assets/providers/`）

16 张 AI 提供商品牌图取自 [Lobe Icons](https://github.com/lobehub/lobe-icons)
（`@lobehub/icons-static-svg`，MIT），文件名按本项目的 provider id 重命名后入库，
没有改图内容。逐个来源：

| 本项目 id | 上游图标 |
|---|---|
| `deepseek` | `deepseek-color` |
| `dashscope` | `qwen-color` |
| `zhipu` | `zhipu-color` |
| `kimi` | `moonshot` |
| `doubao` | `doubao-color` |
| `hunyuan` | `hunyuan-color` |
| `qianfan` | `wenxin-color` |
| `spark` | `spark-color` |
| `stepfun` | `stepfun-color` |
| `minimax` | `minimax-color` |
| `siliconflow` | `siliconcloud-color` |
| `openai` | `openai` |
| `anthropic` | `anthropic` |
| `gemini` | `gemini-color` |
| `openrouter` | `openrouter` |
| `xai` | `xai` |

> 集合是 MIT，但**品牌标识本身是各家商标**，此处仅用于「让用户认出自己在跟谁说话」。
> 不暗示任何背书；要对外分发这份产物时应自行复核各家的商标使用政策。

## 依赖库

| 包 | 许可 | 用途 |
|---|---|---|
| `fflate` | MIT | PNG 序列导出打 zip |
| `gifenc` | MIT | GIF 导出 |
| `@lucide/svelte` | ISC | UI 图标 |
| `@zumer/snapdom` | MIT | 排版层光栅化 |
| `mediabunny` | MPL-2.0 | MP4 封装 |
| `harfbuzzjs` | MIT | 字体子集化 + 字形轮廓（文本转路径） |
| `gl-transitions` | MIT | 转场 |
| `polygon-clipping` | MIT | 图形布尔运算 |
| `wawoff2` | MIT | **仅 devDependency**：`scripts/fonts-woff2-to-sfnt.mjs` 把内置 woff2 无损还原成 TTF |
| Inter · JetBrains Mono · Lora · Outfit（`public/fonts/`） | OFL-1.1 | 内置西文字体（无衬线 / 等宽 / 衬线 / 装饰，各 400+700）。版权行与许可原文见 `public/fonts/OFL.txt`；`*.ttf` 是同一份 `*.woff2` 的无损解压（字形与度量逐字节相同），供 HarfBuzz 取轮廓。woff2 取自 `@fontsource/*` 的 latin 子集（未改动字体） |

以上均按依赖引入，不复制源码入库。

> `mediabunny` 是 MPL-2.0，文件级弱 copyleft：不修改其源文件再分发就没有义务。AGENTS.md 早先把它的许可误记为 MIT，2026-10-02 更正。

> `gl-transitions` 包本身是 MIT，但集合内条目逐条自带 `license` 字段。1.71.0 的 125 条 = MIT 123 + BSD-3 1 + BSD-2 1，全部宽松。
> `src/effects/transitions/catalog.ts` 是唯一 import 它的文件，目录层有 `PERMISSIVE_LICENSES` 白名单兜底（`transition-catalog.test.ts` 同时断言）。
> 运行时把 `texture2D` / `gl_FragColor` 改写成 ES 3.00 写法，不改上游文件。
> 拒收 3 条：`luma`、`displacement`（声明了规范之外的额外贴图输入），`burn`（`vec3 color` 不在 `paramsTypes` 里，拿不到默认值）。

> 内置字体只有 OFL 的四族西文（Inter / JetBrains Mono / Lora / Outfit），且都只含 latin 子集。系统字体（simhei / msyh 等）不允许随软件分发，中文字体由用户自行导入或走本机字体。

## 明确不使用

- `hydra-synth`（AGPL-3.0）
- `Coollab`（GPL-3.0）
