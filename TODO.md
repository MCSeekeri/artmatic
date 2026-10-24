# Agent 可达性缺口（2026-10-22 · 审计结果与待办）

判定口径 = 根 `AGENTS.md` §1.9：**用户能在界面里做的写操作，控制平面都要有对应方法**。
例外只有「改动 Artmatic 自身」：应用外观 / 偏好、工程与素材的**存储格式**、落盘路径、
插件安装确认。本清单只列**工程内容**的缺口。

## 已完成（2026-10-24）

- **格式刷 / 动画刷**：「开始」与「动画」页**最左侧**各一个按钮（`typo-format-painter` /
  `typo-anim-painter`）。单击 = 刷一次就收起，**双击 = 连续刷**；取消三条路径（再点一下
  按钮 / 点空白 / Esc）。纯逻辑在 `typography/format-painter.ts`（编辑器与 agent 共用）：
  `format` 只搬**外观** —— 填充 / 描边 / 圆角 / 文本样式 / 图片各项处理 / 阴影与虚化，
  跨种类有映射（图形的 `fill`/`stroke` ↔ 文本框的 `boxFill`/`boxStroke`），目标没有的
  字段静默跳过；**不搬**内容、几何与 `opacity`/`blend`。`animation` 整份替换并重新发号
  （共用 `data-anim-id` 会把两个元素的动画绑成一份）。刷子开着时**不渲染选择层**，
  否则源元素的选择框会把「点目标」吞掉。
  Agent：`typo_copy_style({ sourceId, targetIds, what })` + `styleCopy` 能力段。
- **关键帧面板的交互补齐**：框选之后拖任意一帧 = **整组平移**（一笔撤销；夹的是整组
  的位移区间，同轨按方向决定写入顺序，避免被 `normalizeKeys` 去重吃掉）；
  `Shift` 吸附的单位可选（**拍 / 秒 / 0.1 秒 / 帧**，`core/time.ts::KEY_SNAP_UNITS`
  与时间轴网格的 `SNAP_MODES` 分表）；轨道行上加了**循环开关**（写 `iterations`）。
- **Ribbon「动画 → 时序」整组删除**：那一组的显示值取「选区里第一个动画」、写入却按
  `kfPanel.animId` 扫全文档，两者可以不一致（动画窗格的技术债）。`setAnimTiming` /
  `retimeTrack` 一并删掉，时序只由关键帧本身表达；动画 Ribbon 留待按关键帧编辑器重构。
- **舞台的「指哪选哪」**：图形元素按 `<path>` 的 `isPointInFill` 过像素闸，
  面积大的中空图形（圆环 / 方框 / 星形）**中间透的地方让位给下层**（此前下层点不到，
  只能 Alt 轮询）；元素小到抓不住时把手**缩成四角**并挂一个**移动握柄**
  （屏幕尺寸 < 30px 收中点把手、< 40px 出握柄）。
  判定是**模糊**的：中心没命中时撒两圈探针（3px / 6px × 八个方向），外接框再放宽
  3px —— 细线 / 旋转过的细长条不必把指针精确压在墨迹上，而洞的直径远大于容差，
  中空图形照旧让位（`isPointInStroke` 不能用来做这件事，实测它的 nonzero 缠绕会把
  圆环的洞算成实心）。
- **底栏「排版预览进度」与关键帧面板的播放头合流为一份时间**（`appState.playT`）：
  删掉 `bgPreview.at`（编辑器局部时间）。那份状态让「拖底栏滑块 → 播放头不动」，
  两个控件看着是一回事、实际各走各的。现在拖动 / 播放都推工程播放头，
  播放中途别人挪了播放头就自动停手（`written` 对不上 ⇒ `pause()`）。
- **排版动画改为结构化关键帧（v16 → v17，真迁移）**：动画模型从「预设 / 手写 CSS 文本」
  变成 `kind:'tracks'`（**一条动画一个属性**、关键帧存**绝对秒**、每帧可带出向缓动：
  关键字 / cubic-bezier / `steps()`）。预览下方的关键帧面板替换了右侧只读的「动画窗格」：
  **元素列 | 属性列 | 时间轴** 三列（属性行与轨道同排）、顶栏承载全部操作（横向滚动 +
  两端渐变）、`⌘/Ctrl + 滚轮` 缩放（以指针处时间为锚）、普通滚轮横向滚动、
  关键帧形状随缓动种类变（菱形 / 圆形 / 方形）、点关键帧弹「值 + 曲线」浮层。
  手势与片段编辑器对齐：标尺拖动 = 播放头、轨道拖动 = 框选、关键帧默认自由拖曳
  （`Shift` 才吸附）。
  Agent：`typo_set_animation({ prop, keys:[{t,v,ease}] })`，旧式 `keys` 按属性拆成多条，
  读回形状可原样写回。烘焙改成按 `getKeyframes()` 的属性并集动态快照 —— 手写 CSS 动
  `visibility` / `letter-spacing` / `clip-path` 时导出不再静默丢效果。

## 已完成（2026-10-22）

- **静音（v15）**：`VisualTrack.muted` + 轨道头喇叭按钮（`track-muted`，只关内嵌音轨、
  画面照常）；检查器视频音频区加「静音」checkbox，勾上后音量 / 淡变变灰。
  三种「不发声」在 `audioSpans` 收口（轨禁用 / 轨静音 / 片段静音），预览、导出混流、
  音轨预热表读同一张表。Agent：`set_track({ muted })` + `set_clip_audio({ muted })`，
  `features.videoAudio` 补 `muted` / `trackMute`。`SCHEMA_VERSION` 14 → 15（恒等迁移）。
