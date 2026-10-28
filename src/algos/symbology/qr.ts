/**
 * qr.ts — QR Code（ISO/IEC 18004）**完整编码**：byte 模式、版本 1..40、L/M/Q/H。
 *
 * ## 为什么只有这一种符号是「完整编码」
 *
 * 七种机器可读符号里，只有 QR 与 Code 128 在这里做到「扫得出来」。理由不是难度，
 * 而是**可验证性**：这两者能用公开参考实现逐位对拍（`tests/unit/symbology.test.ts`
 * 拿 `kazuhikoarase/qrcode-generator` 算出的整幅矩阵做金标），其余五种我没有
 * 一枚可信的参考实现可比，所以它们只做「结构复刻」（见 `structural.ts` 文件头）。
 * 这条边界是刻意的：**宁可少承诺，不要交一张看着像、扫不出来的码**。
 *
 * ## 与上游的关系
 *
 * 结构与判据（掩码惩罚、格式信息布局、之字形铺码）逐条对齐
 * `qrcode-generator`（MIT，见 `CREDITS.md` §二），于是整幅矩阵能与它**逐位相同**。
 * 表数据是脚本从上游提取的（`qr-tables.ts` 文件头有说明）。
 *
 * ## 三条自己踩出来的口径
 *
 * 1. **`null` / `false` / `true` 三态是必须的**：`null` = 还没被占（数据区），
 *    `false` = 明确的空模块（定位图形的分隔符）。把分隔符写成 `null`，之字形
 *    铺码会往里写数据，格式信息就会错位 —— 而且看起来仍然像一张二维码。
 * 2. **掩码是「按惩罚分挑」，不是随便挑**：同内容同参数下换掩码仍然扫得出来，
 *    但画面会变，缩略图/金标会漂。所以这里复刻上游的 `getLostPoint`。
 * 3. **版本 ≥ 7 才有版本信息区**：少写它扫码器靠试错还能过，但金标会对不上。
 */

import { GF256_QR, rsParity } from './gf';
import { DARK, LIGHT, ModuleMatrix } from './matrix';
import { QR_PATTERN_POSITIONS, QR_RS_BLOCKS } from './qr-tables';

export type QrEcLevel = 'L' | 'M' | 'Q' | 'H';

/** 纠错级在**表格里的行序**（L / M / Q / H）—— `qr-tables.ts` 的表就是按这个排的。 */
const EC_INDEX: Record<QrEcLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };

/**
 * 纠错级在**格式信息那几个位**里的取值。⚠️ **与行序不同**：
 * 标准给的编码是 L=01 / M=00 / Q=11 / H=10，也就是 L=1 / M=0 / Q=3 / H=2。
 *
 * 这两套编号混用的后果：图仍然结构完整、掩码惩罚也照常算，只是**格式信息错**，
 * 扫码器读到的纠错级是错的 —— 首版就是这么错的（16 个格子全差：15 位格式 + 1 个
 * 固定黑模块）。单测抓不到「看起来像二维码」，只能靠与参考实现逐位对拍。
 */
const EC_FORMAT_BITS: Record<QrEcLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

export interface QrResult {
  matrix: ModuleMatrix;
  /** 实际用到的版本（1..40）。工具面 / 测试用它判断容量。 */
  version: number;
  /** 实际选中的掩码 0..7。 */
  mask: number;
  /** 内容被截断过（超过版本 40 的容量时的兜底）。 */
  truncated: boolean;
}

interface RsBlock {
  total: number;
  data: number;
}

function rsBlocks(version: number, level: QrEcLevel): RsBlock[] {
  const row = QR_RS_BLOCKS[(version - 1) * 4 + EC_INDEX[level]]!;
  const out: RsBlock[] = [];
  for (let i = 0; i + 2 < row.length; i += 3) {
    const count = row[i]!;
    const total = row[i + 1]!;
    const data = row[i + 2]!;
    for (let j = 0; j < count; j++) out.push({ total, data });
  }
  return out;
}

/** byte 模式的字符计数位宽（版本 1..9 是 8 位，之后 16 位）。 */
function countBits(version: number): number {
  return version < 10 ? 8 : 16;
}

