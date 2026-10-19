import type { Plugin } from 'vite';

/** `scripts/llm-proxy.mjs` 的类型声明（给 vite.config.ts 用）。 */
export function llmProxy(options: {
  /** providerId → 上游 origin。由 `PROXY_ROUTES` 提供，测试可传自造表。 */
  routes: Record<string, string>;
  prefix?: string;
}): Plugin;

/** `/__llm/<providerId>/<tail>` 的解析（纯函数，单测直接喂字符串）。 */
export function parseProxyPath(
  url: string,
  prefix?: string,
): { providerId: string; tail: string } | null;

/** 只透传白名单请求头。 */
export function pickForwardHeaders(headers: Record<string, unknown>): Record<string, string>;