- **视频变速（v14）**：`set_clip_props({ speed })` 常速（保持片段长度，素材不够才缩短，
  回执带 `applied.end`）+ `set_curve(id, "speed", …)` 关键帧（**负值 = 倒放**）。
  `SCHEMA_VERSION` 13 → 14（恒等迁移）。`getCapabilities().features.videoSpeed` 说明
  「保持长度 / 负值只走曲线」；内嵌音轨在速度 ≤ 0 时静音（预览与导出同规则）。
  数学唯一实现是 `core/speed.ts`（`∫v`），取帧 / trim / split / 混流都对着它。
- 排版自定义 CSS 动画（`typo_set_animation.css`）、动画字段往返（`iterations`）、
  `typo_replace_doc.droppedAnimations`。
- 元素 `transform3d`（合并语义）/ `autoHeight` / `path` + `pathUnit` + `clipFrame`；
  白名单收窄到「实现真的会读」的键。

## 不做（用户 2026-10-22 判定）

- **素材导入 + 音频片段**：Agent 不知道用户电脑上素材在哪，交给用户导入。
  连带：`add_clip` 的 kind 不含 `audio`，音频轨对 Agent 只读（这是预期）。

## P1（本轮）✔ 已完成 2026-10-22

- [x] 段落标记：`add / split / rename / remove / move` → 工具 `edit_sections`（五合一）。
      `store.moveSection` / `setFades` 是本轮给数值路径新增的两个入口（拖动仍走 live*）。
- [x] `set_clip_props` 补齐片段字段：`fadeIn` / `fadeOut`（音频，互相钳制）、`crop`、
      `quad`（拒绝退化四边形）、`key`（抠像，支持局部改）、`srcIn`。`null` = 关掉。
- [x] 特效实例 `enabled` 开关：`add_effect({enabled})` + `set_params({enabled})`
      （参数因此变可选，两者至少给一个）。
- [x] 换算法生成器：`set_generator`（参数重置为新默认值；只删旧生成器参数名上的曲线）。
- 文档：`docs/agent-control-plane.md` §12.6；help 文本 `plugin-spec.ts` 新增
  「Sections」「Clip look」两节。

## P2（本轮）✔ 已完成 2026-10-22

- [x] 画幅：`typo_set_canvas_size({ size, scaleContent })`（`resizeDocument` 那条路可选）。
- [x] 分组底板：`typo_update_group({ groupId, patch })`（name / fill / stroke / radius / padding）。
- [x] 排版图片 `key` / `quad`：`typo_update_element` 的 patch + 新建入参 + 整份替换都支持；
      校验与片段共用 `core/image-fx.ts` 的新 `coerce*`（退化四边形在写入前拒绝）。
- [x] 自定义配色：`typo_save_theme`（局部色槽补丁）/ `typo_remove_theme` /
      `typo_set_theme({ scope:'project' })`；能力清单加 `themeSlots`。
- [x] 工程名：`set_project({ name })` + `store.setProjectName`。
- [x] 一键估 BPM：`estimate_beat_grid`（与工具栏同一实现；没音频 → unsupported）。
- [x] 组名：随 `typo_update_group`。
- [x] 图层下标：`typo_reorder_element({ op:'index', index })`。
- 文档：`docs/agent-control-plane.md` §12.7；help 新增「Canvas, group boxes, themes」。

## P3（本轮）✔ 已完成 2026-10-22

- [x] 布尔运算 / 拆分 / 参数化图形转路径 / 文字转路径 → `typo_boolean` /
      `typo_divide` / `typo_convert_to_path`；几何逻辑下沉到
      `typography/shape-convert.ts`（编辑器与 agent 共用）。
      顶点增删**不需要新工具**：`path` 早已可写（`typo_update_element`），
      手改 `d` 即可增删锚点。
- [x] 行内富文本：`typo_update_element({ runs })` + 读侧回显 + 整份往返；
      校验在 `rich-text.ts::coerceRuns`。
- [ ] 字体导入：**不做**（与素材导入同一判定：Agent 不知道用户电脑上的文件在哪；
      用户导入字体后 agent 仍可选用已有字族）。

## 媒体池操作 ✔ 已完成 2026-10-22

- [x] `media_list`（素材归属 / 字节 / 引用次数 / 磁盘占用）+ `media_op` 九种动作：
      `collect` / `relink` / `restore` / `trash` / `delete` / `trash_all` /
      `delete_all` / `clear_trash` / `cleanup_orphans`。
- [x] **可选项「操作媒体池需我确认」**（Agent 设置 → 安全，默认**开**）：
      开着时 `media_op` 返回 `needs-approval`，应用弹确认卡；用户点过之后会话层
      带 `confirm:true` 重放，模型不能自己批准。关掉则直接执行。
- 实现：`ui/project-actions.ts` 的 `listMediaPool` / `runMediaPoolOp`，经
  `ControlContext.mediaPool` 注入（控制平面不 import `ui/`）。

## 反向缺口（Agent 有、UI 没有；不阻塞，记录备查）

- 文档背景 `doc.background`（`typo_set_background` 有，界面无写入入口）。
- 片段 / 排版图片的 `crop`（UI 只有片段裁剪，排版图片没有）。
- `typo_layout` 的 `grid / row / column`（Ribbon 只暴露 align / distribute）。
- 全量特效编译守卫（`compile_all`，仅 MCP / 应用内按钮）。

---

# 进行中（2026-10-19 · W1 续：linked 素材 / 工程包 / Electron 宿主）

按 `docs/plan-0.3-hardening.md` 之后的追加计划（用户 2026-10-19 确认）：