/** UTF-8 字节（不用 `Buffer`：Worker / 浏览器 / Node 三处要一致）。 */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/* ------------------------------------------------------------ 位流 */

class BitBuffer {
  readonly bits: number[] = [];

  put(value: number, len: number): void {
    for (let i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i]) out[i >> 3] |= 0x80 >> (i & 7);
    }
    return out;
  }
}

/* --------------------------------------------------------- 数据码字 */

/**
 * 把内容编成**最终要铺进矩阵的码字序列**（已分块、已纠错、已交织）。
 *
 * `version` 传 0 表示「按容量自动挑最小版本」。
 */
export function qrCodewords(
  content: string,
  level: QrEcLevel,
  version = 0,
): { codewords: Uint8Array; version: number; truncated: boolean } {
  let payload = utf8(content);
  let used = -1;
  let blocks: RsBlock[] = [];
  let truncated = false;

  const first = Math.max(1, Math.min(40, version || 1));
  for (let v = first; v <= 40; v++) {
    const rb = rsBlocks(v, level);
    const totalData = rb.reduce((s, b) => s + b.data, 0);
    const need = 4 + countBits(v) + payload.length * 8;
    // 版本 < 10 时字符计数只有 8 位：长度超过 255 必须至少用到版本 10
    if (payload.length < 1 << countBits(v) && need <= totalData * 8) {
      used = v;
      blocks = rb;
      break;
    }
  }

  if (used < 0) {
    // 装不下：按版本 40 的容量硬截（静默失败更坏 —— 调用方拿 truncated 能读到）
    used = 40;
    blocks = rsBlocks(40, level);
    const totalData = blocks.reduce((s, b) => s + b.data, 0);
    const room = Math.max(0, Math.floor((totalData * 8 - 4 - countBits(40)) / 8));
    payload = payload.subarray(0, room);
    truncated = payload.length < utf8(content).length;
  }

  const totalData = blocks.reduce((s, b) => s + b.data, 0);
  const buffer = new BitBuffer();
  buffer.put(0b0100, 4); // byte 模式
  buffer.put(payload.length, countBits(used));
  for (const b of payload) buffer.put(b, 8);
  if (buffer.length + 4 <= totalData * 8) buffer.put(0, 4); // 终止符
  while (buffer.length % 8 !== 0) buffer.put(0, 1);

  const data = new Uint8Array(totalData);
  const head = buffer.toBytes();
  data.set(head.subarray(0, Math.min(head.length, totalData)));
  // 交替填充字节 0xEC / 0x11（标准附件里的 PAD0 / PAD1）
  for (let i = head.length, k = 0; i < totalData; i++, k++) data[i] = k % 2 === 0 ? 0xec : 0x11;

  // 分块纠错
  const ecPerBlock = blocks[0]!.total - blocks[0]!.data;
  const ecChunks: Uint8Array[] = [];
  const dataChunks: Uint8Array[] = [];
  let offset = 0;
  for (const b of blocks) {
    const chunk = data.subarray(offset, offset + b.data);
    dataChunks.push(chunk);
    ecChunks.push(rsParity(GF256_QR, chunk, ecPerBlock));
    offset += b.data;
  }

  // 交织：先按列取数据码字，再按列取纠错码字
  const out = new Uint8Array(blocks.reduce((s, b) => s + b.total, 0));
  let p = 0;
  const maxData = Math.max(...blocks.map((b) => b.data));
  for (let i = 0; i < maxData; i++) {
    for (const chunk of dataChunks) if (i < chunk.length) out[p++] = chunk[i]!;
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const chunk of ecChunks) if (i < chunk.length) out[p++] = chunk[i]!;
  }
  return { codewords: out, version: used, truncated };
}

/* ------------------------------------------------------------- 矩阵 */

const G15 = 0b10100110111;
const G18 = 0b1111100100101;
const G15_MASK = 0b101010000010010;

function bchDigit(v: number): number {
  let d = 0;
  while (v !== 0) {
    d++;
    v >>>= 1;
  }
  return d;
}

