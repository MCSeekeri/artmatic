/**
 * check-content.mjs — 生成物缺失时把构建变成红色。
 *
 * Starlight 的 `autogenerate` 指向一个空目录时**静默**产出一个空侧栏分组，
 * 站点照样能构建、能部署，只是 API 那一栏整个消失。手写 `slug` 能报错，
 * 但 slug 列表得跟着 TypeDoc 的文件名走，不现实。
 *
 * 所以门槛放在这里：数量对不上就退出码 1。
 */
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = (p) => fileURLToPath(new URL(p, new URL('..', import.meta.url)));

const EXPECT = [
  ['src/content/docs/api/core', 20],
  ['src/content/docs/api/agent', 2],
];

/** 递归数 .md：agent 那一栏的 LLM 运行时是子目录。 */
function countMd(root) {
  let n = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countMd(`${root}/${entry.name}`);
    else if (entry.name.endsWith('.md')) n += 1;
  }
  return n;
}

const problems = [];
for (const [path, min] of EXPECT) {
  const full = dir(path);
  if (!existsSync(full)) {
    problems.push(`${path} 不存在`);
    continue;
  }
  const count = countMd(full);
  if (count < min) problems.push(`${path} 只有 ${count} 个 .md，至少应有 ${min} 个`);
}

if (problems.length) {
  console.error('生成物不完整：\n  - ' + problems.join('\n  - '));
  console.error('\n先跑 `bun run gen:api`（或整条 `bun run gen`）。');
  process.exit(1);
}

console.log('content check  API 生成物在位');