- **1/2/3 已完成**：采样指纹（`fp1:<size>:head/tail64k`）、导入去重（含复活未使用
  素材）、回收站清空 / 孤儿清理 / 未使用素材批量清理、**未落盘素材被移除时不再写盘**。
- **台账 v3 已完成**：`content = {size, fp}` + `locations[] = project | local`；
  `asset-resolve.ts` 纯函数判定 `ok / stale / conflict / missing`；v2 迁移。
- **linked 已完成（浏览器）**：`AssetSource` 加 `path`；`platform.pickLinkedFile`
  （FSA 句柄，存 IndexedDB）；默认 linked，`collect` 才写工程副本；媒体池「引用」
  徽标 + 右键收集；排版/视频按来源取字节。
  - 自动化浏览器（`navigator.webdriver`）强制 bundled：Playwright 驱动不了系统
    文件对话框，linked 的判据由 `linked-assets.spec.ts` 用 OPFS 句柄覆盖。
- **`.artmatic` 工程包已完成**：store-only ZIP64 流式写（data descriptor + CRC）、
  清单校验、路径安全、CRC 校验、插件不执行；工程面板「打包 / 导入工程包」。
  包内容 = 全部未移除素材（含未使用），linked 会被物化进 `assets/`。
- **测试**：单测 2808 全绿（新增 fingerprint / asset-resolve / archive / package）；
  E2E `dedupe` / `cleanup` / `linked-assets` / `package` 新增，相关 37 条全绿。

- **C 段 Electron 宿主已完成**：
  - `desktop/preload.cjs`（contextBridge 白名单）+ `desktop/host.mjs`（allowlist、
    `artmatic-asset://` + Range/206/HEAD、IPC 读写/stat/watch/showInFolder）；
  - `src/platform/electron.ts` 只覆盖原生路径/范围读/监视，其余复用 browser；
  - `AssetSource.path` 全链路：`setAssetPathReader` → `open()` 分块 / `openVideo()`
    返回 mediabunny `CustomSource` 载体 / 打包时收集；
  - `ui/asset-watch.ts`：源文件变化只标 `stale`（媒体池「源已变化」徽标）。
  - **打包产物实测通过**：`release/Artmatic-0.2.2-win32-x64/Artmatic.exe
    --host-smoke --nosandbox --show` → `PASS`；带 `ARTMATIC_SMOKE_VIDEO` 时
    7.6 MB 视频按路径 linked 导入（`mediaKind:'path'`）并打进 `.artmatic`
    （`assets:1, bytes:7614208`）。
  - 可复现入口：`bun run desktop:artifact` / `bun run desktop:smoke`。
- **拖拽 linked + 启动画面**：
  - `importFiles` 先同步快照 `platform.pathForFile`（Electron `webUtils`），再
    `allowPath` 进主进程 allowlist，最后 `importLinkedPath`；浏览器/剪贴板仍走字节。
  - `index.html` 内联启动画面（不依赖 bundle/字体），`main.mjs` 改为
    `show:false` + `ready-to-show` 才显示窗口；产物实测
    `did-finish-load 309ms / ready-to-show 458ms`，启动画面在首帧就已存在，
    mount 后自动退场（`splashGone:true`）。

**未完成（下一步）**：
- 干净机器上复测 `sandbox: true`（本机已知渲染进程崩溃，冒烟用 `--nosandbox`）。
- 图片/音频的桌面 linked 只做了单测 + 代码路径，冒烟只覆盖视频；补一条带
  PNG/WAV 的产物冒烟。
- 工程包导入在 Electron 仍用 `<input type=file>`（可用，但不是原生对话框）。

# 本轮已完成（2026-10-21 · 片段裁剪 v10 + 排版画幅）

两件事：排版片段能改画幅 / 上屏大小；所有可见片段类型（算法 / 排版 / 图片 / 视频 /
纯色）能裁剪。`SCHEMA_VERSION` 9 → 10。

- **裁剪是 clip 级属性**：`SourceClip.crop = {left,top,right,bottom}`，值是**每边被
  裁掉的源比例**，语义是「只收可见窗口、不改采样坐标」（AE 的 Crop）。与排版元素
  `ImageElement.crop`（`{x,y,w,h}` 源窗**铺满**元素框）刻意不同 —— 分水岭写在
  `core/image-fx.ts` 与 `clip-crop.spec.ts` 头注里：裁掉左半边的左 1/6 必须是背景色，
  而不是源 uv≈0.58 的内容。
- **判定在 placement pass 里做，一次 pass 收口**：`engine/placement.frag.ts` 增
  `u_crop` / `u_cropOn`，裁剪只乘 `inside`；裁剪坐标取**四角变换之后**的 `srcTd`，
  所以与 `quad` 谁先谁后无关。全零裁剪不挂字段（与 `quadInverse` 同纪律）⇒
  `u_cropOn = 0` ⇒ 与历史逐位一致。
- 纯函数层 `image-fx.ts`：`MIN_CROP_KEEP = 0.02`、`withCropEdge()`（单边写入时按
  **对边**剩余量钳制，不许把窗口吃没）、`isIdentityCrop()`、`isValidCrop()`。
- **排版画幅**：`typography/canvas-size.ts`（纯计算：`CANVAS_RATIOS` / `sizeForRatio`
  / `withLockedAspect` / `footprintOf`），`CanvasSizePopover.svelte` 挂在排版编辑器
  标题栏：宽高 + 比例锁 + 预设（工程 / 16:9 / 9:16 / 1:1 / 4:5）+「缩放内容」+
  上屏「大小」滑杆。
  - **画布 ≠ 上屏**：`doc.size` 是设计分辨率，`clip.transform.sx/sy` 才是上屏缩放；
    `fit: contain` 会把画布等比放大，所以**同比例改像素，上屏大小不变**。弹层给
    「画面上 W × H（pct% × pct%）」实时读数，就是为了让这件事可见，别当成 bug。
  - 占位尺寸只有一份真源：`footprintOf` 与 `typography/runtime.ts::rasterSizeFor`
    共用 `engine/placement.frag.ts::drawSizeFor`。
