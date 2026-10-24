# src/ui/typography/ —— 排版编辑器的 UI 约定

编辑器形态 · Ribbon 布局 · 取色入口 · 元素手势。
**文档模型、光栅化与配色方案的语义在 `src/typography/AGENTS.md`**（本文件只管 UI 侧）。

**何时读我**：改 `ui/typography/**` 或 `ui/ribbon/**`；动 Ribbon 的宽度预算；
动**任何取色入口**；动舞台上的元素手势（拖 / 缩 / 旋转）时。

相关：`src/typography/AGENTS.md`、`src/ui/AGENTS.md`（抽屉 / modal / 浮层的通用约定）。

---

## 旋转几何

- **选中框必须带 `rot`**：单个元素绕自身中心旋转时 `x/y/w/h` **一点没变**（只有 `rot` 变），
  用未旋转 AABB 画框会纹丝不动。单选 → 元素自己的框（含 rot）；多选 → 整个选区的 AABB。
- **旋转后的缩放走 `resizeFramesRotated`**，不能直接用轴对齐的 `scaleFrames`
  （否则「拖右边却往斜上方长」）。`rot === 0` 时两者逐位等价（有单测钉着）。
- 测这类手势的 E2E 时注意：细长元素转 90° 后把手会跑到视口外，用正方形元素测。
  旋转本身断言 `getComputedStyle(el).transform` 矩阵的非对角项，别用「外接矩形变大」。

---

## 编辑器形态 · 快捷键分流 · 图片置入

- 编辑器形态：**工程内部的一个视图**，UI 是数据驱动的 Ribbon（Tab / 分组 / 按钮，
  含 Contextual Tab 与横向滚动 —— 窄窗口横向滚动是设计如此，Office 也是这么做的）。
- **双击片段 = 打开它自己的编辑器，一律不切分**（切分保留 `S` 键与检查器的按钮）。
  双击是最高误触的手势，把破坏性操作绑在上面迟早出事。
- **图片置入画布只有一条实现**（`ui/typography/actions.ts`）：`placeImageBytes`（新字节，
  三层登记 —— engine 的 `registerImageBytes` / typography 的 `putImageBytes` /
  `assets.put` + `p.assets[]`；缺一层的表现是「排版页里好好的，把这条素材拖到时间轴上
  是一片空白」）与 `placeImageAsset`（已在册的素材，**不许再登记一遍** —— 那会造出第二条
  一模一样的池子素材；只在 objectURL 缺席时补一条）。Ribbon 的「插入图片」、剪贴板粘贴、
  媒体池拖放三条路都走它。多张同时进来按**阶梯错开**摆，全叠在中心的话只看得到最后一张。
- 快捷键按**分流**处理：`App.svelte` 的 `onKey` 在编辑器打开时整段交给
  `ui/typography/keys.ts`。于是 `S`（切分）与 `Alt+↑↓`（移轨）在排版页**自然失效**，
  不需要在时间轴的每条分支上加 `if (!editorOpen)`。
- **编辑器内不做脏标记** —— 排版编辑全程直写工程（可撤销），不存在「切走就丢」的东西。
  需要脏标记的是「工程 vs 磁盘」（`savedVersion`）。
- **画幅与上屏大小的入口在「设计」Ribbon**（`ribbon-canvas-size` → 浮层
  `typo-canvas-pop`，组件 `CanvasSizePopover.svelte`）。按钮由 `ribbon-defs`
  描述生成、只能发无参意图（`onOpenCanvasSize`），**拿不到事件目标**，所以浮层的
  锚点由编辑器用 `CANVAS_SIZE_TESTID` 现查 —— 那个常量同时是 E2E 的稳定契约。
  浮层是受控的（`anchor` / `onclose` 由编辑器给），定位与关闭复用
  `controls/popover.ts`（`position: fixed`，与 Ribbon 里其它弹层同一套）。
  写 `doc.size` 走 `editorState.commit`（可撤销），写上屏大小走 `store.updateClip`
  的 `transform.sx / sy`。**缩放条上不再有尺寸读数** —— 别在 `.zoombar` 里加回去。
