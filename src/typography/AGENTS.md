# src/typography/ —— 排版

`TypographyDocument` 模型 + 光栅化后端 + 字体注册表 / HarfBuzz 子集化。
排版是**工程内部的第二个视图**（`OpenProject.view`），不是 modal、也不是新 tab。

**何时读我**：改排版文档模型 / 光栅化 / 字体与子集化 / 配色方案 / 脱机媒体占位符时。

相关：`src/ui/typography/AGENTS.md`（编辑器、Ribbon、取色入口的 UI 约定）、
`src/ui/AGENTS.md`（抽屉与 modal 的通用约定）、`src/project/AGENTS.md`（字体字节存哪）。

---

- **色标（渐变停靠点）的两条约定**：文档里 `stops` 的数组顺序是**用户的编辑顺序**
  （面板上色标行不跳位），渲染前一律过 `document.normalizeStops`（钳制 0..1 + 按 offset
  排序）——SVG `<defs>` 与 CSS background 共用它，别各排一份；`applyPaintPatch` 在补丁
  **不带 `stops` 时保留整份色标**，只改「offset 最小 / 最大」的那两个颜色，所以 Ribbon
  的两个颜色控件对多色标是安全的（不会被重建成两色标）。Ribbon 的「渐变开始」读的也是
  排序后的首色标。
- **文本框背景与字形填充是两层，别合并字段**：`TextElement.boxFill` 画在元素外壳
  （`.typo-el` 的 CSS `background-*`，文字之下）；`fill` 裁在内层 `.typo-text` 的
  `background-clip: text` 上。共用一个字段的话，`background-clip: text` 会把背景色一起
  裁到字形里，「给文本框填个底色」就变成给字上色。`boxStroke` 同理（外壳的 CSS border，
  `box-sizing: border-box` 已由 elementStyle 钉死）。两者都由 `css.ts::textBoxStyle`
  产出**完整**声明表（就地同步没有删除语义，切回「无填充」必须能复位）。
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
- **元素级 3D 是「参数 → CSS 字符串」，不是矩阵**（`document.ts::Transform3D` +
  `css.ts::transform3dCss`，面板在「元素属性」的 3D 分节）。三条纪律：
  1. **变换顺序固定**：`perspective → translate3d → rotateX → rotateY → rotateZ →
     skewX → skewY → scale3d`。改顺序 = 改已有工程的画面。
  2. `rotate.z` 与 `frame.rot` **合成一个 `rotateZ`**（都是绕 Z），不写两条 ——
     否则「谁先谁后」会变成第三处约定。
  3. `transform-origin` / `backface-visibility` / `transform-style` **总是输出**
     （关闭时给 CSS 默认值）：就地同步只 set 不 delete，漏一个键就会在
     「启用 → 关闭」后残留（与 `textBoxStyle` 同一条纪律）。
  `perspective` 用 **`perspective()` 函数**，所以没有 `perspective-origin`；要做
  「整页共享一个消失点」得把 perspective 提到文档根（未做）。选择框 / 吸附仍按
  **未倾斜**的 `frame` 算 —— 倾斜元素的可视范围与编辑框不一致是已知的，与旋转同源。
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
  上下颠倒（`tests/e2e/typography-export.spec.ts` 有方向断言钉着）。
  ⚠️ **`UNPACK_FLIP_Y_WEBGL` 对 `ImageBitmap` 源在 Chromium 上被忽略** ⇒
  图片 / 视频的上传源统一成 **canvas**，翻转在 `SourceManager.uploadImage` 一处定义。
