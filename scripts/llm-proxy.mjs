/**
 * llm-proxy.mjs — 给应用内 Agent 的 **同源兜底**（dev 与 preview 都注册）。
 *
 * 为什么需要它：浏览器直连 `api.deepseek.com` 是否被 CORS 拦，各家说法与实测
 * 不一致。页面先直连；只有在**收到第一个字节之前**失败才换到本代理。
 *
 * 三条边界（与 AGENTS §6.4 同源）：
 *  1. **只转发白名单路径** `/__llm/chat/completions` —— 不是通用反代。
 *  2. **不落 key、不写日志**：`Authorization` 从请求头原样透传，进程里不留副本。
 *  3. 只在 Vite（dev / preview）里存在；纯静态部署没有这条路由，页面回落到直连
 *     或用户自填的 baseUrl。
 *
 * 与 `scripts/capacity.mjs` 同一个范式：插件在 `configureServer` 与
 * `configurePreviewServer` 两侧都挂，所以 E2E 也能测到这条兜底路径。
 */

const PREFIX = '/__llm';
const UPSTREAM = 'https://api.deepseek.com';
const ALLOWED = new Set([`${PREFIX}/chat/completions`]);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const handler = (req, res, next) => {
  const url = req.url ?? '';
  if (!url.startsWith(PREFIX)) return next();

  if (req.method !== 'POST' || !ALLOWED.has(url.split('?')[0])) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'not-found', message: 'unknown llm proxy route' } }));
    return;
  }

  void (async () => {
    try {
      const body = await readBody(req);
      const upstream = await fetch(UPSTREAM + url.slice(PREFIX.length), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : '',
        },
        body,
      });

      res.statusCode = upstream.status;
      res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
      // 流式回答不能被缓冲或缓存。
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Accel-Buffering', 'no');

      if (!upstream.body) {
        res.end(await upstream.text());
        return;
      }
      const reader = upstream.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) res.write(Buffer.from(value));
      }
      res.end();
    } catch (e) {
      // 已开始写响应时只能断开；未开始则给一条可读的错误。
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { code: 'network', message: String(e?.message ?? e) } }));
      } else {
        res.end();
      }
    }
  })();
};

/** Vite 插件。 */
export function llmProxy() {
  return {
    name: 'artmatic:llm-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
