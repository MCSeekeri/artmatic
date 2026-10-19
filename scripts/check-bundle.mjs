/**
 * check-bundle.mjs — 构建产物守卫：首屏请求数与 lucide 分片数。
 *
 * 为什么需要它：`ui/icons.ts` 是 60+ 个具名静态 import，而 `vite.config.ts` 的
 * manualChunks 会把 `@lucide/svelte` 按首字母切成多块。某个新图标引入一个
 * 新字母组、或某次配置改动把图标拆成一图标一 chunk，**构建照样成功、页面照样
 * 能用**，只是首屏多下载几百 KB / dist 里多出上千个文件（后者会顶爆 safe-delete
 * 的 500 文件阈值，第二次构建直接失败）。这条守卫把这两件事变成明确的报错。
 *
 * 阈值是「当前值 + 余量」，不是目标值：
 *   首屏 modulepreload = 5（polyfill / preload-helper / 一个字母组 / index.svelte）
 *   entry <script type=module> = 1
 *   lucide-icon-*.js = 25（a–z 缺 y）
 *   dist/assets 文件总数 = 240（上限 450，低于 safe-delete 的 500）
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const LIMITS = {
  preloads: 8,
  entryScripts: 2,
  lucideChunks: 30,
  assets: 450,
};

function main() {
  let html;
  try {
    html = readFileSync(join(DIST, 'index.html'), 'utf8');
  } catch {
    throw new Error(`找不到 ${DIST}/index.html —— 先跑一次 vite build`);
  }

  const preloads = [...html.matchAll(/rel="modulepreload"/g)].length;
  const entryScripts = [...html.matchAll(/<script[^>]*type="module"/g)].length;
  const assets = readdirSync(join(DIST, 'assets'));
  const lucideChunks = assets.filter((n) => /^lucide-icon-.*\.js$/.test(n)).length;

  const failures = [];
  if (preloads > LIMITS.preloads) {
    failures.push(`首屏 modulepreload ${preloads} > ${LIMITS.preloads}`);
  }
  if (entryScripts > LIMITS.entryScripts) {
    failures.push(`entry <script type=module> ${entryScripts} > ${LIMITS.entryScripts}`);
  }
  if (lucideChunks > LIMITS.lucideChunks) {
    failures.push(`lucide 分片 ${lucideChunks} > ${LIMITS.lucideChunks}`);
  }
  if (assets.length > LIMITS.assets) {
    failures.push(`dist/assets 文件数 ${assets.length} > ${LIMITS.assets}（safe-delete 阈值 500）`);
  }

  if (failures.length) {
    console.error('[bundle] 构建产物超出预算：');
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[bundle] 首屏 preload ${preloads}/${LIMITS.preloads} · ` +
      `entry ${entryScripts}/${LIMITS.entryScripts} · ` +
      `lucide 分片 ${lucideChunks}/${LIMITS.lucideChunks} · ` +
      `assets ${assets.length}/${LIMITS.assets}`,
  );
}

main();
