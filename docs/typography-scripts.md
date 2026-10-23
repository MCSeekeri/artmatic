# 排版文档脚本（`doc.scripts`）

> 读者：要改 `/src/typography/script/**`、写排版脚本、或写带文档钩子的插件的人。
> 安装级约束在 `src/typography/AGENTS.md`；插件安全边界在 `src/plugins/AGENTS.md`。

## 1. 这是什么

排版文档多了一个**可选的**表现层：`TypographyDocument.scripts`。一条脚本是一段
JS 函数体，页面每帧（预览）/ 每个导出帧（导出）调用一次，拿到 `ctx` 去写元素的
样式、变换、SVG 路径、逐字状态或 canvas 像素。

它解决的是属性面板与 CSS 动画表达不了的事：逐字错峰、路径变形、程序化绘制、
跨元素的节奏编排。**它不改文档数据**：不改属性、不进撤销栈、不动 z 序 / 分组 / 配色。

## 2. 数据模型

```ts
interface TypographyScript {
  id: string;
  name: string;                 // 展示名（默认 Script N）
  code: string;                 // 函数体源码，ctx 在作用域内
  enabled: boolean;             // 单条启停
  targets?: string[];           // 结构预处理目标；缺省 = 全部可见元素
  needs?: ('chars' | 'canvas')[];
}
```

- `scripts` 是**可选字段** ⇒ 不抬 `SCHEMA_VERSION`（与 `groups` / `theme` 同约定）。
  老工程缺省 = 没有脚本，逐字节不变。
- 数组顺序 = 执行顺序。
- 代码**原样保存**（不 trim）：报错行号必须与编辑器里看到的一致。
- `needs` 只决定 render-dom 要不要多铺 DOM（逐字 span / canvas），**不限制**
  `ctx.el(id)` 能拿到谁。

上限（`SCRIPT_LIMITS`）：8 条 / 单条 20k 字符 / 总计 64k 字符（UTF-16 码元）。
`coerceDocument` 的 `sanitizeScripts` 永不抛：坏条目整条丢、超长截断并停用，
问题以路径字符串进 `droppedKeys`。

## 3. 求值

唯一入口：`src/typography/script/run.ts::runScripts()`。舞台与光栅化都只调它。

```
回滚上一帧的写入 → 逐条编译/执行（数组顺序） → 记下这一帧的撤销日志
```

- **回滚**（`baseline.ts`）记的是「我们改过的那些属性/属性的前值」，不是整层
  `style.cssText`：整段写回会打掉 `syncDocDom` 每帧写进去的内联样式。回滚前还会
  比对当前值是否仍是我们上次写的那一个；别人改过就放手。
- **编译**（`compile.ts`）按 `代码哈希 + 长度` 缓存，最多 32 条。
- **每条脚本**独立 try/catch、独立预算。一条失败不影响其他，也不影响画面
  （相当于这条脚本没跑）。
- 光栅化顺序：`bakeAnimations`（CSS 动画）→ `runScripts`（脚本层）→ snapDOM。
- 舞台顺序：`syncDocDom` → `seekAnimations` → `runScripts`。

### 时间与随机

- `ctx.t` 是片段内本地秒；`ctx.frame = round(t * fps)`（转场前半段可能为负）。
- `ctx.rand(i)` 由 `hashSeed(projectSeed, frame, scriptIndex, i)` 派生 —— 同帧同
  脚本同 `i` 永远同值。`Math.random` / `Date.now` / `performance.now` / 定时器
  在编译期被遮蔽（抛错），**这不是安全边界**，只是确定性与误用防护。

### 确定性 / 无状态

脚本必须写成「`t` 的闭式函数」：

- 同一 `t` 两次求值 → 逐像素相同；
- 倒退 seek 不累积（靠回滚日志）；
- 不允许跨帧保存状态（粒子、反应扩散这类需要状态的效果不在支持范围；要做得
  未来接入 `algos` 那套快照 + 重放）。

## 4. `ctx` API（能力清单里的同名副本）

