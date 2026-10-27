/**
 * scripts/make-icon.mjs — 从品牌 SVG 生成桌面壳的窗口图标。
 *
 * 产物 `desktop/icon.ico`（多尺寸，提交进仓库；`desktop/build.mjs` 会把它打进
 * 便携目录）。改了品牌 SVG 才需要重跑：
 *
 *   node scripts/make-icon.mjs
 *
 * ## 为什么要自己拼 ICO
 *
 * ICO 从 Vista 起允许**直接内嵌 PNG**，所以容器本身只有 6 字节头 + 每条 16 字节
 * 目录项，三十行就够 —— 不值得为一次性的转换引一个依赖。
 *
 * ## 长什么样
 *
 * **深底圆角方块 + 浅墨色标记**。品牌 SVG 是两色（紫 + 灰），而灰那档在深色
 * 任务栏上会整个消失；窗口图标又不会跟着系统主题换（Windows 只给一个），所以
 * 自铺一层 app 底色（`#111114`，与启动画面同值），两档任务栏都成立。
 *
 * 渲染走 Playwright + 本机 Edge（仓库里没下 ms-playwright 的浏览器）：
 * 图标是给 Chromium 同一套合成器出的，比手写 SVG 光栅化可靠。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG = path.join(ROOT, 'src', 'assets', 'brand', 'artmatic-small-light.svg');
const OUT = path.join(ROOT, 'desktop', 'icon.ico');

/** Windows 会按 DPI 挑这几档；256 也在里面（ICO 里宽度字段写 0 表示 256）。 */
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** 标记占方块的比例。满幅会让圆角显得被切，太小又糊。 */
const MARK_RATIO = 0.72;
const RADIUS_RATIO = 0.22;

/** 把若干 PNG 打成 ICO：6 字节头 + 每张 16 字节目录项 + PNG 本体。 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const b = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b); // width（0 = 256）
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1); // height
    dir.writeUInt8(0, b + 2); // 调色板大小
    dir.writeUInt8(0, b + 3); // reserved
    dir.writeUInt16LE(1, b + 4); // color planes
    dir.writeUInt16LE(32, b + 6); // bit depth
    dir.writeUInt32LE(e.png.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/** 一页 HTML：底色圆角方块 + 居中的品牌标记。 */
function page(size, svg) {
  const mark = Math.round(size * MARK_RATIO);
  const radius = Math.round(size * RADIUS_RATIO);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; height: 100%; background: transparent; }
    .tile {
      width: ${size}px; height: ${size}px;
      border-radius: ${radius}px;
      background: #111114;
      display: grid; place-items: center;
    }
    .mark { width: ${mark}px; height: ${mark}px; display: block; }
    .mark svg { width: 100%; height: 100%; display: block; }
  </style></head><body>
    <div class="tile"><div class="mark">${svg}</div></div>
  </body></html>`;
}

async function main() {
  const svg = fs.readFileSync(SVG, 'utf8');
  // 品牌 SVG 的 viewBox 带内边距（-10 0 163 163），去掉根元素的宽高让它填满容器。
  const inline = svg
    .replace(/^<\?xml[^>]*\?>\s*/, '')
    .replace(/<!DOCTYPE[^>]*>\s*/, '')
    .replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ');

  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge' });
  } catch {
    browser = await chromium.launch();
  }

  const pageRef = await browser.newPage({ deviceScaleFactor: 1 });
  const entries = [];
  for (const size of SIZES) {
    await pageRef.setViewportSize({ width: size, height: size });
    await pageRef.setContent(page(size, inline), { waitUntil: 'load' });
    const png = await pageRef.screenshot({ omitBackground: true, type: 'png' });
    entries.push({ size, png });
  }
  await browser.close();

  fs.writeFileSync(OUT, buildIco(entries));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log('✓', path.relative(ROOT, OUT), `${kb} KB · ${SIZES.join('/')}`);
}

main().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
