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
- **Ribbon 只放「稳定控件集」，参数编辑住右侧「元素属性」面板**（`PropertiesPanel`，
  与图层 / 动画共用右侧位置）。原先填充组按 `fillKind` 条件展开（角度 / 第二色 / 图案 /
  周期 / 线宽），每切一次填充方式组宽就变一次、后面的组整体位移 —— 用户瞄准的按钮在
  点下去之前跑掉（用户反馈的「改填充方式影响 Ribbon 排版」）。现在 Ribbon 的图形填充组
  与文本填充组都只有「方式 + 主色」两个恒定控件（不适用时置灰但**保留占位**），其余
  参数在三处填充共用的 `PaintEditor` 里。**加新的填充参数时往面板加，不要再往 Ribbon
  的填充组加条件展开。**

---

## Ribbon 布局与取色入口

- **Ribbon 的弹层必须是 `position: fixed`**（`controls/popover.ts` 的纯函数定位）。
  面板是 `overflow: auto/hidden`（横向滚动 + 固定高度），absolute 弹层会被整个裁掉。
  取色卡、菜单、下拉、图库全部走这一套。
- **「开始」的字体区是 PPT 式两排**（`layout: 'rows'` + `size: 'icon'` 的纯图标按钮）：
  第一排是宽下拉（字体 / 字号 / 字号 ∓ / 清除格式），第二排是字形格式，**行尾**是
  字体资源（本机字体 / 导入字体）—— 两者之间靠 `{ kind: 'spacer' }` 撑开，两排的
  右边缘因此天然对齐（间距不定死，改了字号/字体名也不会破坏对齐）。
  这是 `align-items: stretch` 的直接推论：每行必须撑满组宽，行内的弹性间隔才有
  空间可吃。宽度口径有**两处必须同源**——
  `ribbon-model.ts::itemWidth()`（组宽预算）与 `Ribbon.svelte` 在根元素下发的 CSS 变量
  （`--ribbon-icon-w` 等，值来自 `DENSITY`）。各写一遍的表现是「预算说 26px、按钮实际
  30px」，整条 Ribbon 的横向排布会慢慢错位。
- **取色卡的「最近使用的颜色」只记裸色**（`ui/typography/recent-colors.ts`，localStorage、
  可丢）：把 `@accent1` 混进最近色会让那一行在换方案后显示一堆与主题网格重复、
  但语义不同的格子。
- **颜色控件的 `themeId` 由 `ribbon-defs.ts::injectThemeId` 一处注入**，不要在
  `kind: 'color'` 项上各写一遍。漏掉一处的表现是「取色卡画的是默认方案的色格，
  而选出来的颜色按当前方案解析」—— 切过配色方案才现形，且不报错。
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
