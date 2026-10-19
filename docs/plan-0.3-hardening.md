# 0.3 加固计划（分批实施）

> 2026-10-18 · 依据：两周自检结论 + 负责人对三条结论的修正。
> 目标不是加功能，是**把边界关上**：素材不再全量驻留内存、删除不再等于销毁、
> 崩溃不再等于丢工作，然后补两处基本盘（段落 / 插值）。

## 0. 先修正三条前置判断

| 自检时的说法 | 修正后 |
|---|---|
| 排版编辑器 46% 代码量 ＝ 定位漂移 | **不成立**。它体量大是因为 PPT 式交互控件必须逐个定义（光 Ribbon 就 1800 行），而 effects/algos 有通用渲染引擎兜着。平面设计对本类视频是真实需求，不是跑偏。 |
| 「按音乐结构编排」必须死守 | **降级为一项功能**，不是产品定义。补段落标记 + 音频处理即可，不再用「音乐卡点视频」组织其余设计。 |
| Firefox / 非 HTTPS 要加能力闸门 | **改路线**：发行版走桌面壳，Web 版只作开发与试玩。闸门降为可选。 |

时间轴的形态也随之改成两种，而不是在一种上堆卡点能力：

- **节奏模式**：以「小节.拍」为标尺，BPM / 每小节拍数 / offset 常驻工具条，吸附默认开。
- **标准模式**：秒 / 帧标尺，吸附可关，向传统剪辑软件靠。

同一份数据、同一套片段几何，只有标尺渲染与吸附默认值不同 —— 这是本计划里唯一
「看起来像新功能、实际上是开关」的一波。

---

## 1. 分批总览

| Wave | 主题 | 依赖 | 改动面 | 风险 | 可独立发布 |
|---|---|---|---|---|---|
| W0 | 止血（4 个小改） | 无 | 6 文件 | 低 | 是 |
| W1 | 素材生命周期：句柄化 + 流式写 + 删除语义 + 自动保存 | W0 | 14 文件 | **高** | 拆 3 次提交，逐次可发 |
| W2 | 时间轴双形态 + 段落标记 + 音频淡变 | W1（保存路径稳定后再动 schema） | 12 文件 | 中 | 是 |
| W3 | 关键帧插值 | 无 | 6 文件 | 低 | 是 |
| W4 | 工程卫生（死代码 / 参数分派收口 / 文案 / 首屏 / 错误兜底） | 无 | 12 文件 | 低 | 是 |
| W5 | 桌面发行版（Electron，先 spike） | W1（自动保存依赖它才完整） | 新增 + 决策文档 | 高 | 独立分支 |

W2 / W3 / W4 之间没有先后依赖，可以并行或按手感插队。W1 是唯一必须独占的。

---

## W0 · 止血

四个互不相干的小改，目的是在动大手术之前先把「会丢东西」的路径堵掉。

### W0.1 保存不再删除素材文件（一行判断 + 一条提示）

`src/project/io.ts` 第 ④ 段（`diff.removed` → `parent.remove`）改为**不删**。
被移除的素材在磁盘上留成孤儿，由工程面板的「素材检查」报一条：

> 磁盘上有 {n} 个不再被引用的素材，占用 {size}。

清理入口留到 W1.3。这一改立即消灭「点了删除 + 保存 = 源文件消失」，代价是磁盘
会攒孤儿文件，而这一点在面板上明说。

**判据**：`tests/unit/project-io.test.ts` 增「移除素材后保存，文件仍在，且返回
`assetsRemoved === 0`」；E2E `media.spec.ts` 增「删除后重开工程仍能找回该文件」。

### W0.2 导入前挡体积 + 说明

`src/ui/media-import.ts::importVideoFile` 在 `arrayBuffer()` 之前判断
`file.size > limits.videoPerAssetMB`，直接拒绝并给一句「这个素材 {size}，超过本机
预算 {limit}」；`limits` 已有，不新增配置项。

**判据**：单测（纯函数化的 `checkImportSize`）+ E2E 一条（构造大文件太贵，用
`limits` 临时调小到 1MB 来测）。

### W0.3 导出前强制保存

`src/ui/export.ts` 的三条入口在 `runExport` 之前 `await saveProjectNow()`（无目录
时走 W1.2 的 OPFS 草稿，W0 阶段先只提示「建议先保存」）。它同时解决「导出 OOM 崩
标签页 → 未保存编辑全丢」这条链的上半段。

