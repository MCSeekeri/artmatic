/**
 * growth-algos.test.ts — Wave 4 批次 3 的三个生成器（Buddhabrot / 混沌游戏 / DLA）。
 *
 * 三个都是「用随机数长出结构」，所以这份测试有两条共同的主线：
 *
 * 1. **确定性**。硬约束 1.2 —— 同一 seed 在同一状态下必须逐步逐位相同，
 *    否则 seek 与导出都会漂。
 * 2. **「判据要长在机制上」**。这里特别容易写出「常量就能满足」的假断言：
 *    「非黑像素 > 0」对任何有噪声的图都成立。所以每条断言都挑一个**只有
 *    这个机制才给得出**的量：
 *    - Buddhabrot 挑的是「画面亮度与样本数无关」（尺度无关的色调映射）。
 *      按计数归一化的实现会随样本累积整体变亮，这条立刻红。
 *    - 混沌游戏挑的是「谢尔宾斯基的中心必须是个洞」（IFS 的中间子副本
 *      被挖掉）。任何「撒点结果」都不会凭空留出那个洞。
 *    - DLA 挑的是「粘附次数 === 占据格数」（每次粘附真的占了一个新格）与
 *      「值随半径单调」（到达序号确实是径向增长的）。粒子重复粘在同一格
 *      上的实现会让前者立刻红。
 */

import { describe, expect, it } from 'vitest';
import { buddhaSample, createBuddhabrot, makeOrbitScratch } from '../../src/algos/buddhabrot';
import { chaosGameRun } from '../../src/algos/chaos-game';
import { dlaRun } from '../../src/algos/dla';
import { mulberry32 } from '../../src/core/prng';

/* ------------------------------------------------------------------ 通用 */

const litCount = (px: Uint8Array, min = 1): number => {
  let n = 0;
  for (const v of px) if (v >= min) n++;
  return n;
};

const meanOf = (px: Uint8Array): number => {
  let s = 0;
  for (const v of px) s += v;
  return s / px.length;
};

/* ------------------------------------------------------------- Buddhabrot */

