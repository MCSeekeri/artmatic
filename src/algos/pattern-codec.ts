/**
 * pattern-codec.ts — 手绘位图参数的编解码（纯函数，零依赖）。
 *
 * ## 为什么要有它
 *
 * `ParamDef` 的 `pattern` 类型要把一张**手绘图案**存进
 * `AlgoSource.params: Record<string, number | string>`（`core/schema.ts`），
 * 而且这个字符串会经 `JSON.stringify` 进 `project.json`、进 bake Worker 的
 * `postMessage`、进缓存哈希。所以它必须满足三条：
 *
 * 1. **永不抛异常。** 它读的是磁盘上的工程文件 —— 手改过、被别的版本写过、
 *    截断过，都只能降级，不能把整个工程卡在打不开的状态。
 * 2. **自带尺寸。** 图案不是网格的附属：同一张 32×32 的图案要能盖到
 *    112×112 或 256×256 的模拟网格上（居中裁剪）。所以 `w`/`h` 编在串里。
 * 3. **跨环境逐位稳定。** 不用 `btoa`/`atob`（浏览器、Worker、Node 三处
 *    实现与容错口径都不同），自带一份 base64 —— 于是这个模块可以在
 *    vitest 里纯测，也可以在 Worker 里用。
 *
 * ## 格式
 *
 * ```
 * <w>x<h>:<base64>
 * ```
 *
 * 位流是**行主序、字节内高位在前**：位 `j` 取 `byte[j >> 3] >> (7 - (j & 7)) & 1`。
 *
 * 选 base64 而不是十六进制：同样的比特省 1/3 的字符。512×512 的上限下，
 * 最坏约 43 KB（十六进制会是 87 KB），对 `project.json` 是可接受的量级；
 * 常规手绘图案（≤64²）只有几百字节。
 */

/**
 * 位图上限。编辑器实际只用 8..64；上限 512 是给**从素材导入**留的 ——
 * 导入按模拟网格的分辨率采样（网格最大 512），512² 的位串约 43 KB base64，
 * 对 `project.json` 是可接受的量级。
 */
export const MAX_PATTERN_DIM = 512;

export interface Bitmap {
  w: number;
  h: number;
  /** 长度恒为 `w * h`，取值 0 / 1。 */
  data: Uint8Array;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV: Record<string, number> = {};
for (let i = 0; i < 64; i++) B64_INV[B64[i]!] = i;

/* ------------------------------------------------------------------ 构造 */

export function emptyBitmap(w: number, h: number): Bitmap {
  const ww = clampDim(w);
  const hh = clampDim(h);
  return { w: ww, h: hh, data: new Uint8Array(ww * hh) };
}

export function cloneBitmap(bm: Bitmap): Bitmap {
  return { w: bm.w, h: bm.h, data: bm.data.slice() };
}

/**
 * 从 ASCII 行构造位图（预设与单测用）。`.`, ` `, `-`, `0` 视为空，
 * 其余字符（`#`, `*`, `1`, `x`…）视为活。行**可以不等长** —— 按最长行补齐。
 */
export function bitmapFromRows(rows: readonly string[]): Bitmap {
  const h = Math.max(1, rows.length);
  let w = 1;
  for (const r of rows) w = Math.max(w, r.length);
  const bm = emptyBitmap(w, h);
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === '.' || ch === ' ' || ch === '-' || ch === '0') continue;
      bm.data[y * bm.w + x] = 1;
    }
  }
  return bm;
}

/** 反向：把位图渲染成 `#`/`.` 的文本行（单测与调试用）。 */
export function bitmapToRows(bm: Bitmap): string[] {
  const out: string[] = [];
  for (let y = 0; y < bm.h; y++) {
    let row = '';
    for (let x = 0; x < bm.w; x++) row += bm.data[y * bm.w + x] ? '#' : '.';
    out.push(row);
  }
  return out;
}

/** 把任意输入钳成 `[1, MAX_PATTERN_DIM]` 的整数。 */
function clampDim(n: number): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(MAX_PATTERN_DIM, v));
}