- **图片元素的抠图 / 四角是 CPU 处理的**（`typography/image-fx.ts`），不能像片段那样
  交给 GPU：抠图必须逐像素，四角重采样要控质量（与 `placement.frag.ts` 逐点对拍），
  而排版渲染成 DOM，没有 placement pass 那个可编程采样点。三条实测结论：
  1. **CSS 3D 变换在 snapDOM 里是保留的**（2026-10-21 重测 3.2.0：裸 div 的
     `perspective` / `rotateY` / `rotateX` / `translateZ`、真实 `.typo-doc` 嵌套
     （`contain` + `isolation` + `overflow:hidden`）、用四角单应写的 `matrix3d`、
     `<img>`、文字、外层 `scale()` —— 全部正确出图）。**旧注释「snapDOM 会丢
     `matrix3d`」是误判，已删**；当时看到的现象另有原因（未定位）。
     复现脚本在 `.codebuddy/tmp/2026-10-21/`。跨元素 `preserve-3d` 的深度排序
     **仍未验证**。抠图 / 四角仍走 CPU，所以有 `key` 或非恒等 `quad` 的图片元素
     内容节点是 `<canvas>` 而不是 `<img>`（`render-dom.ts::buildImageNode`）——
     这是逐像素处理的要求，不是 3D 的要求。
  2. **处理是异步的**（要等图片解码）。舞台未就绪时先显示**原图**、完成后靠
     `BuildDocOptions.onImageFxReady` bump 一次 version 换节点；光栅化那条路
     **必须 `await ensureDocImagesFx()`**（`dom-snap.ts`）—— 不等的话截图拿到原图，
     而那张图会按正确的缓存键存下来，表现成「导出没抠图且永远不恢复」。
  3. **缓存键 = URL | 位图尺寸 | fit | crop | key 参数 | quad**（`fxKey`）。恒等 quad
     与「没有 quad」同键（两者都走 `<img>` + CSS，与引擎 `u_quadOn = 0` 同一判据）。
     拖动参数时按**元素串行 + 50ms 去抖**（`pump`）：不合并的话拖一下滑杆就是几十次
     1920×1080 的逐像素重算。
  4. **色键公式只有一份**：`core/image-fx.ts::applyKeyToRgba`，与
     `engine/placement.frag.ts` 逐字对齐。两套分家的形态是「排版里边缘发绿、
     时间轴上干净」，没有任何报错。
- **两个测试钩子**：`FontRegistry.subsetting` 可关（退回整体内联），
  `tests/e2e/typography-font.spec.ts` 用它断言**子集 vs 全量逐像素零差异** —— 这是唯一能证明
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
  `tests/unit/typography-icon-shapes.test.ts` 的全量守卫**（1800+ 个图标逐个转换、坐标必须落在
  0..100）—— 模板变了的话表现是「选择器里那一格是空的」，没有任何报错。
- **配色方案：颜色是「引用」而不是值**。`TextStyle.color` / `highlight` /
  `shadow.color`、`Paint` 的各个色、`Stroke.color`、`boxFill` / `boxStroke` 都可以是
  `@accent1`（或带明暗变体的 `@accent1.l80`），见 `typography/theme.ts`。这是
  「换配色方案 ⇒ 用了主题色的元素自动跟着变」的全部机制；从标准色 / 最近使用 /
  其他颜色进来的**裸 hex 不跟着变**，这就是「仅限于使用了配色的元素」。
  三条硬纪律：
  1. **一切颜色的渲染出口都要过 `resolveThemeColor()`** —— 全项目只有两个出口
     （`css.ts` 的 CSS 声明表 + `render-dom.ts` 的 `<defs>`）。漏一处的表现是
     「舞台上变了、导出没变」，而且不报错。
  2. `doc.theme` 是**可选字段**（缺省 = 默认方案），所以**它本身不抬 `SCHEMA_VERSION`**
     —— 与 `groups` / `Paint.opacity` 同一条约定。但**工程级**的两项抬过一次（见下一条）。
  2b. **`Project.typographyTheme` / `Project.customThemes` ⇒ `SCHEMA_VERSION = 6`**
     （5→6 恒等迁移）。自定义方案是**用户内容**：旧版静默忽略 `customThemes` 再保存
     等于把用户调好的那套颜色抹掉。解析顺序「自定义 → 内置 → 默认」，
     `sanitizeCustomThemes` 逐条校验、坏条目整条丢（缺槽 / 坏 hex / 撞内置 id），
     `validateProject` 里**绝不抛** —— 工程必须打得开。
     ⚠️ **凡是从 `doc.theme`（id）出发的解析，都要把 `Project.customThemes` 一起带上**
     （`themeById(id, custom)` / `resolveThemeColor(color, theme, custom)`）：漏一处
     的表现是「用了自定义方案的颜色回落成默认方案」，只在自定义方案上看得出来。
     调用点：`render-dom` 顶层两次（build / sync）、`ribbon-defs`、三个面板、
     `TypographyEditor`（舞台 + `textRaster.customThemes`，后者是**函数**式字段，
     切工程不能留上一份）。
  3. **明暗变体是实测标定的，不是「凭印象调亮度」**：三支规则（常规色走 OOXML 的
     `lumMod/lumOff`、纯黑纯白走固定灰阶、极亮色走亮度乘系数）的实测依据写在
     `theme.ts` 的文件头。改算法前先 `node scripts/extract-theme-colors.mjs analyze <取色卡截图>`
     对照 —— 常规色那 7 列的实测与预测是**逐通道误差 ≤ 1** 的。
