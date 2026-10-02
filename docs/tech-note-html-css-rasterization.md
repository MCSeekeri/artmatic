# HTML+CSS → Canvas 出图的可行性（实测报告）

> 2026-09-27 · 全部数字来自本机实跑，非文档摘录。复现命令见文末。
> 环境：Windows / AMD Ryzen 9 7945HX / RTX 4070 Laptop / Chrome 154.0.8037.58（headless，DPR=1）

## 结论

**这条路能走，而且比预想的好。但有一个必须解决的前置问题，它对性能的影响是 185 倍。**

- 用 HTML+CSS 写排版、截图成纹理、作为片段参与合成：**成立**。
- 三个主流截图库在 1920×1080 下的默认耗时是 **72–276 ms/帧**（约 4–14 fps）。直接用来做实时预览是**不可行的**。
- 但 snapDOM 的耗时几乎全部来自**每一帧重新内联字体文件**。把中文字体做子集化（9.74 MB → 12 KB）后，同一版式降到 **0.7 ms/帧**，且**逐像素零差异**。
- 结论：**排版出图路径可用，但前提是不要用整包字体**。

## 一、三个截图库的实测耗时（1920×1080，中位数，毫秒）

| 库 | 简单（纯文本） | 典型（文字+SVG+竖排） | 复杂（+半调点阵+40 个散字） | 内容逐帧变化 |
|---|---|---|---|---|
| snapDOM（默认） | 106.9 | 97.7 | 95.3 | **206.0** |
| snapDOM（`cache:'disabled'`） | 111.4 | 110.8 | 89.0 | **428.0** |
| snapDOM（`embedFonts:false`） | 0.7 | 0.7 | 0.9 | 10.5 |
| html2canvas-pro | 71.6 | 85.4 | 75.0 | 81.7 |
| modern-screenshot | 275.6 | 207.4 | 226.6 | **436.2** |
| 纯 Canvas2D 自绘基线 | 0.2 | 0.2 | 0.2 | — |

读法：

1. **输出尺寸正确** —— snapDOM 三档均返回 1920×1080，与目标一致，不需要额外缩放处理。
2. **DOM 截图比纯 Canvas2D 慢 350–2300 倍**。这是"省掉自己写排版引擎"的代价，值是值的，但要知道自己在买什么。
3. **内容一变，缓存就失效**。`cache:'disabled'` 在逐帧改文字的场景下变成 428 ms；默认 206 ms。说明这类库的"缓存"只在 DOM 完全静止时有用，而视频里的排版恰恰是每帧都在变。
4. **modern-screenshot 不该用** —— 最慢，且没有换来任何独特能力。
5. **html2canvas-pro 的耗时最稳定**（72–86 ms，不受内容复杂度影响），因为它不走 `foreignObject`，而是自己解析 CSS 再用 `ctx.fillText` 画。这解释了它为什么不需要内联字体，也解释了它为什么**会丢掉 CSS 动画状态**（见第三节）。

## 二、真正的瓶颈：每帧重新内联字体文件

snapDOM 的载荷（`toBlob()` 返回的字节数）在两种配置下：

| 配置 | 载荷 | 耗时 |
|---|---|---|
| 默认（`embedFonts` 自动） | **13,006,362 B** | 52.2 ms |
| `embedFonts:false` | 11,885 B | 1.7 ms |

13,006,362 减去 11,885 等于 **12,994,477 B** —— 正好是 `simhei.ttf`（9,745,792 B）× 4/3 的基 64 展开量。**也就是说每一帧都在构造一个 13 MB 的字符串。**

成本与内联字体字节数的关系（三点验证）：

| 字体 | 载荷 | 中位耗时 | 比值 |
|---|---|---|---|
| simhei.ttf 9.74 MB | 13,006,276 B | 52.2 ms | — |
| impact.ttf 0.21 MB | 287,588 B | 1.1 ms | — |
| 体积比 / 耗时比 | **45.2 / 47.5** | | 线性成立（偏差 <5%） |

**成本 ≈ 4 µs / KB 内联字体 + ~0.7 ms 固定开销。**

### 于是有了决定性的实测：字体子集化

