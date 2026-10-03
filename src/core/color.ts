/**
 * color.ts — 颜色的纯函数工具（core 层：无 DOM / WebGL，可单测）。
 *
 * 从 `engine/sources.ts` 提到这里，因为三个地方要用同一份：源解析（solid
 * 贴图）、算法运行时的 tint、特效应 def 的 `setUniforms`。留一份实现在
 * engine 里会让 effects/algos 反过来为了一个十六进制解析去 import 整个
 * SourceManager。
 */

/** `#rrggbb` 或 `#rrggbbaa` → 0..255 的四分量。坏颜色返回品红（立刻可见）。 */
export function hexToRgba(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return [255, 0, 255, 255]; // 坏颜色画成品红，立刻可见
  const n = parseInt(m[1]!, 16);
  const a = m[2] ? parseInt(m[2], 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/** 同上，但归一化到 0..1 且丢掉 alpha —— vec3 uniform 要的形状。 */
export function colorVec3(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgba(hex);
  return [r / 255, g / 255, b / 255];
}
