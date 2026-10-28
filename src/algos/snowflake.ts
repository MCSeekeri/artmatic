/**
 * snowflake.ts — Reiter 雪花生长模型，`sim` 型。
 *
 * 六角格上每格存一个连续量 `s`（水量）。`s ≥ 1` 即冰。规则如下。
 *
 * ## 先把场拆成两半，这是这个模型**唯一**的不显然之处
 *
 * Reiter 原文把每一格的含水量拆成 `s = u + v`：`v` 是「不参与扩散的水」，
 * `u` 是「可以在格间流动的水」。分类之后
 *
 * ```
 * receptive 的格（冰格 + 冰的紧邻）:  v = s, u = 0
 * 其余格（NR）:                     v = 0, u = s
 * ```
 *
 * 也就是说 **冰与它的紧邻在扩散场里一律贡献 0** —— 它们是**吸收汇**，不是水源。
 * 每步的更新值是两项之和：
 *
 * ```
 * 项一（只对 receptive）: s + γ
 * 项二（对所有格）:       α · ( u(self)/2 + mean_N(u(N))/6 )
 * ```
 *
 * 展开成可以直接写的形式（`nn` = 6 个邻居）：
 *
 * ```
 * receptive:  s ← s + γ + (α/2)·( mean_N(u) − 0 )
 * 其余:       s ← s + (α/2)·( mean_N(u) − s )
 * ```
 *
 * 后者就是显式欧拉离散化的扩散方程 `∂u/∂t = α∇²u`（Reiter 原文的
 * `u + (α/12)(−6u + Σu)`）。**两项的 α 依赖形式不同，只在 α = 1 时重合** ——
 * 一开始把两者都写成「加权平均」`(α/2)(s + mean)` 是错的：那种写法在 α < 1
 * 时整体按 α 衰减，把水汽抹成 0，实测 α=0.4 跑 1600 步只结出 7 个冰格。
 * 前者说明 receptive 格**也会吸入扩散来的水汽** —— 这一项才是生长的真正燃料。
 *
 * ## 为什么必须写成这样（这是本文件唯一一次返工的原因）
 *
 * 第一版把项二的 `u` 直接写成了 `s`，即冰格以 1 参与邻居均值 —— 等于让晶体
 * 反过来向周围**供水**。后果不是「画质差一点」，而是**晶体永远长成实心圆盘**：
 * 生长速度与几何无关，界面张力无从建立。实测 β 0.15→0.55、γ 扫三个量级
 * 全是各向同性圆盘，根因就在这里。
 *
 * 改对之后，枝隙里的格子只看到少数非零邻居（其余被冰遮成 0），生长速度随
 * 「能看到多少水汽」而变 —— 这就是 Mullins–Sekerka 不稳定，枝晶由此而来。
 *
 * ## 三个参数各自的脾气（Reiter 原文 + McRadar 复述）
 *
 * - `β`（背景水量）是**湿度**。低 β + 低 γ → 枝晶；高 β → 星状 / 扇状片晶。
 * - `γ`（环境补偿）是**local rule 的常数项**。它越大，「与几何无关的那部分
 *   生长」占比越高，画面越接近圆盘；越小，生长越完全由扩散场决定，枝越细。
 * - `α`（扩散强度）越大水汽跑得越远、结构越张开（dendritic）；越小越紧凑。
 *
 * ## 边界条件不是装饰
 *
 * Reiter 把远场钉在 β（"Boundary conditions maintain the background level at
 * a radius near the edge"）。没有它，环面会让整个未冻区的平均值随晶体长大而
 * 被 0 稀释掉，生长在几十步内就停摆。所以 `createSnowflake` 把
 * `r > 0.92·(n/2)` 的一圈**每步重置回 β**，晶体因此最多长到半径 `0.46n`。
 *
 * 六角邻域用 offset 列（odd-q）：偶数列的邻居偏右上/右下，奇数列偏左上/左下。
 */

import { patternFromParam, stampCenteredInto } from './pattern-codec';
import { SnapshotRing } from './sim-util';
import { bgColorVisible, bgModeParam } from './shader-lib';
import type { GeneratorDef, SimHandle } from './types';

/** 冻结阈值。`s ≥ 1` 即成冰，之后不再变化。 */
const FREEZE_AT = 1;

