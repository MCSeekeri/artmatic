# src/project/ —— 工程持久化（File System Access）

工程目录格式 · 素材台账 · 原子写 · 句柄持久化（含 `plugins/` 读写）。
**工程真相在磁盘目录，不在 localStorage。**

**何时读我**：改 `project/**`；动保存顺序 / 素材台账 / 句柄与权限 / `.bak` 与读回校验时。

相关：`src/core/AGENTS.md`（`Project` 结构与 `SCHEMA_VERSION` 迁移）、
`src/plugins/AGENTS.md`（`plugins/` 目录）、`src/exporters/AGENTS.md`（流式落盘）。

---

```
<工程目录>/
├── project.json        工程本体（`src/core/AGENTS.md` 的 Project），真相的唯一载体
├── project.json.bak    上一版成功保存的副本
├── assets.json         素材台账（引用路径 + 内容哈希 + 原始文件名）
├── assets/             素材字节（文件名 = <assetId>.<原始扩展名>）
├── analysis/           可重算的离线分析缓存（音频波形 / BPM / 拍网格）
├── plugins/            这个工程挂的插件（一个插件 = 一个 .js），见 `src/plugins/AGENTS.md`
└── thumbs/             缩略图缓存（可丢弃）
```

- `src/project/layout.ts` 是路径规则的唯一真源。路径一律按**段数组**处理，不拼字符串再拆
  —— FSA 的 `name` 里不允许出现分隔符。`plugins/` 也走这一套
  （`pluginPathSegments` / `safePluginId`），并已加入 `PROJECT_DIRS`。
- **`project.json` 不写 `savedAt`**：写进去会让「内容没变 → 字节没变」失效。
- **原子性由浏览器提供**：`createWritable()` 默认 siloed 模式（同目录写 `.crswap`，
  `close()` 时才 rename）。Web 上**没有 fsync**。我们能自己做的只有两件：
  维护 `.bak`，以及 `close()` 之后读回来校验一遍（抓「磁盘满而 close 没报错」这类静默损坏）。
- 多标签页并发写用 `createWritable({ mode: 'exclusive' })`。降级重试**只认 TypeError**
  —— 把「已经有 writer」一起吞掉的话，并发写就退化成静默互相覆盖。
- 素材用**工程根相对路径 + sha256**，不是绝对路径（FSA 不向页面暴露真实路径）。
  随之而来的翻转：**「引用而非拷贝」在 Web 上变成「拷贝进 `assets/`」**，因为
  `<input type=file>` 只给字节不给句柄，而 `showOpenFilePicker()` 给的句柄不能被序列化成
  可移植路径。哈希缓存的键是**字节对象的引用**，`put()` 换字节就自然失效，不需要显式
  invalidate。超 `MAX_HASH_BYTES`（256 MB）记 `hash: null`，退化成「大小 + 修改时间」弱指纹
  （`crypto.subtle.digest` 无法流式，GB 级素材峰值能破 5 GB）。不做纯 JS 哈希回退。
- **写入顺序就是全部的安全性**：素材 → 台账 → 工程 → 删旧素材。崩在中间任何一步都
  无害（孤儿文件只占空间），而「工程引用了已删素材」是有害的。**只有台账里被显式移除的
  素材才删文件** —— 仅仅「没被片段引用」不算（那多半是临时从时间轴上拿下来的）。
- 台账**可以丢**：文件名就是 `<assetId>.<ext>`，从 `assets/` 目录本身就能重建（哈希现场算）。
  所以 `parseLedger` 对损坏输入降级成空台账 + 警告，而不是抛错。`assets/` 里的未跟踪文件
  **只提示不删**。
- 三个根来源（`project/fs.ts` 定义最小句柄接口）：`fsaRoot`（生产，首次需点一次）/
  `opfsRoot`（E2E 与 dev，无授权）/ `memoryRoot`（单测，**模拟 swap 语义** + `setFault()` 注入失败）。
  句柄存 IndexedDB，跨会话保留，但**权限不一定跟着** —— 新会话里 `queryPermission()`
  通常是 `'prompt'`，要 `requestPermission()` 且那一下必须有用户手势。所以「打开最近工程」
  天然只能由点击触发，**页面加载时不能自动恢复**。同名目录靠 `isSameEntry()` 区分。
- **脏标记是近似但方向安全**：`savedVersion !== version` 即视为有未保存改动
  （假阳性只是多问一句，假阴性才是丢工作）。
  `ProjectStore.replaceProject()`（打开 / 新建）**会清空撤销栈**，`loadFrom()`（工程内换内容）
  不会 —— 否则撤销会把两份工程的片段混在一起，而每一步看起来都合法。
