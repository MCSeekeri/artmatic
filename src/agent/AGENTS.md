# src/agent/ —— Agent 控制平面 + 应用内模型运行时

**这是 agent 的唯一操作面**：读场景 / 写工程 / 出图 / 导出 / 排版 / 插件。
面板（`ui/agent/`）与 MCP 网关（`mcp/`）都只是它的传输壳。

**何时读我**：加 / 改工具、改控制平面方法、动插件作者面或排版写入、
改模型运行时（provider / session / executor）、抬 `CONTROL_API_VERSION` 时。

相关：根 `AGENTS.md`（依赖方向 · 一轮一笔撤销）、`src/typography/AGENTS.md`
（文档模型）、`src/plugins/AGENTS.md`（插件安全边界）、`docs/agent-control-plane.md`（方案与契约全表）。

---

## 分层与依赖

```
tools.ts        工具表（名字 / 描述 / 参数 / writes）—— 应用内与 MCP 的共同真源
control-plane.ts 所有方法的唯一实现（读写看导 + 排版 + 插件）
scene.ts        纯函数：场景快照（可在 Node 里单测）
capabilities.ts 能力发现（ids / params 两档）
typography.ts   排版写入（校验前置，落库走 store.commit）
plugin-spec.ts  运行期组装的协议说明书（help 按需取）
plugin-author.ts 试挂 / 安装 / 丢弃 / 移除
llm/            provider（SSE）→ session（工具循环）→ executor（工具名映射）
```

- **不 import `ui/`**：运行期实例全部走注入的 `ControlContext`。
- **可以 import `typography/` 的纯模型层**（`document` / `shapes` / `svg-gen` /
  `theme` / `agent-ops`），**禁止** import `typography/render-dom`（DOM）。
- **不 import `project/plugins`**：写盘走 `ctx.persistPlugin` / `ctx.removePlugin`，
  插件宿主走 `ctx.getPluginHost()`（结构类型 `AgentPluginHost`）。
- `getStore()` 每次重新取 —— 多工程下缓存它必然错。

## 写操作的纪律

- 一律走 `ProjectStore` 的既有方法或 `store.commit`；**不许裸改 `project`**。
- 写之前 `beforeWrite()`：先 `stopTextEditing()`（打字是直接改 `doc.runs`，
  不停会被编辑器下一次提交覆盖），再 `cancelPendingGesture()`。
- **一轮对话 = 一笔撤销**：session 用 `beginTx` / `endTx` 包住整轮，
  而 `CommandStack.commit` 在事务打开时**不单独入栈**（`core/commands.ts`）。
  不要在事务内再手动 begin 第二层事务。
- **会话历史随工程保存，但不进撤销栈**：`project.agentSessions` 由
  `ProjectStore.setAgentSessions` 写入（bump version，不 commit）；快照会剔除
  这个字段、恢复时保留当前值。否则一次 Ctrl+Z 会把聊天记录一起退回去。
  历史上限见 `sanitizeAgentSessions`（30 会话 / 400 条 / 20k 字），图片只留说明。
- 校验全部**前置**：参数不合法时在改动之前抛 `ControlFailure`，绝不半途修改。

## 工具面

- 工具描述是**给模型读的 API 文档**（英文），界面文案走 i18n 的 `agent.*`。
  工具卡的标题用 `agent.toolName.<camelCase>`（`ui/agent/tool-labels.ts` 把
  `ask_user` 这样的 snake_case 转成键段；i18n 守卫只允许 `[a-zA-Z0-9]`）。
  加工具时**同时**加显示名 —— 缺键会回落到英文 id，那正是漏登记的可见信号。
- `writes: true` 决定「是否计入本轮改动数」。漏标的后果是面板说「没改」，
  而工程其实变了。
- **每加一个工具，两边都要有**：`src/agent/tools.ts` 与 `mcp/tools.mjs`
  （应用内短名 ↔ `artmatic_` 前缀）。`tests/unit/agent-tools-parity.test.ts`
  断言名字集合与必填参数一致；MCP 独有工具要显式列进允许清单。