/**
 * 远场的钉扎半径，占半幅的比例。
 *
 * 留 8% 的余量是为了让钉扎圈本身不出现在可见画幅的构图里 —— 晶体长到它
 * 附近时就该被水量限制住，而不是被一条直线边界切掉。与 `catalog.ts` 的
 * 预览时刻配套：预览里看到的尺寸远小于这个半径。
 */
const EDGE_PIN = 0.92;

/**
 * 六角邻域（offset 列 / odd-q：**奇数列整体下移半格**）：相对 (x,y) 的
 * 6 个 (dx,dy)，平铺成 `[dx0,dy0, dx1,dy1, …]`。
 *
 * ```
 * 偶数列 x： 同列上下 + 左右列在 y-1 与 y
 * 奇数列 x： 同列上下 + 左右列在 y 与 y+1
 * ```
 *
 * ## 这份表返工过一次，两次都是「看着像对的」
 *
 * 第一版偶数列写的是 `{(±1,-1), (±1,0), (±1,+1)}` —— **本列反而没有邻居**，
 * 而奇数列写的是 `{(0,±1), (-1,·), (+1,0)}`。两套合起来不对称：偶格连到
 * 奇格的 (y-1,y,y+1)，奇格却连到偶格的 (y-2,y-1,y)。**邻接关系不满足对称性
 * ⇒ 这根本不是一张六角格**，各列的生长速度互不相同。实测后果很直观：
 * 长出来是一个朝左张开的楔形，带着斜向条纹，而不是任何方向都对等的雪晶。
 *
 * 判据是**镜面对称**（x → -x 映射回自身）与**邻接双向**（P 的邻居集合里
 * 含 Q ⟺ Q 的邻居集合里含 P）。两条都能在单测里直接枚举验证，见
 * `tests/unit/cellular-automata.test.ts`。
 *
 * 平铺而不是 `[[dx,dy],…]`：内层循环里 `nb[k][0]` 是一次额外的解引用，
 * 而这段代码每步要跑 6·n² 次。**导出这两张表是为了让上面那两条性质可枚举**
 * —— 表是唯一真源，`snowStep` 的两趟都直接读它。
 */
export const HEX_NB_EVEN = [0, -1, 1, -1, 1, 0, 0, 1, -1, 0, -1, -1];
export const HEX_NB_ODD = [0, -1, 1, 0, 1, 1, 0, 1, -1, 1, -1, 0];

export interface SnowState {
  s: Float32Array;
  /** 已成冰的格（不再演化）。 */
  frozen: Uint8Array;
  /** receptive：自身已成冰或**任一邻居**已成冰 —— 冰格与结晶前沿。 */
  near: Uint8Array;
}

const SNAPSHOT_OPTS = {
  every: 8,
  cap: 48,
  clone: (v: SnowState): SnowState => ({
    s: v.s.slice(),
    frozen: v.frozen.slice(),
    near: v.near.slice(),
  }),
};

export interface SnowRule {
  alpha: number;
  gamma: number;
}

/**
 * 一步（就地更新到 `next`）。
 *
 * **必须读旧写新**：就地把 `s[i] += γ` 写回去，后面的格子在算邻居均值时
 * 读到的就是已加过 γ 的值 —— 生长顺序会依赖遍历方向。所以 receptive 掩码
 * 也要在**改任何东西之前**先算完（下面第 1 趟）。
 *
 * 边界条件不在这里 —— 它是域的性质，不是这个局部规则的。见 `stepTo`。
 */