/* ------------------------------------------------------------------ 编码 */

export function encodePattern(bm: Bitmap): string {
  const w = clampDim(bm.w);
  const h = clampDim(bm.h);
  const nbits = w * h;
  const bytes = new Uint8Array((nbits + 7) >> 3);
  for (let j = 0; j < nbits; j++) {
    if (bm.data[j]) bytes[j >> 3]! |= 1 << (7 - (j & 7));
  }
  return `${w}x${h}:${b64encode(bytes)}`;
}

function b64encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1]! : 0;
    const b2 = has2 ? bytes[i + 2]! : 0;
    out += B64[b0 >> 2]!;
    out += B64[((b0 & 3) << 4) | (b1 >> 4)]!;
    out += has1 ? B64[((b1 & 15) << 2) | (b2 >> 6)]! : '=';
    out += has2 ? B64[b2 & 63]! : '=';
  }
  return out;
}

/* ------------------------------------------------------------------ 解码 */

const HEADER = /^(\d{1,5})x(\d{1,5}):([\s\S]*)$/;

/**
 * 解出位图；**结构非法一律返回 `null`，永不抛**。
 *
 * | 输入 | 结果 |
 * |---|---|
 * | `''` / `undefined` / `null` | `null` |
 * | 缺 `:` / 尺寸非数字 / 越界 | `null` |
 * | 全零载荷 | **合法**（全零位图，不是 `null`） |
 * | 载荷偏短 | 缺失的位补 0 |
 * | 载荷偏长 | 截断到 `w*h` |
 * | 含未知字符 / 换行 / 空格 | 跳过 |
 * | 含 `=` 填充 | 终止 |
 */
export function decodePattern(s: string | undefined | null): Bitmap | null {
  if (!s) return null;
  const m = HEADER.exec(s);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w >= 1 && w <= MAX_PATTERN_DIM && h >= 1 && h <= MAX_PATTERN_DIM)) return null;

  const bytes = b64decode(m[3]!);
  const total = w * h;
  const data = new Uint8Array(total);
  for (let j = 0; j < total; j++) {
    const bi = j >> 3;
    if (bi >= bytes.length) break; // 载荷不足：余下保持 0
    data[j] = (bytes[bi]! >> (7 - (j & 7))) & 1;
  }
  return { w, h, data };
}

function b64decode(payload: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of payload) {
    if (ch === '=') break; // 填充符终止
    if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') continue;
    const v = B64_INV[ch];
    if (v === undefined) continue; // 未知字符跳过
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/* ------------------------------------------------------------------ 变换 */

/** 活格数。 */
export function liveCount(bm: Bitmap): number {
  let n = 0;
  for (let i = 0; i < bm.data.length; i++) if (bm.data[i]) n++;
  return n;
}

export function invertBitmap(bm: Bitmap): Bitmap {
  const out = cloneBitmap(bm);
  for (let i = 0; i < out.data.length; i++) out.data[i] = out.data[i] ? 0 : 1;
  return out;
}

/**
 * 改尺寸：**左上角锚定**拷贝重叠区，新增区域留空。
 *
 * 左上角锚定（而不是居中）是刻意的：编辑器里改尺寸时，用户看到的画面
 * 应该「向右侧/下侧长出来」，而不是整张图突然位移半格 —— 后者会让人
 * 以为自己画的东西跑了。盖印到模拟网格时的居中是 `stampCentered` 的职责，
 * 两者互不干扰。
 */
export function resizeBitmap(bm: Bitmap, w: number, h: number): Bitmap {
  const ww = clampDim(w);
  const hh = clampDim(h);
  if (ww === bm.w && hh === bm.h) return cloneBitmap(bm);
  const out = emptyBitmap(ww, hh);
  const cw = Math.min(ww, bm.w);
  const ch = Math.min(hh, bm.h);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) out.data[y * ww + x] = bm.data[y * bm.w + x]!;
  }
  return out;
}

