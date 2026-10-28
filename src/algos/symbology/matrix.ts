/**
 * matrix.ts — 模块矩阵（符号图案的公共画布）。
 *
 * 七种符号的输出都是「w × h 个模块，每个模块黑或白」。三者（QR / Data Matrix /
 * Aztec）的差别全在**固定图形放哪、数据往哪填**，所以画布只做一件事：
 * 记住哪些格子已经被固定图形占了（`LIGHT` / `DARK`），剩下的 `FREE` 才是数据区。
 *
 * 为什么用一字节一格的 `Uint8Array` 而不是 `boolean[]`：这条路径的产物最终是
 * R8 纹理的字节，`toBytes()` 直接就是它，中间不再有第二份表示。
 */

export const FREE = 0;
export const DARK = 1;
export const LIGHT = 2;

export class ModuleMatrix {
  readonly cells: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = new Uint8Array(w * h);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  /** 取格值（`FREE` / `DARK` / `LIGHT`）；越界按「已占的白」处理。 */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return LIGHT;
    return this.cells[y * this.w + x]!;
  }

  set(x: number, y: number, v: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.cells[y * this.w + x] = v;
  }

  dark(x: number, y: number): void {
    this.set(x, y, DARK);
  }

  light(x: number, y: number): void {
    this.set(x, y, LIGHT);
  }

  isFree(x: number, y: number): boolean {
    return this.get(x, y) === FREE;
  }

  /** 输出 R8 字节：暗 = 255、白 = 0。`FREE` 不会被读到这里（调用方应填满）。 */
  toBytes(): Uint8Array {
    const out = new Uint8Array(this.cells.length);
    for (let i = 0; i < out.length; i++) out[i] = this.cells[i] === DARK ? 255 : 0;
    return out;
  }
}

/**
 * 把字节流按 MSB 顺序铺到 `order` 给出的格子序列上。
 *
 * 两种用途共用一份实现：
 * - **标准编码**（QR）自带精确的码字与掩码，`order` 就是标准的之字形路径；
 * - **结构复刻**（Aztec / MaxiCode / Grid Matrix / 汉信码）只需要「数据区的密度与
 *   噪声感」，`order` 是同心环或 2×2 块序。
 *
 * 铺不满时循环取字节（`pad` 已经按内容哈希撒过一遍，所以尾巴不会出现大片纯色）。
 */
export function fillBits(m: ModuleMatrix, order: readonly number[], bytes: Uint8Array): void {
  if (bytes.length === 0) return;
  let bit = 0;
  for (const cell of order) {
    const b = bytes[(bit >> 3) % bytes.length]!;
    const v = (b >> (7 - (bit & 7))) & 1;
    m.cells[cell] = v ? DARK : LIGHT;
    bit++;
  }
}

/**
 * 把内容哈希成一段**确定性的填充字节**（结构复刻类符号的数据区用）。
 *
 * 不走裸 `Math.random()`（硬约束 1.2）：同一个输入在任何机器、任何运行次数下
 * 得到同一张图，否则「同一 t 两渲不同」会像幽灵一样出现。
 */
export function padFor(seedText: string, len: number): Uint8Array {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = new Uint8Array(len);
  let a = h >>> 0;
  for (let i = 0; i < len; i++) {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = (t ^ (t >>> 14)) & 0xff;
  }
  return out;
}
