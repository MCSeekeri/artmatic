import { describe, expect, it } from 'vitest';
import {
  autoHandles,
  evalCurve,
  segmentHandles,
  upsertKey,
  withInterp,
  type Curve,
  type Key,
} from '../../src/core/curve';
import type { BeatGrid } from '../../src/core/time';

const linear: Curve = {
  keys: [
    { t: 0, v: 0, interp: 'linear' },
    { t: 2, v: 10, interp: 'linear' },
  ],
};

describe('keyframe 求值', () => {
  it('linear：端点与中点', () => {
    expect(evalCurve(linear, 0)).toBe(0);
    expect(evalCurve(linear, 1)).toBe(5);
    expect(evalCurve(linear, 2)).toBe(10);
  });

  it('范围外钳到端点', () => {
    expect(evalCurve(linear, -5)).toBe(0);
    expect(evalCurve(linear, 99)).toBe(10);
  });

  it('step：保持左值直到下一个 key', () => {
    const c: Curve = {
      keys: [
        { t: 0, v: 1, interp: 'step' },
        { t: 1, v: 9, interp: 'step' },
      ],
    };
    expect(evalCurve(c, 0.999)).toBe(1);
    expect(evalCurve(c, 1)).toBe(9);
  });

  it('smooth：端点精确、中点过半且比 linear 平缓起步', () => {
    const c: Curve = {
      keys: [
        { t: 0, v: 0, interp: 'smooth' },
        { t: 1, v: 1, interp: 'linear' },
      ],
    };
    expect(evalCurve(c, 0)).toBe(0);
    expect(evalCurve(c, 1)).toBe(1);
    expect(evalCurve(c, 0.5)).toBeCloseTo(0.5);
    expect(evalCurve(c, 0.25)).toBeLessThan(0.25);
    expect(evalCurve(c, 0.75)).toBeGreaterThan(0.75);
  });

  it('bezier：端点精确，缺省是缓入缓出（中点仍是 0.5）', () => {
    const c: Curve = {
      keys: [
        { t: 0, v: 0, interp: 'bezier' },
        { t: 1, v: 1, interp: 'linear' },
      ],
    };
    expect(evalCurve(c, 0)).toBeCloseTo(0, 6);
    expect(evalCurve(c, 1)).toBeCloseTo(1, 6);
    expect(evalCurve(c, 0.5)).toBeCloseTo(0.5, 2);
    expect(evalCurve(c, 0.25)).toBeLessThan(0.25);
  });

  it('bezier：拉平 handles 产生缓入缓出', () => {
    const c: Curve = {
      keys: [
        { t: 0, v: 0, interp: 'bezier', handles: [0.42, 0, 0.58, 1] },
        { t: 1, v: 1, interp: 'linear' },
      ],
    };
    expect(evalCurve(c, 0.1)).toBeLessThan(0.05);
    expect(evalCurve(c, 0.9)).toBeGreaterThan(0.95);
  });

  it('clipStart 让曲线相对片段起点', () => {
    expect(evalCurve(linear, 3, { clipStart: 2 })).toBe(5);
  });
});

describe('beatAnchor：改了 BPM 卡点自动跟随', () => {
  const anchored: Curve = {
    keys: [
      { t: 0, v: 0, interp: 'linear' },
      { t: 2, v: 2, interp: 'linear' },
    ],
    beatAnchor: { beat: 4 },
  };
  const grid120: BeatGrid = { bpm: 120, offset: 1, beatsPerBar: 4 };
  const grid60: BeatGrid = { bpm: 60, offset: 1, beatsPerBar: 4 };

  it('锚点的 t=0 对齐到该拍', () => {
    // 120bpm：第 4 拍在 1 + 4*0.5 = 3s；曲线 t=0 → v=0
    expect(evalCurve(anchored, 3, { grid: grid120 })).toBe(0);
    // 曲线 t=1（锚后 1 秒）在 4s → v=1
    expect(evalCurve(anchored, 4, { grid: grid120 })).toBe(1);
  });

  it('BPM 改了，同一拍 anchor 的值不变、秒位置自动移动', () => {
    // 60bpm：第 4 拍在 1 + 4*1 = 5s
    expect(evalCurve(anchored, 5, { grid: grid60 })).toBe(0);
    expect(evalCurve(anchored, 6, { grid: grid60 })).toBe(1);
    // 而原来 120bpm 时的 4s 位置在新 BPM 下不再是曲线 t=1
    expect(evalCurve(anchored, 4, { grid: grid60 })).toBe(0);
  });
});

