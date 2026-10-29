import { describe, expect, it } from 'vitest';
import {
  EDGE_COUNT,
  MAX_SHAPE_EDGES,
  MAX_SHAPE_VERTS,
  POLY_GLSL,
  POLY_SHAPES,
  SHAPE_RANGE,
  VERTEX_COUNT,
  rotPlanes,
  shapeById,
  type Vec4,
} from '../../src/algos/polyhedra';

/**
 * 几何表的守卫。
 *
 * 这里守的不是「画出来好不好看」，而是**表的自洽**：坐标抄错一个符号、
 * 区间错位一格、四维顶点的 w 忘了填 —— 三种都会渲染出一幅「看起来像另一个
 * 立体」的画，而编译、类型、E2E 全都通过。
 *
 * 判据都是机制的：正多面体的定义本身就是「所有棱等长、且没有更近的顶点对」，
 * 所以棱数（6 / 12 / 12 / 30 / 30 与 10 / 32 / 24 / 96）不是记下来的数字，
 * 而是坐标正确时的必然结果。
 */

const dist = (a: Vec4, b: Vec4): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);

/** 每个形体的 (顶点数, 棱数)。错一个数就说明坐标或连棱判据坏了。 */
const EXPECT: Record<string, [number, number]> = {
  tetra: [4, 6],
  cube: [8, 12],
  octa: [6, 12],
  dodeca: [20, 30],
  icosa: [12, 30],
  cell5: [5, 10],
  cell8: [16, 32],
  cell16: [8, 24],
  cell24: [24, 96],
};

describe('形体表：坐标与连棱', () => {
  it('九个形体的顶点数与棱数都对', () => {
    expect(POLY_SHAPES.map((s) => s.id).sort()).toEqual(Object.keys(EXPECT).sort());
    for (const s of POLY_SHAPES) {
      const want = EXPECT[s.id]!;
      expect([s.verts.length, s.edges.length], s.id).toEqual(want);
    }
  });

  it('所有棱等长（正多面体的定义，不是记下来的常数）', () => {
    for (const s of POLY_SHAPES) {
      const lens = s.edges.map(([i, j]) => dist(s.verts[i]!, s.verts[j]!));
      const min = Math.min(...lens);
      const max = Math.max(...lens);
      expect(max / min, `${s.id} 的棱不等长 → 坐标写错了`).toBeLessThan(1 + 1e-6);
    }
  });

  it('所有顶点在外接球上（半径 1），且没有重合顶点', () => {
    for (const s of POLY_SHAPES) {
      for (const v of s.verts) expect(Math.hypot(v[0], v[1], v[2], v[3]), s.id).toBeCloseTo(1, 9);
      const keys = new Set(s.verts.map((v) => v.map((x) => x.toFixed(6)).join(',')));
      expect(keys.size, `${s.id} 有重合顶点`).toBe(s.verts.length);
    }
  });

  it('没有自己连自己的棱，也没有重复的棱', () => {
    for (const s of POLY_SHAPES) {
      const seen = new Set<string>();
      for (const [i, j] of s.edges) {
        expect(i, s.id).not.toBe(j);
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        expect(seen.has(key), `${s.id} 的棱 ${key} 重复`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('三维形体的 w 恒为 0，四维形体必须有顶点离开 w = 0', () => {
    for (const s of POLY_SHAPES) {
      const maxW = Math.max(...s.verts.map((v) => Math.abs(v[3])));
      if (s.dim === 3) expect(maxW, `${s.id} 是三维形体，w 必须为 0`).toBe(0);
      else expect(maxW, `${s.id} 是四维形体，w 全 0 就退化成三维了`).toBeGreaterThan(0.3);
    }
  });
});

describe('平坦表：区间与常量数组', () => {
  it('区间首尾相接、覆盖整张表（错位一格 = 渲染成另一个形体）', () => {
    let v = 0;
    let e = 0;
    for (const s of POLY_SHAPES) {
      const r = SHAPE_RANGE[s.id]!;
      expect(r.vBase, `${s.id} 的顶点区间没接上`).toBe(v);
      expect(r.vCount).toBe(s.verts.length);
      expect(r.eBase, `${s.id} 的棱区间没接上`).toBe(e);
      expect(r.eCount).toBe(s.edges.length);
      v += s.verts.length;
      e += s.edges.length;
    }
    expect(v).toBe(VERTEX_COUNT);
    expect(e).toBe(EDGE_COUNT);
  });

  it('循环上界真的是最大形体的规模（否则长的那截被截断）', () => {
    expect(MAX_SHAPE_VERTS).toBe(Math.max(...POLY_SHAPES.map((s) => s.verts.length)));
    expect(MAX_SHAPE_EDGES).toBe(Math.max(...POLY_SHAPES.map((s) => s.edges.length)));
  });

  it('GLSL 常量数组的条目数与表一致', () => {
    const split = POLY_GLSL.indexOf('const ivec2 PE');
    expect(split, '找不到棱表 —— 生成器的拼装方式变了').toBeGreaterThan(0);
    const vertSection = POLY_GLSL.slice(0, split);
    const verts = [...vertSection.matchAll(/vec4\(/g)].length;
    const edges = [...POLY_GLSL.matchAll(/ivec2\(/g)].length;
    expect(verts, '顶点表条目数对不上（错一个数就是整张表错位）').toBe(VERTEX_COUNT);
    expect(edges, '棱表条目数对不上').toBe(EDGE_COUNT);
  });

  it('未知 id 返回 null，而不是抛错或给出别的形体', () => {
    expect(shapeById('no-such')).toBeNull();
    expect(shapeById('cube')!.dim).toBe(3);
    expect(shapeById('cell24')!.dim).toBe(4);
  });
});

describe('旋转平面', () => {
  it('三维：三个轴的平面都不碰 w', () => {
    for (const axis of ['x', 'y', 'z']) {
      const [a, b, c, d] = rotPlanes(3, axis);
      for (const idx of [a, b, c, d]) expect(idx, `三维的 ${axis} 轴转到了 w 上`).toBeLessThan(3);
    }
  });

  it('三维：轴本身不动（旋转平面不含该轴）', () => {
    const idx = { x: 0, y: 1, z: 2 } as const;
    for (const [axis, i] of Object.entries(idx)) {
      const [a, b] = rotPlanes(3, axis);
      expect([a, b], `${axis} 轴被转走了`).not.toContain(i);
    }
  });

  it('四维：该轴不动，主次两个平面不相同（否则进动退化成加速自旋）', () => {
    const idx = { x: 0, y: 1, z: 2, w: 3 } as const;
    for (const [axis, i] of Object.entries(idx)) {
      const [a, b, c, d] = rotPlanes(4, axis);
      expect([a, b], `${axis} 轴被转走了`).not.toContain(i);
      expect(a === c && b === d, `${axis} 轴的次平面与主平面相同`).toBe(false);
      for (const k of [a, b, c, d]) expect(k).toBeGreaterThanOrEqual(0);
      for (const k of [a, b, c, d]) expect(k).toBeLessThan(4);
    }
  });

  it('四维的四个轴给出四种不同的主平面（W 必须真的能被选中）', () => {
    const seen = new Set(['x', 'y', 'z', 'w'].map((a) => rotPlanes(4, a).slice(0, 2).join(',')));
    expect(seen.size).toBe(4);
  });

  it('认不出的轴退回缺省，而不是越界', () => {
    for (const dim of [3, 4] as const) {
      const [a, b] = rotPlanes(dim, 'no-such-axis');
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(dim);
    }
  });
});