- **它读的每一样都是「原地改的对象」，派生必须 `$derived.by` + 返回新对象**：
  ```ts
  const docSize = $derived.by(() => { void appState.version; return { w: doc.size.w, h: doc.size.h }; });
  ```
  `$derived(doc.size)` 拿到的是**同一个引用**，`===` 不变 ⇒ 不重算 ⇒ 浮层读数停在
  旧值，而画面本身是对的（所以看起来像「只有数字不更新」）。`svelte-check` 不报这个。
- **「文字转路径」按钮住在「开始」的「路径」组**（`typo-text-to-path`），与
  「文字填充」同一条出现规则：只在选中文本时占位置。它**异步**（等 wasm +
  字体字节），期间不改文档；失败只 flash 一条可照做的提示（缺字 / 字体读不到 /
  拒绝授权 / 合成字面 / 竖排），**不做半成品转换**。所以按钮没有「进行中」态也
  安全 —— 连点两次不会叠出两批图形（第二次落到「内容已变 / 已不是文本」的分支）。
  **系统字体不需要导入**：字体在注册表里找不到时会去读本机字体（第一次可能
  等 3 秒，会先 flash 一句提示）；只有「本机也没有 / 没授权 / 没有这个字重」
  才让用户导入文件。实现与取舍见 `src/typography/AGENTS.md` 的「文字转路径」。
- **Ribbon 只放「稳定控件集」，参数编辑住右侧「元素属性」面板**（`PropertiesPanel`，
  与图层 / 动画共用右侧位置）。原先填充组按 `fillKind` 条件展开（角度 / 第二色 / 图案 /
  周期 / 线宽），每切一次填充方式组宽就变一次、后面的组整体位移 —— 用户瞄准的按钮在
  点下去之前跑掉（用户反馈的「改填充方式影响 Ribbon 排版」）。现在 Ribbon 的图形填充组
  与文本填充组都只有「方式 + 主色」两个恒定控件（不适用时置灰但**保留占位**），其余
  参数在三处填充共用的 `PaintEditor` 里。**加新的填充参数时往面板加，不要再往 Ribbon
  的填充组加条件展开。**

---

## 关键帧面板（`KeyframePanel.svelte` / `KeyframePopover.svelte`，2026-10-24）

- **位置在预览下方、与预览同宽**：`.main` 的中间列包一层 `.center`（viewport + 4px 横向
  把手 + 面板）。**不要塞回右侧栏** —— 那里两百多像素宽，只能退回「一根 0.6 秒的条」；
  右侧现在只剩图层 / 元素属性 / 脚本三栏（只读的「动画窗格」已整体删除）。
- **三列：元素列 | 属性列 | 时间轴**。属性行与右侧轨道**同排**（同一 `ROW_H`）——
  早期版本把属性行嵌在元素列表里，元素一多就空出成片行、轨道与行头错位。
  **属性列是独立一格**（不在横向滚动容器里），只同步 `scrollTop`。别退回
  `position: sticky` 冻结：sticky 的单元格只有「行」那么高，横向滚到中段时播放头
  会从属性列下面露出来（背景也不连续）。
- **元素列列「有动画的 + 舞台上选中的」**。只列前者的话，一个还没动画的元素永远进不了
  列表，也就永远加不了第一条轨道。元素列可整列折叠（`typo-kf-aside-toggle`）。
- **所有操作都在顶栏**（添加属性 / 时刻 / 删帧 / 删轨道 / 播放 / 重播 / 时钟），宽度不够
  时横向滚动 + 两端渐变（`updateFades`，与 Transport 同款）。**不要在面板底部再放一条
  底栏** —— 它紧挨着 zoombar，两条横条会读成同一个功能的不同部分。
- **值 + 曲线在关键帧浮层**（`KeyframePopover.svelte`）：点关键帧弹出，锚在菱形上，
  下方放不下就翻到上方并夹在视口内。双击空白补帧**只选中、不弹浮层**（连续补帧时它
  会挡住刚加的点）。
- 关键帧形状 = 缓动种类：缺省菱形、`cubic-bezier`/关键字圆形、`steps()` 方形
  （`easeKindOf`）。填充用 `--surface-0`、描边 `--text-secondary`，选中换 `--accent`。
- **一条动画 = 一个属性**（见 `src/typography/AGENTS.md` 的 tracks 一节）。不同属性要
  异步就分别占一条轨道，各自的首帧决定 `delay`；断言要读计算样式 `animationDelay`，
  文档字段只是意图。