用 `pyftsubset` 把 simhei.ttf 按实际用到的字符裁到 12 KB：

| | 字体文件 | 载荷 | 中位耗时 | 等价帧率 |
|---|---|---|---|---|
| 全量 | 9,745,792 B | 13,006,341 B | **129.3 ms** | 8 fps |
| 子集 | 12,132 B | 28,120 B | **0.7 ms** | **1429 fps** |

- 加速 **184.7×**
- 字形保真：`diffPixels = 0`、`maxChannelDelta = 0` —— **逐像素完全一致**

### 另一半：`embedFonts:false` 不能用

关掉字体内联确实快（0.7 ms），但字形会回落到替代字体。两个像素差分的对照：

| 比较 | 差异像素占比 |
|---|---|
| 同一目标连续两次截图（噪声基线） | **0.000 %** |
| `embedFonts:true` vs `false` | **11.297 %** |
| 故意换成一个完全不同的字体 | **10.742 %** |

**"关掉内联"和"换一个字体"造成的差异量级几乎相同** —— 说明关掉内联等于换了字体。snapDOM 自己在控制台也警告：

> `[snapdom] Text in inline/table-cell elements kept its natural width and may re-wrap under font-fallback rasterization. Pass { reconcile: true } for pixel-exact layout (roughly doubles capture time).`

即库本身承认非内联路径下布局不保证像素精确。

**所以正确做法不是关掉内联，而是把字体裁小。** 两者的耗时几乎相同（0.7 ms），但子集化保住了保真。

顺带确认了一件重要的事：**同一目标重复截图，两次结果逐像素完全一致（差异 0）**。这对确定性导出是必要条件。

## 三、CSS 动画能不能做帧精确导出

能。但有条件。

**Web Animations API 的 seek 是精确的。** 对一个 `translateX 0→200px / 2000ms` 的 CSS 动画暂停后设 `animation.currentTime`：

| t (ms) | `getComputedStyle` 得到的 translateX | 期望值 |
|---|---|---|
| 0 | 0.00 | 0 |
| 500 | 50.00 | 50 |
| 1000 | 100.00 | 100 |
| 1500 | 150.00 | 150 |

**误差 0。** 所以 CSS 动画确实可以被外部时钟精确驱动，不需要 `requestAnimationFrame`。

**但截图库不一定会读到这个状态：**

| 库 | 把动画停在 x=100 后截图，实际渲染位置 | 是否保留 |
|---|---|---|
| snapDOM（三种配置） | 100 | 是 |
| modern-screenshot | 100 | 是 |
| **html2canvas-pro** | **8** | **否** |

html2canvas-pro 渲染在 x=8（基本等于起始位置），说明它解析 CSS 时丢掉了动画状态。

**可靠的写法不是指望库读懂动画，而是自己把值烘焙成内联样式再截图：**

```js
// 1. 用 WAAPI 把动画 seek 到目标帧
for (const a of el.getAnimations({ subtree: true })) { a.pause(); a.currentTime = tMs; }
// 2. 把计算结果固化成内联样式，并停掉动画
el.style.animation = 'none';
el.style.transform = `translateX(${computedX}px)`;
// 3. 再截图
await snapdom(el).then(r => r.toCanvas());
```

实测：烘焙之后 **三个库全部正确渲染在 x=100**。

> 设计含义：**你可以在编辑器里用 CSS animation 做动画，但导出管线必须在截图前把动画状态烘焙进内联样式。** 这两件事不能省掉任何一件。

## 四、HTML-in-Canvas（Chrome 154 + `--enable-features=CanvasDrawElement`）

特性确实存在，本机可复现。但**今天还不能作为构建基础**。

### API 面（实测探测结果）

