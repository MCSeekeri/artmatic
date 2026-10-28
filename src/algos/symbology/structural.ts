/**
 * structural.ts — 五种「结构复刻」符号：Aztec / MaxiCode / Data Matrix /
 * Grid Matrix / 汉信码。
 *
 * ## 这一份的边界（先读这段，再看代码）
 *
 * 它们**不是完整的标准编码器**。做到的是：
 *
 * - **宏观结构忠实**：定位 / 同步图形的位置与形状、符号尺寸随内容增长的方式、
 *   静区比例、数据区的密度与噪声感 —— 也就是「一眼认得出这是哪种码」的部分；
 * - **真实纠错**：数据字节真的走 Reed–Solomon（GF(256) / GF(64) / GF(16)，
 *   见 `gf.ts`），所以码字统计与真实符号同源，不是随机撒点；
 * - **确定性**：同一个输入每次得到同一张图（`padFor` 是带种子的哈希）。
 *
 * 没做到的是**精确的码字布局**（Data Matrix 的 "utah" 路径、Aztec 的层内螺线、
 * MaxiCode 的 144 码字交织、汉信码的分块表）。所以：**扫不出来**。
 *
 * 为什么不做：这些布局是真·表数据 + 分支特例，没有可信参考实现就只能是猜 ——
 * 而猜错的形态恰好是「看着完全正确、扫不出来」（见 `qr.ts` 文件头的同一条理由）。
 * 想扫得出来就用 QR 或 Code 128，那两条有整幅矩阵的金标对拍。
 *
 * ⚠️ **不要**在任何界面文案里承诺这五种可扫。这条边界也写在
 * `src/algos/AGENTS.md` 的「机器可读符号」一节。
 */

import { GF16, GF256_DM, rsParity } from './gf';
import { DARK, LIGHT, ModuleMatrix, fillBits, padFor } from './matrix';

/** UTF-8 字节（不用 `Buffer`：Worker / 浏览器 / Node 三处要一致）。 */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 数据 + RS 纠错码字（纠错字数按数据量的比例取，夹在 3..48 之间）。 */
function withParity(data: Uint8Array, ratio: number, gf = GF256_DM, maxEc = 48): Uint8Array {
  const ecLen = Math.max(3, Math.min(maxEc, Math.round(data.length * ratio)));
  const out = new Uint8Array(data.length + ecLen);
  out.set(data);
  out.set(rsParity(gf, data, ecLen), data.length);
  return out;
}

/** 把数据扩/截到 `n` 字节：多出来的部分用**按内容哈希**的填充字节（不撒纯色）。 */
function fitBytes(data: Uint8Array, n: number, seed: string): Uint8Array {
  if (data.length === n) return data;
  if (data.length > n) return data.subarray(0, n);
  const out = new Uint8Array(n);
  out.set(data);
  out.set(padFor(seed, n - data.length), data.length);
  return out;
}

/**
 * 按「到中心的切比雪夫距离、再按方位角」排序的自由格 —— 同心环填充顺序。
 *
 * 两种符号共用它：Aztec 的数据层本来就是一圈一圈的，MaxiCode 的六角格同理。
 * 用排序而不是「按 d 反复扫描整幅」，是因为 189² 的汉信码那样扫一二十遍就是
 * 上千万次比较（实测会拖住参数滑杆）。
 */
function ringOrder(m: ModuleMatrix, cx: number, cy: number): number[] {
  const items: { i: number; d: number; a: number }[] = [];
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (!m.isFree(x, y)) continue;
      const dx = x - cx;
      const dy = y - cy;
      items.push({
        i: m.idx(x, y),
        d: Math.max(Math.abs(dx), Math.abs(dy)),
        a: Math.atan2(dy, dx),
      });
    }
  }
  items.sort((p, q) => p.d - q.d || p.a - q.a);
  return items.map((it) => it.i);
}

/* ==================================================== Data Matrix (ECC200) */

/**
 * 方形 ECC200 的尺寸档（10..144）。**这是标准附件里的档位**，不是任意值：
 * 真实符号只有这些边长，中间跳档是为了让容量阶梯不至于太碎。
 */
const DM_SIZES: readonly number[] = [
  10, 12, 14, 16, 18, 20, 22, 24, 26, 32, 36, 40, 44, 48, 52, 64, 72, 80, 88, 96, 104, 120, 132,
  144,
];

