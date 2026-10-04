/**
 * bitmask.ts — 位掩码的纯工具。
 *
 * 存在的理由：`ParamDef` 里新加的 `bitmask` 类型需要一套「位号 → 行」的
 * 映射规则，而**两个消费方必须完全一致** —— 位表编辑器（`ui/controls/`）
 * 与读这个值的生成器（`algos/rule110.ts`、`algos/game-of-life.ts`）。
 * 各写一份的下场是「界面上点亮的位与 shader 里生效的规则不是同一个」，
 * 而且看不出错。
 *
 * 放在 `core/` 而不是 `algos/`：`core/` 不依赖任何东西，`effects/types.ts`
 * 是它的下游；反过来 import 会形成 `core → effects` 的倒挂。
 * 所以这里只收**结构类型**（位宽 + 画法），不收 i18n 文案键。
 */

/** 位分组的结构视图：与 `effects/types.ts` 的 `BitmaskGroup` 同形，但不含文案键。 */
export interface BitGroupShape {
  bits: number;
  style: 'eca' | 'count';
}

/** 位表里的一行。`bit` 是**全局位号**，LSB = 0。 */
export interface BitRow {
  /** 归属的分组下标。 */
  group: number;
  /** 该组内第几个格子（`'count'` 时就是邻居数）。 */
  indexInGroup: number;
  /** 全局位号（`value >> bit & 1`）。 */
  bit: number;
}

/**
 * 把分组展开成**显示顺序**的行表。
 *
 * 两种顺序是刻意的，不是随便定的：
 * - `'eca'`   **高位在前**。规则号的二进制写法就是把 111 那一行放最上面，
 *             `Rule 30 = 00011110₂` 的意思正是「111→0, 110→0, …, 000→0」。
 * - `'count'` **低位在前**。B/S 表读作「0 个邻居 / 1 个邻居 / …」。
 *             18 位掩码里出生占低 9 位、存活占高 9 位（见 `masksFromBS`）。
 */
export function bitRows(groups: readonly BitGroupShape[]): BitRow[] {
  const rows: BitRow[] = [];
  let base = 0;
  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g]!;
    const bits = Math.max(0, Math.floor(grp.bits));
    if (grp.style === 'eca') {
      for (let i = 0; i < bits; i++) rows.push({ group: g, indexInGroup: i, bit: base + (bits - 1 - i) });
    } else {
      for (let i = 0; i < bits; i++) rows.push({ group: g, indexInGroup: i, bit: base + i });
    }
    base += bits;
  }
  return rows;
}

export function totalBits(groups: readonly BitGroupShape[]): number {
  let n = 0;
  for (const g of groups) n += Math.max(0, Math.floor(g.bits));
  return n;
}

/** 掩码的合法上界（含）。`2^bits - 1`；bits 为 0 时返回 0。 */
export function maskMax(bits: number): number {
  const b = Math.max(0, Math.min(31, Math.floor(bits)));
  return b === 0 ? 0 : (2 ** b - 1) >>> 0;
}

/** 把任意输入钳成 `[0, maskMax(bits)]` 内的整数。非法输入（NaN 等）落 0。 */
export function clampMask(value: unknown, bits: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(maskMax(bits), n));
}

export function getBit(mask: number, bit: number): number {
  return (mask >> bit) & 1;
}

/** 翻转某一位，并钳回合法范围。 */
export function toggleBit(mask: number, bit: number, bits: number): number {
  if (bit < 0 || bit >= bits) return clampMask(mask, bits);
  return clampMask(mask ^ (1 << bit), bits);
}

export function setBit(mask: number, bit: number, on: boolean, bits: number): number {
  if (bit < 0 || bit >= bits) return clampMask(mask, bits);
  const next = on ? mask | (1 << bit) : mask & ~(1 << bit);
  return clampMask(next, bits);
}

/** 把掩码展开成 `[bit0, bit1, …]` 的 0/1 数组（长度 = bits）。 */
export function maskToBools(mask: number, bits: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < bits; i++) out.push(getBit(mask, i));
  return out;
}

export function boolsToMask(bools: readonly (number | boolean)[], bits: number): number {
  let mask = 0;
  for (let i = 0; i < bits && i < bools.length; i++) if (bools[i]) mask |= 1 << i;
  return clampMask(mask, bits);
}

/* ------------------------------------------------------- 生命类 CA 的 B/S */

/**
 * 生命类 CA 的规则打包：**出生占低 9 位（bit0..8 = 邻居数 0..8），
 * 存活占高 9 位（bit9..17）**，合计 18 位。
 *
 * 选这个顺序是为了让 `bitRows` 的 `'count'` 顺序（低位在前）直接给出
 * 「B0,B1,…B8,S0,S1,…S8」的阅读顺序 —— 与 B/S 记法的书写顺序一致。
 */
export const LIFE_BITS = 18;

export function masksFromBS(birth: number, survive: number): number {
  return ((Math.floor(birth) & 0x1ff) | ((Math.floor(survive) & 0x1ff) << 9)) >>> 0;
}

export function birthFromMask(mask: number): number {
  return clampMask(mask, LIFE_BITS) & 0x1ff;
}

export function surviveFromMask(mask: number): number {
  return (clampMask(mask, LIFE_BITS) >> 9) & 0x1ff;
}

/** 把 `B3/S23` 这样的记法解析成掩码；解析不了返回 `fallback`。 */
export function parseBS(text: string, fallback = 0): number {
  const m = /^\s*B([0-8]*)\s*\/\s*S([0-8]*)\s*$/i.exec(text);
  if (!m) return fallback;
  const digits = (s: string): number => {
    let mask = 0;
    for (const ch of s) mask |= 1 << Number(ch);
    return mask;
  };
  return masksFromBS(digits(m[1]!), digits(m[2]!));
}