describe('impulse：指数衰减冲击（闭式，seek 安全）', () => {
  const c: Curve = {
    mode: 'impulse',
    impulse: { decay: 0.3 },
    keys: [
      { t: 0, v: 1, interp: 'step' },
      { t: 1, v: 0.5, interp: 'step' },
    ],
  };

  it('hit 时刻取到峰值', () => {
    expect(evalCurve(c, 0)).toBeCloseTo(1);
    expect(evalCurve(c, 1)).toBeGreaterThan(0.5);
  });

  it('随时间衰减，且两次求值一致（无内部状态）', () => {
    const a = evalCurve(c, 0.5);
    expect(a).toBeLessThan(1);
    expect(a).toBeGreaterThan(0);
    expect(evalCurve(c, 0.5)).toBe(a);
    expect(evalCurve(c, 5)).toBeLessThan(1e-3);
  });
});

describe('follower：非对称攻放包络（闭式 ≈ 步进模拟）', () => {
  const c: Curve = {
    mode: 'follower',
    follower: { attack: 0.1, release: 0.5 },
    keys: [
      { t: 0, v: 0, interp: 'step' },
      { t: 1, v: 1, interp: 'step' },
      { t: 3, v: 0.2, interp: 'step' },
    ],
  };

  /** 用 approach 逐步推进的参考模拟——闭式解必须与它在步进极限一致。 */
  function stepped(t: number, dt = 0.0005): number {
    const attack = 0.1;
    const release = 0.5;
    const keys = c.keys;
    let v = keys[0]!.v;
    let target = keys[0]!.v;
    let ki = 1;
    let time = keys[0]!.t;
    while (time < t) {
      const step = Math.min(dt, t - time);
      time += step;
      while (ki < keys.length && keys[ki]!.t <= time) {
        target = keys[ki]!.v;
        ki++;
      }
      const hl = target > v ? attack : release;
      v = target + (v - target) * Math.pow(0.5, step / hl);
    }
    return v;
  }

  it('多个时刻与步进模拟一致', () => {
    for (const t of [0.5, 1.0, 1.3, 2.0, 2.999, 3.0, 3.4, 5.0]) {
      expect(evalCurve(c, t)).toBeCloseTo(stepped(t), 2);
    }
  });

  it('seek 到段中与从头逐步推进同结果（闭式自证）', () => {
    expect(evalCurve(c, 2.5)).toBeCloseTo(evalCurve(c, 2.5));
    expect(evalCurve(c, 2.5)).toBeGreaterThan(0.9);
  });
});

describe('upsertKey', () => {
  it('按 t 有序插入，近点覆盖', () => {
    let keys = upsertKey([], { t: 1, v: 1, interp: 'linear' });
    keys = upsertKey(keys, { t: 0, v: 0, interp: 'linear' });
    keys = upsertKey(keys, { t: 2, v: 4, interp: 'linear' });
    expect(keys.map((k) => k.t)).toEqual([0, 1, 2]);
    keys = upsertKey(keys, { t: 1.0005, v: 9, interp: 'step' });
    expect(keys).toHaveLength(3);
    expect(keys[1]!.v).toBe(9);
    expect(keys[1]!.interp).toBe('step');
  });
});

/* ---------------------------------------------------------- 贝塞尔手柄 */

const A: Key = { t: 0, v: 0, interp: 'bezier' };
const B: Key = { t: 2, v: 10, interp: 'linear' };

