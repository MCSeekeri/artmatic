/**
 * catalog.ts — 算法生成器的**展示信息**目录：一句话说明 + 预览缩略图的配方。
 *
 * ## 为什么不放在各自的 `defs` 文件里
 *
 * 与 `effects/catalog.ts` 完全同一条理由：二十多条说明要**成批读一遍**才能保证
 * 语气与长度一致（"…的…。"这种句式），散在二十多个文件里做不到。而且这些是
 * **展示信息**，不是生成器协议 —— `types.ts` 讲的是这个生成器算什么，
 * 这里讲的是怎么把它介绍给人看。
 *
 * 代价是「新增一个生成器 = 两个地方」（def + 这里），摩擦由
 * `tests/unit/algo-thumb-assets.test.ts` 的「生成器展示信息目录」一节变成
 * **明确报错**：缺条目、孤儿条目、文案键解析不了、`previewParams` 写了不存在
 * 的参数键、文案超过 44 字 —— 全部会红。
 *
 * ## 为什么预览要有「配方」而不是直接用默认值
 *
 * **因为默认值在 t = 0 时对 sim / bake 是全黑的。** 元胞自动机、反应扩散、
 * 沙堆、雪花这些东西的初始态是「一个种子点」，第一帧必然是空屏；bake 型还要
 * 等生长前沿走完。所以每条都要说清「在哪一秒截」。实测踩过：第一版按 t = 0
 * 截，十来个生成器的缩略图全是黑的，而且**不报错**。
 *
 * 采样时刻的选取依据是各类的「长起来要多久」：
 * - **bake**：`frontMax / speed` 是前沿走满的秒数（见 `types.ts` 的 `BakeReveal`），
 *   取它的 1.5 倍左右留余量。
 * - **realtime**：有 `u_time` 的（场景族、`menger`）取 4 秒让动画走到有形的
 *   相位；纯几何的（牛顿 / Kleinian / Lyapunov / Mandelbrot 默认视角）与 t 无关，
 *   一律 0。
 *
 * ⚠️ **`sim` 那一列的单位不是「秒」，是「步数」。** 决定形态的永远是
 * `t × rate`，而各生成器的默认步频差几十倍（兰顿蚂蚁 400、雪花 30）——
 * 按秒给就会得到一堆「刚开始长」的图。实测第一版就是这么错的：雪花在
 * t = 16s 时只有 160 步（一个孤点），蚂蚁 2400 步（一小团），反应扩散
 * 1680 步（一个环）。所以下面每条都按**目标步数**反推：
 *
 * | 生成器 | 默认 rate | 目标步数 | 秒 |
 * |---|---|---|---|
 * | 兰顿蚂蚁 | 400 | 12000（高速公路成形） | 30 |
 * | 反应扩散 | 120 | 4800（珊瑚铺开） | 40 |
 * | 雪花 | 30 | 1200（主枝带侧枝张开） | 40 |
 * | Lenia | 12 | 240 | 20 |
 * | 生命游戏 | 12 | 300 | 25 |
 * | Brian's Brain | 30 | 180 | 6 |
 * | 循环 CA | 40 | 320 | 8 |
 * | 沙堆 | 30 | 600（约 3.6 万粒，**不能更多**） | 20 |
 * | Wireworld | 60 | 600 | 10 |
 * | Buddhabrot | 15 | 450（每步 2000 样本 → 90 万） | 30 |
 *
 * 沙堆是个特例：它的总沙量有硬上限（约 4.3 万粒可完整稳定化，再多就会被
 * 防卡死闸门静默截断，见 `sandpile.ts` 文件头）。600 次落沙 × 默认 60 粒
 * = 3.6 万粒，正好在安全区内 —— **调大这一条之前先读那段**。
 *
 * Buddhabrot 是另一个特例：它的**亮度与样本数无关**（色调映射按「计数 /
 * 均值」做自适应高通，见 `buddhabrot.ts` 文件头），所以要挑的只是「噪点
 * 收敛到什么程度还能算好看」，而不是「什么时候才亮起来」。
 */

import type { MessageKey } from '../i18n/locales';

export interface AlgoCatalogEntry {
  /** 一句话说明。存**文案键**，理由同 `effects/types.ts` 的 `labelKey`。 */
  descKey: MessageKey;
  /**
   * 预览的采样时刻（秒）。
   *
   * **sim / bake 必须显式给** —— 见文件头：它们在第 0 秒是空屏。
   * 缺省值只对 realtime 有意义。
   */
  previewT?: number;
  /** 预览用的参数覆盖（与该生成器的默认值合并）。 */
  previewParams?: Record<string, number | string>;
}

