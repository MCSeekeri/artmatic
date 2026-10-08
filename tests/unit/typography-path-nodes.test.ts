import { describe, expect, it } from 'vitest';
import {
  cubicAt,
  insertNodeOnSegment,
  mapNodes,
  moveNode,
  nearestOnPath,
  parsePathNodes,
  removeNode,
  segmentCount,
  serializePathNodes,
  setHandle,
  type PathNode,
  type SubPath,
  type Vec,
} from '../../src/typography/path-nodes';
import { shapeGeometry } from '../../src/typography/shapes';

const show = (subs: readonly SubPath[]): string =>
  subs
    .map(
      (sp) =>
        (sp.closed ? '[' : '(') +
        sp.nodes
          .map((n) => `${n.x},${n.y}${n.in ? `i${n.in.x},${n.in.y}` : ''}${n.out ? `o${n.out.x},${n.out.y}` : ''}`)
          .join('|') +
        (sp.closed ? ']' : ')'),
    )
    .join(' ');

const cubicPoint = (p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec => {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
};

/** 一段上的采样（含端点）。与实现同源 —— 直线段也走线性，别套贝塞尔公式。 */
function sampleSegment(a: PathNode, b: PathNode, n: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(
      !a.out && !b.in
        ? { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        : cubicPoint({ x: a.x, y: a.y }, a.out ?? { x: a.x, y: a.y }, b.in ?? { x: b.x, y: b.y }, { x: b.x, y: b.y }, t),
    );
  }
  return out;
}

describe('parsePathNodes — 归一化', () => {
  it('H / V 变成直线段上的普通锚点', () => {
    const subs = parsePathNodes('M0,0 H100 V50 H0 Z');
    expect(subs).toHaveLength(1);
    expect(show(subs)).toBe('[0,0|100,0|100,50|0,50]');
  });

  it('Q 变成三次贝塞尔：两个控制点各在「锚点 → 控制点」的 2/3 处', () => {
    const subs = parsePathNodes('M0,0 Q30,90 60,0');
    const n0 = subs[0]!.nodes[0]!;
    const n1 = subs[0]!.nodes[1]!;
    expect(n0.out).toEqual({ x: 20, y: 60 });
    // c2 = P1 + 2/3·(Q − P1) = (60,0) + 2/3·(−30,90) = (40,60)
    expect(n1.in).toEqual({ x: 40, y: 60 });
  });

  it('S 反射上一段三次贝塞尔的控制点', () => {
    // C 的第二控制点 (20,0)，当前点 (30,0) ⇒ 反射点 (40,0)
    const subs = parsePathNodes('M0,0 C10,0 20,0 30,0 S50,0 60,0');
    const n1 = subs[0]!.nodes[1]!;
    expect(n1.out).toEqual({ x: 40, y: 0 });
  });

  it('S 的前一段不是三次贝塞尔时不反射（控制点就是当前点）', () => {
    const subs = parsePathNodes('M0,0 L30,0 S50,0 60,0');
    expect(subs[0]!.nodes[1]!.out).toEqual({ x: 30, y: 0 });
  });

  it('一个命令跟多组参数 = 多段', () => {
    const subs = parsePathNodes('M0,0 L10,0 20,0 30,0');
    expect(subs[0]!.nodes).toHaveLength(4);
  });

  it('M 之后的多组参数按 L 处理', () => {
    const subs = parsePathNodes('M0,0 10,0 20,0');
    expect(show(subs)).toBe('(0,0|10,0|20,0)');
  });

  it('相对命令按累积坐标解算', () => {
    const subs = parsePathNodes('m10,10 l5,0 l0,5');
    expect(show(subs)).toBe('(10,10|15,10|15,15)');
  });

  it('数字之间省略分隔符也能切（1-2 / .5.5）', () => {
    const subs = parsePathNodes('M0,0L1-2L.5.5');
    expect(show(subs)).toBe('(0,0|1,-2|0.5,0.5)');
  });
});

describe('parsePathNodes — 闭合', () => {
  it('末点与起点重合时合并，起点继承末点的进入手柄', () => {
    const subs = parsePathNodes('M0,0 L10,0 L10,10 L0,0 Z');
    // 4 个锚点写出来，末点 (0,0) 与起点重合 ⇒ 合并成 3 个
    expect(subs[0]!.nodes).toHaveLength(3);
    expect(subs[0]!.closed).toBe(true);
  });

  it('末点与起点**不**重合时，Z 的那一段是直线（两侧手柄清零）', () => {
    // roundPolygonPath 生成的路径正是这一形态：最后一段是边的剩余部分
    const subs = parsePathNodes('M5,0 L20,0 L20,10 Z');
    const sp = subs[0]!;
    expect(sp.closed).toBe(true);
    expect(sp.nodes[0]!.in).toBeNull();
    expect(sp.nodes[2]!.out).toBeNull();
    // 三个锚点都在：末点没有被当成重复点删掉
    expect(sp.nodes).toHaveLength(3);
  });

  it('圆角矩形有 2×顶点数 个锚点（每个角落被切成「弧两端」两个切点）', () => {
    // `roundPolygonPath` 的形态是 `M a0 A b0 L a1 A b1 L …`：绕过一个顶点是一段弧，
    // a 与 b 是它的两个切点。所以四个角 ⇒ 八个锚点。Illustrator 里把圆角矩形
    // 转成路径也是这个数 —— 不是我们把点炸开了。
    const d = shapeGeometry('rect', { w: 100, h: 100, radius: 24 }).d;
    const subs = parsePathNodes(d);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.nodes).toHaveLength(8);
    expect(subs[0]!.closed).toBe(true);
    // 圆角被折成了 4 段曲线：有 out 手柄的锚点数 = 顶点数
    expect(subs[0]!.nodes.filter((n) => n.out).length).toBe(4);
  });

  it('无圆角矩形是纯顶点环', () => {
    const subs = parsePathNodes(shapeGeometry('rect', { w: 100, h: 60 }).d);
    expect(show(subs)).toBe('[0,0|100,0|100,60|0,60]');
  });
});