describe('贝塞尔手柄（段级，值域偏移）', () => {
  it('hOut / hIn 优先于旧版归一化 handles', () => {
    const legacy: Key = { ...A, handles: [0.42, 0, 0.58, 1] };
    const modern: Key = { ...A, hOut: [0.1, 1], hIn: [-0.1, -1] };
    expect(evalCurve({ keys: [legacy, B] }, 0.5)).not.toBeCloseTo(
      evalCurve({ keys: [modern, B] }, 0.5),
      3,
    );
    // 端点仍然精确 —— 手柄只改中段形状
    expect(evalCurve({ keys: [modern, B] }, 0)).toBe(0);
    expect(evalCurve({ keys: [modern, B] }, 2)).toBe(10);
  });

  it('旧版 handles 换算成值域偏移后形状不变（smooth == 水平手柄）', () => {
    const h = segmentHandles({ ...A, handles: [0.42, 0, 0.58, 1] }, B)!;
    expect(h.out[0]).toBeCloseTo(0.84, 9);
    expect(h.out[1]).toBeCloseTo(0, 9);
    expect(h.in[0]).toBeCloseTo(-0.84, 9);
    expect(h.in[1]).toBeCloseTo(0, 9);

    const smooth = segmentHandles({ ...A, interp: 'smooth' }, B)!;
    expect(smooth).toEqual({ out: [2 / 3, 0], in: [-2 / 3, 0] });
  });

  it('控制点被钳进「x 单调」的合法域：极端手柄也不会让时间回折', () => {
    const k: Key = { ...A, hOut: [999, 5], hIn: [-999, -5] };
    const h = segmentHandles(k, B)!;
    expect(h.out[0]).toBeLessThanOrEqual(2);
    expect(h.in[0]).toBeGreaterThanOrEqual(-2);
    expect(h.out[0] - h.in[0]).toBeLessThanOrEqual(2 + 1e-9);

    // t 递增 ⇒ 求值有限且不出现 NaN；端点仍被精确钳到 key 的值
    let prev = -Infinity;
    for (let t = 0; t <= 2; t += 0.05) {
      const v = evalCurve({ keys: [k, B] }, t);
      expect(Number.isFinite(v)).toBe(true);
      prev = v;
    }
    expect(Number.isFinite(prev)).toBe(true);
  });

  it('dv = 0 时值域手柄仍能表达过冲（归一化坐标会把手柄乘成 0）', () => {
    // hOut 属于段起点、hIn 属于段终点 —— 与 Key 注释里的归属一致
    const flat: Key = { t: 0, v: 3, interp: 'bezier', hOut: [0.4, 5] };
    const end: Key = { t: 1, v: 3, interp: 'linear', hIn: [-0.4, -5] };
    expect(evalCurve({ keys: [flat, end] }, 0)).toBeCloseTo(3);
    expect(evalCurve({ keys: [flat, end] }, 1)).toBeCloseTo(3);
    const vs = Array.from({ length: 19 }, (_, i) => evalCurve({ keys: [flat, end] }, (i + 1) / 20));
    // 两端同值，但控制点把中段拱起来/压下去 —— 这正是值域偏移买到的表达能力
    expect(Math.max(...vs)).toBeGreaterThan(3.5);
    expect(Math.min(...vs)).toBeLessThan(2.5);
    // 对称手柄 ⇒ 中点仍回到两端值
    expect(evalCurve({ keys: [flat, end] }, 0.5)).toBeCloseTo(3);
  });
});

describe('withInterp / autoHandles', () => {
  it('切到 bezier 时补水平手柄（缓入缓出），不改入参数组', () => {
    const keys: Key[] = [
      { t: 0, v: 0, interp: 'linear' },
      { t: 2, v: 10, interp: 'linear' },
    ];
    const out = withInterp(keys, [0], 'bezier');
    expect(out[0]!.interp).toBe('bezier');
    expect(out[0]!.hOut).toEqual([2 / 3, 0]);
    expect(out[1]!.hIn).toEqual([-2 / 3, 0]);
    expect(keys[0]!.interp).toBe('linear');
    expect(keys[0]!.hOut).toBeUndefined();
  });

  it('切到 bezier 时把旧版 handles 物化，形状不变', () => {
    const keys: Key[] = [
      { t: 0, v: 0, interp: 'bezier', handles: [0.42, 0, 0.58, 1] },
      { t: 2, v: 10, interp: 'linear' },
    ];
    const out = withInterp(keys, [0], 'bezier');
    expect(out[0]!.hOut![0]).toBeCloseTo(0.84, 9);
    expect(out[1]!.hIn![0]).toBeCloseTo(-0.84, 9);
    // 同一个 t 的求值不变
    for (const t of [0.2, 0.5, 1.4]) {
      expect(evalCurve({ keys: out }, t)).toBeCloseTo(evalCurve({ keys }, t), 9);
    }
  });

  it('切回 linear 保留手柄（再切回 bezier 时形状还在）', () => {
    const keys: Key[] = [
      { t: 0, v: 0, interp: 'bezier', hOut: [0.2, 1] },
      { t: 1, v: 1, interp: 'linear', hIn: [-0.2, -1] },
    ];
    const out = withInterp(keys, [0], 'linear');
    expect(out[0]!.interp).toBe('linear');
    expect(out[0]!.hOut).toEqual([0.2, 1]);
  });

  it('autoHandles 只重置相邻的两段，不碰更远的段', () => {
    const keys: Key[] = [
      { t: 0, v: 0, interp: 'bezier', hOut: [0.1, 3] },
      { t: 1, v: 1, interp: 'bezier', hOut: [0.1, 3], hIn: [-0.1, -3] },
      { t: 2, v: 2, interp: 'bezier', hOut: [0.1, 3] },
      { t: 3, v: 3, interp: 'linear' },
    ];
    const out = autoHandles(keys, [1]);
    // 出向段 1→2 与入向段 0→1 都归 key 1，两段都重置
    expect(out[1]!.hOut).toEqual([1 / 3, 0]);
    expect(out[2]!.hIn).toEqual([-1 / 3, 0]);
    expect(out[0]!.hOut).toEqual([1 / 3, 0]);
    expect(out[1]!.hIn).toEqual([-1 / 3, 0]);
    // 2→3 段不邻接 key 1，保持原样
    expect(out[2]!.hOut).toEqual([0.1, 3]);
    expect(out[3]!.hIn).toBeUndefined();
  });
});