function bchTypeInfo(value: number): number {
  let d = value << 10;
  while (bchDigit(d) - bchDigit(G15) >= 0) d ^= G15 << (bchDigit(d) - bchDigit(G15));
  return ((value << 10) | d) ^ G15_MASK;
}

function bchTypeNumber(value: number): number {
  let d = value << 12;
  while (bchDigit(d) - bchDigit(G18) >= 0) d ^= G18 << (bchDigit(d) - bchDigit(G18));
  return (value << 12) | d;
}

/** 掩码条件（i = 行，j = 列），与标准 0..7 同序。 */
export function maskBit(pattern: number, i: number, j: number): boolean {
  switch (pattern) {
    case 0:
      return (i + j) % 2 === 0;
    case 1:
      return i % 2 === 0;
    case 2:
      return j % 3 === 0;
    case 3:
      return (i + j) % 3 === 0;
    case 4:
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5:
      return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6:
      return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    default:
      return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
  }
}

interface Grid {
  size: number;
  /** 0 = 还没被占（数据区）；1 = 白；2 = 黑。 */
  v: Uint8Array;
}

function probePattern(g: Grid, row: number, col: number): void {
  const { size } = g;
  for (let r = -1; r <= 7; r++) {
    if (row + r <= -1 || size <= row + r) continue;
    for (let c = -1; c <= 7; c++) {
      if (col + c <= -1 || size <= col + c) continue;
      const on =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      g.v[(row + r) * size + col + c] = on ? 2 : 1;
    }
  }
}

function alignmentPattern(g: Grid, version: number): void {
  const pos = QR_PATTERN_POSITIONS[version - 1] ?? [];
  for (const row of pos) {
    for (const col of pos) {
      if (g.v[row * g.size + col] !== 0) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const on = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          g.v[(row + r) * g.size + col + c] = on ? 2 : 1;
        }
      }
    }
  }
}

function timingPattern(g: Grid): void {
  const { size } = g;
  for (let r = 8; r < size - 8; r++) {
    if (g.v[r * size + 6] !== 0) continue;
    g.v[r * size + 6] = r % 2 === 0 ? 2 : 1;
  }
  for (let c = 8; c < size - 8; c++) {
    if (g.v[6 * size + c] !== 0) continue;
    g.v[6 * size + c] = c % 2 === 0 ? 2 : 1;
  }
}

function typeInfo(g: Grid, level: QrEcLevel, mask: number, test: boolean): void {
  const { size } = g;
  const bits = bchTypeInfo((EC_FORMAT_BITS[level] << 3) | mask);
  for (let i = 0; i < 15; i++) {
    const on = !test && ((bits >> i) & 1) === 1;
    // 竖排（左上角向下 + 左下角向上）
    if (i < 6) g.v[i * size + 8] = on ? 2 : 1;
    else if (i < 8) g.v[(i + 1) * size + 8] = on ? 2 : 1;
    else g.v[(size - 15 + i) * size + 8] = on ? 2 : 1;
    // 横排（右上角向左 + 左上角向右）
    if (i < 8) g.v[8 * size + size - i - 1] = on ? 2 : 1;
    else if (i < 9) g.v[8 * size + 15 - i] = on ? 2 : 1;
    else g.v[8 * size + 15 - i - 1] = on ? 2 : 1;
  }
  // 固定的黑模块
  g.v[(size - 8) * size + 8] = !test ? 2 : 1;
}

function typeNumber(g: Grid, version: number, test: boolean): void {
  const { size } = g;
  const bits = bchTypeNumber(version);
  for (let i = 0; i < 18; i++) {
    const on = !test && ((bits >> i) & 1) === 1;
    g.v[Math.floor(i / 3) * size + (i % 3) + size - 11] = on ? 2 : 1;
    g.v[((i % 3) + size - 11) * size + Math.floor(i / 3)] = on ? 2 : 1;
  }
}

