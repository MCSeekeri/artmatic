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

**未完成（下一步）**：
- `desktop/preload.cjs` / `host.mjs`、`src/platform/electron.ts`、`artmatic-asset`
  自定义协议 + Range、路径 linked 视频（mediabunny `CustomSource`）、文件监视。
- 回归全量 E2E 与 Electron 冒烟；更新 `src/ui/AGENTS.md` 的工程包/徽标约定。

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
  - 实测 snapDOM **会丢掉 `matrix3d`**、但保留 `<canvas>` 与 `mask-image` ⇒ 有 fx 的
    图片元素渲染成 `<canvas>`（先按 fit/crop 画、再逐像素色键、再 H⁻¹ 重采样）；
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
