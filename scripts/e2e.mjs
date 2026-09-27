/**
 * e2e.mjs — E2E 启动器：build → vite preview → playwright test → 清理。
 *
 * 不用 playwright 的 webServer 配置：它经 shell  spawn 长驻进程，
 * 在某些沙箱里整个进程树会收到 SIGTERM（test runner 零输出暴毙）。
 * 这里全部用 process.execPath 直接 spawn node，绕开 shell。
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4173;
const node = process.execPath;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`))));
    p.on('error', reject);
  });
}

async function waitForPort(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* 还没起来 */ }
    await delay(300);
  }
  throw new Error(`等待 ${url} 超时`);
}

// 已有 preview 在跑就复用（省一次起服务的时间），但**构建永远要做**——
// 否则复用的是一个给旧代码服务的服务器（实测踩过：测试对着旧 dist 跑）。
let reuse = false;
try {
  const r = await fetch(`http://localhost:${PORT}/`);
  reuse = r.ok;
} catch { /* 没在跑 */ }

let server = null;
try {
  console.log('[e2e] vite build …');
  await run(node, ['node_modules/vite/bin/vite.js', 'build']);
  if (!reuse) {
    console.log('[e2e] 启动 vite preview …');
    server = spawn(node, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
    await waitForPort(`http://localhost:${PORT}/`);
  }
  console.log('[e2e] playwright test …');
  await run(node, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)]);
  console.log('[e2e] 全部通过');
} finally {
  server?.kill();
}