- 时间轴：横轴是绝对秒，`zoom` 只改像素密度（`⌘/Ctrl + 滚轮`，以指针处时间为锚），
  普通滚轮 = 横向滚动（内容超出时），`scrollLeft` 驱动标尺平移；**播放头夹进
  `[0, clipDur]`**（打开编辑器时播放头可能停在片段外，原样显示会出现 `-24.00s`）。
- **手势与片段编辑器对齐**：标尺拖动 = 播放头，轨道上拖动 = 框选（框内关键帧多选，
  Delete 一起删，点空白清空）。关键帧**默认自由拖曳**，`Shift` 才吸附到拍 ——
  无条件吸附时 0.5s 一跳，用户会以为「拖不动」。
- ⚠️ **修饰符类名不能与同组件的块类名重名**：`.beat` 上加过 `class:bar`，而顶栏也叫
  `.bar`（Svelte 的 scoped class 会一起命中），于是每条小节线上长出一个 12×27 的方块
  （用户报的「标尺上的小方块」）。现在叫 `is-bar`。这条同样适用于 `on` / `sel` 这类
  一个词的修饰符。
- 关键帧用**时刻**标识而不是下标：`applyTrackTiming()` 每次写入都会重排关键帧。
- 手势：拖动关键帧 = `beginGesture → live(moveKey) → endGesture`，没位移就
  `cancelGesture`；擦洗挂在滚动容器上（轨道少时下方空白也能拖）；Delete 删选中帧
  （事件里挡掉 input / textarea）；拖动吸附到拍，按住 Alt 关闭。
- **列表派生必须逐层浅拷贝**（`{ ...a, keys: a.keys.map(k => ({ ...k })) }`）：
  文档对象是原地改的，直接交给 `{#each}` 会在拖动后按 `===` 认为没变而静默断更。
- 缓动是**出向**语义（本帧 → 下一帧），所以入口长在关键帧上；末帧没有下一段，
  控件呈禁用态并给一行说明。
- 「双击轨道加点」这条提示**只在底栏**（`hints.ts::KF_HINT`，指针落到轨道区时出现），
  面板里不再写说明文字。

## 脚本页签（`ScriptPanel.svelte`）

- 入口是右侧第 4 个页签「脚本」，**不要再往 Ribbon 加按钮**（Ribbon 只放稳定
  控件集，见本文件开头）。脚本是**文档级**的，属性面板只放一行只读提示
  「受 N 条脚本控制」，那一条是就地同步的状态，不是操作入口。
- 代码编辑走**草稿 + 失焦提交**（`onblur` → `editorState.commit`）：每个字符一次
  commit 会把撤销栈灌满（一次 Ctrl+Z 只退一个字母）。同时保留「检查语法」按钮
  （只编译不执行），错误消息显示在按钮旁。
- 总开关直接写 `appState.setRunTypoScripts()`（UI 偏好）；`ScriptPanel` 自己不存
  第二份。关闭时面板顶部有说明、图层行有 `code` 标记、元素属性底部显示
  「脚本未运行」——三处都要在，少一处就会出现「脚本写了但没人知道它没跑」。
- **列表派生必须返回浅拷贝**（`scripts` 里对每条脚本 `{...s}` + 拷贝数组字段）。
  `doc.scripts[i]` 是原地改的普通对象：直接把它交给 `$derived` / `{#each}`，
  版本号变了、派生重跑了，但引用没变 ⇒ Svelte 按 `===` 认为「不用更新」，
  新增/删除脚本要等下一次交互才刷新。同样的坑在 `LayersPanel` 文件头写着。
  依赖要显式读 `appState.version`，不要只依赖 `doc`（它每次重算还是同一对象）。
- 代码框的草稿同步**看焦点**（`codeFocused`）：同步 effect 在每次版本变化时都会
  重跑，不挡住会在打字途中被库里的旧代码覆盖。同一条脚本的其它字段（启停 /
  needs / 目标）变化时不要碰草稿，只在「选中换了 / 代码被外部改了」时替换。
- 运行诊断从 `script/diagnostics.ts` 订阅（模块级表，不进文档）；`$effect` 里
  `subscribeScriptDiagnostics` 的清理必须返回，否则切页签后还在累加计数。
- 脚本写入会改变**结构**（`needs` / `targets` / 逐字 span），所以
  `TypographyEditor` 的 `signature` 必须带 `scriptsActive` 与 `editingId`；
  改 `docSignature` 的入参时两处（build / sync）一起改。