- 拒绝未知参数键（拼错一个字母就静默取默认值是最难查的一类）。

## 能力清单（`getCapabilities`）

- `detail:'ids'` 只给 id；`params` 给完整参数表（键 / 类型 / 区间 / 选项 / 默认值 /
  能否打关键帧）。**参数表可以很大**，所以支持 `ids` 过滤。
- `ParamDef.visibleWhen` 是函数，序列化时必须剥掉（`serializeParam`）。
- 文本片段的 `source.doc` 在快照里只给摘要（`ClipTextSummary`），详情走
  `getTypographyDoc` —— 这是 `CONTROL_API_VERSION = 2` 的读形状变更。
- 段落标记（v3）在 `head()` 里给**两份快照**：`sections: { id, name, start, color? }`。
  只给起点（结尾 = 下一段起点），否则 agent 读到的是「视图的算法」而不是数据。
  音频片段另给 `fadeIn` / `fadeOut`（0 不铺开）。
- 抬版本时同步 `mcp/index.mjs` 与 `tests/e2e/agent.spec.ts`（后者 import 常量）。

## 排版写入

- 纯函数在 `typography/agent-ops.ts`，这里只做校验 + `store.commit`。
- 每个写方法一次 `commit`（一个工具调用 = 一笔撤销）。
- `coerceDocument` **永不抛**：坏元素整条丢弃，工程必须打得开。
- 文本元素的三层填充别混：`fill`（字形）/ `boxFill`（文本框底）/ `boxStroke`（边框）。
- 布局优先走 `typo_layout`，别让模型手算坐标。

## 插件作者面

- 两级：`plugin_try`（内存载入 + 真 GL 编译，可预览）→ `plugin_install`（写盘）。
  **两级都必须用户确认**，否则返回 `needs-approval` —— 试挂不是「只看一眼」：
  `host.importBytes` 会 `import()` 源码，也就是**立刻在主世界执行**。确认必须挡在
  它之前，否则「未确认时没有实例」这条判据不成立。
- `plugin_try` 的 `confirm` **不暴露给模型**（工具面没有这个参数，模型不能自批）；
  它只由 session 在用户点了审批卡之后带 `confirm:true` 重调。MCP 面的 `confirm`
  由客户端用户决定。「本次会话允许试挂」只活在 UI 会话里，不进协议。
- 草稿只活在控制平面实例的内存里；安装之后磁盘才是真源。
- 只写 `plugins/<合法 id>.js`（`isValidPluginSegment`），没有任意路径写、没有 eval。
- `plugin-spec.ts` 的说明书由 `EFFECT_HEAD` / `ALGO_HEAD` 常量拼出 ——
  加 uniform 时文档自动跟上；单测断言「两个头的每个 uniform 都出现在文档里」。
- 插件是单文件、不能 import，所以说明书里要带可直接粘贴的 helper。

## 模型运行时（`llm/`）

分层：`transport`（fetch / SSE 取帧 / 直连降级）→ `protocol/*`（请求体 · 鉴权 ·
流式归约）→ `session`（工具循环）→ `executor`（控制平面）。

- **协议只有两种**：`openai`（Chat Completions，覆盖 15 家）与 `anthropic`
  （Messages）。差异全部在 `providers/registry.ts` 的数据里，别在适配器里写
  `if (providerId === ...)` —— **`session.ts` 里一个 provider 分支都不许有**。
- 新增一家 = 往 `PROVIDERS` 加一条 + 一张 logo（`src/assets/providers/<id>.svg`）。
  端点 / 思考形态 / 回传策略 / 代理白名单 / UI 下拉全部由这条数据派生。
  自检：`tests/unit/agent-providers.test.ts` 的注册表守卫。
- **手写 SSE**（不引 SDK）：`delta.tool_calls[i].function.arguments` 是**分片**，
  按 `index` 累积再拼。Anthropic 的 `partial_json` / `signature` 同理，
  且 `signature` 是**追加到块上**而不是拼进正文。