/** realtime 且有 `u_time` 时用的缺省采样时刻：4 秒，让动画走到有形的相位。 */
const RT_TIME = 4;

/**
 * **realtime 条目**的构造助手。
 *
 * 它存在的理由是 `intRes` **只对 realtime 有意义** —— bake / sim 的参数表里
 * 根本没有这一项（它们的分辨率由 `size` / `width` / `height` 决定）。所以
 * `intRes` 不能像别的共用参数那样全局合并：那样会给十来个 def 塞一个它们
 * 不认识的键。让**条目构造本身**区分这两类，比在每个 def 上判断干净。
 *
 * `intRes` 提到最高档：缩略图是**唯一一次**渲染，没有「拖一下滑杆重渲」的
 * 机会，所以直接按质量优先。实测 640×360 下没有任何生成器会慢到需要降档。
 */
function rt(descKey: MessageKey, previewT: number = RT_TIME): AlgoCatalogEntry {
  return { descKey, previewT, previewParams: { intRes: '720' } };
}

export const ALGO_CATALOG: Record<string, AlgoCatalogEntry> = {
  /* ---------------------------------------------------------------- bake */
  rule110: { descKey: 'algo.desc.rule110', previewT: 8 },
  bifurcation: { descKey: 'algo.desc.bifurcation', previewT: 6 },
  lsystem: { descKey: 'algo.desc.lsystem', previewT: 10 },
  // `'value'` 揭示按 speed 推进，要到 speed 秒把 255 走完才全长出来。
  'chaos-game': { descKey: 'algo.desc.chaosGame', previewT: 8 },
  dla: { descKey: 'algo.desc.dla', previewT: 10 },

  /* ----------------------------------------------------------------- sim */
  'game-of-life': { descKey: 'algo.desc.gameOfLife', previewT: 25 },
  'langtons-ant': { descKey: 'algo.desc.langtonsAnt', previewT: 30 },
  'reaction-diffusion': { descKey: 'algo.desc.reactionDiffusion', previewT: 40 },
  'brians-brain': { descKey: 'algo.desc.briansBrain', previewT: 6 },
  'cyclic-ca': { descKey: 'algo.desc.cyclicCa', previewT: 8 },
  sandpile: { descKey: 'algo.desc.sandpile', previewT: 20 },
  /*
   * 40 秒 = 1200 步（默认 rate 30）。此时主枝带侧枝、枝隙清楚，晶体半径约
   * 90 格 —— 占钉扎半径的六成，画幅里留得住呼吸。
   *
   * ⚠️ 再往后长会顶到远场钉扎圈（`r > 0.92·n/2`，见 `snowflake.ts`），
   * 晶体变成一整个实心圆盘。这是 Reiter 模型的固有行为（"growth limited
   * by radius"），不是 bug —— 想要更大的晶体就调大「网格」。
   */
  snowflake: { descKey: 'algo.desc.snowflake', previewT: 40 },
  lenia: { descKey: 'algo.desc.lenia', previewT: 20 },
  wireworld: { descKey: 'algo.desc.wireworld', previewT: 10 },
  buddhabrot: { descKey: 'algo.desc.buddhabrot', previewT: 30 },

  /* ------------------------------------------------------------ realtime */
  mandelbrot: rt('algo.desc.mandelbrot', 0),
  menger: rt('algo.desc.menger'),
  mandelbulb: rt('algo.desc.mandelbulb'),
  apollonian: rt('algo.desc.apollonian'),
  newton: rt('algo.desc.newton', 0),
  kleinian: rt('algo.desc.kleinian', 0),
  lyapunov: rt('algo.desc.lyapunov', 0),

  'scene-ripple': rt('algo.desc.sceneRipple'),
  'scene-field': rt('algo.desc.sceneField'),
  'scene-datamosh': rt('algo.desc.sceneDatamosh'),
  'scene-flow': rt('algo.desc.sceneFlow'),
  'scene-strands': rt('algo.desc.sceneStrands'),
};

/**
 * 取某个生成器的预览配方（含全局参数合并）。
 *
 * 生成器不在目录里时返回 `null` —— 调用方（批量脚本 / lab 钩子）据此跳过，
 * 而 `algo-catalog.test.ts` 保证**注册表里的每一个都有条目**，所以线上不会
 * 走到那个分支。
 */
export function previewRecipe(
  id: string,
): { t: number; params: Record<string, number | string> } | null {
  const entry = ALGO_CATALOG[id];
  if (!entry) return null;
  return { t: entry.previewT ?? RT_TIME, params: { ...entry.previewParams } };
}