## Ribbon 布局与取色入口

- **Ribbon 的弹层必须是 `position: fixed`**（`controls/popover.ts` 的纯函数定位）。
  面板是 `overflow: auto/hidden`（横向滚动 + 固定高度），absolute 弹层会被整个裁掉。
  取色卡、菜单、下拉、图库全部走这一套。
- **字体下拉的每个选项用它自己的字体画名字**（`SelectOption.fontFamily`，值由
  `typography/font/css-family.ts::cssFamily` 生成），触发区（`.sel-label`）跟随当前值 ——
  挑字体时看的是「长什么样」，配一行小字说明是噪声。族名**必须加引号转义**：本机族名里
  有空格 / 数字 / 逗号，裸拼会让整条 `font-family` 声明失效，而失效是**静默**的
  （退回界面字体，不报错）。E2E 因此不只断言 computed 字体名，还量同一串字在四族里的
  宽度必须互不相同（`typography-ribbon.spec.ts` 的「字体下拉」用例）。
- **「开始」的字体区是 PPT 式两排**（`layout: 'rows'` + `size: 'icon'` 的纯图标按钮）：
  第一排是宽下拉（字体 / 字号 / 字号 ∓ / 清除格式），第二排是字形格式，**行尾**是
  字体资源（本机字体 / 导入字体）—— 两者之间靠 `{ kind: 'spacer' }` 撑开，两排的
  右边缘因此天然对齐（间距不定死，改了字号/字体名也不会破坏对齐）。
  这是 `align-items: stretch` 的直接推论：每行必须撑满组宽，行内的弹性间隔才有
  空间可吃。宽度口径有**两处必须同源**——
  `ribbon-model.ts::itemWidth()`（组宽预算）与 `Ribbon.svelte` 在根元素下发的 CSS 变量
  （`--ribbon-icon-w` 等，值来自 `DENSITY`）。各写一遍的表现是「预算说 26px、按钮实际
  30px」，整条 Ribbon 的横向排布会慢慢错位。
- **大按钮的宽度跟着标签走**（`labelWidthPx()`，`itemWidth()` 与 `RibbonButton` 用
  同一个数）。写死 50px 的话「插入生成器」会被截成「插入生…」—— 而 Ribbon 的设计
  前提是「文字直接写在按钮上」，截断等于把功能藏起来。估算按 `--fs-xs`（10px）：
  全角 10.2、其余 5.8，另留 10px 内边距；显式 `width` 仍然优先（如「应用到整个项目」）。
- **取色卡的「最近使用的颜色」只记裸色**（`ui/typography/recent-colors.ts`，localStorage、
  可丢）：把 `@accent1` 混进最近色会让那一行在换方案后显示一堆与主题网格重复、
  但语义不同的格子。
- **颜色控件的 `themeId` 由 `ribbon-defs.ts::injectThemeId` 一处注入**，不要在
  `kind: 'color'` 项上各写一遍。漏掉一处的表现是「取色卡画的是默认方案的色格，
  而选出来的颜色按当前方案解析」—— 切过配色方案才现形，且不报错。
- **自定义配色方案的移除入口是图库的右键菜单**（`RibbonThemes` → `controls/Menu`）：
  只有 `options[].removable`（= 工程 `customThemes` 里的条目）才挂得上，内置方案
  只读。动作只有一条 `actions.removeCustomTheme`，一笔撤销，且**同时删掉引用它的
  `doc.theme` / `Project.typographyTheme`** —— 留着悬空 id 不会报错（渲染照样回落
  默认方案），但工程会带着一个「本版本没有的方案」。两个实现细节：右键菜单必须
  渲染在 `{#if open}` **之外**（点菜单项时指针不在面板上，图库会先自关，嵌套的
  菜单会被连带卸载、点击落空）；图库的 `attachDismiss` 必须开
  `keepOnRightButton`，否则右键一按下面板就没了，`contextmenu` 根本落不到那一行。
- **原生取色器（`<input type="color">`）只接 `change`，不接 `input`**：那个 input
  活在取色卡的弹层里，而提交动作会关掉弹层 ⇒ input 被销毁 ⇒ **原生取色器被连坐关闭**，
  颜色根本拖不动（用户报过）。拖动中的实时预览要用手势事务（`live`/`endGesture`）做，
  不能「每次 `input` 都提交」—— 那还会往撤销栈里塞几十笔。