/** 用给定的 `[0,1)` 随机源撒点。随机源由调用方给 —— 语法上禁止裸 `Math.random()`（§1.2）。 */
export function randomBitmap(w: number, h: number, rng: () => number, density = 0.35): Bitmap {
  const bm = emptyBitmap(w, h);
  for (let i = 0; i < bm.data.length; i++) bm.data[i] = rng() < density ? 1 : 0;
  return bm;
}

/* ------------------------------------------------------------------ 盖印 */

/**
 * 泛型盖印：把「点亮第 i 个格」这件事交给调用方。
 *
 * 拆出泛型版的理由：图案要盖进的场不只有 `Uint8Array` 的 0/1 掩膜 ——
 * 反应扩散盖的是 `Float32Array` 的浓度场（掩膜处 `v=1, u=0.25`）、沙堆盖的是
 * `Uint32Array` 的高度场、Lenia 盖的是 `Float32Array` 的连续状态。
 * 没有它，每个生成器都要先盖一张 0/1 掩膜再映射一遍 —— 九处抄同一段算术。
 */
export function stampCenteredInto(
  gw: number,
  gh: number,
  bm: Bitmap,
  set: (index: number) => void,
): void {
  const ox = Math.floor((gw - bm.w) / 2);
  const oy = Math.floor((gh - bm.h) / 2);
  for (let y = 0; y < bm.h; y++) {
    const ty = oy + y;
    if (ty < 0 || ty >= gh) continue;
    const srcRow = y * bm.w;
    const dstRow = ty * gw;
    for (let x = 0; x < bm.w; x++) {
      if (!bm.data[srcRow + x]) continue;
      const tx = ox + x;
      if (tx < 0 || tx >= gw) continue;
      set(dstRow + tx);
    }
  }
}

/**
 * 把图案**居中**盖进 `gw × gh` 的网格，超出部分裁剪。
 *
 * 居中而不是左上角对齐：模拟网格通常远大于手绘图案（32×32 盖到 112×112），
 * 左上角对齐会让图案缩在角落，而且网格改尺寸时图案位置会漂。
 * 单元值写 `value`（默认 1），与 `createLife` 内部 0/1 的表示一致。
 */
export function stampCentered(
  grid: Uint8Array,
  gw: number,
  gh: number,
  bm: Bitmap,
  value = 1,
): void {
  stampCenteredInto(gw, gh, bm, (i) => {
    grid[i] = value;
  });
}

/** 泛型的单行盖印（一维 CA 的初始行）。`set` 收到的是**行内下标**。 */
export function stampRowInto(w: number, bm: Bitmap, set: (index: number) => void): void {
  const ox = Math.floor((w - bm.w) / 2);
  for (let x = 0; x < bm.w; x++) {
    if (!bm.data[x]) continue; // 第 0 行：索引就是 x
    const tx = ox + x;
    if (tx < 0 || tx >= w) continue;
    set(tx);
  }
}

/**
 * 一维元胞自动机的初始行：只取图案的**第 0 行**，居中裁剪进长度 `w` 的行。
 *
 * 不做垂直方向的处理 —— 「1D 图案」的语义就是「一行」，多出来的行是无意义的
 * 输入，忽略比报错好（它同样要经得起手改过的工程文件）。
 */
export function stampRow(row: Uint8Array, w: number, bm: Bitmap, value = 1): void {
  stampRowInto(w, bm, (i) => {
    row[i] = value;
  });
}

/* --------------------------------------------------- 给生成器用的便捷入口 */

/**
 * 把参数里的图案串解成位图；空串/坏串返回 `null`。
 *
 * 这一层存在的意义是「**永不抛**」这条纪律只写一遍：生成器里
 * `decodePattern(String(params.pattern ?? ''))` 直接调用即可，
 * 不需要各自判空、各自 try。
 */
export function patternFromParam(value: unknown): Bitmap | null {
  if (typeof value !== 'string') return null;
  return decodePattern(value);
}
