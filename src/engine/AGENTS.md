# src/engine/ —— WebGL2 底层

Program / Target / Pass 调度 · 纹理池 · 预览尺寸 · 确定性时钟 · 素材登记 · 视频取帧与缓存。

**何时读我**：改 `engine/**`；动**合成顺序（z 序）/ 影响深度**；动预览尺寸或全屏策略；
加一个 pass、或碰 GL 状态时。

相关：`src/effects/AGENTS.md`（着色器协议 · `prePasses` / `feedback` · GL 状态事故）、
`src/core/AGENTS.md`（容量预算的裁决）、`src/render/AGENTS.md`（谁把这一层装起来）。

---

## 合成求值

```ts
function buildStack(project: Project, t: number): Stack {
  // 1. 收集所有命中 t 的 SourceClip，轨道序 → 轨道内序 决定 z
  // 2. 按 z 序合成（各自的 blend / opacity / transform / 曲线求值）
  // 3. 把命中的 EffectClip 的 chain 依 z 序插入到 step 2 之后
  // 4. 顶部叠加渲染：排版层
}
```

**EffectClip 是 adjustment layer 语义**：只作用于 z 序在它**之下**的所有 SourceClip 的
合成结果。「调色放最顶层」= 作用于整幅画面；「故障放在两层之间」= 只坏一层。

### 影响深度（`EffectClip.affectDepth`，v5）

`affectDepth = N > 0` 的特效**不再吃 acc 当时的样子**，而是吃一段**独立合成的组画面**：
从「下方第 N 条**启用**视觉轨」起的连续一段 op，**从透明起**合成 → 特效链 → 贴回下层。
于是「作用域 = 只留下这几条轨道时的那幅画面」，它看不到作用域之外的轨道。
「只给上面两层调色、别碰背景」就是它存在的理由。`N = 0` / 缺省 = 下方全部 = v4 的行为
（这条老路**逐字节没变**，也不多花 pass）。

- **贴回用的不是写死的 normal，而是作用域最底层那个 op 自己的混合模式**（`scope-blend.ts`
  的 `bottomScopeBlend`）：组从透明起合成，组内最底层没有背景板，对着透明黑做
  `add` / `multiply` / `screen` 会算出**不透明黑**（alpha 照常按本层覆盖度累积）。
  实测：**黑填充 + 线性加深(add)** 的圆形设了影响深度就变成黑块、把下方画面盖住，
  而不设深度时它与下方相加仍是下方色。所以最底层那个 source 在组内按 `normal`
  收进来（`neutralizeBottomBlend`），混合模式留到贴回那一步对着真正的背景板做。
  守卫 `tests/e2e/effect-scope-blend.spec.ts`（判据是「depth=1 与 depth=0 逐通道一致」，
  不是「画面变了」）。已知近似：组内 rgb 是预乘的，半透明边缘会被多压一次
  （不透明实心区域逐位一致）。

- **只数启用轨**：禁用轨不参与合成，谈不上被影响，也不该占掉一格深度 —— 否则关掉一条轨
  会让上方特效突然作用不到任何东西（看起来就是「特效没了」）。
- **同轨更早的片段在作用域里**：它们在画面上本来就在它之下。作用域是**一段连续的 z 序 op**
  （不是「按轨号挑片段」），所以这一条与上一条都只是这条定义的推论。
- **吸收**：作用域内的其它特效（更低、自己也带深度）需要的轨道会**并进**外层作用域。
  反过来做（截断内层）会让内层特效变成静默的空操作 —— 那是更坏的表现。
- **下方没有启用轨** → 作用域为空，特效作用在**空画面**上（多数特效因此看不出变化）。
  检查器显示「影响：V2、V3」或那条空作用域警告；判据共用
  `engine/stack.ts::affectedVisualIndices`，**别在 UI 里另算一遍**（对不上时不报错）。
- 实现：`buildStack` 把作用域 op **折进** `EffectOp.scope`（顶层不再重复出现它们）；
  旁路消费方（`video-source` 的预取）要走 `walkOps`，否则作用域里的视频源不预解码。
  `compositor.runOps` 递归渲染，`groupTargets(depth)` 保证嵌套时外层中间结果不被覆盖。
  区间族是层叠的（laminar），所以建树是一个栈一趟的事。
- **`SCHEMA_VERSION` 抬到 5**，4→5 是**恒等迁移**：旧版打开新版工程要显式报错，
  而不是静默丢掉作用域再保存。

> **z 序 = 列表位置取反**（`engine/stack.ts` 的 `buildStack`：`z = 视觉轨数 - 1 - 视觉轨下标`）。
> `tracks[0]` 渲染在轨道列表最顶部，按 NLE 惯例就是最前景 ⇒ 它的 z 必须最大。
> **编号只数视觉轨**（音频轨不参与合成）。
> 写反的表现是**「特效完全无效且不报错」**。`core/demo-project.ts` 的 tracks 数组
> 必须一起倒序，`tests/unit/stack.test.ts` 会挡住。

---

## 预览

- 预览降质档位（帧率 1×/½/⅓、画质 100/75/50/25%、暂停回全质）**只影响预览**。
  缩放乘在 `fitPreviewSize` 的结果上，**不能走 `setExportSize`** —— 那会让 `syncSize`
  直接 return，窗口缩放 / 切工程 / 改分辨率全都不会再适配。而且**不动 CSS 盒**：
  canvas 不设 CSS 尺寸时，显示尺寸等于缓冲像素数，只缩后备缓冲画面会跟着变小。
- 帧率节流只在**播放中**生效：暂停时永远渲，那是「改一个参数立刻看到结果」的路径。
- **全屏预览**：宿主是 `.preview` 容器（不是 canvas —— 悬浮工具条与两帧浮层要跟着
  铺满），`requestFullscreen` 后由 `fullscreenchange` 同步状态（浏览器给的退出通道
  不走我们的按钮）。它打开的**唯一开关**是 `renderer.setAllowUpscale(true)`
  （`fitPreviewSize` 松开 `k = Math.min(1, scale)` 那个帽子，上限 `UPSCALE_CAP = 2×`）——
  **绝不能改用 `setExportSize`**（`syncSize` 永久短路）。退出全屏必须关回去，
  否则窗口模式下也按屏幕尺寸分配缓冲。
  - 预览缓冲**由显示区域决定**，所以「工程分辨率变小」不会让 `kit.w` 变小到分辨率以下 ——
    量它之前先想清楚是哪个量在限制（`tests/e2e/ui-ux.spec.ts` 的全屏用例记着这一条）。
  - **headless 里 `Esc` 不触发浏览器级退出全屏**（键盘是 CDP 合成的），E2E 的退出
    走我们自己的按钮（`document.exitFullscreen()`，不需要手势）。