export function snowStep(cur: SnowState, next: SnowState, n: number, rule: SnowRule): void {
  const { alpha, gamma } = rule;
  const half = alpha / 2;

  /* --- 第 1 趟：receptive 掩码（读旧态）---------------------------------
     receptive = 冰 ∪ 冰的紧邻。直接「从每个冰格向它的 6 个邻居广播」而不是
     「每个格子回头查 6 个邻居」：前者是 O(n² + 6·冰数)，后者是 O(6n²)，
     而冰在后期能占掉三成面积。 */
  next.near.set(cur.frozen);
  for (let x = 0; x < n; x++) {
    const nb = (x & 1) === 1 ? HEX_NB_ODD : HEX_NB_EVEN;
    for (let y = 0; y < n; y++) {
      const i = y * n + x;
      if (!cur.frozen[i]) continue;
      for (let k = 0; k < 12; k += 2) {
        let xx = x + nb[k]!;
        if (xx < 0) xx += n;
        else if (xx >= n) xx -= n;
        let yy = y + nb[k + 1]!;
        if (yy < 0) yy += n;
        else if (yy >= n) yy -= n;
        next.near[yy * n + xx] = 1;
      }
    }
  }

  /* --- 第 2 趟：更新 ---------------------------------------------------
     `meanU` 里的 receptive 邻居按 0 计 —— 这是与第一版唯一的差别，也是
     枝晶与圆盘的唯一差别。 */
  for (let x = 0; x < n; x++) {
    const nb = (x & 1) === 1 ? HEX_NB_ODD : HEX_NB_EVEN;
    for (let y = 0; y < n; y++) {
      const i = y * n + x;
      if (cur.frozen[i]) {
        next.s[i] = FREEZE_AT;
        next.frozen[i] = 1;
        continue;
      }
      let sumU = 0;
      for (let k = 0; k < 12; k += 2) {
        let xx = x + nb[k]!;
        if (xx < 0) xx += n;
        else if (xx >= n) xx -= n;
        let yy = y + nb[k + 1]!;
        if (yy < 0) yy += n;
        else if (yy >= n) yy -= n;
        const j = yy * n + xx;
        if (!next.near[j]) sumU += cur.s[j]!;
      }
      const meanU = sumU / 6;
      const receptive = next.near[i] === 1;
      let v: number;
      if (receptive) {
        v = cur.s[i]! + gamma + half * meanU;
      } else {
        v = cur.s[i]! + half * (meanU - cur.s[i]!);
      }
      if (v >= FREEZE_AT) {
        v = FREEZE_AT;
        next.frozen[i] = 1;
      } else {
        next.frozen[i] = 0;
      }
      next.s[i] = v;
    }
  }
}

export function createSnowflake(params: Record<string, number | string>): SimHandle {
  const n = Math.max(64, Math.min(512, Math.round(Number(params.size) || 320)));
  const stepsPerSec = Math.max(1, Number(params.rate) || 30);
  const rule: SnowRule = {
    alpha: Math.max(0.05, Number(params.alpha) || 1),
    gamma: Math.max(0, Number(params.gamma) || 0.001),
  };
  const beta = Math.max(0.01, Math.min(0.95, Number(params.beta) || 0.4));

  /*
   * 远场钉扎掩码。平方半径先算好，省掉每步的 sqrt。
   * 圆心取**格子中心**（`n >> 1`）而不是几何中心 `(n-1)/2`：种子种在
   * `(n>>1, n>>1)`，圆心的半个像素偏移会破坏六重对称。
   */
  const c = n >> 1;
  const pinR = EDGE_PIN * (n / 2);
  const pinR2 = pinR * pinR;
  const pin = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    const dy = y - c;
    for (let x = 0; x < n; x++) {
      const dx = x - c;
      if (dx * dx + dy * dy > pinR2) pin[y * n + x] = 1;
    }
  }

  const cur: SnowState = {
    s: new Float32Array(n * n).fill(beta),
    frozen: new Uint8Array(n * n),
    near: new Uint8Array(n * n),
  };
  const next: SnowState = {
    s: new Float32Array(n * n),
    frozen: new Uint8Array(n * n),
    near: new Uint8Array(n * n),
  };

  // 单核（中心一格）或多核（手绘图案 —— 每个亮格都是一个核）
  const plantAt = (i: number): void => {
    cur.s[i] = FREEZE_AT;
    cur.frozen[i] = 1;
  };
  if (params.seedMode === 'pattern') {
    const bm = patternFromParam(params.pattern);
    if (bm) stampCenteredInto(n, n, bm, plantAt);
    else plantAt((n >> 1) * n + (n >> 1));
  } else {
    plantAt((n >> 1) * n + (n >> 1));
  }
  // `seed` 不参与：这个模型是纯确定性的（初值只有一个核）

  let frame = 0;
  const snapshots = new SnapshotRing<SnowState>(SNAPSHOT_OPTS, cur);
  const out = new Uint8Array(n * n);

  /** 远场回钉。每步跑一次，是 O(n²) 的直线扫描，相对第 2 趟可忽略。 */
  const repin = (st: SnowState): void => {
    for (let i = 0; i < pin.length; i++) {
      if (!pin[i]) continue;
      st.s[i] = beta;
      st.frozen[i] = 0;
    }
  };

  const stepTo = (target: number): void => {
    while (frame < target) {
      snowStep(cur, next, n, rule);
      // 交换（`snowStep` 写满每一格，交换安全）
      const ts = cur.s;
      const tf = cur.frozen;
      const tn = cur.near;
      cur.s = next.s;
      cur.frozen = next.frozen;
      cur.near = next.near;
      next.s = ts;
      next.frozen = tf;
      next.near = tn;
      repin(cur);
      frame++;
      if (snapshots.shouldStore(frame)) {
        // 快照要一份**独立副本**：cur 的三条数组下一轮就会被当成写入缓冲
        snapshots.store(frame, cur);
      }
    }
  };

  return {
    gridW: n,
    gridH: n,
    stepsPerSec,
    seek(simFrame: number): void {
      const target = Math.max(0, Math.floor(simFrame));
      if (target < frame) {
        const snap = snapshots.nearestAtOrBefore(target);
        cur.s.set(snap.value.s);
        cur.frozen.set(snap.value.frozen);
        cur.near.set(snap.value.near);
        frame = snap.frame;
      }
      stepTo(target);
    },
    current(): Uint8Array {
      /*
       * 三档着色。水位压得很低（上限 70）是刻意的：过冷水是**背景**，
       * 它存在的意义是让人看见晶体周围的缺水晕，而不是自己抢戏。
       * 晶体长开后前沿会连成一片，120 的中间档刚好读成「枝尖的亮边」。
       */
      for (let i = 0; i < out.length; i++) {
        if (cur.frozen[i]) out[i] = 255; // 冰
        else if (cur.near[i]) out[i] = 120; // 结晶前沿
        else out[i] = Math.min(70, Math.round(cur.s[i]! * 100)); // 过冷水 / 缺水晕
      }
      return out;
    },
  };
}