- **Svelte 5 断更（踩到并修好）**：`doc`/`clip` 是**原地改的对象**，`$derived(doc.size)`
  拿到同一引用 ⇒ 不重算 ⇒ 弹层读数永远停在旧值。凡随文档/片段变的派生一律
  `$derived.by(() => { void appState.version; ... return 新对象 })`。
- 检查器新增「裁剪」区块（对所有 source 片段显示，四边 `%` + 重置删字段）。
- 守卫：`image-fx.test.ts`（钳制 / 对边不可重复吃 / 坏值集合）、`schema.test.ts`
  （四种源类型通过、7 类坏值被拒、v9→v10 恒等迁移）、`canvas-size.test.ts`（含
  「同比例改像素不改变上屏大小」）、E2E `clip-crop` 3 条 + `typography-canvas` 3 条。
- **顺手修一条既有 E2E 抢跑**：`project.spec.ts::移除素材后保存` 在 HEAD 上就稳定失败
  （`git worktree` 跑基线复核过）。根因不在产品侧：`restoreUnusedAsset` 会先
  `await` 一次 OPFS 字节读回才 `commit`，点完立刻断言必然抢在它前面。改成
  `expect.poll` 等状态落地，机制断言不变。
- **变异测试**（`stryker --mutate src/core/image-fx.ts,src/typography/canvas-size.ts`）：
  `canvas-size.ts` 74.7% → **98.85%**，只剩 1 个等价存活（`byWidth.h <= frame.h` 在
  正好装下时两支同值）。补的四条测试各钉一处真缺口：预设表的 id / 比例（漏一条就
  静默换画幅）、工程画面单轴为 0 的退化分支、`withLockedAspect` 的除零（会给出
  `Infinity` 并一路进 GLSL）、`footprintOf` 的 `NaN%`。`image-fx.ts` 新增的裁剪全部
  被杀死；余下 59 个存活都在既有的 CPU 色键（127–212 行，本次未动）。
- **入口搬到「设计」Ribbon**（用户要求）：画布尺寸从缩放条上那枚读数按钮移到
  `设计 → 画布大小`（`ribbon-canvas-size`，testid 常量与浮层锚点共用一个真源）。
  缩放条上不再有尺寸读数。为此浮层改成**受控**（`anchor` / `onclose` 由编辑器给）：
  Ribbon item 的 `onselect` 是无参意图，拿不到事件目标，锚点用 testid 现查。
  「再点一次关掉」由编辑器 toggle（锚点算浮层内部，否则 pointerdown 会先关、click 再开，
  看起来是闪一下）。

# 0.3 交付前复核（2026-10-19）

计划（`docs/plan-0.3-hardening.md`）W0–W5 逐条核对：`bun run check` 0 error 0 warning，
单测 2902 全绿，E2E 419 全绿。复核修掉三处漂移 + 一处漏项：

- `mcp/index.mjs` 的 `APP_VERSION` 从写死的 `0.2.2` 改成读 `package.json`（版本号
  单一真源，否则 MCP 面报的是旧版本）。
- `MediaPool.svelte` 的 `menuTarget` 改 `$state.raw`（svelte-check 把它报成疑似漏写
  `$state`；`raw` 不做深代理，闭包语义不变）。
- README / AGENTS 跟上报废结论：发行版是桌面壳、素材默认引用、自动保存与回收站。
- **W5.2 第四条补上**：`probeCapacity()` 在 `app://` 下没有 `/__capacity.json`，
  发行版会静默退回 `DEFAULT_LIMITS`。现在由主进程 `artmatic:capacity` 供给
  （见 `docs/electron-compat.md` §8.6）。

发布：`0.3.0` 便携产物 `release/Artmatic-0.3.0-win32-x64`（333 MB）。冒烟 PASS、
探针全绿（UA `Artmatic/0.3.0`、WebGL2 + 硬编、`localFonts 800`）、1080p 端到端
MP4 4.6 s / 48.5 MB。

# 本轮已完成（2026-10-19 · 0.3 加固 W1「素材生命周期」）

按 `docs/plan-0.3-hardening.md` 的 W1（三个子阶段，沿用 W0 的「文件不销毁」前提）：

- **W1.1 素材字节句柄化**：`AssetStore` 的 `bytes` 换成 `AssetSource =
  file | handle | bytes | none`。视频导入 `putFile()`（一个字节都不读），打开工程
  `putHandle()`；图片 / 音频仍是 `bytes`（它们本来就要整份喂解码器）。读接口收口成
  `open()`（分块，保存用）与 `readAll()`（一次性），`bytesOf()` 只返回已在内存的字节。
  - `FsFile` 增 `readStream()` / `readBlob()`（原生 `File` 零拷贝直通）；
    `writeStreamAtomic()` 边读边写，2 GB 素材的保存峰值只剩一块 buffer。
  - **视频不算哈希**（`hash: null`）：`crypto.subtle` 不能流式，为 200 MB 视频算哈希
    就等于把它整份读进堆 —— 与 W1.1 的目标直接冲突。代价是视频退化成大小指纹，
    收益是「没变的视频，打开与保存零读取」。
  - `auditLedger` 的 `probe` 在不需要哈希时只读 `File.size`（原先每次打开工程都会把
    所有素材整份读一遍，视频也在内）。