**判据**：E2E「改一个片段 → 点导出 → 重新加载 → 改动还在」。

### W0.4 插件试挂要确认

`src/agent/control-plane.ts::pluginTry` 改为默认返回 `needs-approval`，与
`pluginInstall` 同一张审批卡（面板已能显示源码）。补一个「本次会话允许试挂」
复选框，避免 agent 在迭代期每轮弹一次。

文案：`agent.plugin.needsApproval` 已存在，复用它；新增一条
`agent.plugin.tryRisk`，说明「它会立刻在页面里执行」。

**判据**：`tests/e2e/agent-in-app.spec.ts` 增「未确认时 `pluginTry` 返回
needs-approval 且未产生实例」；确认后重复那次调用成功。

### W0.5 MP4 的 codec 阶梯

`src/exporters/mp4-sink.ts` 写死了 `MP4_CODEC = 'avc1.4d0028'`（Main 4.0）。
无硬件编码器的机器上，Chromium 只能回退到 OpenH264，而它**只支持 Constrained
Baseline**，于是 `isConfigSupported` 返回 false，UI 报「本机浏览器不支持 WebCodecs」
—— 诊断错了，机器能编，只是编不了 Main。

改成阶梯：`avc1.4d0028` → `avc1.4d401f` → `avc1.42E01E`，第一个能过就用它；
全不过才退 PNG。选中软件路径时导出面板加一句「本机无硬件编码器，导出会明显变慢」。
依据见 `docs/electron-compat.md` §0.2 / §0.3。

**判据**：单测（阶梯选择函数，纯函数）；E2E 用 `hardwareAcceleration:'prefer-software'`
跑一次短导出，断言产物 `ftyp`/`avcC` 里 profile 为 Baseline 且能被解码器读回；
另有一条断言「三档全 false 时 UI 文案是『只能导出 PNG 序列』而不是『不支持 WebCodecs』」。

### W0 可选（20 行）

`src/main.ts` 开头一条能力检查：没有 `showDirectoryPicker` 或没有 WebGL2 时，
在 `#app` 里渲染一段静态说明而不是挂载主应用。桌面壳落地后可以删掉，在它落地
之前 Web 版不至于「界面正常、保存静默失败」。

---

## W1 · 素材生命周期（核心，独占）

这是整个计划里唯一需要重写的部分。三个子阶段，每个都能单独合并发布。

### W1.1 素材字节句柄化

**问题**：`project/asset-store.ts::loadFrom` 与 `ui/media-import.ts` 都把整份字节
读进 `Map`。2GB 视频工程 = 2GB JS 堆，多工程同页翻倍。而
`platform/types.ts::PickedVideo` 的注释已经写明「只给 `File` 句柄，10 GB 素材也不会
把堆撑爆」—— 接口是对的，实现违反了它。

**改法**：`AssetStore` 的 `bytes: Uint8Array | null` 换成 `source` 联合：

```
type AssetSource =
  | { kind: 'file'; file: File }                    // 本地导入，磁盘背书
  | { kind: 'handle'; handle: FsFileHandle }        // 从工程目录读回
  | { kind: 'bytes'; bytes: Uint8Array }            // 图片 / 音频（本来就小）
  | { kind: 'none' }                                // generated
```

- `AssetStore.get()` 拆成 `open(id): AsyncIterable<Uint8Array>` 与
  `readAll(id)`（后者只给已知小体量用：图片喂 `createImageBitmap`、音频喂
  `decodeAudioData`）。
- 视频：`{ kind: 'file' }`，一个字节都不读。
- 哈希：沿用 `project/hash.ts` 的 `MAX_HASH_BYTES` 上限，超限不哈希（现状如此），
  没超的走流式。
- `hydrateRenderAssets` 对视频继续只登记 `File`，不动。

**判据**：
- 新建 `tests/unit/asset-store.test.ts`：「`File` 来源不读字节」——用一个 1MB 假
  `File` 记录 `arrayBuffer` 调用次数，断言 0。
- E2E：导入一个视频 → `page.evaluate` 读 `performance.memory.usedJSHeapSize`
  （Chromium 有）→ 断言增量小于文件大小的一半。这条比「画面正常」有意义得多。

### W1.2 流式写盘 + 自动保存 + 崩溃恢复

**流式写**：`project/fs.ts` 增 `writeStreamAtomic(dir, name, source)`，内部
`openWrite()` 逐块 `write()`；`FsWritable.write(Uint8Array)` 已支持，接口不用改。
`project/io.ts::writeProject` 的素材循环改走这条，`bytesFor` 换成 `open(id)`。

