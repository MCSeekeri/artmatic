# Artmatic

面向算法艺术与故障艺术的 Web 原生时间轴工具——把算法艺术和故障艺术**按音乐结构编排**起来：统一时间轴、按拍吸附、可打关键帧、确定性逐帧导出。

> 架构宪法、硬约束、ADR 与参考代码地图见 [AGENTS.md](AGENTS.md)。修改架构 / 数据模型 / 构建方式之前，先更新它。

## 当前状态：MVP（端到端精简切片）

打开即是可编排的 demo 工程（16s @120BPM，音频程序生成）：

- **底图**：Mandelbrot 缓慢推近（realtime 生成器，zoom 关键帧曲线）
- **纹理**：Rule 110 元胞自动机生长（Worker 烘焙 → R8 纹理，screen 混合）
- **局部故障**：第 5–8 小节的 slices + channel-split（adjustment layer 语义）
- **全屏调色**：echo 拖尾（ping-pong 反馈）+ 扫描线，全程

能力清单：

| 模块 | 内容 |
|---|---|
| core | 数据模型（判别联合轨道/片段）、曲线求值（linear/step/smooth/bezier + beatAnchor + impulse/follower 闭式）、拍网格（手动 BPM+offset）、三种重叠策略（reject/push/trim 可配置）、事务式撤销栈 |
| engine | WebGL2 合成管线（ping-pong + placement + 8 种混合模式）、预览尺寸解耦、确定性时钟 |
| algos | Rule 30/90/110（bake·Worker）、生命游戏（sim·固定步长+快照+seek 重放）、Mandelbrot（realtime·参数关键帧） |
| effects | channel-split / slices / pixelate / echo(feedback) / scanlines，「新增特效 = 两个文件」（defs + glsl，glob 自动配对） |
| timeline | Canvas2D 网格/波形、拖拽/拍吸附/双击切分/多轨增删、检查器 + 关键帧打点（可锚拍） |
| exporters | FrameSink 接口 + PNG 序列（fflate zip）紧循环导出，进度/取消 |
| 音频 | 导入音频（波形 min/max 可视化）、播放与工程时间同步 |

明确不做（路线图上排在后面）：BPM 自动估计（手动拍网格已可用）、video/text 源、typography、Electron/ffmpeg、WebCodecs 视频导出、曲线编辑器画布。

## 快速开始

```bash
# 依赖（bun 或 npm 均可；国内网络推荐 bun，快一个量级）
bun install

# 开发（纯浏览器，不需要 Electron）
bun run dev          # http://localhost:5173

# 验证三件套
bun run check        # svelte-check 类型检查
bun run test         # vitest 单元测试（纯函数）
bun run test:e2e     # Playwright E2E（自构建 + 自起 preview + 系统 Chrome）
```

E2E 用本机 Chrome（`channel: 'chrome'`），**不需要** `playwright install`。

## 快捷键

| 键 | 作用 |
|---|---|
| Space | 播放 / 暂停 |
| S | 在播放头处切分选中片段 |
| Delete / Backspace | 删除选中片段 |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | 撤销 / 重做 |
| Ctrl + 滚轮 | 以鼠标为锚缩放时间轴 |

双击片段 = 在该处切分；标尺拖动 = scrub 播放头。

## 确定性（本项目的立身之本）

- 唯一时钟 `t`（帧号/fps）：预览 rAF 与导出紧循环走同一条 `renderFrame(project, t)`。
- 随机全部带种子：`withSeededRandom`（JS 侧）/ `u_seed = hash(projectSeed, instanceId, frame)`（GLSL 侧）。
- 有状态模拟（生命游戏）：固定步长 + 每 16 步快照 + seek 从最近快照重放，`seek(f) ≡ 顺序 step f 次`。
- 反馈特效（echo）：seek 清历史；导出顺序渲染所以天然确定。
- E2E 逐像素断言：同 t 同历史状态 100 次求值零差异；导出帧 vs 预览帧差在噪声级（实测 5s/150 帧 mean ≈ 1.6e-6）。

## 许可与致谢

移植与依赖登记在 [CREDITS.md](CREDITS.md)（angel-echo / openmosh MIT / angel-echo-splitter / fflate MIT / Font Awesome Free）。不引 AGPL/GPL 代码。