| 位置 | 成员 | 状态 |
|---|---|---|
| `HTMLCanvasElement.prototype` | `layoutSubtree` | ✅ 存在 |
| `HTMLCanvasElement.prototype` | `requestPaint()` | ✅ 存在 |
| `HTMLCanvasElement.prototype` | `captureElementImage(el)` | ✅ **可用** |
| `HTMLCanvasElement.prototype` | `onpaint`（`paint` 事件） | ✅ **可用** |
| `CanvasRenderingContext2D.prototype` | `drawElementImage` | ⚠️ 存在但不工作 |
| `WebGL2RenderingContext.prototype` | `texElementImage2D` | ⚠️ 存在但拒绝所有入参 |
| `WebGL2RenderingContext.prototype` | `texElementSubImage2D` | ⚠️ 存在（子区域更新，未验证） |
| `GPUQueue.prototype` | `copyElementImageToTexture` | ⚠️ 存在（WebGPU，未验证） |
| `window.ElementImage` | 构造函数 | ⚠️ `Illegal constructor`，只能由 API 产出 |

### 能用的部分（而且是好消息）

```js
canvas.setAttribute('layoutsubtree', '');
canvas.appendChild(domChild);
// ...
const ei = canvas.captureElementImage(domChild);   // → ElementImage { width:1920, height:1080, close() }
```

实测耗时：

| 环节 | 中位耗时 @1920×1080 |
|---|---|
| 改 DOM → `requestPaint()` → `paint` 事件触发 | **4.2 ms** |
| `captureElementImage()` 本身 | **~0 ms** |
| 合计等价帧率 | **238 fps** |

`paint` 事件带 `changedElements`，能告诉你哪些元素变了。这两个数字说明：**只要上传那一步通了，这条路比任何截图库快 20 倍以上，而且不需要序列化、不需要内联字体。**

### 卡住的部分

`texElementImage2D` 的报错在几轮试探后收敛为一句话：

```
TypeError: Failed to execute 'texElementImage2D' on 'WebGL2RenderingContext':
The provided value is not of type '(Element or ElementImage)'
```

穷举过的组合（全部失败）：

| 调用 | 结果 |
|---|---|
| `(TEXTURE_2D, tex, cap)` / `(TEXTURE_2D, tex, el)` | `Invalid internalformat` |
| `(TEXTURE_2D, tex, RGBA8, cap)` | 类型不匹配 |
| `(TEXTURE_2D, tex, RGBA8, cap, {})` | 类型不匹配 |
| `(TEXTURE_2D, tex, SRGB8_ALPHA8, cap)` | 类型不匹配 |
| `(TEXTURE_2D, tex, cap, RGBA8)` | 类型不匹配 |
| `(TEXTURE_2D, tex, RGBA8, el)` | 类型不匹配 |
| 先创建 GL 上下文再捕获 / 先捕获再创建 GL | 无差别 |

`cap` 通过 `instanceof ElementImage` 检查为真、有正确的 `width/height`，但仍被拒绝。同时 `ctx.drawElementImage` 报 `No cached paint record for element`，即使已经等到 `paint` 事件。

**判断**：这个 API 仍在剧烈变动中（入口从 `drawElement` 改名到 `drawElementImage` 并新增 `captureElementImage`），本版构建里的上传绑定不完整。属于 origin trial 阶段的正常状态，但不能作为工程依赖。

### 战略判断

- **不要为它设计架构。** 只有 Chrome 一家实现，Firefox/Safari 都没有表态，API 面还在改。
- **但要在接口后面给它留位置。** 它的捕获路径（4.2 ms）和"文字仍是真 DOM、可选中、可被读屏软件读到"这两点，长期价值太大，不能放弃。
- **在 Electron 里它反而好办**：网页需要 origin trial token，而 Electron 可以直接 `app.commandLine.appendSwitch('enable-features', 'CanvasDrawElement')`，不依赖 trial 窗口。代价是钉死 Electron 版本。

## 五、推荐的排版子系统架构

**一个接口，四个后端，按能力递增排优先级。**

```ts
interface TextRasterizer {
  /** DOM 内容 → 可上传为纹理的位图。必须能被反复调用且结果确定。 */
  rasterize(doc: TypographyDocument, size: {w:number; h:number}, t: number): Promise<ImageSource>
  /** 内容未变时可复用的句柄；返回 null 表示必须重新光栅化 */
  cached(key: string): ImageSource | null
}
```