**自动保存**（两条路，同一个出口）：

| 场景 | 落点 | 频率 |
|---|---|---|
| 有目录句柄 | 正式 `project.json` | 变更后 2s 防抖 |
| 无目录句柄 | OPFS `drafts/<projectKey>.json` | 同上 |

三条硬约定：

1. **自动保存不轮转 `.bak`**。`.bak` 只在手动保存时写，否则它变成「两秒前」，
   失去兜底意义。
2. **自动保存不入撤销栈、不 bump version**。直接 `store.serialize()`。
3. **单飞队列**：同一个工程同时只允许一个写入在进行，后到的合并等待。
   与手动保存抢同一个文件时以手动为准（手动会 `cancel` 掉排队中的自动保存）。

失败降级：磁盘满 / 权限失效 → 自动保存转 OPFS，底栏常驻一条
「自动保存已降级到本地草稿」，点开能看原因。

**崩溃恢复**：`RestoreTabsBanner` 扩成两段：目录句柄恢复（现状）与
「N 分钟前的未保存草稿」恢复。草稿恢复 = 读 JSON → 走 `migrateProject` →
落成一份带未保存标记的工程（首次保存再让用户选目录）。

**判据**：
- 单测：`autosave.test.ts`（防抖合并 / 单飞 / 手动优先级 / 失败降级），全部走
  `memoryRoot`，不需要浏览器。
- E2E：改片段 → 等 2.5s → `page.reload()` → 断言改动还在且工程标脏。
- E2E：在 OPFS 里预置一份草稿 → 启动 → 断言 banner 出现 → 恢复后内容一致。

### W1.3 删除语义：解除关联 vs 销毁源文件

`assets.json` 增 `retained` 标记（**不是 `schemaVersion`**，是台账自己的
`layoutVersion` +1，旧版缺该字段视为 `false`，即旧行为）。

| 动作 | 语义 | 撤销 | 磁盘 |
|---|---|---|---|
| 媒体池「移除」 | 从 `Project.assets` 删除，台账标记 `retained: true` | 不入栈（字节不在快照里，假撤销更坏） | 文件保留 |
| 「清理未使用素材」 | 列出 `retained` 条目，勾选后删除 | 二次确认，写 `assets/.trash/` | 进回收站目录 |
| 「删除源文件」 | 仅对已移除的条目出现 | 二次确认 | 真删 |

`assets/.trash/` 内的文件不参与 `auditLedger`（`project/layout.ts` 已有
`isProjectFile` / `isBackupFile` 那套判定，加一条同样形状的排除）。

**判据**：`tests/unit/project-ledger.test.ts` 与 `tests/unit/project-io.test.ts`
各加三条（保留 / 清理 / 真删）；E2E「移除 → 保存 → 重开仍可恢复 → 清理 → 文件进
`.trash`」。

### W1 风险与回滚

`AssetStore` 是保存、打开、渲染素材三条路的交汇点，改错的表现是「打开工程素材
全丢」而不是报错。**每个子阶段单独提交，提交前跑一次完整 E2E**。回滚点用
`git tag backup/pre-w1.x`（禁 `git stash`）。W1.1 与 W1.2 之间不要夹别的改动。

---

## W2 · 时间轴双形态 + 段落标记 + 音频淡变