- **面板里的一切取色入口走 `ui/controls/ColorField.svelte`（色块按钮 + 取色卡）**，
  裸 `<input type="color">` 只允许存在于 `ColorPickerPanel` 内部的「其他颜色」一格
  （它是逃生舱，不是入口）。原来散落的 6 处（检查器 3 + 属性面板 1 + 填充面板 2，
  另加 lab 2 处）都换过了 —— 原生控件给不出**主题色引用**，所以「换配色方案 ⇒
  颜色跟着走」在那些入口上根本不可能发生。两条口径不变：**显示的是解析后的 hex，
  写回的仍是裸 hex**（精细调整区，改完就该钉死）；`theme` 传**对象**（调用方解析好，
  含 `customThemes`），`allowNone` 控制要不要「无颜色」那一项。

---

## 图片的四角调整模式（`QuadEditLayer.svelte`）

图片元素开了「四角调整」之后，可以在画布上拖四个角 / 边中点：

- **模式是显式的**（属性面板的「在画布上调整」勾选框 → `editorState.quadEditId`），
  不是「选中就显示手柄」。原因：四角手柄与 8 个缩放把手在四个角上**完全重合**，
  两套同时显示时用户分不清拖的是缩放还是透视。进入该模式后 `SelectionLayer`
  只留外框（`quadEdit` prop），退出/换选中就收手柄（`setSelection` 里清）。
- **手柄画在旋转后的框上**：`frame.rot` 是外壳的 CSS 旋转，四角在未旋转的层空间里
  —— 画在未旋转位置上的话，转过 30° 的图片会看到手柄浮在画外。拖动的逆变换
  用 `Rᵀ`（`docToLayer`），写反的表现是「转过的元素手柄走反方向」。
- **拖动是一笔撤销**：`beginGesture()` → `live()`（每 move 改 `el.quad`）→
  `endGesture(tr('typo.undo.quad'))`；纯点击（零位移）走 `cancelGesture()`，
  不留空记录。Esc = 取消这次拖动，不在拖动时 = 退出模式。

---

## 生成器（`ui/typography/SvgGenPickerModal.svelte` + 元素属性面板）

- **入口只有一个按钮**（「插入」页 → 图形组 → 「插入生成器」），点开按六组分区的
  22 格选择器。**参数不进 Ribbon**：横向条带装不下十来个滑杆，全部住在右侧
  「元素属性」的「生成器」小节（类型 / 种子 / 换种子 + `ParamDef` 动态控件）。
- **换类型也走同一个选择器弹窗**（带 `current` 高亮），不是下拉：二十多个生成器靠
  名字挑不出来。与「更换特效 / 转场 / 算法艺术」是同一种交互。
- **预览盒的宽高必须与 `spec.aspect` 严格同比例**（`artBox()` 算好后内联）。
  `<svg preserveAspectRatio="none">` 会照着盒子拉伸：盒子一旦靠 `width: %` +
  `max-height` 夹出来，圆就会变成横向椭圆（用户报的「预览都被拉伸」）。
- **预览与插入同源**：卡片就是 `buildFromSpec(spec, 默认参数, defaultSeed)` 的输出，
  与 `actions.addGeneratedShape` 第一次 build 逐字节相同。手画预览迟早与生成器分家。
- **拖动实时、松手一笔撤销**：`range` 的 `oninput` 走 `setGeneratorParamLive`
  （`beginGesture` + `live`），`onchange` 走 `endGeneratorParamLive`。下拉 / 开关是
  离散值，直接 `setGeneratorParam`（一次 commit）。
- **多选语义**：换类型作用于**全部**生成器元素；改参数只写「与首个元素同 id」的那些
  —— 否则一个色板上的键会污染另一个生成器。
- 参数标签一律 `resolveLabel(p.labelKey, tr)`：`ParamDef.labelKey` 的类型是 `Label`
  （插件可能给字面量），直接 `tr()` 会编译报错。
- **`typo-to-path` 对生成器元素必须可点**（`shape:'svg' && !gen` 才置灰）：
  它的语义是「脱离生成器」，不是「参数化图形转路径」。
- 未知 `gen.id`（旧档 / 别人的数据）→ 生成器小节只留一行降级提示，路径照常渲染。