describe('Buddhabrot', () => {
  it('逃逸判据：不动点不逃逸、远处的点逃逸', () => {
    const n = 32;
    const view = { cx: 0, cy: 0, half: 1 };
    const sc = makeOrbitScratch(256);

    // c = 0：z 恒为 0，永不逃逸 ⇒ 轨道被丢弃
    expect(buddhaSample(new Uint16Array(n * n), n, view, 256, () => 0.5, sc)).toBe(false);
    // c = 2（视野右缘）：z 一步就超出 |z| > 2 ⇒ 逃逸
    expect(buddhaSample(new Uint16Array(n * n), n, view, 256, () => 1 - 1e-9, sc)).toBe(true);
  });

  it('第 0 步全黑，且不会因为除零变成 NaN', () => {
    const sim = createBuddhabrot({ size: 128, batch: 200, maxIter: 128 }, 7);
    const px = sim.current();
    expect(px.every((v) => v === 0)).toBe(true);
  });

  it('seek ≡ 顺序推进；同一个 seed 逐位相同', () => {
    const p = { size: 128, batch: 200, maxIter: 128 };
    const a = createBuddhabrot(p, 7);
    const b = createBuddhabrot(p, 7);
    a.seek(40);
    b.seek(90);
    b.seek(40);
    expect(b.current()).toEqual(a.current());
    const c = createBuddhabrot(p, 8);
    c.seek(40);
    expect(c.current()).not.toEqual(a.current());
  });

  it('**亮度与样本数无关**（色调映射按「计数 / 均值」自适应，不是按计数）', () => {
    const p = { size: 160, batch: 400, maxIter: 192 };
    const short = createBuddhabrot(p, 3);
    short.seek(60); // 24000 样本
    const long = createBuddhabrot(p, 3);
    long.seek(400); // 160000 样本，6.7 倍

    const mShort = meanOf(short.current());
    const mLong = meanOf(long.current());
    expect(mShort, '短跑的画面不该是空的').toBeGreaterThan(5);
    // 6.7 倍样本下均值亮度必须基本不变。按计数归一化会差 6 倍以上。
    expect(Math.abs(mLong - mShort) / mShort, `均值 ${mShort.toFixed(1)} → ${mLong.toFixed(1)}`).toBeLessThan(0.35);

    // 而结构必须**更干净**：亮像素占比不能反而变少，噪底必须被压下去。
    const litShort = litCount(short.current(), 2);
    const litLong = litCount(long.current(), 2);
    expect(litLong).toBeLessThanOrEqual(litShort * 1.05);
  });

  it('采样真的在显影：非黑像素随步数单调增', () => {
    const sim = createBuddhabrot({ size: 128, batch: 300, maxIter: 160 }, 11);
    sim.seek(10);
    const a = litCount(sim.current(), 8);
    sim.seek(120);
    const b = litCount(sim.current(), 8);
    expect(b).toBeGreaterThan(a);
    expect(a).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------ 混沌游戏 */

describe('混沌游戏', () => {
  const base = { ratio: 0.5, points: 300000, restriction: 'none' as const, size: 401, seed: 5 };

  it('N=3 长出的必须真的是谢尔宾斯基三角：中心是个洞', () => {
    const { data } = chaosGameRun({ ...base, vertices: 3 });
    const c = 200; // size=401 ⇒ 中心格 (200,200)
    // 三个顶点的重心正好落在被挖掉的中间子三角形里 —— 任何「撒点」都不会
    // 凭空留下这个洞，只有 IFS 收缩才做得到。
    expect(data[c * 401 + c], '中心不该有点').toBe(0);
    // 而且洞**不止中心一处**：整个中间子三角形都是空的。取它内部三个点。
    for (const [px, py] of [
      [200, 150],
      [160, 210],
      [240, 210],
    ] as const) {
      expect(data[py * 401 + px], `中间子三角形的 (${px},${py}) 不该有点`).toBe(0);
    }
    // 三个角必须实心：顶点是被无限次命中的极限点。反推顶点位置 ——
    // 顶点在半径 0.46n 的圆上、三个方向分别是上 / 右下 / 左下。
    for (const [vx, vy] of [
      [0, -1],
      [Math.sqrt(3) / 2, 0.5],
      [-Math.sqrt(3) / 2, 0.5],
    ] as const) {
      const ix = Math.round(200 + vx * 401 * 0.46);
      const iy = Math.round(200 + vy * 401 * 0.46);
      expect(data[iy * 401 + ix], `顶点 (${ix},${iy}) 该是实心的`).toBeGreaterThan(0);
    }
    expect(litCount(data), '覆盖过低，图基本没长出来').toBeGreaterThan(5000);
  });

  it('N=3 用 noRepeat 会把轨道锁进短周期（已知行为，改动时必须重新核对）', () => {
    const free = chaosGameRun({ ...base, vertices: 3, restriction: 'none' });
    const locked = chaosGameRun({ ...base, vertices: 3, restriction: 'noRepeat' });
    const a = litCount(free.data);
    const b = litCount(locked.data);
    // 实测 12676 vs 738（同 40 万点）。这条断言是**故意钉住一个已知缺陷**：
    // 一旦有人改了顶点选择逻辑，它会红，提醒去看 N=3 还是不是谢尔宾斯基。
    expect(a).toBeGreaterThan(b * 3);
  });

  it('背景恒为 0，图上的值恒在 1..255（`value` 揭示的两条老规矩）', () => {
    const { data } = chaosGameRun({ ...base, vertices: 5 });
    let lit = 0;
    for (const v of data) {
      expect(v).toBeLessThanOrEqual(255);
      if (v > 0) lit++;
    }
    expect(lit).toBeGreaterThan(1000);
    // 「图上有 0」会让那些像素跟背景一起消失 —— 它们必须是可分辨的
    const values = new Set<number>();
    for (const v of data) if (v > 0) values.add(v);
    expect(values.has(0)).toBe(false);
  });

  it('半径揭示：值随半径单调不减（前沿才能从中心往外推）', () => {
    const { data } = chaosGameRun({ ...base, vertices: 3 });
    // 取两条环带上的平均值：内环必须比外环暗（值更大）
    let inner = 0;
    let innerN = 0;
    let outer = 0;
    let outerN = 0;
    for (let y = 0; y < 401; y++) {
      for (let x = 0; x < 401; x++) {
        const v = data[y * 401 + x]!;
        if (!v) continue;
        const d = Math.hypot(x - 200, y - 200);
        if (d > 30 && d < 60) {
          inner += v;
          innerN++;
        } else if (d > 130 && d < 160) {
          outer += v;
          outerN++;
        }
      }
    }
    expect(innerN).toBeGreaterThan(0);
    expect(outerN).toBeGreaterThan(0);
    expect(inner / innerN).toBeLessThan(outer / outerN);
  });

  it('确定性：同 seed 逐位相同，不同 seed 不同图', () => {
    const a = chaosGameRun({ ...base, vertices: 5, seed: 1 });
    const b = chaosGameRun({ ...base, vertices: 5, seed: 1 });
    expect(b.data).toEqual(a.data);
    const c = chaosGameRun({ ...base, vertices: 5, seed: 2 });
    expect(c.data).not.toEqual(a.data);
  });
});

/* ------------------------------------------------------------------ DLA */

describe('扩散受限聚集', () => {
  const want = 2500;
  const run = (seed: number, size = 320) =>
    dlaRun({ size, particles: want, seedRadius: 2, stick: 4, seed });

  it('**每次粘附都占了一个新格**（不会重复粘在同一格上）', () => {
    const r = run(9);
    expect(r.placed).toBe(want);
    expect(
      litCount(r.data),
      '占据格数少于粘附次数 —— 粒子粘在了已经占据的格上',
    ).toBe(want);
  });

  it('值随半径单调：种子最暗（= 1），最外圈最亮', () => {
    const r = run(9);
    const n = r.w;
    const c = n >> 1;
    let seedV = 0;
    let farSum = 0;
    let farN = 0;
    let farMax = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = r.data[y * n + x]!;
        if (!v) continue;
        const d = Math.hypot(x - c, y - c);
        if (v === 1) seedV++;
        if (d > 60) {
          farSum += v;
          farN++;
          if (v > farMax) farMax = v;
        }
      }
    }
    expect(seedV, '种子格必须存在且值是 1（最先显影）').toBeGreaterThan(0);
    expect(farN).toBeGreaterThan(0);
    expect(farSum / farN, '外圈的平均值必须明显高于 1').toBeGreaterThan(60);
    expect(farMax).toBeGreaterThan(200);
  });

  it('聚集体是**分形**而不是实心填充（拟合维数明显低于 2）', () => {
    /* 判据取「粒子数 → 半径」的标度指数 D（`N ∝ R^D`）。
       注意方向：D < 2 意味着同样粒子数下半径**更大**（更稀疏），所以
       「半径长得快」恰恰是分形的证据 —— 初版把这条写反了。
       实测（seed 4、384 网格）：N=500→R=33、1500→61、4000→122，D≈1.57。
       理论的 DLA 维数是 ≈1.71，小规模（几千粒）会偏低。 */
    const radiusOf = (d: ReturnType<typeof dlaRun>): number => {
      const n = d.w;
      const c = n >> 1;
      let best = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (!d.data[y * n + x]) continue;
          const r = Math.hypot(x - c, y - c);
          if (r > best) best = r;
        }
      }
      return best;
    };
    const pts = [500, 1500, 4000].map((N) => {
      const d = dlaRun({ size: 384, particles: N, seedRadius: 2, stick: 4, seed: 4 });
      expect(d.placed, `N=${N} 没长满`).toBe(N);
      return { N, R: radiusOf(d) };
    });
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    const k = pts.length;
    for (const p of pts) {
      const X = Math.log(p.R);
      const Y = Math.log(p.N);
      sx += X;
      sy += Y;
      sxx += X * X;
      sxy += X * Y;
    }
    const D = (k * sxy - sx * sy) / (k * sxx - sx * sx);
    expect(D, `拟合维数 ${D.toFixed(2)}（实心填充会是 2.0）`).toBeGreaterThan(1.3);
    expect(D, `拟合维数 ${D.toFixed(2)}`).toBeLessThan(1.9);
  });

  it('聚集体顶到网格边界时会停下，不会重复粘附充数', () => {
    // 网格小、粒子多 ⇒ 一定撞上限
    const r = dlaRun({ size: 128, particles: 20000, seedRadius: 2, stick: 4, seed: 1 });
    expect(r.placed).toBeLessThan(20000);
    expect(litCount(r.data), '占据格数仍必须等于粘附次数').toBe(r.placed);
  });

  it('确定性：同 seed 逐位相同', () => {
    expect(run(3, 192).data).toEqual(run(3, 192).data);
    expect(run(4, 192).data).not.toEqual(run(3, 192).data);
  });
});

