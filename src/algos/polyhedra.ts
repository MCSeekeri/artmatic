/**
 * polyhedra.ts — 「正多面体」生成器的**几何表**：顶点 / 棱 + 给着色器的常量数组。
 *
 * ## 为什么表在 JS 侧算，而不是手抄进 GLSL
 *
 * 五个柏拉图立体加四个四维正多面体一共 103 个顶点、252 条棱。手抄两张索引表
 * 的失效形态是「某条棱连错一个下标」—— 画面上只是一根线歪到隔壁顶点，看起来
 * 像「这个立体的形状就是这样」，而代码、编译、守卫测试全部通过。
 *
 * 所以这里只写**坐标**，棱由 `edgesOf()` 按「最短距离」自动连。正多面体的
 * 定义本身就是这样：所有棱等长，且没有比它更近的顶点对。这条定义是机制的，
 * 不是样子的 —— 坐标抄错一个符号，棱的条数立刻变（`polyhedra.test.ts` 断言
 * 每个形体的棱数，6 / 12 / 12 / 30 / 30 与 10 / 32 / 24 / 96）。
 *
 * ## 坐标系
 *
 * 一律**外接球半径 1**（四维也一样）。生成器只做投影与缩放，不需要真实尺寸，
 * 统一半径意味着 `scale` 这一个滑杆在所有形体的口径一致。
 *
 * 三维形体的 `w` 分量恒为 0 —— 于是「三维」不是另一条代码路径，而是四维公式
 * 在 w = 0 处的特例（见 `polyhedron.ts` 的 `project4`）。
 */

/** 直角坐标，第四分量只对四维形体有意义。 */
export type Vec4 = readonly [number, number, number, number];

export interface PolyShape {
  readonly id: string;
  readonly dim: 3 | 4;
  readonly verts: readonly Vec4[];
  readonly edges: readonly (readonly [number, number])[];
}

/** 黄金比例。十二 / 二十面体的坐标全靠它。 */
const PHI = (1 + Math.sqrt(5)) / 2;

/* ------------------------------------------------------------ 坐标构造 */

/** (±1,±1,±1) —— 立方体的 8 个顶点，也是十二面体那 8 个。 */
function signedCube(): Vec4[] {
  const out: Vec4[] = [];
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) out.push([x, y, z, 0]);
    }
  }
  return out;
}

/** 正四面体：(1,1,1) 与三个「两个负号」的排列，两两距离相等。 */
function tetra(): Vec4[] {
  return [
    [1, 1, 1, 0],
    [1, -1, -1, 0],
    [-1, 1, -1, 0],
    [-1, -1, 1, 0],
  ];
}

/** 正八面体：三根坐标轴上的 ±1。 */
function octa(): Vec4[] {
  const out: Vec4[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const s of [-1, 1]) {
      const v = [0, 0, 0, 0];
      v[axis] = s;
      out.push([v[0]!, v[1]!, v[2]!, 0]);
    }
  }
  return out;
}

/** 正十二面体：(±1,±1,±1) + 三族 (0, ±1/φ, ±φ) 的循环排列。 */
function dodeca(): Vec4[] {
  const out = signedCube();
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      out.push([0, a / PHI, b * PHI, 0]);
      out.push([a / PHI, b * PHI, 0, 0]);
      out.push([b * PHI, 0, a / PHI, 0]);
    }
  }
  return out;
}

/** 正二十面体：三族 (0, ±1, ±φ) 的循环排列 —— 十二面体的对偶。 */
function icosa(): Vec4[] {
  const out: Vec4[] = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      out.push([0, a, b * PHI, 0]);
      out.push([a, b * PHI, 0, 0]);
      out.push([b * PHI, 0, a, 0]);
    }
  }
  return out;
}

/**
 * 四维 5-cell（五胞体，正单形）：正四面体 + 一个沿 w 抬起的顶点。
 *
 * 顶点高度 `sqrt(5/3)` 是「让新顶点到四个底面顶点的距离等于底面棱长」的解：
 * 底面外接半径 1、棱长 2√(2/3)，于是 `1 + R² = 8/3`。
 */
function cell5(): Vec4[] {
  const base = unitRadius(tetra());
  const out: Vec4[] = base.map((v): Vec4 => [v[0], v[1], v[2], 0]);
  out.push([0, 0, 0, Math.sqrt(5 / 3)]);
  /*
   * 必须重新居中：`shape()` 只按**外接半径**缩放，而刚加进来的顶点让重心
   * 从原点挪到了 w = 1/5 的高度。不居中时五个顶点到晶格原点的距离不等
   * （0.77 与 1.0），自旋看上去会绕着一个偏离形体中心的点晃。
   */
  return recenter(out);
}