- **W1.2 流式写 + 自动保存 + 崩溃恢复**：`project/autosave.ts`（纯编排：防抖 / 单飞 /
  手动优先 / 失败降级，全走 `memoryRoot` 单测）；`ui/autosave.ts` 接线。
  - 有目录 → `saveProject({backup:false})`；无目录 → OPFS `drafts/<draftKey>.json`。
  - 三条硬约定都落了：不轮转 `.bak`、不动 `savedVersion` / 不 bump version / 不入撤销栈、
    单飞（手动保存 `cancel + idle`，自动保存以 `canWrite:false` 让路）。
  - **内容没变不写**（`lastWritten` 比对 + `SaveReport.projectText`）：`store.touch()`
    在播放视频时每帧都会 bump version，没有这一层就会每两秒重写一遍 `project.json`。
  - `RestoreTabsBanner` 扩成两段：目录句柄恢复（现状）+ 草稿恢复；底栏常驻
    `app.autosaveDegraded`（带原因）。
- **W1.3 删除语义**：台账 `retained`（`LAYOUT_VERSION` 1 → 2，缺字段 = false）。
  - 媒体池「移除」= `assets.retire()`：离开活动素材、进「未使用素材」，保存时按
    `retained: true` 写台账，**文件不动**。
  - 「工程」面板新增「未使用素材」：恢复 / 移到 `assets/.trash/`（先写回收站再删原文件）/
    彻底删除（二次确认）。`auditLedger` 跳过 retained（文件丢了也不报 error）；
    `listAssetPaths` 天然不含 `.trash/`（只列直接子文件）。
- **与 W0 的关系**：W0.1「保存不删文件」保留；W1.3 把「孤儿提示」升级成「可恢复的保留项」，
  所以 `project.spec` 里那条 W0.1 断言改成了新语义（不再报 untracked，改为可恢复）。
  W0.2 的导入闸门**保留**（复看结论：它已从「防内存峰值」变成「单素材策略上限」）；
  W0.3 的导出前保存与自动保存共用同一条 `writeTo` 路径（先 `cancel + idle`）。
- 守卫：`tests/unit/asset-store.test.ts`（File 来源零读取 / 句柄读回 / retain·restore）、
  `autosave.test.ts`（防抖合并 / 单飞 / 手动优先 / 让路 / 双失败）、
  `project-ledger.test.ts`（retained 解析·序列化·审计跳过·不算 changed）、
  `project-io.test.ts`（自动保存不碰 `.bak` / 回收站 / 真删）；
  E2E `autosave.spec.ts`（草稿→刷新→恢复且仍脏 / 自动保存不轮转 `.bak` / 内容没变不重写）、
  `project.spec.ts`（移除→重开→恢复 / 清理进 `.trash`）。

**未做（刻意的）**：
- W1.1 判据里的「导入视频后 `performance.memory` 增量 < 文件一半」没有写成 E2E：
  现成的测试视频只有几 KB，量不出区别；改为单测里直接断言 `arrayBuffer()/stream()`
  调用次数为 0（更强、且不依赖 Chromium 私有 API）。
- 图片 / 音频仍是整份读回（见根 `AGENTS.md` §7 第 4 条）。真正的修法是流式解码，不在本轮。
- 草稿只有 `Project` JSON，没有素材字节 —— 从草稿恢复的工程缺素材是实话，不是 bug。

# 本轮已完成（2026-10-19 · 0.3 加固 W0「止血」）

按 `docs/plan-0.3-hardening.md` 的 W0 批次（五项互不相干的小改 + 一条可选闸门）：

- **保存不删素材**（W0.1）：`saveProject` 去掉第 ④ 段；媒体池「移除」只解除引用，
  字节留在 `assets/`。打开工程时把孤儿聚合成**一条**提示（体积只 stat、不读字节）。
  删除确认语与完成语同步改成「文件保留」，不再承诺保存时销毁。
- **导入体积闸门**（W0.2）：`core/capacity.ts::checkImportSize`（闭区间，超一字节即拒）
  挡在 `probeVideo` / `arrayBuffer` **之前**；文案给出「多大 / 上限多少 / 怎么改」。
- **导出前强制保存**（W0.3）：MP4 / PNG / GIF 三条入口先 `saveProjectNow()`；
  无目录时只提示不拦；先保存再置 `exportProgress`，await 后复查一次。
- **插件试挂需确认**（W0.4）：`plugin_try` 默认返回 `needs-approval`，确认挡在
  `host.importBytes` 之前（否则源码已经执行）。审批卡按 `kind` 分流，试挂卡带
  「本次会话允许试挂」；`plugin_try` 的工具面**不加** `confirm`（模型不能自批），
  MCP 面显式加、由客户端用户确认。
- **MP4 codec 阶梯**（W0.5）：`avc1.4d0028` → `avc1.4d401f` → `avc1.42e028` →
  `avc1.42e01e`（补 baseline 4.0：3.1 的 coded area 只到 720p）。探测按导出尺寸
  + `avc: {format:'avc'}`；选中串交给 `CanvasSource.fullCodecString`，否则 mediabunny
  会自己拼回 Main。面板区分「无硬编（软件路径，会慢）」与「没有可用 H.264」。
- **启动能力闸门**（可选）：`main.ts` 只做 WebGL2 / `showDirectoryPicker` 检查，
  通过后动态 import `app-boot.ts`（原 main.ts 正文逐字搬迁）；缺能力时渲染静态说明。
- 守卫：`project-io.test.ts`（移除不删 + 孤儿聚合成一条）、`capacity.test.ts`
  （导入闸门边界）、`mp4-codec.test.ts`（阶梯纯函数）；E2E `project.spec.ts`
  （移除后重开文件仍在 / 改片段→导出→reload 改动还在）、`media-pool.spec.ts`
  （超限导入被拒）、`export-mp4.spec.ts`（Main 被拒→Baseline 产物 profile 0x42 且可解码 /
  全不支持时的文案）、`agent-in-app.spec.ts`（未确认不产生实例 + 会话允许 + 安装拒绝）。

