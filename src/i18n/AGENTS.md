# src/i18n/ —— 文案

自研 `tr()` + 扁平点分键表 + `Label` 契约（插件给的运行期字符串走后者）。

**何时读我**：加 / 改任何用户可见文案；加一个域或一门语言；给数据表加 `labelKey` 时。

相关：根 `AGENTS.md` 硬约束 1.1（`t` 是帧号 —— 所以翻译函数不叫 `t`）、
`src/plugins/AGENTS.md`（为什么 `labelKey` 的类型是 `Label` 而不是 `MessageKey`）。

---

- 唯一入口是 **`tr()`**，**不叫 `t`** —— 本项目 `t` 是**帧号**的专名（硬约束 1.1），
  拿它当翻译函数等于在每个渲染函数里制造命名冲突。
- key 是**扁平点分命名**（`'tl.importAudio'`），`keyof typeof zhCN` 直接就是 `MessageKey`，
  编译期可检查，不需要类型体操。按域拆文件只是为了让 600+ 条找得到，合并后就是一张平表。
  域清单见 `tests/unit/i18n.test.ts` 的 `DOMAINS`（common · media · pool · effects · app ·
  project · timeline · inspector · curve · transitions · typography · ribbon · shortcuts ·
  errors · lab · agent · plugins）。**加一个域 = 加一个文件 + 在 `zh-CN/index.ts` 与那份 `DOMAINS` 各登记一行**
  （漏登记的表现是「文案写对了但跨文件重名检测覆盖不到它」）。
- **`i18n/index.svelte.ts` 必须是 `.svelte.ts`**：locale 是 `$state`，而 `tr()` 每次调用都读它
  ⇒ 模板里任何一处 `tr()` 都自动建立依赖，切语言时整棵树重渲。用普通模块 + 订阅回调的做法
  有一个很明确的失败形态：加了新文案却忘了订阅那处 ⇒ 界面静默停在旧语言。
- **数据表存 `labelKey` / `nameKey`，由 UI 侧解析**：`effects/defs/*`、`algos/*`、
  `typography/{shapes,animation,document}.ts`、`ui/shortcuts.ts` 都是**模块加载时求值一次**的表，
  里面直接写 `tr('…')` 会把值冻结在导入那一刻的语言上，而且症状极具误导性：**只有那几项不动**。
  字段名带 `Key` 后缀是刻意的 —— 改名让所有使用点编译报错，一个也漏不掉。
- **什么不进语言文件**：参数名 / 保留字（`opacity`、`transform.x`、curve 键、generator id、
  assetId）、`console.*` 与启动期不变量（判据是**用户有没有可能看到它**）、纯数值格式化
  （`1920×1080`、`12 ms`）。**含「词」的带数字文案要进**（`{n} 帧` 里的「帧」要翻译）。
- 占位符只认 `{名字}`，缺参数时**原样保留**（返回 `已打开「{name}」` 而不是空串 ——
  后者看起来像数据本身为空）。**禁止用模板字符串拼句子**（翻译时无法重排语序）；
  三元表达式里的两句话也拆成两个 key。
- **加一门语言**：复制 `locales/zh-CN/` 整个目录 + 在 `locales/index.ts` 登记一行，
  **不改任何组件代码**。键集必须完全一致（单测挡）。