describe('parsePathNodes — 弧', () => {
  it('椭圆解析出 4 个节点，正好是四个极值点', () => {
    const subs = parsePathNodes(shapeGeometry('ellipse', { w: 100, h: 100 }).d);
    const sp = subs[0]!;
    expect(sp.closed).toBe(true);
    expect(sp.nodes).toHaveLength(4);
    const pts = sp.nodes.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`).sort();
    expect(pts).toEqual(['0,50', '100,50', '50,0', '50,100']);
  });

  it('弧转贝塞尔之后仍在圆上（90° 分段的逼近误差应小于千分之一）', () => {
    const subs = parsePathNodes(shapeGeometry('ellipse', { w: 100, h: 100 }).d);
    const sp = subs[0]!;
    let worst = 0;
    for (let i = 0; i < sp.nodes.length; i++) {
      const pts = sampleSegment(sp.nodes[i]!, sp.nodes[(i + 1) % sp.nodes.length]!, 20);
      for (const p of pts) worst = Math.max(worst, Math.abs(Math.hypot(p.x - 50, p.y - 50) - 50));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('半径为 0 的弧退化成直线段', () => {
    const subs = parsePathNodes('M0,0 A0,0 0 0 1 50,0');
    expect(show(subs)).toBe('(0,0|50,0)');
  });

  it('起终点重合的弧整段被忽略（规范要求）', () => {
    const subs = parsePathNodes('M0,0 A50,50 0 1 0 0,0 L10,0');
    expect(show(subs)).toBe('(0,0|10,0)');
  });

  it('半径过小时按规范等比放大到刚好容下弦长（不会出现 NaN）', () => {
    const subs = parsePathNodes('M0,0 A1,1 0 0 1 100,0');
    for (const n of subs[0]!.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });
});

describe('serializePathNodes — 结构幂等', () => {
  const cases = [
    'M10,10 C20,0 40,0 50,10 L50,50 Z',
    'M0,0 L100,0 L100,60 L0,60 Z',
    'M0,0 C10,0 20,0 30,0 S50,0 60,0 Z',
    'M0,0 Q30,90 60,0 T120,0 Z',
    'M0,0 A50,50 0 0 1 100,0 Z',
    'M0,0 L10,0 L10,10',
  ];

  it('序列化到字符串层面是不动点（路径字符串稳定 = 光栅化缓存稳定）', () => {
    for (const d of cases) {
      const once = parsePathNodes(d);
      const s1 = serializePathNodes(once);
      const twice = parsePathNodes(s1);
      // 首次序列化会把坐标舍入到两位小数，所以第二次的结构**可能**与第一次
      // 差一点点；但那之后必须彻底稳定 —— 否则每帧同步都会产出新的 DOM 字符串。
      expect(serializePathNodes(twice), d).toBe(s1);
      expect(twice[0]!.nodes.length, d).toBe(once[0]!.nodes.length);
    }
  });

  it('直线段用 L 输出，带手柄的段用 C', () => {
    expect(serializePathNodes(parsePathNodes('M0,0 L10,0'))).toBe('M0,0 L10,0');
    expect(serializePathNodes(parsePathNodes('M0,0 C10,0 20,0 30,0'))).toBe('M0,0 C10,0 20,0 30,0');
  });

  it('坐标只保留两位小数（路径字符串必须稳定，否则光栅化缓存会被冲掉）', () => {
    const d = serializePathNodes([{ closed: false, nodes: [{ x: 1.23456, y: 2.98765, in: null, out: null }, { x: 3, y: 4, in: null, out: null }] }]);
    expect(d).toBe('M1.23,2.99 L3,4');
  });
});

describe('segmentCount', () => {
  it('闭合路径的段数 = 节点数（最后一段回到起点）', () => {
    const sp = parsePathNodes('M0,0 L10,0 L10,10 Z')[0]!;
    expect(segmentCount(sp)).toBe(3);
  });

  it('开放路径的段数 = 节点数 − 1', () => {
    const sp = parsePathNodes('M0,0 L10,0 L10,10')[0]!;
    expect(segmentCount(sp)).toBe(2);
  });

  it('单点路径没有段', () => {
    expect(segmentCount({ closed: false, nodes: [{ x: 0, y: 0, in: null, out: null }] })).toBe(0);
  });
});

describe('insertNodeOnSegment — 必须保形', () => {
  /** 某一段在参数 t 处的点。 */
  const at = (a: PathNode, b: PathNode, t: number): Vec => {
    const p0: Vec = { x: a.x, y: a.y };
    const p3: Vec = { x: b.x, y: b.y };
    return cubicPoint(p0, a.out ?? p0, b.in ?? p3, p3, t);
  };

  /**
   * 在「全局参数 u」处取点：细分之后两段拼起来应当与原段**逐点**相同。
   *
   * 用精确参数而不是「在 101 个采样里找最近的」—— 后者本身带一个参数误差，
   * 在曲率大的地方能差出 0.7 个像素，于是判据变成在量测试的采样密度。
   */
  function pointAt(after: SubPath, t0: number, u: number): Vec {
    const a = after.nodes[0]!;
    const mid = after.nodes[1]!;
    const b = after.nodes[2]!;
    return u <= t0 ? at(a, mid, u / t0) : at(mid, b, (u - t0) / (1 - t0));
  }

  it('曲线段细分后逐点相同（de Casteljau）', () => {
    const sp: SubPath = parsePathNodes('M0,0 C20,80 80,80 100,0')[0]!;
    const t0 = 0.3;
    const after = insertNodeOnSegment(sp, 0, t0);
    expect(after.nodes).toHaveLength(3);

    const before = sampleSegment(sp.nodes[0]!, sp.nodes[1]!, 100);
    let worst = 0;
    for (let i = 0; i <= 100; i++) {
      const u = i / 100;
      const p = pointAt(after, t0, u);
      worst = Math.max(worst, Math.hypot(p.x - before[i]!.x, p.y - before[i]!.y));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('细分后的新锚点落在原曲线上', () => {
    const sp: SubPath = parsePathNodes('M0,0 C20,80 80,80 100,0')[0]!;
    const after = insertNodeOnSegment(sp, 0, 0.5);
    const mid = after.nodes[1]!;
    const truth = cubicPoint({ x: 0, y: 0 }, { x: 20, y: 80 }, { x: 80, y: 80 }, { x: 100, y: 0 }, 0.5);
    expect(mid.x).toBeCloseTo(truth.x, 6);
    expect(mid.y).toBeCloseTo(truth.y, 6);
  });

  it('直线段细分后不长出手柄（否则「加点」会平白把直线变弯）', () => {
    const sp = parsePathNodes('M0,0 L100,0')[0]!;
    const after = insertNodeOnSegment(sp, 0, 0.5);
    expect(after.nodes[1]!.in).toBeNull();
    expect(after.nodes[1]!.out).toBeNull();
    expect(after.nodes[0]!.out).toBeNull();
    expect(after.nodes[2]!.in).toBeNull();
    expect(serializePathNodes([after])).toBe('M0,0 L50,0 L100,0');
  });

  it('只有一侧有手柄时，原来没有的那一侧细分后仍然没有', () => {
    const sp: SubPath = {
      closed: false,
      nodes: [
        { x: 0, y: 0, in: null, out: { x: 30, y: 40 } },
        { x: 100, y: 0, in: null, out: null },
      ],
    };
    const after = insertNodeOnSegment(sp, 0, 0.5);
    expect(after.nodes[0]!.out).not.toBeNull();
    expect(after.nodes[2]!.in).toBeNull();
  });

  it('闭合路径的最后一段（回到起点那一段）也能插点', () => {
    const sp = parsePathNodes('M0,0 L100,0 L100,100 Z')[0]!;
    const after = insertNodeOnSegment(sp, 2, 0.5);
    expect(after.nodes).toHaveLength(4);
    // 新点落在 (50,50)
    expect(after.nodes[3]!.x).toBeCloseTo(50, 6);
    expect(after.nodes[3]!.y).toBeCloseTo(50, 6);
  });

  it('越界的段下标返回原对象', () => {
    const sp = parsePathNodes('M0,0 L10,0')[0]!;
    expect(insertNodeOnSegment(sp, 5, 0.5)).toBe(sp);
  });
});

describe('removeNode', () => {
  it('删掉一个锚点，相邻两段合并', () => {
    const sp = parsePathNodes('M0,0 L50,0 L100,0')[0]!;
    const after = removeNode(sp, 1);
    expect(after.nodes).toHaveLength(2);
    expect(serializePathNodes([after])).toBe('M0,0 L100,0');
  });

  it('闭合路径少于 3 个锚点时拒绝删除（会退化成来回的一条线）', () => {
    const sp = parsePathNodes('M0,0 L50,0 L100,0 Z')[0]!;
    const once = removeNode(sp, 0);
    expect(once.nodes).toHaveLength(3);
    expect(removeNode(once, 0)).toBe(once);
  });

  it('开放路径保留 2 个锚点（一条直线段是有意义的）', () => {
    const sp = parsePathNodes('M0,0 L50,0 L100,0')[0]!;
    const after = removeNode(sp, 0);
    expect(after.nodes).toHaveLength(2);
  });
});

describe('moveNode', () => {
  it('手柄跟着锚点平移（漏掉的话曲线会被拉成锥形）', () => {
    const sp: SubPath = {
      closed: false,
      nodes: [
        { x: 0, y: 0, in: null, out: { x: 10, y: 0 } },
        { x: 50, y: 0, in: { x: 40, y: 0 }, out: null },
      ],
    };
    const after = moveNode(sp, 0, { x: 0, y: 20 });
    expect(after.nodes[0]!.out).toEqual({ x: 10, y: 20 });
    // 另一个锚点不受影响
    expect(after.nodes[1]!.in).toEqual({ x: 40, y: 0 });
  });

  it('不原地改（撤销栈里存的是引用，原地改会让「撤销」失效）', () => {
    const sp = parsePathNodes('M0,0 L10,0')[0]!;
    const before = JSON.stringify(sp);
    moveNode(sp, 0, { x: 5, y: 5 });
    expect(JSON.stringify(sp)).toBe(before);
  });
});

describe('setHandle', () => {
  const two: SubPath = {
    closed: false,
    nodes: [
      { x: 0, y: 0, in: { x: -10, y: 0 }, out: { x: 10, y: 0 } },
      { x: 50, y: 0, in: { x: 40, y: 0 }, out: null },
    ],
  };

  it('mirror = true 且另一侧存在 ⇒ 镜像（方向相反、长度相同）', () => {
    const after = setHandle(two, 0, 'out', { x: 0, y: 30 }, true);
    expect(after.nodes[0]!.out).toEqual({ x: 0, y: 30 });
    expect(after.nodes[0]!.in).toEqual({ x: 0, y: -30 });
  });

  it('mirror = false ⇒ 只动这一侧（角点）', () => {
    const after = setHandle(two, 0, 'out', { x: 0, y: 30 }, false);
    expect(after.nodes[0]!.in).toEqual({ x: -10, y: 0 });
  });

  it('另一侧本来就不存在时不凭空创建一个（否则相邻直线段会被拖弯）', () => {
    // 节点 1 没有 out 手柄 ⇒ 拖它的 in 时不该顺手给 out 也造一个。
    const after = setHandle(two, 1, 'in', { x: 20, y: 0 }, true);
    expect(after.nodes[1]!.out).toBeNull();
    expect(after.nodes[1]!.in).toEqual({ x: 20, y: 0 });
  });

  it('拖 in 侧同样镜像 out 侧', () => {
    const after = setHandle(two, 0, 'in', { x: 0, y: -12 }, true);
    expect(after.nodes[0]!.out).toEqual({ x: 0, y: 12 });
  });
});

describe('nearestOnPath（双击加点靠它定位）', () => {
  it('直线段走解析解：垂足就是最近点', () => {
    const subs = parsePathNodes('M0,0 L100,0');
    const hit = nearestOnPath(subs, { x: 30, y: 10 })!;
    expect(hit.seg).toBe(0);
    expect(hit.t).toBeCloseTo(0.3, 6);
    expect(hit.dist).toBeCloseTo(10, 6);
  });

  it('直线段超出两端时钳到端点', () => {
    const subs = parsePathNodes('M0,0 L100,0');
    expect(nearestOnPath(subs, { x: -40, y: 0 })!.t).toBe(0);
    expect(nearestOnPath(subs, { x: 140, y: 0 })!.t).toBe(1);
  });

  it('曲线段上找到的点确实落在曲线上（dist 与真实距离一致）', () => {
    const subs = parsePathNodes('M0,0 C0,100 100,100 100,0');
    const target = { x: 50, y: 30 };
    const hit = nearestOnPath(subs, target)!;
    const p = cubicAt(subs[0]!.nodes[0]!, subs[0]!.nodes[1]!, hit.t);
    expect(Math.hypot(p.x - target.x, p.y - target.y)).toBeCloseTo(hit.dist, 6);
    // 粗采样只有 24 份，精化之后应当明显优于它 —— 否则说明二分那段没生效
    expect(hit.dist).toBeGreaterThan(0);
  });

  it('超过 maxDist 一律返回 null', () => {
    const subs = parsePathNodes('M0,0 L100,0');
    expect(nearestOnPath(subs, { x: 50, y: 40 }, 5)).toBeNull();
    expect(nearestOnPath(subs, { x: 50, y: 3 }, 5)).not.toBeNull();
  });

  it('闭合路径的最后一段（回到起点那一段）也能命中', () => {
    const subs = parsePathNodes('M0,0 L100,0 L100,100 Z');
    const hit = nearestOnPath(subs, { x: 50, y: 50 })!;
    expect(hit.seg).toBe(2);
  });

  it('多段之间取全局最近的那一段', () => {
    const subs = parsePathNodes('M0,0 L100,0 L100,100');
    expect(nearestOnPath(subs, { x: 100, y: 60 })!.seg).toBe(1);
    expect(nearestOnPath(subs, { x: 40, y: 2 })!.seg).toBe(0);
  });

  it('命中之后插点，形状不变（双击加点的端到端判据）', () => {
    const subs = parsePathNodes('M0,0 C20,80 80,80 100,0');
    const target = { x: 50, y: 45 };
    const hit = nearestOnPath(subs, target)!;
    const after = insertNodeOnSegment(subs[0]!, hit.seg, hit.t);
    // 新锚点就是那个命中点 —— 用户双击哪里，点就长在哪里
    const added = after.nodes[hit.seg + 1]!;
    expect(added.x).toBeCloseTo(cubicAt(subs[0]!.nodes[0]!, subs[0]!.nodes[1]!, hit.t).x, 6);
    expect(added.y).toBeCloseTo(cubicAt(subs[0]!.nodes[0]!, subs[0]!.nodes[1]!, hit.t).y, 6);
  });
});

describe('mapNodes', () => {
  it('锚点与控制点一起变换（漏掉手柄会让曲线在缩放后扭曲）', () => {
    const subs = parsePathNodes('M0,0 C10,0 20,0 30,0');
    const scaled = mapNodes(subs, (p) => ({ x: p.x * 2, y: p.y * 2 }));
    const n0 = scaled[0]!.nodes[0]!;
    const n1 = scaled[0]!.nodes[1]!;
    expect(n0.out).toEqual({ x: 20, y: 0 });
    expect(n1.in).toEqual({ x: 40, y: 0 });
    expect(n1.x).toBe(60);
  });
});

describe('cubicAt', () => {
  it('直线段是**线性**参数化', () => {
    // 把缺失的控制点补成锚点本身（p1 = p0、p2 = p3）会得到缓入缓出的参数化：
    // t = 0.3 落在 21.6% 处而不是 30% 处。症状是「双击直线段，点在别处长出来」。
    const subs = parsePathNodes('M0,0 L100,0');
    const [a, b] = subs[0]!.nodes;
    expect(cubicAt(a!, b!, 0.3)).toEqual({ x: 30, y: 0 });
    expect(cubicAt(a!, b!, 0.5)).toEqual({ x: 50, y: 0 });
  });

  it('曲线段在 t=0 / 1 处正好是两端锚点', () => {
    const subs = parsePathNodes('M0,0 C20,80 80,80 100,0');
    const [a, b] = subs[0]!.nodes;
    expect(cubicAt(a!, b!, 0)).toEqual({ x: 0, y: 0 });
    expect(cubicAt(a!, b!, 1)).toEqual({ x: 100, y: 0 });
  });
});
