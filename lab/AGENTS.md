# lab/ —— 试炼场（`/lab/`）

第二个 HTML 入口，与主应用**完全隔离**（独立 canvas、独立 Renderer、不引导主应用）。
存在理由只有一条：**决定哪些特效 / 生成器值得留下、默认参数该定多少**。

**何时读我**：改 `lab/**`；加一个需要「肉眼比一比」的新特效 / 生成器；动 lab 的批量导出时。

相关：`src/effects/AGENTS.md`（新增参数类型时 lab 是必改的四个消费方之一）、
`src/assets/AGENTS.md`（缩略图批量导出）、`src/algos/AGENTS.md`（生成器的默认值靠 lab 实测选定）、
根 `AGENTS.md` 的「架构分层」。

---

- **进 build**（`vite.config.ts` 的 `rollupOptions.input` 双入口），不是 dev-only ——
  E2E 走 build → preview 管线，产物里没有它就没有任何自动化覆盖。
- `/lab`（无尾斜杠）会被 SPA fallback 静默端上**主应用**，所以 `labRedirect()` 必须
  **同时**注册 `configureServer` 与 `configurePreviewServer`。E2E 一律访问 `/lab/`。
- 素材只能是**算法生成器 + `lab/patterns.ts` 的程序化测试图**，用 `lab:` 前缀伪
  generator id 由 lab 内层 resolver 拦截；**不注册进 `algos/registry.ts`、不改 `schema.ts`**。
- 分辨率档位靠 `renderer.setExportSize()` 钉死后备缓冲 —— `preview-size.ts` 的
  `k = Math.min(1, scale)` **只缩不放**，中间舞台列在常见视口下会被悄悄缩小。
- **回放型生成器（闪回）在 lab 里要自带「之前的素材」**：`build-project.ts` 给它
  垫一条彩条轨（`FEED`）并把片段头挪到 `LAB_RECALL_START`（6 秒）。垫底必须用
  **已注册的生成器** —— 回放帧由 `render/recall.ts` 自己那台合成器重渲，它不认识
  `lab:` 伪 id。`selectSource` 还会在播放头停在片段头之前时往前推一把，否则
  选中它是「整屏透明」，看起来与坏掉一模一样。
