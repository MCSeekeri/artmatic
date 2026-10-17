/**
 * ascii-charsets.ts — 「ASCII 字符画」的字符集预设与解析。
 *
 * 放在 `defs/` 与 `glsl/` 之外：两半都要用它（def 只需要选项值，glsl 要真的
 * 字符序列去栅格化），而「一个特效 = 两个文件」的 glob 配对不允许第三份
 * 定义表（多出来的文件会被注册表当成缺一半）。
 *
 * ## 为什么排序不在这里
 *
 * 字符的**面积占比**差得很远（`@` 与 `.` 差一个量级），按用户输入的顺序映射
 * 亮度会让画面忽明忽暗 —— 这正是「自定义字符集容易变乱」的原因。
 * 解法不是让人肉排字符，而是**按实测覆盖率排序**：`engine/glyph-atlas.ts`
 * 栅格化后量每个字形的 alpha 均值、升序摆放，于是着色器里
 * `index = 亮度 × 字形数` 天然是一条密度梯度。所以这里只管「有哪些字符」，
 * 不管「谁更密」。
 */

/** 预设字符集。key 与 `defs/ascii.ts` 的 select 选项值一一对应。 */
export const ASCII_CHARSETS: Record<string, string> = {
  /** 经典 @#%&* 序列（用户给的那套，去掉了重复的 `*`）。 */
  classic: "@#%&*+=-:.'\"",
  /** 线框：笔画类字符，暗处稀疏、亮处成框。 */
  line: '|-/_\\+[]{}()<>',
  /** 方块：从 1/8 块到全块，密度连续，最不挑亮度。 */
  block: '░▒▓█▉▊▋▌▍▎▏',
  /** 二值：只有两级，颗粒最硬。 */
  binary: '01',
};

/** 自定义字符的上限。图集里 96 格已经远超肉眼能分辨的阶调数。 */
export const MAX_CHARSET_LENGTH = 64;

/**
 * 参数 → 真正要栅格化的字符序列。
 *
 * 三条规则（都在 `compactChars` 里）：
 * 1. **去掉空白**：格子的「空」由覆盖率最低的字形承担。留着空格当字形的话，
 *    `0 1` 这种输入会变成三个字形（含空格），而用户想的是两个。
 * 2. **去重**：重复字符在图集里占两格、覆盖率还一样，只会浪费索引。
 * 3. **空串退回经典集**：自定义输入被清空时，画面不该变成一片纯色底。
 */
export function asciiCharsetText(values: Record<string, number | string>): string {
  const id = String(values.charset ?? 'classic');
  const raw =
    id === 'custom' ? String(values.custom ?? '') : (ASCII_CHARSETS[id] ?? ASCII_CHARSETS.classic!);
  return compactChars(raw);
}

export function compactChars(raw: string): string {
  const out: string[] = [];
  for (const ch of Array.from(raw)) {
    if (/\s/.test(ch)) continue;
    if (out.includes(ch)) continue;
    out.push(ch);
    if (out.length >= MAX_CHARSET_LENGTH) break;
  }
  return out.length > 0 ? out.join('') : ASCII_CHARSETS.classic!;
}
