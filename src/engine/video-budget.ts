/**
 * video-budget.ts — 视频纹理缓存的**淘汰决策**（纯函数，不碰 GL）。
 *
 * 从 `video-source.ts` 抽出来只有一个理由：**这里是这次修的那类 bug 的正中央**，
 * 而它必须能被单测钉住。搬纹理、删纹理那部分是副作用，留在 `video-source.ts`。
 *
 * ## 修的是什么
 *
 * 预算曾经写成 `new FrameCache(192MB)` 建在**每条素材**的条目里，而注释写着
 * 「纹理缓存预算」。于是「192 MB 预算」在 N 个素材上是 N × 192 MB —— 实测一次
 * 4 秒的导出就用掉 398 MB 显存（3 个素材）。这类错误的形态非常固定：
 * **一个看起来安全的数字，量纲或作用域写错了，而症状在别处**（显存耗尽 →
 * 上下文丢失 → 预览黑屏停更，且不报错）。
 *
 * ## 两级裁决
 *
 *  1. **每条缓存先夹自己的上限**：防一个素材吃掉全局预算（比如一条 4K 长时间线
 *     素材把 20 帧全占了，别的素材一个字节都进不来）。
 *  2. **再看全局**：超了就淘汰**最久没被取用**的那条缓存里最旧的一帧，
 *     逐帧淘汰到回到预算内。
 *
 * 「最久没被取用」是**缓存**的新旧，不是帧的新旧：正在播的素材几乎每帧都被取用，
 * 而很久没上时间轴的那条整条都可以放掉 —— 这比「谁的帧时间戳更老」更贴近
 * 用户接下来会看什么。
 *
 * ## 两条不许违反的不变量
 *
 *  - **每条缓存至少留一帧**：那是「这一层现在显示的画面」，删了会立刻变空白。
 *  - 连这样都还超预算时**停手**（并把 `overBudget` 报出去）：宁可显式超一点
 *    让用户看见，也不要删掉他正看着的最后一张画面。走到这一步说明机器能力与
 *    工程规模真的不匹配，正确的动作是降低素材规格，不是继续删。
 *
 * ## 为什么按「每帧字节数」逐个算而不是取平均
 *
 * 同一条缓存里帧的尺寸**可以不一样**：预览按 `renderW` 上传、导出按 1920 上传，
 * 切换时新旧两种尺寸会共存在一条缓存里（区间判定带 `w`，见 `FrameCache.get`）。
 * 取平均会让「淘汰到刚好不超预算」这件事变成估算 —— 而预估超一点就等于没超。
 */

/**
 * 一条视频缓存的不可淘汰视图。
 *
 * `sizes` 是**最旧在前**的逐帧字节数（与 `FrameCache` 的插入顺序一致）。
 */
export interface CacheUsage {
  /** 该缓存最近一次被取用的逻辑时刻，越大越新。 */
  used: number;
  sizes: readonly number[];
}

export interface EvictionPlan {
  /** 每条缓存应当从**最旧的一端**淘汰几帧，下标与入参一一对应。 */
  drop: number[];
  /** 按计划执行后是否仍然超预算（= 只剩「每条一帧」也放不下）。 */
  overBudget: boolean;
}

/** 一条缓存被淘汰 `n` 帧之后还剩的字节数。 */
function remainOf(c: CacheUsage, drop: number): number {
  let bytes = 0;
  for (let i = drop; i < c.sizes.length; i++) bytes += c.sizes[i]!;
  return bytes;
}

const allBytes = (c: CacheUsage): number => remainOf(c, 0);
/** 最多能淘汰几帧（至少留一帧：那是这一层现在显示的画面）。 */
const droppable = (c: CacheUsage): number => Math.max(0, c.sizes.length - 1);

/**
 * 算出该淘汰哪些帧。
 *
 * @param caches 各缓存（顺序即输出顺序，**不必**有序）。
 * @param perAssetBytes 单条缓存的上限（字节）。
 * @param totalBytes 全局预算（字节）。
 */
export function planEviction(
  caches: readonly CacheUsage[],
  perAssetBytes: number,
  totalBytes: number,
): EvictionPlan {
  const drop = new Array<number>(caches.length).fill(0);
  let total = 0;

  // ① 每条先夹自己的上限。
  for (let i = 0; i < caches.length; i++) {
    const c = caches[i]!;
    let bytes = allBytes(c);
    const limit = droppable(c);
    while (bytes > perAssetBytes && drop[i]! < limit) {
      bytes -= c.sizes[drop[i]!]!;
      drop[i]! += 1;
    }
    total += bytes;
  }
  if (total <= totalBytes) return { drop, overBudget: false };

  // ② 全局：按 used 升序逐帧淘汰（最久没取用的那条先丢）。
  const order = caches.map((c, i) => ({ c, i })).sort((a, b) => a.c.used - b.c.used);
  for (const { c, i } of order) {
    const limit = droppable(c);
    while (total > totalBytes && drop[i]! < limit) {
      total -= c.sizes[drop[i]!]!;
      drop[i]! += 1;
    }
    if (total <= totalBytes) {
      // 剩下的缓存不超预算了，但**已经算出来的 drop 仍然有效**（它们按各自的
      // 上限被夹过，不动它们）。
      return { drop, overBudget: false };
    }
  }
  // 只剩「每条一帧」还是放不下 —— 停手，并把这件事报出去。
  return { drop, overBudget: true };
}
