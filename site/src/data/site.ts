export const GITHUB = 'https://github.com/OxygenNine/artmatic';

/** `BASE_URL` 一定以 `/` 结尾；拼完不会出现 `//`，也不依赖部署在域名根。 */
export function url(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * 下载入口。仓库还没有任何发行版（2026-10 建仓），所以 `available: false`
 * 时首页不摆一个指向空 Releases 页的按钮 —— 那种假可用状态比没有按钮更糟。
 * 发了第一个 release 后改这里：`available: true`，补 `version` 与 `size`。
 */
export const DOWNLOAD = {
  available: false,
  url: `${GITHUB}/releases`,
  label: 'Windows x64 便携包',
} as const;

export const NAV = [
  { label: '使用指南', href: '/guide/' },
  { label: '开发手册', href: '/dev/architecture/' },
  { label: 'API', href: '/api/core/' },
] as const;