/** 四维 8-cell（超立方体）：16 个 ±1 组合。 */
function cell8(): Vec4[] {
  const out: Vec4[] = [];
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        for (const w of [-1, 1]) out.push([x, y, z, w]);
      }
    }
  }
  return out;
}

/** 四维 16-cell（超八面体）：四根坐标轴上的 ±1。 */
function cell16(): Vec4[] {
  const out: Vec4[] = [];
  for (let axis = 0; axis < 4; axis++) {
    for (const s of [-1, 1]) {
      const v = [0, 0, 0, 0];
      v[axis] = s;
      out.push([v[0]!, v[1]!, v[2]!, v[3]!]);
    }
  }
  return out;
}

/** 四维 24-cell：(±1,±1,0,0) 的全部排列 —— 唯一没有三维对应物的正多胞体。 */
function cell24(): Vec4[] {
  const out: Vec4[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (const si of [-1, 1]) {
        for (const sj of [-1, 1]) {
          const v = [0, 0, 0, 0];
          v[i] = si;
          v[j] = sj;
          out.push([v[0]!, v[1]!, v[2]!, v[3]!]);
        }
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------- 规范化 */

function radiusOf(v: Vec4): number {
  return Math.hypot(v[0], v[1], v[2], v[3]);
}

/** 缩到外接球半径 1。 */
function unitRadius(verts: readonly Vec4[]): Vec4[] {
  let r = 0;
  for (const v of verts) r = Math.max(r, radiusOf(v));
  return verts.map((v): Vec4 => [v[0] / r, v[1] / r, v[2] / r, v[3] / r]);
}

/** 减去质心。5-cell 的构造天然偏心，转起来会绕着一个偏的点晃。 */
function recenter(verts: readonly Vec4[]): Vec4[] {
  const n = verts.length;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let cw = 0;
  for (const v of verts) {
    cx += v[0] / n;
    cy += v[1] / n;
    cz += v[2] / n;
    cw += v[3] / n;
  }
  return verts.map((v): Vec4 => [v[0] - cx, v[1] - cy, v[2] - cz, v[3] - cw]);
}

/* ------------------------------------------------------------------ 棱 */

/**
 * 棱 = 距离等于**最短顶点对距离**的那些顶点对。
 *
 * 判据用的是平方距离（免开方），容差取最小距离的 1e-6 —— 坐标是代数数，
 * 双精度下同一条棱的两端算出来的值只差 1e-16 量级。
 */
function edgesOf(verts: readonly Vec4[]): [number, number][] {
  const d2 = (a: Vec4, b: Vec4): number => {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    const dw = a[3] - b[3];
    return dx * dx + dy * dy + dz * dz + dw * dw;
  };

  let min = Infinity;
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) min = Math.min(min, d2(verts[i]!, verts[j]!));
  }
  const tol = min * 1e-6;

  const out: [number, number][] = [];
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      const s = d2(verts[i]!, verts[j]!);
      if (Math.abs(s - min) <= tol) out.push([i, j]);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ 注册 */

function shape(id: string, dim: 3 | 4, verts: Vec4[]): PolyShape {
  const v = unitRadius(verts);
  return { id, dim, verts: v, edges: edgesOf(v) };
}

/**
 * 全部形体。**顺序就是顶点表 / 棱表的排布顺序** —— `SHAPE_RANGE` 由它推出，
 * 所以「加一个形体」只需在这里追加一行，两张平坦表自动跟着长。
 */
export const POLY_SHAPES: readonly PolyShape[] = [
  shape('tetra', 3, tetra()),
  shape('cube', 3, signedCube()),
  shape('octa', 3, octa()),
  shape('dodeca', 3, dodeca()),
  shape('icosa', 3, icosa()),
  shape('cell5', 4, cell5()),
  shape('cell8', 4, cell8()),
  shape('cell16', 4, cell16()),
  shape('cell24', 4, cell24()),
];

export interface ShapeRange {
  /** 在顶点表里的起点（vec4 下标）。 */
  vBase: number;
  vCount: number;
  /** 在棱表里的起点（ivec2 下标）。 */
  eBase: number;
  eCount: number;
}

/** 形体 id → 它在平坦表里的区间。 */
export const SHAPE_RANGE: Readonly<Record<string, ShapeRange>> = (() => {
  const out: Record<string, ShapeRange> = {};
  let v = 0;
  let e = 0;
  for (const s of POLY_SHAPES) {
    out[s.id] = { vBase: v, vCount: s.verts.length, eBase: e, eCount: s.edges.length };
    v += s.verts.length;
    e += s.edges.length;
  }
  return out;
})();

export function shapeById(id: string): PolyShape | null {
  return POLY_SHAPES.find((s) => s.id === id) ?? null;
}

/** 顶点表的顶点总数。着色器的循环上界与常量数组长度都用它。 */
export const VERTEX_COUNT = POLY_SHAPES.reduce((n, s) => n + s.verts.length, 0);
/** 棱表的棱总数。 */
export const EDGE_COUNT = POLY_SHAPES.reduce((n, s) => n + s.edges.length, 0);
/** 单个形体最多的顶点数 —— 每像素那两圈循环的**编译期**上界。 */
export const MAX_SHAPE_VERTS = Math.max(...POLY_SHAPES.map((s) => s.verts.length));
/** 单个形体最多的棱数。 */
export const MAX_SHAPE_EDGES = Math.max(...POLY_SHAPES.map((s) => s.edges.length));

/* ---------------------------------------------------------------- 旋转 */

/**
 * 轴 → 坐标号。四维多出 `w`。
 *
 * 取值**进工程 JSON**（存的是字符串），改名等于让老工程的旋转轴静默退回缺省。
 */
export const POLY_AXES: Record<string, number> = { x: 0, y: 1, z: 2, w: 3 };

/**
 * 「绕 a 轴转」→ 两个旋转平面的坐标号 `[p1a, p1b, p2a, p2b]`。
 *
 * 四维里没有「绕一根轴旋转」这回事（旋转固定的是一个**平面**），所以规则定成
 * 一条可验证的：**该轴保持不动，旋转发生在它后面那两个坐标构成的平面里**
 * （按 x→y→z→w 循环计）。于是
 *
 * | 轴 | 主平面 | 该轴 | 读起来 |
 * |---|---|---|---|
 * | x | YZ | 不动 | 普通的自旋 |
 * | y | ZW | 不动 | 顶点在四维里进出 —— 超立体最典型的「呼吸」 |
 * | z | WX | 不动 | 同上，另一个相位 |
 * | w | XY | 不动 | W 恒定，看上去就是三维自旋 |
 *
 * 第二个平面（`p2`，由 `precess` 控制转速）取主平面之后的那一组：既保证
 * 「两条轴一起转」不退化成一个平面，也保证三维形体的两个平面都不会碰到 w。
 *
 * 三维与四维共用这一条规则，只是模数不同（3 / 4）—— 两套 if 分支迟早会漂。
 */
export function rotPlanes(dim: 3 | 4, axis: string): [number, number, number, number] {
  const n = dim;
  const a = Math.min(Math.max(POLY_AXES[axis] ?? 1, 0), n - 1);
  const b = (a + 1) % n;
  const c = (a + 2) % n;
  const d = (c + 1) % n;
  return [b, c, c, d];
}

/* ---------------------------------------------------------------- GLSL */

/** GLSL 的浮点字面量。6 位小数足够（坐标都是代数数，1e-6 已是视觉上的零）。 */
function num(x: number): string {
  return x.toFixed(6);
}

/**
 * 两张平坦常量表：`PV` 顶点（vec4，未用到的分量留给四维）、`PE` 棱（两个下标）。
 *
 * 为什么是**平坦表 + 区间**而不是每形体一张表：形体由参数在运行期选，而 GLSL
 * 没有「按名字取表」。平坦表配合 `u_vBase` / `u_eBase`（uniform）做下标，索引
 * 是「uniform 起点 + 循环变量」—— 对编译器是常量内存访问，不会退化成局部数组。
 */
export const POLY_GLSL = (() => {
  const verts = POLY_SHAPES.flatMap((s) => s.verts);
  const edges = POLY_SHAPES.flatMap((s) => s.edges);

  const vLines = verts.map(
    (v) => `  vec4(${num(v[0])}, ${num(v[1])}, ${num(v[2])}, ${num(v[3])})`,
  );
  const eLines = edges.map((e) => `ivec2(${e[0]}, ${e[1]})`);

  // 开头必须换行：块注释只有落在行首才被文案守卫当注释，紧跟反引号的那种算代码。
  return `
/* 顶点 / 棱表：由 algos/polyhedra.ts 生成，不要手改。 */
const vec4 PV[${verts.length}] = vec4[${verts.length}](
${vLines.join(',\n')}
);

const ivec2 PE[${edges.length}] = ivec2[${edges.length}](
  ${eLines.join(', ')}
);

/* 四个坐标轴的单位基。旋转平面用它来表达，避免对 vec4 做动态下标。 */
const vec4 AX[4] = vec4[4](
  vec4(1.0, 0.0, 0.0, 0.0),
  vec4(0.0, 1.0, 0.0, 0.0),
  vec4(0.0, 0.0, 1.0, 0.0),
  vec4(0.0, 0.0, 0.0, 1.0));
`;
})();
