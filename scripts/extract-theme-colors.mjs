/**
 * extract-theme-colors.mjs — 从 Office 截图里采样「主题颜色」数据。
 *
 * 用途：把两张参考截图转成 `src/typography/theme.ts` 的色值表 ——
 *   ① 取色卡截图（主题颜色 5×10 网格 / 标准色 / 最近使用色）
 *   ② 配色方案列表截图（每个方案一行缩略色块）
 * 手抄色值必然出错（一个 hex 一位看不出来），采样是唯一可靠的做法。
 *
 * 零依赖：PNG 解码用 Node 自带的 zlib（手写反 filter）。不引 sharp / pngjs
 * 的理由与项目其它脚本一致 —— 这类一次性工具不值得拉一棵依赖树。
 *
 * 用法：
 *   node scripts/extract-theme-colors.mjs probe <png> [--row y] [--col x]
 *      探测模式：打印指定扫描线上的颜色变化点，用来定位网格几何。
 *   node scripts/extract-theme-colors.mjs grid <png>
 *      按内置几何（见 GEOMETRY）采样取色卡网格 + 标准色 + 最近色。
 *   node scripts/extract-theme-colors.mjs schemes <png>
 *      采样配色方案列表（每行一排色块）。
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/* ------------------------------------------------------------ PNG 解码 */

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/** 解码 8bit PNG → { width, height, at(x, y): {r,g,b,a} }。支持灰度/RGB/RGBA/调色板。 */
export function decodePng(buf) {
  for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIG[i]) throw new Error('不是 PNG 文件');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('不支持隔行扫描 PNG');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`不支持位深 ${bitDepth}`);

  const srcCh = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * srcCh;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= srcCh ? cur[x - srcCh] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= srcCh ? prev[x - srcCh] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pred) & 255;
      } else if (filter !== 0) {
        throw new Error(`未知 filter ${filter}`);
      }
      cur[x] = v;
    }
  }

  const at = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return { r: 0, g: 0, b: 0, a: 0 };
    const i = y * stride + x * srcCh;
    if (colorType === 3) {
      const idx = out[i];
      return {
        r: palette[idx * 3],
        g: palette[idx * 3 + 1],
        b: palette[idx * 3 + 2],
        a: trns && idx < trns.length ? trns[idx] : 255,
      };
    }
    if (colorType === 0 || colorType === 4) {
      const v = out[i];
      return { r: v, g: v, b: v, a: colorType === 4 ? out[i + 1] : 255 };
    }
    return { r: out[i], g: out[i + 1], b: out[i + 2], a: srcCh === 4 ? out[i + 3] : 255 };
  };
  return { width, height, at };
}

/* ------------------------------------------------------------ 工具 */

const hex = (c) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const dist = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

/* ------------------------------------------------------------ 探测 */

function probe(img, { row, col, thr = 24 }) {
  console.log(`尺寸 ${img.width} × ${img.height}（阈值 ${thr}）`);
  for (const y of String(row ?? '').split(',').filter(Boolean).map(Number)) {
    let prev = img.at(0, y);
    console.log(`\n— 行扫描 y=${y} —`);
    for (let x = 1; x < img.width; x++) {
      const c = img.at(x, y);
      if (dist(c, prev) > thr) console.log(`  x=${x}: ${hex(prev)} → ${hex(c)}`);
      prev = c;
    }
  }
  for (const x of String(col ?? '').split(',').filter(Boolean).map(Number)) {
    let prev = img.at(x, 0);
    console.log(`\n— 列扫描 x=${x} —`);
    for (let y = 1; y < img.height; y++) {
      const c = img.at(x, y);
      if (dist(c, prev) > thr) console.log(`  y=${y}: ${hex(prev)} → ${hex(c)}`);
      prev = c;
    }
  }
}

/* ------------------------------------------------------------ 采样 */

/**
 * 取色卡（图 2）网格几何 —— 以 483×758 的截图为基准，按比例缩放适配其它尺寸。
 *
 * 10 列 × 6 行：行 1 = 原色槽（lt1, dk1, lt2, dk2, a1..a6），行 2-6 = 5 个明暗变体。
 * 列中心 = 27 + 48k，行 1 中心 y=148，变体区行中心 y=213 + 42k。
 */
function samplePalette(img) {
  const sx = img.width / 483;
  const sy = img.height / 758;
  const cols = [];
  for (let k = 0; k < 10; k++) cols.push(Math.round((27 + 48 * k) * sx));
  const rows = [Math.round(148 * sy)];
  for (let k = 0; k < 5; k++) rows.push(Math.round((213 + 42 * k) * sy));
  // 每格取 3×3 采样点的**中位色**：避开 1px 描边与抗锯齿的边缘像素。
  const cell = (x, y) => {
    const list = [];
    for (const dy of [-6, 0, 6]) for (const dx of [-8, 0, 8]) list.push(img.at(x + dx, y + dy));
    list.sort((a, b) => a.r + a.g + a.b - (b.r + b.g + b.b));
    return list[Math.floor(list.length / 2)];
  };
  const grid = rows.map((y) => cols.map((x) => hex(cell(x, y))));
  return { grid };
}