| 字段 | 语义 |
|---|---|
| `t` / `frame` / `fps` / `duration` | 时间（秒 / 帧号 / 工程帧率 / 片段时长秒） |
| `w` / `h` | 文档画幅 px |
| `seed` | 工程种子 |

`ctx.el(id)` / `ctx.els(kind?)` → 句柄（元素不可见/不存在时 `null`）：

| 方法 | 说明 |
|---|---|
| `style(decls)` | 写内联样式到**脚本层**（`.typo-script`）；数字转字符串，`null` 移除 |
| `transform({x,y,rotate,scale,skew})` | x/y 文档 px，rotate/skew **角度**；与 CSS 动画层复合（动画在外、脚本在内） |
| `opacity(v)` / `visible(b)` | 0..1 / 布尔 |
| `attr(name, value)` | 写内容节点（svg / `.typo-text` / `.typo-image`）的属性 |
| `path(d)` | 仅 `shape:'svg'`；坐标系看 `pathUnit`（`percent` = 0..100，`px` = 元素框） |
| `var(name, value)` | CSS 自定义属性，必须 `--` 开头 |
| `canvas()` | 预建 2D 画布（`needs:['canvas']`），每次取用时清空并复位；无画布返回 `null` |
| `box()` / `d` | 未旋转框 / 文档里的原始路径 `d` |

`ctx.chars(elId)` → 每个字符一个句柄（`index` / `count` / `char` / `style` /
`transform` / `opacity`）。**只有 `needs:['chars']` 的目标元素才有**。

纯函数：`rand(i)`、`ease('linear'|'in'|'out'|'in-out', x)`、`clamp`、`lerp`、
`smoothstep`、`morph(dA, dB, k)`、`hsl(h,s,l)`、`log(...)`。

禁止：创建 DOM 节点、读布局（`getBoundingClientRect`）、网络、文件、`await`。

## 5. 结构预处理与已知限制

- **逐字**：`applyRuns(..., { perChar: true })` 在每个码点上生成
  `<span data-ch>`（`display:inline-block; white-space:pre`）。代价：inline-block
  会断开连字与跨字偶间距；**编辑该文本时退回按段渲染**（逐字暂停，面板有提示）。
- **Canvas**：元素内插 `<canvas data-script-canvas>`（先于内容 append，画在下面），
  backing store = 元素框 px，CSS 100%。**只支持 2D**：WebGL canvas 在 snapDOM
  里是空白。
- 脚本层永远存在（一个空 `div`），所以「有没有脚本」不改变 DOM 层级；
  只有逐字 span / canvas 是按需的。

## 6. 缓存与两条渲染路径

- `docIsAnimated(doc, scriptsActive)`：有动画 **或**（有启用脚本且总开关开）→
  动画文档（帧号进键）。关掉脚本时按静态缓存（frame = null），避免每帧重烘。
- 缓存键 = `docHash|WxH|frame|模式盐`，盐 = `s{0,1}h{0,1}`（脚本 / 插件钩子是否
  参与）。切开关必然换键，不会命中旧图。
- `docHash` 含脚本文本 ⇒ 改一个字符就重烘一次（正确行为）。
- 插件 `render` 钩子存在时同样按动画文档处理。
- 带脚本的文档**每帧都要重新光栅化**（这是脚本能逐帧变化的前提），所以导出
  耗时 ≈ 帧数 × 单帧光栅化时间；没有脚本的静态文档整段只烘一次。两条性能纪律：
  1. 淘汰（`TypographyRuntime.evict`）必须保住**刚落地的这一条**：导出期 `live`
     还停在前两帧，误删这一帧的纹理会让 `resolve` miss，成片从第 3 帧起纯黑；
  2. `FontRegistry.ensure()` 每帧都调，data URL 按字形集缓存（`dataUrlKey`），
     否则 woff2 / 整量回退时每帧都要重新 base64 整个字体。

## 7. 信任模型：默认关闭

脚本是**工程携带的任意代码**，在主 realm 里执行，没有真沙箱。

