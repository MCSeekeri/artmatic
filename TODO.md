# 本轮已完成（2026-10-15 第二批）

- **取色卡全量替换 + 工程级配色方案**：新增 `ui/controls/ColorField.svelte`（色块按钮 +
  取色卡），替换检查器 3 处、属性面板 1 处、填充面板 2 处、lab 2 处原生
  `<input type="color">`（原生控件只在取色卡内部的「其他颜色」里保留）。`Project` 增
  `typographyTheme` / `customThemes`（可选字段 + 形状校验，坏数据整条丢、绝不抛），
  `SCHEMA_VERSION` 5→6（恒等迁移）。「设计」选项卡增「应用到整个项目」（一次 commit 写
  所有文本片段 + 新片段默认）与「编辑方案」（内置方案打开即复制成自定义方案，保存一笔
  撤销）；`ui/typography/ThemeEditorModal.svelte` 编 8 个可变槽（两个端点纯白/纯黑只读）。
  一切 `@slot` 解析都带上了 `Project.customThemes`（漏一处的形态是「自定义方案的颜色
  回落成默认」，只在自定义方案上看得出来）。
- **时间轴工具栏横向滚动**：`Transport` 装不下时不再折成两行（折行会让工具条高度随窗口
  跳变、并把 stage 的列撑宽），改为 `overflow-x: auto` + 隐藏滚动条 + 纵向滚轮转横向 +
  两侧渐变遮罩（只在可滚且未到端时显示）。**没有**任何「刷新时归零 scrollLeft」的 effect。
- **时间轴高度可调 + 全屏预览**：`UiPrefs.timelineHeight`（钳 120–560，localStorage）；
  工具条下缘一条 4px 热区调高度，轨道区与抽屉夹角的两个方块一次手势同时调高度与该侧
  抽屉宽度（两条热区的竖直符号相反 —— 都是「边界跟随光标」）。全屏预览走
  `renderer.setAllowUpscale`（只被全屏路径打开，2× 上限），**不碰 `setExportSize`**；
  宿主是 `.preview` 容器，状态由 `fullscreenchange` 同步。
- **片段复制 / 剪切 / 粘贴**：`core/clipboard.ts`（纯逻辑）定义自有 JSON 载荷
  （`{kind:'artmatic/clips', version:1, clips:[{trackId, clip}]}`，start **与 end 一起**
  归一）；`ProjectStore.pasteClips` 一笔撤销、落点几何复用新抽出的 `placeInto`
  （与 `addClip` 同源）；`App.onPaste` 先试文本通道里的片段 JSON、命中才接管，未命中
  **整段放行**；Ctrl+C/X 写系统剪贴板 + 内存副本（写不进去时 Ctrl+V 才拦内存里那份）。
- **脱机媒体占位符**：片段引用的素材**不存在**时画面给暗红占位（`file-x-corner` 图标 +
  「脱机媒体」），而不是静默跳过那一层。判据唯一实现 `appState.isAssetOffline`（仓里没字节
  **且**运行期没登记过），三个出口共用（合成路径的注入探针、排版光栅化、排版舞台）。
  颜色与字形常量在 `core/offline-media.ts`。
- **文本框同步修改（用户报的 bug）**：给部分文字单独设过字号 / 颜色 / 加粗后，选中整个
  文本框再改同一属性，那部分不跟随。根因是元素级写入没有清掉整段里该键的旧行内覆盖
  （覆盖优先级更高）；`writeTextProp` 与 `setTextHighlight` 现在同时清覆盖，
  `scaleFontSize` 的无选区分支按同一比例缩放已覆盖的字号（保留混排比例，与有行内选区
  时的行为一致）。

## 待办

- [ ] 简易抠图
- [ ] 图片变形调整（可以调整四角顶点 / 四条边的位置，图片在各方向被拉伸，可模拟一些
      3D 透视之类的效果）
- [ ] 偶发预览黑屏的后续观察：2026-10-14 做过一轮**有界审查**并修掉查实的两条
      （rAF 循环没有异常保护 ⇒ `tick()` 抛一次循环永久死亡；`attachPreview` 不校验
      canvas 身份 ⇒ dev 组件级热更新后画在脱离 DOM 的那块 canvas 上），结论与「查过并
      排除的怀疑项」写在 `ui/Preview.svelte` 的文件头。再遇到时记录更详细的触发条件：
      切换前/后停在哪个视图、是否 dev 热更新、是否刚导出过。
