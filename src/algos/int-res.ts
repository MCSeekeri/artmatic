/**
 * int-res.ts — `intRes` 参数值 → `realtime` 生成器的**内部渲染尺寸**。
 *
 * 抽成纯函数是因为它在两处被读到（`AlgoRuntime.resolve` 的尺寸推导、单测），
 * 而**宽高比取自渲染目标**这件事本身就是一次修 bug：
 *
 * 旧写法是 `w = round(res * 16 / 9)` —— 竖屏（9:16）工程的 3D 会被按 16:9 渲染
 * 再 letterbox，画面里出现两条黑边，而参数面板上看不出任何异常。
 *
 * `auto` 的含义是「跟渲染目标一样大」：预览时渲染目标是画布后备缓冲（约 960×540），
 * 导出时是导出尺寸（1080p / 4K）。**这是 3D 画质的第一杠杆** —— 固定 480 行时
 * 1080p 导出等于把每个着色器像素铺成 2.25×2.25 个设备像素，阴影与高光做得再好
 * 都在这一步被抹掉。
 */

/** 内部渲染高度的上下界。上界是「4K 导出也不无限加价」的唯一约束。 */
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 1440;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * @param v       `intRes` 参数的原始值（`'auto'` 或 `'240'` / `'480'` / `'720'` / `'1080'`）
 * @param renderW 渲染目标宽（`kit.w`）
 * @param renderH 渲染目标高（`kit.h`）
 */
export function intResSize(v: string, renderW: number, renderH: number): { w: number; h: number } {
  // 渲染目标还没量出来时按 16:9 兜底（首帧 / 尺寸同步之前）
  const aspect = renderW > 0 && renderH > 0 ? renderW / renderH : 16 / 9;
  const asked = v === 'auto' ? Math.round(renderH) : Number(v);
  const h = clamp(Number.isFinite(asked) && asked > 0 ? asked : 480, MIN_HEIGHT, MAX_HEIGHT);
  return { w: Math.max(2, Math.round(h * aspect)), h };
}
