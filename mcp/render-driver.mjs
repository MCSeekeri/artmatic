/**
 * render-driver.mjs — CLI 的 `render` 子命令：**驱动器，不是渲染器**。
 *
 * 方案 §7 的硬边界：CLI **永远不出像素**。它做的四件事是
 * `build → 起 preview → 起 Chrome → 让页面里的控制平面导出`，
 * 然后把产物写到 `--out`。像素全程只在浏览器里产生 —— 硬约束 1.1
 * （预览与导出走同一条求值路径）因此不可能被这条命令绕过。
 *
 * 它也是「有头 / 无头共用同一控制平面」（方案 §6.3）的又一个例证：这里跑的
 * `control.loadScene / exportBase64` 与 MCP 网关、与 E2E 调的是同一份实现。
 *
 * 用法：
 *   node scripts/cli.mjs render <dir> --out FILE [--format mp4|png|gif]
 *        [--range from:to] [--size WxH] [--url http://localhost:5173]
 *
 * `--url` 是**旁挂**：指向一个已经在跑的 dev / preview（例如用户开着 `pnpm run dev`），
 * 于是这次渲染落在「用户正看着的那个实例」上。省略则自己起一套无头的。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Bridge } from './bridge.mjs';

const EXT = { mp4: 'mp4', png: 'zip', gif: 'gif' };

function parse(argv) {
  const out = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const eq = key.indexOf('=');
      if (eq >= 0) out.flags[key.slice(0, eq)] = key.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) out.flags[key] = argv[++i];
      else out.flags[key] = 'true';
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

function die(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

const args = parse(process.argv.slice(2));
// `scripts/cli.mjs` 会把命令名留在 argv 里（render <dir> …）。
const dir = args.positional[args.positional[0] === 'render' ? 1 : 0];
if (!dir) die('用法：render <dir> --out FILE [--format mp4|png|gif] [--range from:to] [--size WxH]');

const format = args.flags.format ?? 'mp4';
if (!(format in EXT)) die(`未知格式 ${format}（可用：${Object.keys(EXT).join(' / ')}）`);
const outPath = args.flags.out ? resolve(args.flags.out) : die('缺少 --out（产物落盘路径）');

/** 区间是**帧号**（左闭右开）—— 与 MCP 工具、与 `runExport` 同一约定。 */
function frameRange(raw) {
  if (!raw) return undefined;
  const m = /^(\d+)\s*:\s*(\d+)$/.exec(raw.trim());
  if (!m) die(`--range 形如 120:240（帧号，左闭右开），收到 ${raw}`);
  return { from: Number(m[1]), to: Number(m[2]) };
}

function size(raw) {
  if (!raw) return undefined;
  const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(raw.trim());
  if (!m) die(`--size 形如 640x360，收到 ${raw}`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

const projectFile = isAbsolute(dir) ? join(dir, 'project.json') : join(resolve(dir), 'project.json');
let project;
try {
  project = JSON.parse(readFileSync(projectFile, 'utf8'));
} catch (e) {
  die(`读不到 ${projectFile}：${e.message}`);
}

const bridge = new Bridge({ url: args.flags.url });
const progressAt = { last: -1 };

try {
  process.stderr.write(`[render] 起服务 / 浏览器 …\n`);
  const origin = await bridge.start();
  process.stderr.write(`[render] 页面 ${origin}；装载工程「${project.name ?? projectFile}」…\n`);

  // `loadScene` = 控制平面的路径 B（整体改写，可撤销）。它内部会迁移 + 校验，
  // 所以磁盘上那份「旧版本 / 手改过」的 JSON 在这里被挡一次。
  const loaded = await bridge.call('loadScene', [project]);
  if (!loaded.ok) die(`装载工程失败：${loaded.error.code} / ${loaded.error.message}`);

  const info = await bridge.call('describe');
  if (!info.ok) die(`describe 失败：${info.error.message}`);
  process.stderr.write(
    `[render] 导出 ${format}（${info.data.resolution.w}×${info.data.resolution.h} @ ${info.data.fps}fps，${info.data.duration}s）…\n`,
  );

  await bridge.startExport({ format, frameRange: frameRange(args.flags.range), size: size(args.flags.size) });

  for (;;) {
    const { done, state } = await bridge.pollExport();
    if (state) {
      // 只在整数百分比变化时打一行，免得把 stderr 刷成滚屏。
      const pct = Math.floor(state.frac * 100);
      if (pct !== progressAt.last && pct % 10 === 0) {
        progressAt.last = pct;
        process.stderr.write(`[render] ${pct}%（${state.frames}/${state.totalFrames} 帧）\n`);
      }
    }
    if (done) break;
    await delay(200);
  }

  const res = await bridge.takeExportResult();
  if (!res) die('导出没有留下结果');
  if (!res.ok) {
    // cancelled 也是「没产物」，但要说清是取消而不是失败。
    die(`导出失败：${res.error.code} / ${res.error.message}`);
  }
  writeFileSync(outPath, Buffer.from(res.data.base64, 'base64'));
  process.stderr.write(`[render] 完成：${outPath}（${res.data.bytes} 字节）\n`);
} finally {
  await bridge.close();
}
