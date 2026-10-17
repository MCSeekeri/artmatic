/**
 * quad.test.ts — `core/quad.ts`（四角单应 + 层/帧 uv 仿射）的纯函数守卫。
 *
 * 判据刻意用「具体数值」而不是「两边互相一致」：互相一致只证明两个方向用了
 * 同一套错公式。透视非线性那一条钉的是手推的期望值 `(1/3, 1/3)`；
 * layerUv↔frameUv 那几条把 `placement.frag.ts` 的着色器公式**逐字复刻**一遍
 * 再对拍 —— 两边一起改错的概率远小于「只改一边」。
 */
import { describe, expect, it } from 'vitest';
import {
  frameUvToLayerUv,
  homographyFromUnitSquare,
  invertMat3,
  isIdentityQuad,
  layerUvToFrameUv,
  quadInverseMatrix,
  quadSourceUv,
  type PlacementAffine,
} from '../../src/core/quad';
import { identityQuad, type QuadCorners } from '../../src/core/schema';

/** 行主序 3×3 单应作用在齐次点 (u,v,1) 上。测试里独立写一遍，不复用源码的私有函数。 */
function apply(m: readonly number[], u: number, v: number): [number, number] {
  const w = m[6]! * u + m[7]! * v + m[8]!;
  return [(m[0]! * u + m[1]! * v + m[2]!) / w, (m[3]! * u + m[4]! * v + m[5]!) / w];
}

/** 手挑的透视四边形：上窄下宽的梯形（上边 x∈[0.2,0.8]，下边 x∈[0,1]）。 */
const PERSPECTIVE: QuadCorners = {
  tl: [0.2, 0.15],
  tr: [0.8, 0.15],
  br: [1.0, 0.9],
  bl: [0.0, 0.9],
};

/** 一般四边形（四边都不平行、四角都不在原点），用来避免「原点是特殊点」造成的假通过。 */
const GENERAL: QuadCorners = {
  tl: [0.1, 0.1],
  tr: [0.85, 0.2],
  br: [0.9, 0.95],
  bl: [0.05, 0.8],
};

/** 等腰梯形：手推 H = [[1, 0.5, 0],[0, 2, 0],[0, 1, 1]]（见下面「透视非线性」）。 */
const TRAPEZOID: QuadCorners = {
  tl: [0, 0],
  tr: [1, 0],
  br: [0.75, 1],
  bl: [0.25, 1],
};

/** 确定性 LCG —— 单测不允许裸 Math.random()（根 AGENTS.md 硬约束 1.2 的精神）。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/* ------------------------------------------------------- 单位方 → 四边形 */