- **文字高亮走 `--typo-hl` 自定义属性下发到行内段**，不是给 `.typo-text` 上色：
  那个盒子是 flex 容器、撑满整个元素框，背景会连换行处的空白一起填满
  （看起来是「给文本框刷了底色」而不是「把字涂黄」）。背景**不继承**，所以元素级
  高亮只能靠变量传给每个 `<span data-run>`；行内覆盖则直接写 `background-color`。

---

## SVG 素材生成器（`src/typography/svg-gen/`）

22 个程序化生成器（一期 20 + 二期 motif / contour），对外只有一条契约：
**纯函数** `build(params, seed) => { d, evenOdd?, strokeOnly?, commands }`。

- 坐标 authored 在 **0..100 × 0..100**，走既有的 `shape:'svg'` + `scaleFrom100` 通道；
  插入后就是普通 `ShapeElement`，填充 / 描边 / 混合 / 动画 / 导出全部白拿。
- **随机只能来自注入的 `seed`**（`core/prng.ts`）。不许 `Math.random` / `Date.now` / DOM ——
  否则「同参数同种子复现同一张图」这条唯一的承诺就没了。
- 图元 IR（`prims.ts`）是 `d` 的**唯一序列化出口**。不要在生成器里拼字符串：
  相对命令的当前点会串味、`A` 的 flag 会与数字粘连、闭合带另起 `M` 会让 evenodd 自我抵消。
- `commands` 必须是真实命令数（序列化时数出来的），`GEN_MAX_COMMANDS = 3000`；
  超了只 `console.warn`、**不改用户参数**（静默降档的表现是「拖到最大却没变」）。

### 数据模型

- `ShapeElement.evenOdd?` + `ShapeElement.gen?`（`{ id, seed, params }`）都是**可选字段**，
  不抬 `SCHEMA_VERSION`（与 `groups` / `doc.theme` 同一条约定）。
- **渲染只读 `path`**，不重算；改参数时在 `actions.ts::rebuildGen` 里重算并写回。
  这样 `docHash` 只在真变化时改变，光栅化缓存口径不变。
- `gen.params` 存的是**合并默认值后的全量值**：工程文件不会因为将来改了默认值而静默变样。
  读旧档 / 外来数据时 `mergeParams()` 会补缺键并归一 checkbox。
- 未知 `gen.id` → 属性面板降级隐藏、路径照常渲染、不抛错。

### 五条会再咬人的坑

1. **`evenOdd` 必须一路透传**（`ShapeBox.evenOdd` → `shapeGeometry('svg')` → `render-dom` /
   `path-ops`）。漏一处的表现是「环 / 刻度盘 / 嵌套框全变成实心块」，不报错。
2. **开放样条不能对邻点取模**。取模会让首点的前驱变成末点，端部切线反向、曲线甩出盒外
   （实测 -15，盒是 0..100）。`serializePrims` 的 `at()` 已按 close/open 分开处理。