/** 之字形铺码：从右下角起、每两列一组、上下交替。 */
function mapData(g: Grid, data: Uint8Array, mask: number): void {
  const { size } = g;
  let inc = -1;
  let row = size - 1;
  let bitIndex = 7;
  let byteIndex = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1; // 第 6 列是定时图形，整列跳过
    for (;;) {
      for (let c = 0; c < 2; c++) {
        const idx = row * size + col - c;
        if (g.v[idx] !== 0) continue;
        let on = byteIndex < data.length ? ((data[byteIndex]! >>> bitIndex) & 1) === 1 : false;
        if (maskBit(mask, row, col - c)) on = !on;
        g.v[idx] = on ? 2 : 1;
        bitIndex--;
        if (bitIndex === -1) {
          byteIndex++;
          bitIndex = 7;
        }
      }
      row += inc;
      if (row < 0 || size <= row) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }
}

function buildGrid(
  version: number,
  level: QrEcLevel,
  mask: number,
  data: Uint8Array,
  test: boolean,
): Grid {
  const size = version * 4 + 17;
  const g: Grid = { size, v: new Uint8Array(size * size) };
  probePattern(g, 0, 0);
  probePattern(g, size - 7, 0);
  probePattern(g, 0, size - 7);
  alignmentPattern(g, version);
  timingPattern(g);
  typeInfo(g, level, mask, test);
  if (version >= 7) typeNumber(g, version, test);
  mapData(g, data, mask);
  return g;
}

/** 掩码惩罚分（与上游 `getLostPoint` 同口径）。 */
export function lostPoint(g: Grid): number {
  const { size, v } = g;
  const at = (r: number, c: number): boolean => v[r * size + c] === 2;
  let point = 0;

  // 1. 与邻域同色的模块数（3×3 内同色超过 5 个开始罚）
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let same = 0;
      const dark = at(row, col);
      for (let r = -1; r <= 1; r++) {
        if (row + r < 0 || row + r >= size) continue;
        for (let c = -1; c <= 1; c++) {
          if (col + c < 0 || col + c >= size) continue;
          if (r === 0 && c === 0) continue;
          if (dark === at(row + r, col + c)) same++;
        }
      }
      if (same > 5) point += 3 + same - 5;
    }
  }

  // 2. 2×2 的同色块
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      let count = 0;
      if (at(row, col)) count++;
      if (at(row + 1, col)) count++;
      if (at(row, col + 1)) count++;
      if (at(row + 1, col + 1)) count++;
      if (count === 0 || count === 4) point += 3;
    }
  }

  // 3. 形如 1:1:3:1:1 的伪定位图形
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size - 6; col++) {
      if (
        at(row, col) &&
        !at(row, col + 1) &&
        at(row, col + 2) &&
        at(row, col + 3) &&
        at(row, col + 4) &&
        !at(row, col + 5) &&
        at(row, col + 6)
      ) {
        point += 40;
      }
    }
  }
  for (let col = 0; col < size; col++) {
    for (let row = 0; row < size - 6; row++) {
      if (
        at(row, col) &&
        !at(row + 1, col) &&
        at(row + 2, col) &&
        at(row + 3, col) &&
        at(row + 4, col) &&
        !at(row + 5, col) &&
        at(row + 6, col)
      ) {
        point += 40;
      }
    }
  }

  // 4. 黑白比例偏离 50%
  let dark = 0;
  for (let i = 0; i < v.length; i++) if (v[i] === 2) dark++;
  point += (Math.abs((100 * dark) / size / size - 50) / 5) * 10;
  return point;
}

/** 编码成模块矩阵（**不含**静区 —— 静区由调用方按参数加）。 */
export function encodeQr(content: string, level: QrEcLevel = 'M'): QrResult {
  const { codewords, version, truncated } = qrCodewords(content, level);

  let bestMask = 0;
  let bestPoint = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const p = lostPoint(buildGrid(version, level, mask, codewords, true));
    if (p < bestPoint) {
      bestPoint = p;
      bestMask = mask;
    }
  }

  const g = buildGrid(version, level, bestMask, codewords, false);
  const m = new ModuleMatrix(g.size, g.size);
  for (let i = 0; i < g.v.length; i++) {
    // 铺完之后不该还有未定格；真有就按白处理，避免出现「一格透明」
    if (g.v[i] === 2) m.cells[i] = DARK;
    else m.cells[i] = LIGHT;
  }
  return { matrix: m, version, mask: bestMask, truncated };
}
