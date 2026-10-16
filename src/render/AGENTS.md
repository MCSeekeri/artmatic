# src/render/ —— ★ 合成根

装配 Renderer + SourceManager + AlgoRuntime + EffectRunner。
**主应用与 `/lab/` 共用同一份 `createRenderCore`** —— 两边各写一份的 bug 形态是
「试炼场里好好的、主应用里某类源不工作」，而且不会有任何报错。

**何时读我**：加一个新的离屏渲染器（缩略图那类）；出现「想顺手在别处再装一台 renderer」的念头时。

相关：根 `AGENTS.md` 的「架构分层」（`render/` 为什么必须单独一层）、
`src/algos/AGENTS.md`、`src/effects/AGENTS.md`。

---

- **离屏渲染器住在 `render/effect-thumb-renderer.ts`**（不是 `effects/` 也不是
  `ui/effect-picker/`）：它要 `createRenderCore`，而 `render → effects` 是唯一合法的
  方向；放 `effects/` 会成环。**只有 lab 的批量导出在用**（选择器读静态资源，见 `src/assets/AGENTS.md`）。
