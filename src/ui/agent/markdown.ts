/**
 * markdown.ts — 对话正文的 Markdown 渲染（`AgentDrawer` 与历史记录共用）。
 *
 * 为什么需要：模型回答天然是 Markdown（列表 / 加粗 / 行内代码 / 代码块），
 * 按纯文本渲染时用户看到的是 `**加粗**` 和 `- 条目` —— 这不是「少一点装饰」，
 * 而是**读不成句子**。
 *
 * ## 三条安全约束
 *
 * 1. **先转义 `<` 再解析**。模型输出是不可信输入，`<img onerror=...>` 这类
 *    注入在这里就会被变成字面量。Markdown 语法本身不使用 `<`（自动链接除外，
 *    代价可接受），所以这一步不影响排版。
 * 2. **链接只允许 http(s) / mailto / 锚点**，其余一律落到 `#`。
 *    模型写出 `javascript:` 链接时不能让它变成可点的执行入口。
 * 3. **图片不加载**：`![](...)` 只回显 alt 文本。对话里没有任何理由去请求
 *    第三方 URL（会把「本机截图」变成对外的网络请求）。
 *
 * 渲染结果通过 `{@html}` 注入，所以上面三条是**必须**而不是保险。
 */

import { marked, type Tokens } from 'marked';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SAFE_HREF = /^(https?:\/\/|mailto:|#)/i;

marked.use({
  gfm: true,
  // 聊天里的换行是**语义换行**（用户按了回车），不是 Markdown 的「软换行合并」。
  breaks: true,
  renderer: {
    link({ href, title, text }: Tokens.Link): string {
      const safe = SAFE_HREF.test(href ?? '') ? escapeHtml(href ?? '') : '#';
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${safe}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image({ text }: Tokens.Image): string {
      return text ? `<span class="md-img-alt">[${escapeHtml(text)}]</span>` : '';
    },
  },
});

/**
 * 渲染缓存：流式回答时每来一个 token 都会重渲最后一条消息，而正文是累加的
 * —— 不缓存的话一次回答会把同一段前缀解析几十遍。上限很小，只留住当前几条。
 */
const cache = new Map<string, string>();
const CACHE_MAX = 40;

export function renderMarkdown(text: string): string {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  // `<` 转义必须在解析之前：之后就是 HTML 了，再转义会把我们自己的标签打坏。
  const html = marked.parse(text.replace(/</g, '&lt;'), { async: false }) as string;
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(text, html);
  return html;
}