describe('homographyFromUnitSquare', () => {
  it('恒等四角 → 恒等矩阵', () => {
    expect(homographyFromUnitSquare(identityQuad())).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  const cornersOf = (q: QuadCorners): [number, number, [number, number]][] => [
    [0, 0, q.tl],
    [1, 0, q.tr],
    [1, 1, q.br],
    [0, 1, q.bl],
  ];

  it('把单位方四角映到 tl / tr / br / bl（透视梯形）', () => {
    const h = homographyFromUnitSquare(PERSPECTIVE);
    expect(h).not.toBeNull();
    for (const [u, v, want] of cornersOf(PERSPECTIVE)) {
      const got = apply(h!, u, v);
      expect(got[0], `(${u},${v}).x`).toBeCloseTo(want[0], 12);
      expect(got[1], `(${u},${v}).y`).toBeCloseTo(want[1], 12);
    }
  });

  it('把单位方四角映到 tl / tr / br / bl（一般四边形）', () => {
    const h = homographyFromUnitSquare(GENERAL);
    expect(h).not.toBeNull();
    for (const [u, v, want] of cornersOf(GENERAL)) {
      const got = apply(h!, u, v);
      expect(got[0], `(${u},${v}).x`).toBeCloseTo(want[0], 12);
      expect(got[1], `(${u},${v}).y`).toBeCloseTo(want[1], 12);
    }
  });

  it('平行四边形走仿射特例：末行 [0,0,1]，且不被判成退化', () => {
    // 仿射偏离 dx3/dy3 恰好为 0，投影分支的分母同时为 0 ——
    // 不单列这个分支的话，一个完全合法的平行四边形会算出 0/0。
    //
    // ⚠️ 四角必须全用二进制可精确表示的值（0.25 / 0.5 / 0.75 / 1）：只要有一个
    // 小数让 dx3 = x0 - x1 + x2 - x3 的舍入结果不为 0，就会落进投影分支，
    // 这条用例就变成「平行四边形恰好几乎仿射」的**假覆盖**（变异测试抓到的：
    // 仿射分支整段没被测到）。
    const para: QuadCorners = {
      tl: [0.25, 0.25],
      tr: [0.75, 0.25],
      br: [1.0, 0.75],
      bl: [0.5, 0.75],
    };
    const h = homographyFromUnitSquare(para);
    expect(h).not.toBeNull();
    // 真的走了仿射特例：末行是精确的 [0,0,1]（投影分支会留下 ~1e-16 的 g/h）。
    expect(h!.slice(6)).toEqual([0, 0, 1]);
    // x = 0.25 + 0.5u + 0.25v；y = 0.25 + 0.5v
    const want = [0.5, 0.25, 0.25, 0, 0.5, 0.25, 0, 0, 1];
    h!.forEach((entry, i) => expect(entry, `m[${i}]`).toBeCloseTo(want[i]!, 12));
  });
});

/* --------------------------------------------------------------- 恒等判定 */

describe('isIdentityQuad', () => {
  const withCorner = (corner: keyof QuadCorners, xy: [number, number]): QuadCorners => {
    const q = identityQuad();
    q[corner] = [xy[0], xy[1]];
    return q;
  };

  it('单位方四角 → true', () => {
    expect(isIdentityQuad(identityQuad())).toBe(true);
    // 拷贝一份（不是同一个引用）也应是 true。
    expect(isIdentityQuad({ ...identityQuad() })).toBe(true);
  });

  it('任一角偏离 → false', () => {
    expect(isIdentityQuad(withCorner('tl', [0.5, 0.5]))).toBe(false);
    expect(isIdentityQuad(withCorner('tr', [0.5, 0.5]))).toBe(false);
    expect(isIdentityQuad(withCorner('br', [0.5, 0.5]))).toBe(false);
    expect(isIdentityQuad(withCorner('bl', [0.5, 0.5]))).toBe(false);
  });

  it('容差边界：|Δ| <= eps 算恒等，超过不算', () => {
    expect(isIdentityQuad(withCorner('tl', [1e-6, 0]))).toBe(true);
    expect(isIdentityQuad(withCorner('tl', [-1e-6, 0]))).toBe(true);
    // 两个分量都要测边界：只测 x 的话 y 那一半的比较符改错（<= → <）不会被发现。
    expect(isIdentityQuad(withCorner('tl', [0, 1e-6]))).toBe(true);
    expect(isIdentityQuad(withCorner('tl', [0, -1e-6]))).toBe(true);
    expect(isIdentityQuad(withCorner('tl', [2e-6, 0]))).toBe(false);
    expect(isIdentityQuad(withCorner('tl', [0, -2e-6]))).toBe(false);
    // eps 可调：默认容差下 false 的偏差，放大 eps 后应变成 true。
    expect(isIdentityQuad(withCorner('br', [1 + 1e-4, 1]))).toBe(false);
    expect(isIdentityQuad(withCorner('br', [1 + 1e-4, 1]), 1e-3)).toBe(true);
  });
});

/* --------------------------------------------------------------- 往返 / 逆 */

describe('quadInverseMatrix / quadSourceUv', () => {
  it('H⁻¹(H(p)) ≈ p（手挑透视四边形，误差 < 1e-9）', () => {
    const h = homographyFromUnitSquare(PERSPECTIVE)!;
    const inv = quadInverseMatrix(PERSPECTIVE);
    expect(inv).not.toBeNull();
    const points: [number, number][] = [
      [0, 0], [1, 0], [1, 1], [0, 1],
      [0.25, 0.5], [0.5, 0.25], [0.3, 0.7], [0.5, 0.5],
    ];
    for (const [u, v] of points) {
      const dest = apply(h, u, v);
      const back = apply(inv!, dest[0], dest[1]);
      expect(back[0], `(${u},${v}).x`).toBeCloseTo(u, 9);
      expect(back[1], `(${u},${v}).y`).toBeCloseTo(v, 9);
    }
  });

  it('随机四边形：H⁻¹(H(p)) 往返误差 < 1e-9', () => {
    const rand = lcg(0x5eed);
    // 四个角各自围绕单位方顶点抖动 ±0.15 —— 仍在透视单应的有效域内（不会出现消失线
    // 穿过四边形），但已经足够「一般」，能抓住行列式 / 伴随矩阵写错的情况。
    const jitter = (base: number): number => base + (rand() - 0.5) * 0.3;
    for (let k = 0; k < 20; k++) {
      const q: QuadCorners = {
        tl: [jitter(0), jitter(0)],
        tr: [jitter(1), jitter(0)],
        br: [jitter(1), jitter(1)],
        bl: [jitter(0), jitter(1)],
      };
      const h = homographyFromUnitSquare(q);
      const inv = quadInverseMatrix(q);
      expect(h, `第 ${k} 个四边形不该退化`).not.toBeNull();
      expect(inv).not.toBeNull();
      for (const [u, v] of [[0.5, 0.5], [0.2, 0.8], [0.8, 0.2]] as [number, number][]) {
        const dest = apply(h!, u, v);
        const back = apply(inv!, dest[0], dest[1]);
        expect(back[0], `#${k} (${u},${v}).x`).toBeCloseTo(u, 9);
        expect(back[1], `#${k} (${u},${v}).y`).toBeCloseTo(v, 9);
      }
    }
  });

  it('恒等四角：quadSourceUv 原样返回；层外 uv 落到 [0,1] 之外', () => {
    const q = identityQuad();
    expect(quadSourceUv(q, 0, 0)).toEqual([0, 0]);
    expect(quadSourceUv(q, 0.25, 0.75)).toEqual([0.25, 0.75]);
    expect(quadSourceUv(q, -0.2, 0.5)![0]).toBeLessThan(0);
    expect(quadSourceUv(q, 1.3, 0.5)![0]).toBeGreaterThan(1);
    expect(quadSourceUv(q, 0.5, -0.01)![1]).toBeLessThan(0);
    expect(quadSourceUv(q, 0.5, 1.01)![1]).toBeGreaterThan(1);
  });

  it('一般四边形：层外点反解出的源 uv 也在单位方之外', () => {
    // 取四边形左上角再往左上偏一点 —— 一定在四边形之外。
    const src = quadSourceUv(PERSPECTIVE, -0.1, -0.1);
    expect(src).not.toBeNull();
    expect(src![0] < 0 || src![0] > 1 || src![1] < 0 || src![1] > 1).toBe(true);
  });

  it('quadInverseMatrix 与 quadSourceUv 的采样矩阵是同一份', () => {
    const inv = quadInverseMatrix(GENERAL)!;
    for (const [u, v] of [[0.1, 0.2], [0.7, 0.4], [0.5, 0.9]] as [number, number][]) {
      expect(quadSourceUv(GENERAL, u, v)).toEqual(apply(inv, u, v));
    }
  });
});

/* ------------------------------------------------------------------- 退化 */

describe('退化单应', () => {
  it('三点共线 → null（homography / 逆矩阵 / 采样三处一致）', () => {
    // tl、tr、br 在 y=0 上共线。
    const collinear: QuadCorners = { tl: [0, 0], tr: [1, 0], br: [2, 0], bl: [0, 1] };
    expect(homographyFromUnitSquare(collinear)).toBeNull();
    expect(quadInverseMatrix(collinear)).toBeNull();
    expect(quadSourceUv(collinear, 0.5, 0.5)).toBeNull();
  });

  it('四点重合 → null', () => {
    const same: QuadCorners = {
      tl: [0.5, 0.5], tr: [0.5, 0.5], br: [0.5, 0.5], bl: [0.5, 0.5],
    };
    expect(homographyFromUnitSquare(same)).toBeNull();
    expect(quadInverseMatrix(same)).toBeNull();
    expect(quadSourceUv(same, 0.5, 0.5)).toBeNull();
  });

  it('四角压到同一条斜线上（面积 0）→ null', () => {
    const flat: QuadCorners = {
      tl: [0, 0], tr: [0.25, 0.25], br: [1, 1], bl: [0.5, 0.5],
    };
    expect(homographyFromUnitSquare(flat)).toBeNull();
    expect(quadInverseMatrix(flat)).toBeNull();
  });

  it('压扁的仿射四边形（两条边退化成一个点）→ null', () => {
    const collapsed: QuadCorners = { tl: [0, 0], tr: [1, 0], br: [1, 0], bl: [0, 0] };
    expect(homographyFromUnitSquare(collapsed)).toBeNull();
  });

  it('自交四边形：消失线穿过层空间时，w <= 0 的点采样返回 null', () => {
    // 四角顺序交叉（bowtie）：单应矩阵本身可逆，但消失线横穿层空间 ——
    // 这类四边形 UI 拖得出来，渲染侧把它判为「层外透明」，采样侧必须返回 null。
    // 手推 H = [[0,-1,0],[1,-1,0],[0,-2,1]]，逆矩阵的 w = 1 - 2u（消失线 u=0.5）。
    const bowtie: QuadCorners = { tl: [0, 0], tr: [0, 1], br: [1, 0], bl: [1, 1] };
    expect(homographyFromUnitSquare(bowtie), '矩阵本身可逆，不属于退化四边形').not.toBeNull();
    expect(quadSourceUv(bowtie, 0.5, 0.5)).toBeNull();  // w = 0（消失线上）
    expect(quadSourceUv(bowtie, 0.6, 0.5)).toBeNull();  // w = -0.2（消失线另一侧）
    expect(quadSourceUv(bowtie, 0.25, 0.5)).not.toBeNull(); // w = 0.5（有效侧）
  });
});

describe('invertMat3', () => {
  it('正常矩阵求逆后 M·M⁻¹ = I', () => {
    const m = [1, 2, 3, 0, 1, 4, 5, 6, 0];
    const inv = invertMat3(m)!;
    // 已知逆：[[-24,18,5],[20,-15,-4],[-5,4,1]]
    const want = [-24, 18, 5, 20, -15, -4, -5, 4, 1];
    inv.forEach((v, i) => expect(v, `m[${i}]`).toBeCloseTo(want[i]!, 12));
    // 手乘一遍验证，避免「逆矩阵恰好是另一个错矩阵」这种巧合。
    const mul = (r: number, c: number): number =>
      m[r * 3]! * inv[c]! + m[r * 3 + 1]! * inv[3 + c]! + m[r * 3 + 2]! * inv[6 + c]!;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) expect(mul(r, c), `(${r},${c})`).toBeCloseTo(r === c ? 1 : 0, 12);
    }
  });

  it('奇异 / 近奇异 / 非有限 / 长度不对 → null', () => {
    // 行线性相关（第三行 = 第一行 + 第二行），det 恰为 0。
    expect(invertMat3([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
    // det = 1e-13 < 1e-12：数值上已经不可靠，不能当可逆用。
    expect(invertMat3([1, 0, 0, 0, 1e-13, 0, 0, 0, 1])).toBeNull();
    // 长度不是 9（含多给的情况：只取前 9 个会静默算出一个「看起来对」的逆）。
    expect(invertMat3([1, 0, 0])).toBeNull();
    expect(invertMat3([1, 0, 0, 0, 1, 0])).toBeNull();
    expect(invertMat3([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])).toBeNull();
    // 输入带 Infinity：det 也可能算出 NaN，被更早的行列式检查挡住。
    expect(invertMat3([1, 0, 0, 0, Infinity, 0, 0, 0, 1])).toBeNull();
    // 但这条 det = Infinity（不是 NaN）：求逆过程中出现 Inf/Inf = NaN ——
    // 它才是「结果必须有限」那道 guard 的判据（上面那条到不了那里）。
    expect(invertMat3([Infinity, 0, 0, 0, 1, 0, 0, 0, 1])).toBeNull();
  });
});

/* --------------------------------------------------------------- 透视非线性 */

describe('透视非线性（钉具体数值）', () => {
  it('梯形的手推单应：H = [[1,0.5,0],[0,2,0],[0,1,1]]', () => {
    // 这个梯形（上边 y=0、下边 y=1）能闭式手推，所以能钉「精确的矩阵」，
    // 而不是只钉「映射到角点对」—— 后者对任何合法单应都成立，区分不了公式错位。
    const want = [1, 0.5, 0, 0, 2, 0, 0, 1, 1];
    homographyFromUnitSquare(TRAPEZOID)!.forEach((entry, i) =>
      expect(entry, `m[${i}]`).toBeCloseTo(want[i]!, 12),
    );
  });

  it('H⁻¹ 的目的端中点 ≠ 源端中点：反解出 (1/3, 1/3)', () => {
    // tl=(0,0) 与 br=(0.75,1) 的**目的端**中点是 (0.375,0.5)。
    // 透视下它的源坐标是 (1/3,1/3)，而源空间两端点的中点是 (0.5,0.5) —— 差得远。
    const src = quadSourceUv(TRAPEZOID, 0.375, 0.5);
    expect(src).not.toBeNull();
    expect(src![0]).toBeCloseTo(1 / 3, 12);
    expect(src![1]).toBeCloseTo(1 / 3, 12);
    expect(src![0]).not.toBeCloseTo(0.5, 6);
  });

  it('正向：源中点 (0.5,0.5) 落在 (0.5, 2/3)（线性拉伸会落在 (0.5,0.5)）', () => {
    const h = homographyFromUnitSquare(TRAPEZOID)!;
    const dest = apply(h, 0.5, 0.5);
    expect(dest[0]).toBeCloseTo(0.5, 12);
    expect(dest[1]).toBeCloseTo(2 / 3, 12);
    expect(dest[1]).not.toBeCloseTo(0.5, 6);
  });
});

/* ------------------------------ 层 uv ↔ 帧 uv（仿射；公开 API 左上原点） */

describe('layerUvToFrameUv / frameUvToLayerUv（左上原点）', () => {
  /**
   * `src/engine/placement.frag.ts::layerUv()` 的逐字复刻 —— **GL 空间**（v 向上，
   * 与着色器的 `vUv` 同向）。刻意在测试里再写一遍而不是调源码：两边走同一个函数
   * 的话，公式一起改错也是绿的（这条对拍的意义就在「两份独立实现」）。
   */
  function shaderLayerUvGl(a: PlacementAffine, x: number, y: number): [number, number] {
    const px = (x - a.cx) * a.frameW;
    const py = (y - a.cy) * a.frameH;
    const s = Math.sin(a.rot);
    const c = Math.cos(a.rot);
    const rx = c * px + s * py;
    const ry = c * py - s * px;
    return [rx / Math.max(a.drawW, 1) + 0.5, ry / Math.max(a.drawH, 1) + 0.5];
  }

  /**
   * 着色器公式 + 左上原点桥接：公开 helper 与 `placement.frag.ts` 差一次 v 翻转，
   * 对拍时在两端各翻一次（帧 uv 翻进 GL，得到的层 uv 翻回左上）。目的仍是钉死
   * 「helper 与 `layerUv()` 互逆」，而不是把公开函数的坐标方向钉反。
   */
  function shaderLayerUvTopleft(a: PlacementAffine, x: number, y: number): [number, number] {
    const [u, v] = shaderLayerUvGl(a, x, 1 - y);
    return [u, 1 - v];
  }

  /** 无旋转、draw = 帧一半的常见摆放（sx = sy = 0.5）。 */
  const HALF: PlacementAffine = {
    frameW: 1000, frameH: 1000, drawW: 500, drawH: 500, cx: 0.5, cy: 0.5, rot: 0,
  };

  /** 有旋转、且 drawW/frameW ≠ drawH/frameH（sx≠sy）的一般摆放。 */
  const TILTED: PlacementAffine = {
    frameW: 1920, frameH: 1080, drawW: 800, drawH: 700, cx: 0.4, cy: 0.6, rot: -0.7,
  };

  /**
   * 方向守卫：**层的左上角必须落在画面左上角**（左上原点、不镜像）。
   * 这是 e2e 抓过的真实回归 —— helper 若按 GL 空间（v 向上）输出，手柄会上下
   * 镜像，而画面本身是对的，只有对比手柄与画面时才看得出来。
   */
  it('层的左上角 → 画面左上角（左上原点，不镜像）', () => {
    const full: PlacementAffine = {
      frameW: 1920, frameH: 1080, drawW: 1920, drawH: 1080, cx: 0.5, cy: 0.5, rot: 0,
    };
    expect(layerUvToFrameUv(full, 0, 0)).toEqual([0, 0]);
    expect(layerUvToFrameUv(full, 1, 1)).toEqual([1, 1]);
    expect(layerUvToFrameUv(full, 0.25, 0.25)).toEqual([0.25, 0.25]);
    expect(frameUvToLayerUv(full, 0.25, 0.25)).toEqual([0.25, 0.25]);
    // 半幅摆放：层的上半仍在画面中线以上、下半在中线以下。
    expect(layerUvToFrameUv(HALF, 0.5, 0)[1]).toBeLessThan(0.5);
    expect(layerUvToFrameUv(HALF, 0.5, 1)[1]).toBeGreaterThan(0.5);
  });

  it('中心点映射到 center；无旋转时按 draw/frame 比例缩放（手算）', () => {
    expect(layerUvToFrameUv(HALF, 0.5, 0.5)).toEqual([0.5, 0.5]);
    // 层 (0.75,0.25) = 右半、上半：偏移 (0.25,-0.25)×500px = (125,-125)px
    // → 帧 (0.625,0.375)（u 向右、v 向下）。
    expect(layerUvToFrameUv(HALF, 0.75, 0.25)).toEqual([0.625, 0.375]);
    // 层 (0.25,0.75) = 左半、下半 → 帧 (0.375,0.625) —— 上下不能反。
    expect(layerUvToFrameUv(HALF, 0.25, 0.75)).toEqual([0.375, 0.625]);
    // 反方向：帧 (0.75,0.25) → 偏移 (250,-250)px → 层 (1,0)（右边界、上边界）。
    expect(frameUvToLayerUv(HALF, 0.75, 0.25)).toEqual([1, 0]);
  });

  it('旋转 π/2：层右边中点 → 帧顶边中点（左上原点；与着色器手算一致）', () => {
    const a: PlacementAffine = {
      frameW: 1000, frameH: 1000, drawW: 1000, drawH: 1000, cx: 0.5, cy: 0.5,
      rot: Math.PI / 2,
    };
    const f = layerUvToFrameUv(a, 1, 0.5);
    // 层 (1,0.5) 是右边界中点；绕中心转 90° 后在左上原点语义下落到帧顶边中点。
    expect(f[0]).toBeCloseTo(0.5, 12);
    expect(f[1]).toBeCloseTo(0, 12);
    // 反向验证：着色器公式（GL 空间）+ v 桥接给出的层坐标必须是 (1,0.5)。
    const back = shaderLayerUvTopleft(a, f[0], f[1]);
    expect(back[0]).toBeCloseTo(1, 12);
    expect(back[1]).toBeCloseTo(0.5, 12);
  });

  it('与 placement.frag 的着色器公式逐点一致（两端加 v 桥接）', () => {
    for (const a of [HALF, TILTED]) {
      for (const [x, y] of [[0, 0], [1, 1], [0.25, 0.75], [0.5, 0.5], [0.9, 0.1]] as [number, number][]) {
        const cpu = frameUvToLayerUv(a, x, y);
        const shader = shaderLayerUvTopleft(a, x, y);
        expect(cpu[0], `(${x},${y}).u`).toBeCloseTo(shader[0], 12);
        expect(cpu[1], `(${x},${y}).v`).toBeCloseTo(shader[1], 12);
        // 反方向也要对：回到帧 uv（这才是「与着色器互逆」的完整判据）。
        const back = layerUvToFrameUv(a, shader[0], shader[1]);
        expect(back[0], `(${x},${y}).x`).toBeCloseTo(x, 12);
        expect(back[1], `(${x},${y}).y`).toBeCloseTo(y, 12);
      }
    }
  });

  it('两个方向互逆（含旋转与 sx≠sy；两次 v 翻转的舍入容差 1e-6）', () => {
    for (const a of [HALF, TILTED]) {
      for (const [u, v] of [[0.5, 0.5], [0, 0], [1, 1], [0.25, 0.75], [0.9, 0.1]] as [number, number][]) {
        const f = layerUvToFrameUv(a, u, v);
        const back = frameUvToLayerUv(a, f[0], f[1]);
        expect(back[0], `(${u},${v}).u`).toBeCloseTo(u, 6);
        expect(back[1], `(${u},${v}).v`).toBeCloseTo(v, 6);
      }
      for (const [x, y] of [[0, 0], [1, 1], [0.3, 0.6]] as [number, number][]) {
        const l = frameUvToLayerUv(a, x, y);
        const back = layerUvToFrameUv(a, l[0], l[1]);
        expect(back[0], `(${x},${y}).x`).toBeCloseTo(x, 6);
        expect(back[1], `(${x},${y}).y`).toBeCloseTo(y, 6);
      }
    }
  });

  it('drawSize 被压到 1px 以下时与着色器同样兜底（分母 max(size,1)），且仍互逆', () => {
    const tiny: PlacementAffine = {
      frameW: 1920, frameH: 1080, drawW: 0.3, drawH: 0.2, cx: 0.5, cy: 0.5, rot: 0.2,
    };
    const l = frameUvToLayerUv(tiny, 0.6, 0.4);
    const shader = shaderLayerUvTopleft(tiny, 0.6, 0.4);
    expect(l[0]).toBeCloseTo(shader[0], 12);
    expect(l[1]).toBeCloseTo(shader[1], 12);
    const back = layerUvToFrameUv(tiny, l[0], l[1]);
    expect(back[0]).toBeCloseTo(0.6, 6);
    expect(back[1]).toBeCloseTo(0.4, 6);
  });
});