3. **闭合带的下沿必须 `L` 接上**，不能另起 `M`（evenodd 会把带子算成两片互相抵消）。
4. **嵌套环带是两条子路径**（外框一条、内框一条）。把内框顶点接在外框后面是一个自交
   多边形，evenodd 会在连接处涂出蝴蝶结。
5. **坐标必须留在 0..100**：越界会撑大包围盒，选中框、布尔运算、光栅化区域跟着错。
   生成器里的夹取（抖动、外沿、溅点扩散）是硬要求，不是审美。
6. **marching squares 的 16-case 表要按位核对**（`defs/contour.ts`）。两处会静默出错：
   ① 鞍点（5 / 10）的配对必须**绕着单个角**走，写反就把线连到对角线方向；
   ② 「只有一个角在下」的三组（11 / 13）最容易把孤立角认错 —— 后果不是报错，
   而是插值被夹到 0/1、端点全部落在格点上，等高线断成一截一截的虚线。改表后
   先跑 `tests/unit/svg-gen.test.ts` 里的「等高线不出盒」与命令数守卫。
7. **环带的内圈必须反向绕向**（`prims.ts::band` 已按此发出）。两个后果：
   - `nonzero` 下「外圈顺时针 + 内圈逆时针」才是环，同向会变成实心圆盘；
   - **多个图形互相重叠时要走 nonzero**（刻度盘的刻度与环），交集是**并集**。
     走 evenodd 的话重叠处会被挖空 —— 刻度穿过环的那一段直接消失（用户报过）。
     反之，靠 evenodd 挖洞的生成器（`rings` / `perspective`）必须保证子路径**不重叠**。

### 脱离规则

「转为路径」与「进入顶点编辑」对生成器元素 = **清掉 `gen`**（路径已是烘焙结果），
元素退化成普通 svg 路径。不清的话，用户手改的节点会被下一次参数改动**静默覆盖**。

### 加一个生成器

1. 在 `defs/<group>.ts` 里写 spec（`params` 用 `shared.ts` 的工厂，区间按「最坏组合
   ≤ 3000 命令」调）；
2. 在 `registry.ts` 的 `SVG_GENERATORS` 与对应组数组里登记；
3. 文案进 `i18n/locales/zh-CN/typography.ts`（`gen.<id>` 与复用的 `gen.p.*`），
   **数据表只存 `labelKey`**；
4. `tests/unit/svg-gen.test.ts` 会自动扫到它（注册表驱动），不需要逐条加测试。

---

## 脱机媒体占位符（素材不存在时画什么）

- **「脱机媒体」占位符**：片段引用的素材**不存在**时，画面给一块暗红占位
  （`file-x-corner` 图标 + 「脱机媒体」），而不是静默跳过那一层（无声空白）。
  - 判据的**唯一实现**是 `appState.isAssetOffline(assetId)`：仓里没有字节**且**
    运行期没登记过 —— 两个条件都要查，只查仓子会把「导入中」误判成不存在，
    只查登记表会把「打开工程时文件读不到」漏掉。**「不存在」与「还没加载好」是
    两件事**：给后者也画占位符的话，正常加载会满屏闪暗红。
  - 三个消费方共用它：合成路径（`render-core` 注入 `sources.setAssetOfflineProbe`）、
    排版光栅化（`textRaster.isImageOffline`）、排版舞台（`TypographyEditor` 的
    `BuildDocOptions.isImageOffline`）。各判一次的形态是「时间轴上显示脱机、
    画布上却空白」。
  - 占位文字由宿主注入（`setOfflineLabel` / `offlineLabel`）—— `engine` 与
    `typography` 都不 import i18n。字形与颜色常量在 `core/offline-media.ts`
    （canvas 与 DOM 两个出口共用，各画各的会出现「时间轴上是暗红、排版里是玫红」）。
  - DOM 侧（`render-dom`）状态迁移**不走 `docSignature`**（素材就绪/消失不改文档
    结构签名），所以 `syncElement` 里用 `data-typo-offline` 标记就地换节点。
