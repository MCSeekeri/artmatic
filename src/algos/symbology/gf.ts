/**
 * gf.ts — GF(2^m) 的指数/对数表与 Reed–Solomon 编码。
 *
 * 七种机器可读符号里有六种靠 RS 纠错（一维条形码没有），而它们用的域不同：
 * QR / Data Matrix / 汉信码走 GF(256)（本原多项式 0x11d / 0x12d），
 * Aztec 的层数决定 6/8/10/12 位码字（GF(64)/GF(256)…），
 * MaxiCode 用 GF(64)（0x43）。所以这里**只有一份**实现，参数化本原多项式 ——
 * 每个符号各抄一份的话，抄错哪个域不会有任何报错，只是纠错码全错（图还很好看）。
 *
 * 纯函数、无 DOM / WebGL：`tests/unit/symbology.test.ts` 直接打这里。
 */

export interface GaloisField {
  /** 2^m */
  readonly size: number;
  /** 长度 2*size-1：`exp[i]` = α^i（循环复用，避免取模） */
  readonly exp: Uint16Array;
  /** 长度 size：`log[v]` = i 使 α^i = v（`log[0]` 无定义，写 -1） */
  readonly log: Int16Array;
  mul(a: number, b: number): number;
  div(a: number, b: number): number;
}

/**
 * 造一个域。`prim` 是本原多项式的位模式（含最高位），如 GF(256) 的 0x11d。
 *
 * 生成方式是最朴素的「α 的幂 + 溢出时异或本原多项式」，与标准附件里的表逐项相同。
 */
export function galoisField(prim: number, m: number): GaloisField {
  const size = 1 << m;
  const exp = new Uint16Array(size * 2 - 1);
  const log = new Int16Array(size).fill(-1);
  let x = 1;
  for (let i = 0; i < size - 1; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x >= size) x ^= prim;
  }
  // 后半段是前半段的循环复用：mul 里就不用对 (size-1) 取模，省掉一次除法
  for (let i = size - 1; i < size * 2 - 1; i++) exp[i] = exp[i - (size - 1)]!;

  return {
    size,
    exp,
    log,
    mul(a: number, b: number): number {
      if (a === 0 || b === 0) return 0;
      return exp[log[a]! + log[b]!]!;
    },
    div(a: number, b: number): number {
      // 英文消息：这是开发诊断，不是给用户看的文案（i18n 守卫会拦中文字面量）
      if (b === 0) throw new Error('GF division by zero');
      if (a === 0) return 0;
      return exp[log[a]! - log[b]! + (size - 1)]!;
    },
  };
}

/**
 * 常用域（每个符号用哪个都写在它自己文件里，不要在这里加第三份）。
 *
 * ⚠️ **域的尺寸必须与码字的取值范围匹配。** 拿 GF(64) 去算 8 位数据字节会读到
 * `log[200]`（越界 → `undefined`）→ 乘法得 NaN → 异或把它当 0 ⇒ 纠错码字整段
 * 归零，而图案看起来仍然是一张正常的码。实测踩过：MaxiCode 的数据区尾巴整行
 * 全白。所以这里的三个域都按「**码字宽度与域尺寸一致**」使用：
 * 8 位码字用 GF(256)，4 位（Aztec 的 mode message）用 GF(16)。
 */
export const GF256_QR = galoisField(0x11d, 8);
export const GF256_DM = galoisField(0x12d, 8);
export const GF16 = galoisField(0x13, 4);

/**
 * 生成多项式 `Π(x − α^i)`（i = 0 .. degree-1），系数**从高次到常数**，首项恒为 1。
 *
 * 返回长度是 `degree + 1`。
 */
export function rsGeneratorPolynomial(gf: GaloisField, degree: number): Uint8Array {
  let poly = Uint8Array.of(1);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    // 乘 (x − α^i) = 乘 (x + α^i)：GF(2^m) 里加减都是异或
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]!;
      next[j + 1] ^= gf.mul(poly[j]!, gf.exp[i]!);
    }
    poly = next;
  }
  return poly;
}

/**
 * 算 `degree` 个纠错码字（移位寄存器法，与「除 xn−k·d(x) 取余」等价）。
 *
 * 输入是**数据码字**（每项 0..gf.size-1），输出长度 = `degree`。
 */
export function rsParity(gf: GaloisField, data: ArrayLike<number>, degree: number): Uint8Array {
  if (degree <= 0) return new Uint8Array(0);
  const gen = rsGeneratorPolynomial(gf, degree);
  const res = new Uint8Array(degree);
  for (let i = 0; i < data.length; i++) {
    const factor = (data[i]! ^ res[0]!) & 0xff;
    res.copyWithin(0, 1);
    res[degree - 1] = 0;
    if (factor === 0) continue;
    for (let j = 0; j < degree; j++) res[j] ^= gf.mul(gen[j + 1]!, factor);
  }
  return res;
}