/**
 * Data Matrix：**实线 L + 时钟线**的外框是它唯一的视觉签名，那部分是标准的；
 * 内部填充用蛇形顺序（不是标准的 "utah" 路径，见文件头）。
 *
 * 大尺寸符号在标准里会被切成多个数据区、区间有对齐图形 —— 这里不做，
 * 否则外框就不再是「一整条 L」了。所以边长上限压到 144 / 内部不留分区。
 */
export function encodeDataMatrix(content: string): ModuleMatrix {
  const raw = utf8(content);
  let size = DM_SIZES[DM_SIZES.length - 1]!;
  let dataCap = 1;
  let ecLen = 3;
  for (const s of DM_SIZES) {
    const total = Math.floor(((s - 2) * (s - 2)) / 8);
    const ec = Math.max(3, Math.round(total * 0.3));
    const cap = total - ec;
    if (cap >= raw.length) {
      size = s;
      dataCap = cap;
      ecLen = ec;
      break;
    }
  }

  const data = fitBytes(raw, dataCap, content);
  const full = new Uint8Array(data.length + ecLen);
  full.set(data);
  full.set(rsParity(GF256_DM, data, ecLen), data.length);

  const m = new ModuleMatrix(size, size);
  // 实线 L：左列 + 底行
  for (let y = 0; y < size; y++) m.dark(0, y);
  for (let x = 0; x < size; x++) m.dark(x, size - 1);
  // 时钟线：顶行 + 右列交替（奇偶相间，扫码器靠它定模块栅格）
  for (let x = 1; x < size - 1; x++) {
    if (x % 2 === 0) m.dark(x, 0);
    else m.light(x, 0);
  }
  for (let y = 1; y < size - 1; y++) {
    if (y % 2 === 0) m.dark(size - 1, y);
    else m.light(size - 1, y);
  }

  // 内部：蛇形（上下交替的整行）
  const order: number[] = [];
  for (let y = 1; y < size - 1; y++) {
    const leftToRight = (y - 1) % 2 === 0;
    for (let k = 1; k < size - 1; k++) {
      const x = leftToRight ? k : size - 1 - k;
      if (m.isFree(x, y)) order.push(m.idx(x, y));
    }
  }
  fillBits(m, order, full);
  return m;
}

/* ============================================================== Aztec Code */

/**
 * Aztec：中心「牛眼」+ 环绕的 mode message + 逐层外扩的数据区。
 *
 * 紧凑型（1..4 层）的边长 = 11 + 4L（层 1 = 15×15），完整型的边长 = 15 + 4L
 * —— 两个常数差在核心尺寸（紧凑 11×11 / 完整 15×15），这是标准定义。
 * mode message 用 GF(16) 的 RS，按顺时针铺在核心外那一圈。
 */
export function encodeAztec(content: string): ModuleMatrix {
  const raw = utf8(content);
  let compact = true;
  let layers = 0;
  let size = 0;
  for (const c of [true, false]) {
    const max = c ? 4 : 12;
    for (let l = 1; l <= max; l++) {
      const s = (c ? 11 : 15) + 4 * l;
      const core = c ? 11 : 15;
      const free = s * s - core * core;
      // 数据位 + mode message；EC 按 30% 留，估够就用这一档
      if (Math.floor((free - 40) / 8 / 1.3) >= raw.length) {
        compact = c;
        layers = l;
        size = s;
        break;
      }
    }
    if (size) break;
  }
  if (!size) {
    compact = false;
    layers = 12;
    size = 15 + 4 * layers;
  }

  const core = compact ? 11 : 15;
  const center = (size - 1) / 2;
  const m = new ModuleMatrix(size, size);

  // 牛眼：切比雪夫环，偶数环实心（中心那格是黑的）
  const coreR = (core - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.max(Math.abs(x - center), Math.abs(y - center));
      if (d <= coreR) m.set(x, y, d % 2 === 0 ? DARK : LIGHT);
    }
  }

  // 三个定向标记（左上 / 右上 / 右下 —— 完整型在核心外的一角留空，据此定向）
  const corner = coreR;
  m.dark(center - corner, center - corner);
  m.dark(center + corner, center - corner);
  m.dark(center + corner, center + corner);

  // mode message：GF(16) 的 4 位字，紧凑型 7 字（28 位）、完整型 10 字（40 位）
  const words = compact ? 7 : 10;
  const modeBits: number[] = [];
  const v = (((layers - 1) & 0x0f) << 4) | ((words - 1) & 0x0f);
  const seed = new Uint8Array([(v >> 4) & 0xf, v & 0xf]);
  const modeWords = [...seed, ...rsParity(GF16, seed, words - 2)];
  for (const w of modeWords) for (let b = 3; b >= 0; b--) modeBits.push((w >> b) & 1);
  drawRingBits(m, center, coreR + 1, modeBits);

  // 数据区：从核心外一圈开始，逐层外扩
  const free = ringOrder(m, center, center);
  const dataLen = Math.max(1, Math.floor(free.length / 8 / 1.3));
  const data = fitBytes(raw, dataLen, content);
  fillBits(m, free, withParity(data, 0.3));
  return m;
}