export const snowflakeDef: GeneratorDef = {
  id: 'snowflake',
  nameKey: 'algo.snowflake',
  kind: 'sim',
  volatile: ['rate', 'colorBg', 'colorLive', 'bgMode'],
  params: [
    { key: 'size', labelKey: 'algo.snowflake.grid', type: 'range', min: 128, max: 512, step: 32, defaultValue: 320 },
    {
      key: 'beta',
      labelKey: 'algo.snowflake.beta',
      type: 'range',
      min: 0.05,
      max: 0.8,
      step: 0.01,
      defaultValue: 0.48,
    },
    { key: 'alpha', labelKey: 'algo.snowflake.alpha', type: 'range', min: 0.2, max: 2, step: 0.05, defaultValue: 1 },
    {
      key: 'gamma',
      labelKey: 'algo.snowflake.gamma',
      type: 'range',
      min: 0.0001,
      max: 0.004,
      step: 0.0001,
      defaultValue: 0.0008,
    },
    {
      key: 'seedMode',
      labelKey: 'algo.snowflake.seedMode',
      type: 'select',
      defaultValue: 'single',
      options: [
        { labelKey: 'algo.snowflake.seedSingle', value: 'single' },
        { labelKey: 'algo.snowflake.seedPattern', value: 'pattern' },
      ],
    },
    {
      key: 'pattern',
      labelKey: 'algo.snowflake.pattern',
      type: 'pattern',
      defaultValue: '',
      editorSize: 32,
      mode: '2d',
      visibleWhen: (v) => v.seedMode === 'pattern',
    },
    { key: 'rate', labelKey: 'algo.snowflake.speed', type: 'range', min: 1, max: 60, step: 1, defaultValue: 30 },
    {
      key: 'colorBg',
      labelKey: 'algo.snowflake.colorBg',
      type: 'color',
      defaultValue: '#04121f',
      visibleWhen: bgColorVisible,
    },
    { key: 'colorLive', labelKey: 'algo.snowflake.colorLive', type: 'color', defaultValue: '#dff3ff' },
    bgModeParam(),
  ],
  create: (params) => createSnowflake(params),
};