| 后端 | 耗时 @1080p | 保真 | 依赖 | 何时用 |
|---|---|---|---|---|
| `hic` | ~4 ms（捕获）+ 上传 | 最高（浏览器自己渲染） | Chrome 154+ 且 flag；上传未通 | API 稳定后作为默认 |
| `dom-snap` | **~0.7 ms**（子集字体） | 高 | snapDOM + 字体子集化 | **现在就用这个** |
| `canvas2d` | ~0.2 ms | 需自己实现排版 | 无 | 极简单场景 / 兜底 |
| `png-import` | 0 | 完全由外部工具决定 | 无 | 逃生舱，第一天就做 |

### `dom-snap` 的关键实现规则

1. **字体必须子集化，且按字形集哈希缓存。**
   子集在字符集变化时才重算，产物按 `hash(字形集, 字号)` 存盘。用户打字时字形集变化很慢，命中率极高。
   —— 不做这一条，每帧 129 ms；做了，每帧 0.7 ms。
2. **绝对不要用 `embedFonts:false` 换性能。** 实测它等同于换字体（差异量级与故意换字体相同），且 snapDOM 自己警告可能重新折行。要提性能就去裁字体。
3. **导出前必须等 `document.fonts.ready`**，否则首帧会用回落字体量度，导出的排版与预览不一致——而且这种 bug "看起来都正常"，极难定位。
4. **动画状态要烘焙，不要依赖库去读。** html2canvas-pro 会直接丢掉它。
5. **上传统一走"内容变化才重传"**：排版层只在内容或变换变化时重绘 canvas 并 `texImage2D`，其余帧只做采样变换。1080p 全屏每帧上传是 8.3 MB 的 CPU→GPU 拷贝，60fps 下 500 MB/s，帧率会塌。`texElementSubImage2D`（若可用）正是为这个场景准备的。
6. **重复截图是逐像素确定的**（实测差异 0）——这一点让它在确定性导出管线里是可用的，不必担心抖动。

### 中文字体子集化的取舍

- 优点：体积从 MB 级降到 KB 级，且字形零损失（实测逐像素相同）。
- 代价：需要把 `fontTools` / harfbuzz 系工具链引入构建流程；字形集变化时要重算并失效缓存。
- 字体许可：**子集化属于"修改"，必须检查字体的再分发条款。** 系统自带字体（如 simhei）通常不允许随软件分发，正式产品要么换开源字体（思源黑体 / Noto Sans CJK，OFL），要么做成"用户自备字体"。这条要在 MVP 里就定死，不要等到打包时才发现。

## 六、复现方式

```bash
cd bench
# 三个截图库的性能 + 动画状态 + HIC 探测
python driver.py            # → result.json
python driver_verify.py     # → result_verify.json（HIC 签名 + 字形保真 + 载荷）
python driver_verify2.py    # → result_verify2.json（API 面扫描 + 字体体积线性）
python driver_verify8.py    # → result_verify8.json（子集化实测）
```

字体子集化：

```bash
python -m fontTools.subset fonts/simhei.ttf \
  --text="用到的所有字符" \
  --output-file=fonts/subset.ttf --layout-features='*' --no-hinting
```

## 七、本次没有验证的部分

诚实标注，避免被当成已证事实：

1. **`texElementImage2D` 是否正确签名存在。** 我只能证明"我试过的 12 种组合都失败"，不能证明"没有能用的组合"。WICG 规范还在演化，值得在 Chrome Canary 上再试一次，或直接读 `github.com/WICG/html-in-canvas` 的当前规范。
2. **`texElementSubImage2D` 与 WebGPU 的 `copyElementImageToTexture`** 只确认了存在，未验证行为。
3. **字体子集化的实际构建集成**（自动收集字形集、缓存失效策略、许可审查）尚未做原型。
4. **在真实 Electron 里的表现**未测。本次全部是 headless Chrome 154。Electron 的 Chromium 版本可能落后，需按 `app.commandLine.appendSwitch` 再验一次。
5. **长时导出的稳定性**（数千帧连续截图的显存与缓存行为）未测。
6. **排版编辑器的交互复杂度**（选区、拖拽、图层树、逐字动画）完全没有触碰——这是排版模块真正的工作量所在，与出图路径无关。