- **思考参数有五形态**（`thinking` / `enable_thinking`+`thinking_budget` /
  `reasoning_effort` / `reasoning.effort` / `thinking.budget_tokens`），
  翻译**只在** `providers/reasoning.ts::thinkingParamsFor`。UI 档位固定四档，
  不要把档位写成提示词。
- **「关不掉思考」是模型级的**（GLM 5.3 / MiniMax M3）：传 `disabled` 直接 400。
  写在 `ModelRule.alwaysThinking` 上，UI 据此隐藏「关闭」档。
- **思维链回传策略是 per-provider 的** `thinking.echo`：
  `required`（DeepSeek 带 tools 漏传 = 400、Anthropic 的 signature 必须原样）、
  `optional`、`never`（智谱明确不回传）。判据在适配器的 `serializeMessages`，
  session 只管把 `reasoning_content` 与 `providerMeta` 写进历史。
- **`WireMessage` 是内部表示**，`providerMeta`（Anthropic 的 thinking 块、
  OpenRouter 的 `reasoning_details`）**绝不上线**，任何序列化器都要剥掉它。
- **图片只能出现在 user 消息**。不支持图片的模型（`ModelRule.noImages`）要
  **跳过注入**，否则模型会凭空描述画面。截图在工具轮结束后以一条 user 消息注入。
- `t` 是秒；工具表里帧号字段一律带 `Frame`。
- 传输：**先直连**，在收到第一个字节之前失败才切 `<proxyPath>/<providerId>/<端点>`。
  `preferProxy` 按 provider 记忆。已经吐过字之后**不重试**（会重放半截回答）。
  OpenAI 官方端点拒绝带 `Origin` 的请求，`transport.browserDirect: false` 只走代理。
- **响应必须是 `text/event-stream`**：静态站点会把 `/__llm/*` 回落成 200 + HTML，
  没有这条守卫时表现为「一条空回答且没有任何错误」。
- **重复调用先引导、别掐断**：同一个「工具 + 参数」第 3 / 6 次把引导**附加在
  那条 tool 结果末尾**，第 12 次才判死。⚠️ 不能插 system 消息（DeepSeek 带 tools
  会 400，且坏历史会让之后每条都 400）。
- **400 自愈**：`bad-response + 400` 之后清空模型历史并提示。**上下文超限例外**
  （归 `context`）：那是装不下，不是历史被污染 —— 压缩，不要清空。
- `ask_user` 是 **appOnly** 工具：由 session 直接拦截并向 UI 要答案（`onAskUser`）。
- **上下文窗口按 `(provider, model)` 取**（`contextLimitOf`，从 32k 到 1M）；
  75% 时用同一个模型（不带 tools）把前半段压成交接说明，保留最近 8 条。
  硬裁剪兜底，**绝不能切在 assistant/tool 之间**。
- `AbortController` 贯穿请求；单请求超时 300s。
- 步数默认 200、上限 2000（`MAX_STEPS` / `MAX_STEPS_LIMIT`）。
- **配置**：`agent-prefs.ts` 是纯函数层（迁移 / 解析），`agent-state.svelte.ts`
  只负责接到 `$state` 上。key / 模型 / 端点**按 provider 各存一份**，只覆盖与
  注册表不同的部分。Key 只存 `localStorage` 的 `artmatic.agent`，**不进
  `project.json`**；`sessionOnly` 在落盘时剥掉所有 key。

## 测试

- 纯逻辑（参数序列化 / 文档原语 / SSE / 裁剪 / 工具表）在 `tests/unit`。
- 需要真 GL 与页面状态的在 `tests/e2e/agent*.spec.ts`：用 `page.route` 伪造 SSE，
  不依赖真 Key；插件那条走真编译（坏着色器 → `compile-failed`）。
- 真 Key 冒烟脚本与日志放 `.codebuddy/tmp/<日期>/`，别提交。