# 本轮已完成（2026-10-18 · 第三轮：400 修复与可用性）

- **修复 400**：重复调用的引导以前作为 **system 消息**插在 assistant/tool 之间，
  DeepSeek 带 tools 时会 400，且坏消息留在历史里导致之后每条都 400。现在引导
  附加在**那条 tool 结果的末尾**（结构不变）。
- **400 自愈**：`bad-response + 400` 后自动清空模型历史（UI 记录保留）并提示，
  下一条消息可以继续；错误卡显示响应体（reasoning_content / 工具配对的线索）。
- **上下文管理**：窗口 1M token，75% 触发压缩（同一个模型、不带 tools 把前半段
  压成交接说明，保留最近 8 条）；发送按钮左侧常驻环形进度，75% 琥珀 / 90% 红。
- **历史入口回面板顶栏**；「新会话」改用 `message-circle-plus`；新增「导出日志」
  （JSON：配置 / UI 消息 / wire 消息 / usage / lastError，key 与图片打码）。
- **对话可选中**：`.stream` 恢复 `user-select: text`；右键是自绘菜单
  （复制 / 全选 / 添加到输入框 / 复制整段），输入框保留原生菜单。
- 思考过程旁那句解释删掉，只留「思考过程」。
- 守卫：`agent-llm.test.ts` 增压缩原语（75% 阈值 / 裁剪不拆工具对 / recentTail）；
  `agent-in-app.spec.ts` 增「右键菜单」「上下文环」「重复引导不新增 system」
  「400 后自动恢复」四条。

# 本轮已完成（2026-10-18 · 第二轮：Agent 体验）

- **运行时长/步数**：默认 200 步、上限 2000（旧的 16/40 在真实任务里根本不够）；
  默认开思考；思考强度用 **DeepSeek 原生 `reasoning_effort`**（关 / low / high / max），
  不是提示词。带 `tools` 的请求把每轮 `reasoning_content` **完整回传**（漏传会 400）。
- **重复调用不再掐断**：同一「工具 + 参数」第 3 / 6 次注入引导（换参数 / 读结果 /
  用 `ask_user`），第 12 次才停。用户能在「思考过程」块里看到模型在干什么。
- **`ask_user` 工具**（appOnly）：模型可以暂停任务、弹问答卡（选项 + 自由输入），
  回答作为 tool result 继续同一轮。MCP 不声明它（没有正在看着面板的人）。
- **UI**：输入框改为悬浮在底部（附图 / 模型 / 思考强度二级菜单 / 纸飞机发送）；
  工具卡显示中文名 + 状态小圆点，整轮结束自动折叠；消息区 flex 子项禁止收缩
  （修滚动条不出现、卡片被压扁）；设置改为左 navside 分页的独立 modal；
  rail tooltip = 「Agent 任务」；会话结束后默认提示自动消失。
- **会话历史进工程**：`project.agentSessions`（30/400/20k 上限，图片不存 base64），
  顶栏 `history` 图标 → 只读历史面板（内容搜索 / 删除 / 一键清空）。
  `ProjectStore` 快照剔除该字段：撤销不会把聊天记录退回去。
- 守卫：`tests/unit/agent-sessions.test.ts`（清洗 + 撤销隔离）、
  `agent-llm.test.ts`（重复阶梯 / 原生思考参数）、
  `agent-in-app.spec.ts` 增「悬浮输入框 + 附图」「思考过程折叠」「ask_user」
  「历史搜索 / 清空」「工具卡高度」五条。

# 本轮已完成（2026-10-18）

**应用内 Agent（v2 控制平面）**：从左侧 rail 打开一个对话抽屉，用自然语言写插件、
编排时间轴、组合排版。落地的东西：

- **契约 v2**：`getCapabilities({detail:'params', ids})`（参数表序列化，剥掉
  `visibleWhen`）；文本片段的 `source.doc` 改为摘要 + `getTypographyDoc`；
  `CONTROL_API_VERSION = 2`。`ControlContext` 新增排版 / 插件接缝
  （`stopTextEditing` / `getPluginHost` / `persistPlugin` / …），控制平面仍不 import
  `ui/` 与 `project/plugins`。
- **排版写入**：`typography/agent-ops.ts`（纯函数：元素工厂 / 白名单 patch / 层级 /
  组合 / 对齐分布 / 网格行列 / `coerceDocument` 永不抛）+ `agent/typography.ts`
  （校验前置 + 每工具一笔撤销）。12 个 `typo_*` 工具。
- **插件作者面**：`plugin_try`（内存载入 + 真 GL 编译，结构化 issue 供自修复）→
  `plugin_install`（**必须用户确认**，面板出审批卡、可看源码）；`plugin-spec.ts`
  的说明书由 `EFFECT_HEAD`/`ALGO_HEAD` 常量拼出。
- **应用内模型运行时**：`agent/llm/`（provider 手写 SSE + tool_calls 分片累积 /
  session 工具循环 + 事务 + 裁剪 / executor 工具映射）；直连失败自动回落
  `/__llm` 同源代理（`scripts/llm-proxy.mjs`，dev 与 preview 双侧注册）。
  截图以 user 消息注入（Chat Completions 只允许图片在 user 消息）。
- **面板**：左侧与媒体池互斥、共用宽度；rail 图标带状态（思考弧 / 工具计数 /
  待确认点 / 错误色，`prefers-reduced-motion` 退化）；工具卡 / 截图卡 / 审批卡 /
  「已修改 N 处 · 撤销本轮」。排版页也能开。
