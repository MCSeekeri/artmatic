/**
 * css-weight.ts — CSS Fonts 4 §5.2.2 的 weight 匹配（纯函数）。
 *
 * 注册字体（`FontRegistry.pickFace`）与本机字体（`local-fonts.ts` 的
 * `pickLocalFont`）用的是**同一条规则**：浏览器面对一族里缺某个字重时怎么挑，
 * 两边必须一致，否则「预览挑 700、转路径挑 400」会静默画出细一档的字。
 *
 * 抽成独立文件而不是留在 `font-registry.ts`：本机字体的匹配要在**不引入**
 * 字体注册表（及其 HarfBuzz 子集化依赖）的地方用，单测也不该为一个纯函数
 * 去加载 wasm。
 *
 * 摘要是：
 *
 *  - 400 → 先找 500，再找 < 400 里最大的，最后找 > 400 里最小的；
 *  - 500 → 先找 400，再找 < 400 里最大的，最后找 > 500 里最小的；
 *  - 其余 → 先找 ≤ 目标里最大的，再找 > 目标里最小的。
 */
export function pickCssWeight(desired: number, available: readonly number[]): number {
  const weights = [...new Set(available)].sort((a, b) => a - b);
  if (!weights.length) return desired;
  // 精确命中永远优先：下面那些「先找 500 / 先找 400」的规则只在**没有精确面**时生效。
  if (weights.includes(desired)) return desired;

  const below = (limit: number, inclusive: boolean): number | undefined =>
    weights.filter((w) => (inclusive ? w <= limit : w < limit)).pop();
  const above = (limit: number): number | undefined => weights.find((w) => w > limit);

  if (desired === 400) {
    return weights.includes(500) ? 500 : (below(400, false) ?? above(400) ?? weights[0]!);
  }
  if (desired === 500) {
    if (weights.includes(400)) return 400;
    return below(400, false) ?? above(500) ?? weights[0]!;
  }
  return below(desired, true) ?? above(desired) ?? weights[0]!;
}