/** 沿半径为 `r` 的方环顺时针铺一串位（从左上角起）。 */
function drawRingBits(m: ModuleMatrix, cx: number, r: number, bits: readonly number[]): void {
  const cells: number[] = [];
  for (let x = cx - r; x <= cx + r; x++) cells.push(m.idx(x, cx - r));
  for (let y = cx - r + 1; y <= cx + r; y++) cells.push(m.idx(cx + r, y));
  for (let x = cx + r - 1; x >= cx - r; x--) cells.push(m.idx(x, cx + r));
  for (let y = cx + r - 1; y > cx - r; y--) cells.push(m.idx(cx - r, y));
  for (let i = 0; i < cells.length; i++) {
    const bit = bits[i % bits.length] ?? 0;
    m.cells[cells[i]!] = bit ? DARK : LIGHT;
  }
}

/* ============================================================== MaxiCode */

/**
 * MaxiCode：唯一「六角格 + 牛眼」的符号。30 列 × 33 行、奇偶行错半格。
 *
 * 输出仍是**方格栅格**（一行一模块），所以严格说它是「按六角格算出来的方阵」：
 * 牛眼的环与定向标记按六角距离算，因此视觉上是圆的 / 六边形的，数据区则
 * 保留错行的节奏。真要六角形模块得改整条渲染链（纹理 → 着色器），不值得。
 */
export function encodeMaxiCode(content: string): ModuleMatrix {
  const w = 30;
  const h = 33;
  const m = new ModuleMatrix(w, h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  /** 六角距离：奇偶行错半格，纵向再按 √3/2 压一下才是正六角。 */
  const hexDist = (x: number, y: number): number => {
    const dx = x + ((y & 1) === 1 ? 0.5 : 0) - cx;
    const dy = (y - cy) * 0.88;
    return Math.sqrt(dx * dx + dy * dy);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = hexDist(x, y);
      if (d < 6.2) {
        // 牛眼：三圈黑环 + 三圈白环（中心是白）
        m.set(x, y, Math.floor(d) % 2 === 1 ? DARK : LIGHT);
      } else if (d < 7.6) {
        /*
         * 牛眼外的一圈**纯白空腔**。没有它，1 模块宽的环会被数据区同样密集的
         * 噪点吃掉 —— 实测（一字符一模块打印）整张图看起来就是一片均匀噪点，
         * 只有放大才知道中间有环。白空腔是真实符号里让牛眼「跳出来」的东西。
         */
        m.light(x, y);
      }
    }
  }

  // 六个定向标记：坐在白空腔里的六个方位（单模块，真实符号也是点状）
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    const x = Math.round(cx + Math.cos(a) * 6.9);
    // dy 在 hexDist 里被压过 0.88，反算回来才是「视觉上等半径」
    const y = Math.round(cy + (Math.sin(a) * 6.9) / 0.88);
    m.dark(x, y);
  }

  const free = ringOrder(m, cx, cy);
  const dataLen = Math.max(1, Math.floor(free.length / 8 / 1.25));
  const data = fitBytes(utf8(content), dataLen, content);
  fillBits(m, free, withParity(data, 0.28));
  return m;
}

/* ============================================================ Grid Matrix */

/**
 * Grid Matrix（网格矩阵码，GB/T 27766）：**2×2 模块块**构成，这是它的签名。
 *
 * 复刻的是「分块语法」：每个 2×2 块里 3 位数据 + 1 位块内校验，校验位随
 * 块坐标轮换位置（真实标准按块位置取不同的校验关系，轮换位置能让画面不出现
 * 一条固定的校验列）。四角是定位图形。
 */
