/**
 * sfnt.ts — 对字体文件的**极小**只读探测（不依赖 HarfBuzz）。
 *
 * 目前只回答一个问题：**这个字体有没有 `wght` 变量轴**。
 *
 * 为什么需要它：一本正经的静态字体被请求 700 时没有 700 字面，浏览器会
 * **合成粗体**（轮廓里没有那层加粗，转路径必须拒绝）；而变量字体虽然记录里
 * 只写「Regular」，却有 `wght` 轴 —— 那不是合成，按轴实例化就是真正的 700。
 * 两者在 `FontData.style` 上长得一样，只能看字节。
 *
 * 只解析 SFNT 表目录与 `fvar` 头（OpenType 规范），不做完整校验：拿到的是
 * 浏览器刚读出来的字体文件，损坏的概率可以忽略；越界一律当「没有」。
 */

const TAG_FVAR = 'fvar';
const TAG_WGHT = 'wght';

/** 四个字节当 ASCII tag（不用 TextDecoder：这里全都是 ASCII）。 */
function tagAt(u8: Uint8Array, p: number): string {
  return String.fromCharCode(u8[p]!, u8[p + 1]!, u8[p + 2]!, u8[p + 3]!);
}

/**
 * 字体文件是否有 `wght` 轴（变量字体）。
 *
 * 支持 TTC（`ttcf`）—— 取**第一个** face 的表目录。Local Font Access 实测给的是
 * 单 face SFNT，这里只是防御：真遇到集合时，第一个 face 的头表目录同样能反映
 * 「这个文件是不是变量字体」（同一文件里的 face 通常共享轴）。
 */
export function fontHasWeightAxis(bytes: ArrayBuffer): boolean {
  const u8 = new Uint8Array(bytes);
  if (u8.length < 12) return false;
  const dv = new DataView(bytes);

  let base = 0;
  if (tagAt(u8, 0) === 'ttcf') {
    if (u8.length < 16) return false;
    base = dv.getUint32(12);
    if (base + 12 > u8.length) return false;
  }

  const numTables = dv.getUint16(base + 4);
  for (let i = 0; i < numTables; i += 1) {
    const rec = base + 12 + i * 16;
    if (rec + 16 > u8.length) return false;
    if (tagAt(u8, rec) !== TAG_FVAR) continue;

    // fvar 头：major(2) minor(2) axesArrayOffset(2) reserved(2)
    //          axisCount(2) axisSize(2) instanceCount(2) instanceSize(2)
    const off = dv.getUint32(rec + 8);
    if (off + 16 > u8.length) return false;
    const axesArrayOffset = dv.getUint16(off + 4);
    const axisCount = dv.getUint16(off + 8);
    const axisSize = dv.getUint16(off + 10);
    if (axisSize < 20) return false;
    for (let a = 0; a < axisCount; a += 1) {
      const p = off + axesArrayOffset + a * axisSize;
      if (p + 4 > u8.length) return false;
      if (tagAt(u8, p) === TAG_WGHT) return true;
    }
    return false;
  }
  return false;
}