- **一轮 = 一笔撤销**：`CommandStack.commit` 在 `beginTx` 打开时不再单独入栈
  （补了单测：事务内多次 commit 只留一条记录、撤销回到事务之前）。
- **工具表单一真源**：`src/agent/tools.ts` + `tests/unit/agent-tools-parity.test.ts`
  钉住「应用内 ⊆ MCP、required 一致、MCP 独有工具在允许清单里」。
- 守卫：`tests/unit/agent-capabilities.test.ts`、`typography-agent-ops.test.ts`、
  `agent-llm.test.ts`（SSE / 裁剪 / 说明书完整性）、`commands.test.ts`（事务语义）、
  `tests/e2e/agent-in-app.spec.ts`（伪造 SSE：编排 / 排版 / 插件试挂 / 安装审批，
  不需要真 Key）。
- 文档：新增 `src/agent/AGENTS.md`（依赖 / 写纪律 / 工具面 / 插件 / 模型层），
  根 `AGENTS.md` 补依赖方向、规则地图与第 5 条铁律，本方案文档补 §10。

待真 Key 冒烟：脚本与日志放 `.codebuddy/tmp/<日期>/`。

# 本轮已完成（2026-10-17）

- **简易抠图（色键）**：`SourceClip.key`（`{ color, tolerance, softness, spill }`，
  `SCHEMA_VERSION` 7）。在 placement pass 里**只乘本层 alpha**（不是特效片段）：
  YCbCr 色度差为主 + 亮度差 ×1/2 —— 同一组参数对「阴影下的绿幕」与「白 / 灰背景」
  都成立；容差 / 柔边映射为距离阈值的一半，溢色抑制把半透明边缘往亮度压。
  检查器有完整区块，另有**吸管**（在预览画面点一下取色：只渲染该轨一帧 →
  `readPixels` → 同一次同步任务内还原，屏幕不闪；Esc / 换选中退出）。
- **图片四角调整（透视变形）**：`SourceClip.quad`（`{ tl, tr, br, bl }`，层空间**左上原点**）。
  渲染用「单位方 → 四角」单应的**逆映射**采样，是真透视（不是双线性拉伸），
  与 `fit` / `transform` 复合（先摆好图层再拉角依然成立）；四角退化到不可逆时按
  「不调整」渲染、**不丢层**。预览画面有 4 个角 + 4 个边中点手柄（拖边 = 平移该边
  两个角），拖动是一笔撤销；检查器有开关与重置。
- **坐标约定**：数据 / 层 / 帧 / 源 uv **一律左上原点**（`(0,0)` = 左上，v 向下）；
  GL 的 v 向上只存在于着色器与 `core/quad.ts` 的 helper 边界（一次 v 翻转进去、
  再一次翻回采样）。`core/quad.ts` 零运行时 import，E2E 直接 import 它算期望值。
  **关闭状态（无 key / 恒等 quad）与改动前的渲染逐位一致** —— 已用新老旧 shader
  的 GPU A/B 实测（逐字节 0 差异）。
- `SCHEMA_VERSION` 6 → 7（恒等迁移：两个字段都可选，抬版本号是为了旧版打开时显式
  报「版本过新」而不是静默丢掉用户设置）。`validateClip` 对 key/quad 做形状校验
  （坏颜色 / NaN / 少角在**打开时**就报错，不穿透到渲染期）。
- 守卫：`tests/unit/quad.test.ts`（28 条；变异测试 `src/core/quad.ts` 95.6% killed）、
  `tests/unit/schema.test.ts`（v7 校验 / 迁移 / 深拷贝）、`tests/unit/stack.test.ts`
  （key/quad 求值与转场两侧独立）、`tests/e2e/keying.spec.ts`（渲染 A/B + 容差语义 +
  UI 接线 + 吸管）、`tests/e2e/quad-warp.spec.ts`（CPU/GPU 逐点对拍 + 真透视判据 +
  手柄拖动 / 一笔撤销 / 重置）。
- 已知限制（刻意不修）：① 转场窗口内 gl-transitions 只读贴图 rgb、不看 alpha，
  抠掉的区域在转场中按黑色参与混合（普通合成路径完全正确；已记在 placement 文件头）；
  ② 四角手柄的 `sx/sy` 用 transform 基值、不采样曲线（编辑辅助，跟随动画会没法拖）。
- **排版文档里的图片元素也能抠图 / 四角透视**（同一天的需求延伸）：`ImageElement`
  新增 `key` / `quad`（与片段**同一个类型**，定义搬到了 `core/image-fx.ts`）。排版是
  DOM，没有 placement pass，所以是 CPU 实现（`typography/image-fx.ts`）：
  - ~~实测 snapDOM 会丢掉 `matrix3d`~~ —— **2026-10-21 重测否定了这条**（3.2.0：
    perspective / rotateY / rotateX / translateZ / 四角单应 matrix3d / `<img>` / 文字 /
    真实 `.typo-doc` 嵌套 / 外层 scale 全部正常出图，脚本在
    `.codebuddy/tmp/2026-10-21/`）。CPU 实现仍然保留，理由是抠图必须逐像素、四角
    重采样要与 GPU 逐点对拍 ⇒ 有 fx 的图片元素渲染成 `<canvas>`（先按 fit/crop 画、
    再逐像素色键、再 H⁻¹ 重采样）；
  - 处理异步（等解码），舞台先显示原图、就绪后换节点；**光栅化前必须 await**，
    否则导出会把未处理的原图按正确缓存键存下来（永远不恢复）；
  - 参数拖动按元素串行 + 50ms 去抖（一次拖滑杆几十个键，不合并会卡主线程）；
  - 舞台有 4 角 + 4 边中点手柄（`QuadEditLayer.svelte`，进入「在画布上调整」模式时
    缩放把手让位），拖动一笔撤销。
  守卫：`tests/unit/image-fx.test.ts` + `tests/unit/typography-image-fx.test.ts`；
  E2E `tests/e2e/typography-image-fx.spec.ts`（真实导入 + 舞台/光栅化像素 + 手柄拖动 +
  一笔撤销）。

