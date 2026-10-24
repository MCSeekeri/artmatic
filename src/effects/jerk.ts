/**
 * jerk.ts — 「抽动」位移：分段常量的突变位移（画面滚卷一类特效用）。
 *
 * 语义：位置每隔 `1/rate` 秒**突然换一个**，刻度之内纹丝不动。特效自己照常算
 * 平滑滚动的相位，把这个量当常数叠上去 —— 于是画面在刻度内平滑滚动，在刻度
 * 边界瞬间跳到别处。幅度被 `amount` 夹死（±amount，单位是「整幅」），所以
 * 位置永远只偏离平滑滚动位置 `amount` 以内：调小 = 像放映机卡了一格，
 * 调大 = 满屏乱跳。
 *
 * ## 为什么在 JS 侧算，而不是写进 fragment
 *
 * - **可单测**（`tests/unit/jerk-offset.test.ts`）。写进 fragment 就只能靠 E2E
 *   读像素，「幅度有没有被夹住」「刻度内是否真的恒定」这类不变量根本测不到。
 * - **序列种子能取片段 id**：`u_seed` 是**逐帧**变的（`seedFor(…, frame)`），
 *   拿它做「刻度内恒定」的量会让画面每帧重掷一次，抽动退化成纯噪声。
 * - 它仍是 **t 的闭式函数**，不攒状态：预览与导出必然是同一次随机（硬约束 1.1 / 1.2）。
 */
import { hashSeed, withSeededRandom } from '../core/prng';

/**
 * `t` 处的抽动位移，单位是「整幅」（`0.5` = 半幅）。
 *
 * - `amount ≤ 0`（关闭）、`rate ≤ 0`、`t` 非有限 ⇒ 恒 `0`：不留 NaN 进 uniform
 *   （uniform 里的 NaN 会让整帧变成黑，且不报错）。
 * - 同 `seed` + 同刻度 ⇒ 同一个值，与帧率、分辨率、渲染路径无关。
 */
export function jerkOffset(t: number, rate: number, amount: number, seed: number | string): number {
  if (!(amount > 0) || !(rate > 0) || !Number.isFinite(t)) return 0;
  const tick = Math.floor(t * rate);
  // 刻度序号要作为一次「抽取」的输入：同一刻度内重复求值必须得到同一个数。
  const r = withSeededRandom(hashSeed(seed, tick), (rng) => rng());
  return (r * 2 - 1) * amount;
}
