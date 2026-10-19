/**
 * llm-proxy.mjs — 给应用内 Agent 的 **同源兜底**（dev 与 preview 都注册）。
 *
 * 为什么需要它：浏览器直连各家 API 的表现不一致 —— OpenAI 官方明确拒绝带
 * `Origin` 的请求，DeepSeek 实测被 CORS 拦，Gemini / OpenRouter 则开放。
 * 页面先直连；只有在**收到第一个字节之前**失败才换到本代理。
 *
 * 四条边界：
 *  1. **只转发注册表里的 provider**，路径 `/__llm/<providerId>/<端点>`。
 *     转发目标取自路由表（由 `providers/registry.ts` 派生），不是请求里带的 URL ——
 *     所以这不是通用反代，也就没有「拿它去刷别家站点」的口子。
 *  2. **不落 key、不写日志**：鉴权头从请求头原样透传，进程里不留副本。
 *  3. 只在 Vite（dev / preview）里存在；纯静态部署没有这条路由，页面回落到直连
 *     或用户自填的 baseUrl。
 *  4. 只放行 `POST`，且 `tail` 必须是 `/` 开头的同源路径（挡 `../` 穿越）。
 *
 * 与 `scripts/capacity.mjs` 同一个范式：插件在 `configureServer` 与
 * `configurePreviewServer` 两侧都挂，所以 E2E 也能测到这条兜底路径。
 */

const DEFAULT_PREFIX = '/__llm';

/** 需要透传给上游的请求头。别的（cookie / referer / origin）一概不带。 */
const FORWARD_HEADERS = [
  'content-type',
  'accept',
  'authorization',
  'x-api-key',
  'anthropic-version',
  'anthropic-beta',
  'anthropic-dangerous-direct-browser-access',
];

/**
 * `/__llm/deepseek/chat/completions` → `{ providerId:'deepseek', tail:'/chat/completions' }`。
 * 解析不出（缺 id、缺端点）返回 `null`。
 */
export function parseProxyPath(url, prefix = DEFAULT_PREFIX) {
  const path = String(url ?? '').split('?')[0];
  if (!path.startsWith(`${prefix}/`)) return null;
  const rest = path.slice(prefix.length + 1);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const providerId = rest.slice(0, slash);
  const tail = rest.slice(slash);
  if (!providerId || tail === '/') return null;
  return { providerId, tail };
}

/** 只放行白名单里的头，值必须是字符串。 */
export function pickForwardHeaders(headers) {
  const out = {};
  for (const name of FORWARD_HEADERS) {
    const value = headers?.[name];
    if (typeof value === 'string' && value) out[name] = value;
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function fail(res, status, code, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: { code, message } }));
}

/**
 * @param {{ routes: Record<string, string>, prefix?: string }} options
 *   `routes`：providerId → 上游 origin（来自 `PROXY_ROUTES`）。
 */
export function llmProxy({ routes = {}, prefix = DEFAULT_PREFIX } = {}) {
  const handler = (req, res, next) => {
    const url = req.url ?? '';
    if (!url.startsWith(prefix)) return next();

    const parsed = parseProxyPath(url, prefix);
    if (!parsed) return fail(res, 404, 'not-found', 'unknown llm proxy route');
    if (req.method !== 'POST') return fail(res, 405, 'method', 'only POST is proxied');

    const base = routes[parsed.providerId];
    if (!base) return fail(res, 404, 'not-found', `provider ${parsed.providerId} is not proxied`);

    let target;
    try {
      target = new URL(parsed.tail, `${base.replace(/\/+$/, '')}/`);
    } catch {
      return fail(res, 400, 'bad-path', 'malformed upstream path');
    }
    // `../` 穿越：解析后的 origin 必须还是这一家。
    if (target.origin !== new URL(base).origin) {
      return fail(res, 404, 'not-found', 'path escapes the provider origin');
    }

    void (async () => {
      try {
        const body = await readBody(req);
        const upstream = await fetch(target, {
          method: 'POST',
          headers: pickForwardHeaders(req.headers),
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
          fail(res, 502, 'network', String(e?.message ?? e));
        } else {
          res.end();
        }
      }
    })();
  };

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