/* ------------------------------------------------------------ 变体分析 */

const rgb = (c) => {
  const m = /^#(..)(..)(..)$/.exec(c);
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
};

function toHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

function fromHsl(h, s, l) {
  const hh = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const to = (v) => Math.round(v * 255);
  return { r: to(f(hh + 1 / 3)), g: to(f(hh)), b: to(f(hh - 1 / 3)) };
}

/** Office 的 5 个变体语义：Lighter 80 / 60 / 40 %、Darker 25 / 50 %。 */
export const SHADES = [
  { id: 'l80', lum: (l) => l * 0.2 + 0.8 },
  { id: 'l60', lum: (l) => l * 0.4 + 0.6 },
  { id: 'l40', lum: (l) => l * 0.6 + 0.4 },
  { id: 'd25', lum: (l) => l * 0.75 },
  { id: 'd50', lum: (l) => l * 0.5 },
];

/** 把实测网格转成「变体 vs 只改亮度」的对照表。 */
function analyzePalette(img) {
  const { grid } = samplePalette(img);
  const base = grid[0];
  for (let k = 0; k < 10; k++) {
    const b = rgb(base[k]);
    const bh = toHsl(b);
    console.log(`\n列${k} 原色 ${base[k]}  H=${bh.h.toFixed(0)} S=${bh.s.toFixed(3)} L=${bh.l.toFixed(3)}`);
    for (let i = 0; i < 5; i++) {
      const got = rgb(grid[i + 1][k]);
      const gh = toHsl(got);
      const want = fromHsl(bh.h, bh.s, SHADES[i].lum(bh.l));
      const d = Math.abs(want.r - got.r) + Math.abs(want.g - got.g) + Math.abs(want.b - got.b);
      console.log(
        `  ${SHADES[i].id} 实测 ${grid[i + 1][k]} H=${gh.h.toFixed(0)} S=${gh.s.toFixed(3)} L=${gh.l.toFixed(3)}` +
          ` | 预测(lumMod) ${hex(want)} Δ=${d}`,
      );
    }
  }
}

/**
 * 配色方案列表（图 3）几何 —— 以 407×970 的截图为基准。
 *
 * 8 块 = [dk2, lt2, a1, a2, a3, a4, a5, a6]（由 Office 行验证：采样值与
 * 公开的 Office 主题 XML 完全一致），块中心 x = 29 + 22j，行中心 y = 25 + 42k。
 */
const SCHEME_NAMES = [
  'office',
  'office-2013',
  'office-2007',
  'grayscale',
  'blue-warm',
  'blue',
  'blue-ii',
  'blue-green',
  'green',
  'yellow-green',
  'yellow',
  'yellow-orange',
  'orange',
  'orange-red',
  'red-orange',
  'red',
  'magenta',
  'violet',
  'violet-ii',
  'median',
  'paper',
  'caption',
  'slipstream',
];

function sampleSchemes(img) {
  const sx = img.width / 407;
  const sy = img.height / 970;
  const out = [];
  for (let k = 0; k < SCHEME_NAMES.length; k++) {
    const y = Math.round((25 + 42 * k) * sy);
    const colors = [];
    for (let j = 0; j < 8; j++) colors.push(hex(img.at(Math.round((29 + 22 * j) * sx), y)));
    out.push({ id: SCHEME_NAMES[k], colors });
  }
  return out;
}

/* ------------------------------------------------------------ 主入口 */

const [cmd, file, ...rest] = process.argv.slice(2);
if (!cmd || !file) {
  console.error('用法: node scripts/extract-theme-colors.mjs <probe|grid|schemes> <png> [--row y] [--col x]');
  process.exit(1);
}
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  if (rest[i]?.startsWith('--')) {
    const raw = rest[i + 1];
    args[rest[i].slice(2)] = /^[-\d.,]+$/.test(raw) ? (raw.includes(',') || raw.includes('.') ? raw : Number(raw)) : raw;
  }
}
const img = decodePng(readFileSync(file));

if (cmd === 'probe') probe(img, args);
else if (cmd === 'analyze') analyzePalette(img);
else if (cmd === 'grid') {
  const { grid } = samplePalette(img);
  for (const [i, row] of grid.entries()) console.log(`行${i + 1}: ${row.join(' ')}`);
} else if (cmd === 'schemes') {
  for (const s of sampleSchemes(img)) console.log(`${s.id.padEnd(14)} ${s.colors.join(' ')}`);
} else {
  console.error(`未知命令 ${cmd}`);
  process.exit(1);
}