> **状态（2026-10-19）**：已完成。三处与计划不同的实现选择，理由都写在代码里：
>
> 1. **段落带是标尺上方一条 DOM（`SECTION_BAND_HEIGHT = 12`），不是 `drawRuler` 里的画布条。**
>    双击改名要输入框、右键要菜单、悬停要 title —— 12px 高的画布条里三样都做不了，
>    而画布条迟早还要补一套手写命中检测。`drawRuler` 因此一行没改，只多了 `mode` 参数。
> 2. **缩放台阶没做**（计划里「按小节对齐 / 自由」那一格）。缩放当前是连续值，
>    要按小节对齐得先定义「哪些 pxPerBeat 算合法」，没有需求能定下来。其余两处
>    （标尺文案、吸附默认值）已落地。
> 3. **吸附默认值在「老偏好」上不覆盖**：`UiPrefs` 里已经存过 `snap` 的用户视为手动
>    调过（`snapTouched`），不会因为升级被改成「小节」。首次运行的默认仍是
>    「节奏模式 + 小节」。
>
> 判据落地：`tests/unit/sections.test.ts`、`audio-envelope.test.ts`、`ruler-label.test.ts`、
> `mixdown.test.ts`（新增淡变三条）；E2E `timeline-sections.spec.ts`（拖 / 改名 / 删除 /
> 吸附 / 存取）、`timeline-modes.spec.ts`（两形态 + 吸附跟随 + 不覆盖手动值）、
> `timeline-audio-fade.spec.ts`（两个手柄 + 一笔撤销）。**导出音频能量的 E2E 改由
> `mixdown.test.ts` 的离线混流单测覆盖** —— 为了它跑一次真实导出（编码 + 解码回读）
> 成本高一个量级，而这条判据的本质是「混流用了同一份包络」。
>
> **验收复核（2026-10-19，用户反馈）**，五处改法：
>
> 1. **offset 进了标尺**：拍线 = `xOfBeat(b) = offset 的 x + b × pxPerBeat`，标尺、
>    行内网格、标准模式时间码全走它（此前只有吸附算了 offset，于是播放头永远压不上刻度）。
> 2. **形态开关改成两态按钮**（`activity` / `timer`），去掉下拉 —— 两个状态不值得两次点击。
> 3. **吸附档位按形态分表**：节奏「小节 / 拍 / 半拍 / 自由」，标准「自由 / 帧」；
>    帧吸附步长 `1/fps`（此前标准模式还在列拍单位，且两种形态共用一个值，
>    切一次就丢用户的选择）。持久化只存当前形态那一份。
> 4. **「在鼠标处切分段落」**（右键段内任意位置）：段落只存起点，先标第一个点会把
>    整首歌圈成第一段；切一刀 = 插一个新起点，左半的终点自动变成它。
> 5. **检查器对音频给「渐入 / 渐出」**（与两端三角手柄同一份数据、同一份钳制），
>    不再露出通用的 `fadeSec`（它仍在数据层给混流做剪辑点防爆音）。
> 6. **两列竖直滚动量程对齐**（段落带落地后暴露的）：轨道头列底部的「添加轨道」页脚
>    占掉 28px **视口**，画布那列横向滚动条又吃掉 s 像素 —— 画布内容末尾补一条等高的
>    `.footer-pad`、轨道头列补 `sidePad = offsetHeight - clientHeight` 的底部内边距，
>    两侧 `scrollHeight - clientHeight` 才相等。否则滚到底时低位那侧把高位那侧拽回来，
>    表现是「最后一条轨的名字被加轨按钮盖住」。

### W2.1 段落标记（schema v8）

`Project.sections: Section[]`，`{ id, name, start, color? }`。`start` 用秒（与
`clip.start` 同一口径），吸附到拍由 UI 决定，不写进数据。

- 标尺上方 12px 带：`timeline/grid-draw.ts::drawRuler` 里加一段，不改画布结构。
- 交互：单击定位播放头、拖动改位置、双击改名、右键删除。全部复用
  `timeline/drag.ts` 的事务式手势。
- 段落边界即吸附点；`beatAtTime` 不变。
- 迁移 v7 → v8 恒等（缺省 `[]`）。

**判据**：单测（`sections` 排序 / 重叠允许 / 迁移）；E2E（拖段落改位置一笔撤销、
段落边界吸附、重开工程保留）。

### W2.2 两种时间轴形态（纯 UI 开关）

`UiPrefs.timelineMode: 'beat' | 'standard'`（`UiPrefs` 四项同步：interface /
`loadUiPrefs` 的 fallback+normalize / `persistUi` / `app-state`）。

| | 节奏模式 | 标准模式 |
|---|---|---|
| 标尺 | `3.2`（小节.拍） | `00:04.12`（分:秒.帧） |
| 工具条 | BPM / 每小节拍数 / offset 常驻 | 时长 / 帧率 |
| 吸附 | 默认开 | 默认关 |
| 缩放 | 按小节对齐 | 自由 |

不新增数据结构、不改渲染管线 —— 只有标尺文案、缩放台阶与吸附默认值三处分支。

吸附已经是 `UiPrefs.snap: SnapMode`（`bar / beat / half / free`，表在
`core/time.ts` 的 `SNAP_MODES`，全仓唯一）。模式**只改它的初值**（节奏模式
`'bar'`、标准模式 `'free'`），用户手动改过之后不再被模式覆盖 —— 否则每次切模式
都会把用户的习惯抹掉。切换模式不写回 `snap`，只在「从未手动调过」时跟随。