- 总开关 `UiPrefs.runTypoScripts`，**默认 false**；关闭时不执行、画面与「文档里
  没有脚本」逐像素相同。
- 关闭时导出也不含脚本效果 ⇒ 导出面板会警告，`export.ts` 会**挡下导出**并提示，
  不允许静默出一份不一样的片子。
- 界面标记：脚本页签、图层行（「脚本未运行」）、元素属性底部（「受 N 条脚本控制」）。
- 如实告知文案在 `typo.scriptRisk`：脚本是本工程携带的任意代码，只打开你信任的工程。

## 8. 插件文档钩子（API v2）

清单：

```js
export const plugin = {
  format: 'artmatic-plugin',
  apiVersion: 2,
  id: 'my-plugin',
  name: 'My plugin',
  typography: {
    hooks: [{ id: 'brand', name: 'Brand footer', phase: 'open', run(doc, ctx) { … } }],
  },
};
```

- 阶段：`open`（读工程后、上屏前）/ `save`（写盘前，改的是副本）/
  `render`（每次光栅化之前，只作用于本次出图）。
- 输入是**深拷贝 + 冻结**；返回整份文档（`undefined` = 不改）。
- 输出过 `coerceDocument`：抛错、返回非对象、或出现未知键 ⇒ **整条拒绝、保留原文档**，
  面板显示原因（`pl.hookRuntime`）。
- `render` 拿得到 `t / frame / fps / duration / seed`，必须是纯函数；不写回工程。
  它**每帧对每个文本片段跑一次**，输入是深拷贝 + 冻结 —— 钩子要保持 O(元素数)，
  不要把整篇文档扫成几万次操作（同步代码无法被中断，慢钩子会直接拖慢每帧光栅化）。
- 钩子在挂载时用合成文档跑一次，跑不通的钩子从注册表剔除（`hook-failed`）。
- 注册表：`src/typography/hook-registry.ts`（内置层为空 + 插件层，id =
  `${pluginId}/${localId}`）；`PluginHost` 的 install / disable / enable / remove /
  release 同步注册与注销。`PLUGIN_API_VERSION = 2`；声明钩子却写 1 会被拒收。
- 打开工程的挂载顺序：`openAt` 先以临时引用键挂插件（`open:<k>`）→ 跑 `open` 钩子
  → `adoptProject` → 用工程 id 正式挂载 → 释放临时引用。这样钩子看到的是「还没上屏」
  的文档，而插件仍然只加载一次。

## 9. Agent 可达

- 工具 `typo_set_scripts({ clipId, scripts })`（两处工具表 + MCP 分发都在）。
  校验前置：结构与语法错误在改动之前拒绝；`[]` 清空，省略字段保留。
- `get_typography_doc({ detail: 'full' })` 带 `scripts`，可原样写回；
  `typo_replace_doc` 省略 `scripts` 时保留、`[]` 才清空。
- `get_typography_capabilities().scripts` 是模型唯一能看到 API 形状、单位、限制与
  模板的地方。`notes` 写死「默认不运行」——模型必须提示用户去开启，不能假定效果可见。

## 10. 测试

- 单元（node）：`tests/unit/typography-script.test.ts`（清洗 / 沙箱 / 预算 /
  诊断 / 签名）、`typography-script-morph.test.ts`（k=0/1 精确、无 NaN）、
  `plugin-typography-hooks.test.ts`（manifest / 注册表 / 冻结输入 / 未知键拒绝）、
  `agent-scripts.test.ts`（写入 / 读回 / 整份替换）。
- E2E（真浏览器）：
  - `tests/e2e/typography-script.spec.ts`：开关关闭 = 无脚本基线、同 t 两次逐像素相同、
    canvas 被截进产物、脚本抛错不毁帧；
  - `tests/e2e/plugins.spec.ts`（「排版文档钩子」一节）：render 钩子影响出图、
    open 钩子在打开工程时改写文档。
- 确定性断言只走 `typoRasterize`（不经过 compositor / GPU）；合成链上的偶发差异
  见根 `AGENTS.md` §1.3，不要为它改渲染代码。