- **「方框跟踪」特效**（`box-tracker`）：YOLO 风格的检测 HUD 叠加层。链路是
  「固定 160×90 探针 → `readPixels` → `core/blob-track`（显著性 + 网格峰 + 区域生长
  + 贪心关联 + EMA）→ Canvas2D 叠层 → `u_overlay` 合成」。方框样式 5 种（实线 /
  虚线 / 角括号 / 双线 / 纹理描边）、标签 4 套内置词库 + 自定义多行词、45° 折线 /
  直线 / 曲线连线、框内 9 种单 pass 观感、以及扫描线 / 准星刻度 / 侧边数据条 /
  连线流光 / 出入场动画。**框内不调用任意特效**（多 pass 管线没有子区域求值）。
  - 探针尺寸**不随渲染尺寸变**，否则预览与导出会得到不同的框；
  - 状态在 `onSeek` 清空（与 `feedback` 类同一处置），导出顺序播放逐帧精确；
  - 缩略图/单帧渲染靠 `EffectShaderDef.stateful` 连渲 12 帧 + 淡入从 0.35 起，
    否则「第一帧一个框都没有」。
  - 守卫：`tests/unit/blob-track.test.ts`（11 条）+ `tests/e2e/box-tracker.spec.ts`
    （出框 / 参数即时生效 / 探针不随档位变 / 每个装饰项都画出东西 / 多行文本框）。
- **`text` 参数类型**（`TextField`）+ 取色卡主题色引用修复：非排版颜色入口
  （纯色片段 / 算法参数 / 特效参数 / lab 两处）在**写入时**解析 `@accent1`，
  打开工程时由 `validateProject` 补历史数据；否则引用会退化成品红。
  守卫：`tests/e2e/color-picker-refs.spec.ts` + `schema.test.ts` 三条。

## 待办

- [x] 简易抠图
- [x] 图片变形调整（可以调整四角顶点 / 四条边的位置，图片在各方向被拉伸，可模拟一些
      3D 透视之类的效果）
- [x] 排版编辑器里的图片元素也支持抠图与四角透视
- [ ] 偶发预览黑屏的后续观察：2026-10-14 做过一轮**有界审查**并修掉查实的两条
      （rAF 循环没有异常保护 ⇒ `tick()` 抛一次循环永久死亡；`attachPreview` 不校验
      canvas 身份 ⇒ dev 组件级热更新后画在脱离 DOM 的那块 canvas 上），结论与「查过并
      排除的怀疑项」写在 `ui/Preview.svelte` 的文件头。再遇到时记录更详细的触发条件：
      切换前/后停在哪个视图、是否 dev 热更新、是否刚导出过。

# 本轮已完成（2026-10-16）

- **AGENTS.md 拆成多级**：原来单文件 2156 行 / 170 KB，每次任务全量进上下文，
  怎么压缩都只能压掉几行。现在按「改哪一块就读哪一份」拆成 **19 份**：
  根 `AGENTS.md`（364 行，只留产品判据 / 硬约束 / 技术栈 / 分层与依赖方向 / 命令 /
  未决问题 / 外部参考 / 协作约定）+ **根里那张「子系统规则地图」**（目录 → 规则文件 →
  什么时候必须先读）。二级 16 份（`src/core` `src/engine` `src/effects` `src/algos`
  `src/render` `src/audio` `src/typography` `src/timeline` `src/exporters` `src/project`
  `src/plugins` `src/i18n` `src/assets` `src/ui` `lab` `tests`）+ 三级 2 份
  （`src/ui/typography`（兼管 `ui/ribbon`）、`tests/e2e`）。每份的开头都写了
  「何时读我」与相关文件，根地图是唯一入口。
- **正文逐字搬运、零丢失**：拆分是脚本按行号机械切的（`.codebuddy/tmp/2026-10-16/split-agents.mjs`，
  原文备份在同目录 `AGENTS.orig.md`），只有三类改动 —— 标题降级（`### 5.6 …` → `## …`）、
  交叉引用 `§x.y` 改写成路径（26 处）、**裸测试文件名补全路径**（如 `lab.spec.ts` →
  `tests/e2e/lab.spec.ts`，39 处）。校验脚本按行比对：原文 1895 条非空行全部落在新文件里，
  差异只剩上述三类 + 手写标题/地图。
- 顺带补齐根目录树的欠账：补 `assets/` `agent/` `tests/` `docs/` `mcp/`·`cli/` 五行
  （`src/agent/` 旧文件从未提过，指向 `docs/agent-control-plane.md`）。
- ⚠️ **未实测的一点**：CodeBuddy 官方文档只保证子目录的 `CODEBUDDY.md` 会被动态加载，
  子目录 `AGENTS.md` 是否自动进上下文没验证出来（本次会话内加探针文件没有任何反应，
  疑似规则在会话启动时就缓存了）。所以**不要假设子目录那份已经在上下文里** ——
  根地图上写了「按表主动读」。下次重启后可以用 `/memory` 或再放一次探针确认；
  若确实不自动加载，可以把每份规则文件复制/软链成 `CODEBUDDY.md`（同名规则优先）。

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