**判据**：E2E 两条（切换模式后标尺文案变化 / 吸附默认值跟随），不要断言像素。

### W2.3 音频淡变（schema v8 并入）

`AudioClip.fadeIn / fadeOut`（秒，可选），`exporters/mixdown.ts` 与播放器共用
同一条包络求值（放 `core/audio-envelope.ts`，纯函数，可单测）。

- 时间轴上片段两端各一个小三角手柄，拖动一笔撤销。
- 与 `gain` 曲线复合：包络 × 曲线。
- 波形在淡变区内压暗，给一个可见的结果。

**判据**：单测（包络在 0 / 中段 / 末尾的采样值，`gain` 复合）；E2E（导出
audio buffer 在淡变区首尾能量低于中段 —— 走离线混流，不依赖播放）。

---

## W3 · 关键帧插值

数据层已经支持 `linear / step / smooth / bezier`，`ui/clip-edit.ts` 只会写
`linear`，界面没有入口 —— 于是用户手打的动画全是匀速。

### W3.1 单个关键帧的插值

- 时间轴上选中关键帧 → 右键菜单：线性 / 阶梯 / 平滑（`bezier` 先不暴露，
  它需要控制点，等曲线编辑器）。
- 检查器的关键帧行右侧加一个 3 态小按钮，与右键菜单同一份实现。

### W3.2 批量与可见反馈

- 框选多个关键帧一起改。
- 时间轴曲线在 `step` 段画成直角折线（现状应该都是直线），这是「改了有没有生效」
  唯一肉眼可见的证据。

**判据**：单测已有 `curve.ts` 的分支覆盖；E2E 断言「同一段曲线，`linear` 与
`step` 在 t 中点的求值不同，且 `step` 等于前一个键的值」（走导出一帧读回，
或直接读 `appState` 的求值结果，别读像素）。

---

## W4 · 工程卫生

可以和任何一波并行。

| 项 | 位置 | 做法 |
|---|---|---|
| 死代码 5 处 | `algos/sheet.ts`（仅自测引用）、`ui/export.ts::isExporting`、`glyph-layout.ts` 三个导出、`agent/types.ts` ~14 个零引用类型、`recent-colors.ts::rememberColor` | 删。`sheet.ts` 连测试一起删 |
| 参数类型分派 4 份 | `Inspector.svelte:707/1110`、`lab/LabParams.svelte:85/216` | 抽 `<ParamRow>` + 一个 `paramControl(p)` 分派函数，两边共用；Lab 不再把未知类型渲成颜色选择器 |
| 重复工具 3 处 | `ago()`（EmptyState / Rail）、体积格式化（export.ts / Rail）、颜色解析（core/color、image-fx、app-state） | 各收口一处 |
| 冗余文案 6-8 条 | `insp.scaleSeparateTip`、`insp.affectDepthTip`、`insp.emptyChain` 第二条、三条「换个搜索词」、`app.shortcutSchemeHint`、`insp.effectEnableTip` | 删或压到一句。判据：tooltip 只写「用户猜不到的后果」 |
| 首屏 21 个 preload | `ui/icons.ts` 的静态导入被 rollup 切成 25 个按字母分片的 chunk | 试 `build.rollupOptions.output.manualChunks` 把 `@lucide/svelte` 并进单块；不行就改按需动态导入 |
| 全局错误兜底 | 无 | `main.ts` 接 `window.onerror` / `unhandledrejection` → 底栏一条可展开的错误条，带「复制诊断信息」（版本 / 路由 / UA / 最近 10 条 console.error） |

**判据**：`css-namespace.test.ts` 的 `SCANNED_DIRS` 照旧；`param-row` 的 E2E
选择器必须仍然全绿（这是收口的回归网）；首屏 chunk 数写进一条构建断言。

---

## W5 · 桌面发行版（独立分支）

> **状态（2026-10-19）**：便携产物已跑通，端到端 MP4 导出 4.1 s / 48 MB 成功。
> 实测数据与两个待复测异常见 `docs/electron-compat.md` §8。剩下的不是可行性问题，
> 而是收尾：沙箱复测、locale 裁剪、安装包与签名。

调研结论见 `docs/electron-compat.md`。三条要点改变了这一波的形状：

1. **官方 Electron 已开专有编解码器**（`all.gn`: `ffmpeg_branding="Chrome"` +
   `proprietary_codecs=true`），塞 ffmpeg 对 WebCodecs 无效，也不是必需。