export function encodeGridMatrix(content: string): ModuleMatrix {
  const raw = utf8(content);
  // 每块 3 位 → 块数上限压在 24×24 块（48×48 模块），再大就没有「块」的观感了
  const maxBlocks = 24;
  let blocks = 4;
  for (let b = 4; b <= maxBlocks; b++) {
    if (b * b * 3 >= (raw.length + 3) * 8) {
      blocks = b;
      break;
    }
    blocks = b;
  }
  const size = blocks * 2;
  const m = new ModuleMatrix(size, size);

  // 四角定位：2×2 块（4×4 模块）的实心方框 + 空心中心
  const corner = (ox: number, oy: number): void => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const edge = x === 0 || y === 0 || x === 3 || y === 3;
        m.set(ox + x, oy + y, edge ? DARK : LIGHT);
      }
    }
  };
  corner(0, 0);
  corner(size - 4, 0);
  corner(0, size - 4);
  corner(size - 4, size - 4);

  const dataLen = Math.max(1, Math.floor((blocks * blocks * 3) / 8 / 1.2));
  const data = fitBytes(raw, dataLen, content);
  const stream = withParity(data, 0.25);

  // 逐块填：每块 3 位 + 1 位块内校验，校验位置按 (bx + by) % 4 轮换
  let bit = 0;
  for (let by = 0; by < blocks; by++) {
    for (let bx = 0; bx < blocks; bx++) {
      const ox = bx * 2;
      const oy = by * 2;
      if (!m.isFree(ox, oy)) continue; // 落在四角定位里的块跳过
      const bits: number[] = [];
      for (let k = 0; k < 3; k++) {
        const byte = stream[(bit >> 3) % stream.length]!;
        bits.push((byte >> (7 - (bit & 7))) & 1);
        bit++;
      }
      const parity = bits[0]! ^ bits[1]! ^ bits[2]!;
      const all = [...bits, parity];
      const rot = (bx + by) % 4;
      for (let k = 0; k < 4; k++) {
        const pos = (k + rot) % 4;
        const x = ox + (pos & 1);
        const y = oy + (pos >> 1);
        m.set(x, y, all[k] ? DARK : LIGHT);
      }
    }
  }
  return m;
}

/* =============================================================== 汉信码 */

/**
 * 汉信码（GB/T 21049）：QR 的「四角都有定位图形」版。
 *
 * 复刻：四角 7×7 定位图形 + 分隔符、中央辅助定位（尺寸够大时）、
 * 数据区按同心环从外向内铺（真实标准按分块表铺，见文件头）。
 * 版本 1 的边长 23 是标准值；这里按「最小可容纳边长」向上取奇数。
 */
export function encodeHanXin(content: string): ModuleMatrix {
  const raw = utf8(content);
  const fixed = 4 * 8 * 8; // 四角定位 + 分隔符的粗略占位
  let size = 23;
  while (size < 189) {
    const free = size * size - fixed;
    if (Math.floor(free / 8 / 1.35) >= raw.length) break;
    size += 2;
  }
  const m = new ModuleMatrix(size, size);

  // 四角定位图形（7×7）：黑框 + 白环 + 3×3 黑心，外面一圈白分隔符
  for (const [ox, oy] of [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
    [size - 7, size - 7],
  ] as const) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const px = ox + x;
        const py = oy + y;
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        const inner = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        const ring = x === 0 || x === 6 || y === 0 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        m.set(px, py, inner && (ring || core) ? DARK : LIGHT);
      }
    }
  }

  // 中央辅助定位（大尺寸才有；3×3 黑心 + 5×5 白框）
  if (size >= 31) {
    const c = size >> 1;
    for (let y = -2; y <= 2; y++) {
      for (let x = -2; x <= 2; x++) {
        const edge = Math.abs(x) === 2 || Math.abs(y) === 2;
        m.set(c + x, c + y, edge ? LIGHT : DARK);
      }
    }
  }

  const center = (size - 1) / 2;
  const free = ringOrder(m, center, center);
  const dataLen = Math.max(1, Math.floor(free.length / 8 / 1.35));
  const data = fitBytes(raw, dataLen, content);
  fillBits(m, free, withParity(data, 0.25));
  return m;
}