2. **不能 `loadFile`**。`file://` 是 null origin，会关掉 IndexedDB / OPFS / FSA ——
   而 Artmatic 的句柄持久化、自动保存草稿都压在这三样上。必须用 `app://`
   自定义 scheme（`standard + secure + supportFetchAPI + stream + codeCache`）。
3. **权限默认全放行**，`local-fonts` / `fileSystem` 不需要 handler；真正要接的是
   `file-system-access-restricted`（不接 = 选到黑名单目录直接 `AbortError`）。

### 5.1 开工前的探针（5 分钟）

`VideoEncoder.isConfigSupported` 三档 profile + `VideoDecoder` + `EyeDropper` +
`navigator.clipboard.write(ClipboardItem)` + `showDirectoryPicker`，脚本见
`docs/electron-compat.md` §5。

编码这条已经不用猜了：硬编之外有 OpenH264 软件回退，但它只支持 Constrained
Baseline（`openh264_video_encoder.cc` 里 `profile != H264PROFILE_BASELINE` 直接
返回 `kEncoderUnsupportedProfile`）。所以 W0.5 那条 codec 阶梯是这一波的前置条件，
不是可选项 —— 没有它，无硬编的机器会看到「本机不支持 WebCodecs」。

### 5.2 宿主侧四处接线

- 自定义 scheme + `protocol.handle` 服务 `dist/`（含 `../` 穿越防护与 SPA fallback）。
- `session.defaultSession.on('file-system-access-restricted', …)`：`allow` / 换目录
  二选一，不要一律放行（Artmatic 会往工程目录里写文件）。
- `Platform.download` 改为主进程 `showSaveDialog` + 写文件，不用 `a.download`。
- `probeCapacity()` 改由主进程 `os.totalmem/freemem` 供给，形状不变。

`platform/types.ts` 的文件头本来就写着「M5 加 electron.ts（IPC 版），接口不动」——
接缝在，不用造。若探针显示 FSA 在 `app://` 下正常，`project/fs.ts` 一行不改。

### 5.3 同批翻转一条硬约束

根 `AGENTS.md` §2 现在写着「打包分发：目前不做。不要复活 Electron 壳」，理由是
「Chromium / Electron 构建反而不带专有编解码器」。该理由已被 `all.gn` 推翻，
必须在该波次里改写，并留下调研依据；README 的「Chrome / Edge 最新版」前置条件
同步改成桌面版。

**不建议**把 Tauri 当省事方案：Windows 的 WebView2 带 H.264，但 macOS / Linux 的
WebKit 没有 WebCodecs H.264，跨平台会退化成本文里的「Firefox 处境」。体积优势
换来的是每平台各测一遍。要走这条就先写进决策文档再动手。

---

## 2. 版本号与格式变更清单

| 变更 | 位置 | 性质 |
|---|---|---|
| `SCHEMA_VERSION` 7 → 8 | `core/schema.ts` | 恒等迁移（`sections` / `fadeIn` / `fadeOut` 全可选） |
| `assets.json` `layoutVersion` +1 | `project/ledger.ts` | `retained` 缺省 false，旧版可读 |
| `UiPrefs.timelineMode` | `ui/app-state.svelte.ts` | 四项同步，非法值回落 `'beat'` |
| `CONTROL_API_VERSION` | `agent/types.ts` | W2 之后抬到 3（场景快照多了 `sections`） |

所有迁移都走「恒等」路线：字段可选、旧工程读进来天然合法，抬版本号只为让旧版
打开新工程时**明确报错**而不是静默丢数据。

---

## 3. 不做

- 不做浏览器能力闸门的完整版（W0 那条 20 行的够用）。
- 不做插件沙箱（试挂确认 + 面板明示是最终形态）。
- 不做贝塞尔控制点手柄（`bezier` 数据保留，UI 只到 smooth）。
- 不做预合成 / 嵌套、素材重链、导出队列 —— 本轮不在账上。
- 不重构 `app-state.svelte.ts`（2313 行）。W4 的收口已经能把它削掉一部分，
  整体拆分留到有明确痛点的下一次。

---

## 4. 开始前

1. `git tag backup/pre-0.3`，之后每波开始前同样打一个。
2. 基线：`bun run check` + `bun run test`（当前 2729 全绿）+ 一次完整 E2E。
3. 每波结束更新对应子系统的 `AGENTS.md`；根文件只在**硬约束**变化时改（W5 有一条）。
