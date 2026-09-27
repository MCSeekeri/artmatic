import { describe, expect, it } from 'vitest';
import {
  fadeWeight,
  freeRangeAt,
  hasOverlap,
  MIN_CLIP_LENGTH,
  moveSpan,
  resizeSpan,
  spanAt,
  splitSpan,
  type Span,
} from '../../src/core/clips';

const DUR = 20;

function lane(): Span[] {
  return [
    { id: 'a', start: 0, end: 2 },
    { id: 'b', start: 3, end: 5 },
  ];
}

describe('基础查询', () => {
  it('spanAt 半开区间', () => {
    const clips = lane();
    expect(spanAt(clips, 1)?.id).toBe('a');
    expect(spanAt(clips, 2)).toBeNull();
    expect(spanAt(clips, 3)?.id).toBe('b');
  });

  it('freeRangeAt 找出空档', () => {
    expect(freeRangeAt(lane(), 2.5, DUR)).toEqual({ start: 2, end: 3 });
    expect(freeRangeAt(lane(), 1, DUR)).toBeNull();
    expect(freeRangeAt(lane(), 10, DUR)).toEqual({ start: 5, end: DUR });
  });

  it('hasOverlap', () => {
    expect(hasOverlap(lane())).toBe(false);
    expect(hasOverlap([{ id: 'x', start: 0, end: 4 }, ...lane()])).toBe(true);
  });
});

describe('moveSpan · reject（落点非法就整次不动）', () => {
  it('落点撞上邻居 → 保持原位', () => {
    const out = moveSpan(lane(), 'a', 2.5, DUR, 'reject');
    const a = out.find((c) => c.id === 'a')!;
    expect([a.start, a.end]).toEqual([0, 2]);
  });

  it('落点越界后撞上邻居 → 保持原位', () => {
    const out = moveSpan(lane(), 'b', -5, DUR, 'reject');
    const b = out.find((c) => c.id === 'b')!;
    expect([b.start, b.end]).toEqual([3, 5]);
  });

  it('合法落点原样通过（可以越过邻居，只要落点是空的）', () => {
    const out = moveSpan(lane(), 'a', 6, DUR, 'reject');
    expect(out.find((c) => c.id === 'a')!.start).toBe(6);
  });

  it('贴边不视为重叠（半开区间）', () => {
    const out = moveSpan(lane(), 'a', 1, DUR, 'reject');
    expect(out.find((c) => c.id === 'a')!.start).toBe(1);
  });
});

describe('moveSpan · push（挤开邻居，级联向右）', () => {
  it('挤右侧邻居并级联', () => {
    const out = moveSpan(lane(), 'a', 2.5, DUR, 'push');
    const a = out.find((c) => c.id === 'a')!;
    const b = out.find((c) => c.id === 'b')!;
    expect([a.start, a.end]).toEqual([2.5, 4.5]);
    expect([b.start, b.end]).toEqual([4.5, 6.5]);
    expect(hasOverlap(out)).toBe(false);
  });

  it('三条链式级联', () => {
    const clips: Span[] = [
      { id: 'a', start: 0, end: 2 },
      { id: 'b', start: 2, end: 3 },
      { id: 'c', start: 3, end: 4 },
    ];
    const out = moveSpan(clips, 'a', 1, DUR, 'push');
    expect(out.find((c) => c.id === 'b')!.start).toBe(3);
    expect(out.find((c) => c.id === 'c')!.start).toBe(4);
  });

  it('级联推出工程末尾时整体回吸', () => {
    const clips: Span[] = [
      { id: 'a', start: 0, end: 2 },
      { id: 'b', start: 18, end: 20 },
    ];
    const out = moveSpan(clips, 'a', 17.5, DUR, 'push');
    // b 被推到 19.5–21.5 超出 → 整体回吸 1.5
    expect(hasOverlap(out)).toBe(false);
    expect(out.every((c) => c.end <= DUR && c.start >= 0)).toBe(true);
  });
});

describe('moveSpan · trim（吃掉邻居重叠部分）', () => {
  it('裁右侧邻居的头部', () => {
    const out = moveSpan(lane(), 'a', 2.5, DUR, 'trim');
    const b = out.find((c) => c.id === 'b')!;
    expect([b.start, b.end]).toEqual([4.5, 5]);
  });

  it('完全盖住邻居 → 删除', () => {
    const clips: Span[] = [
      { id: 'a', start: 0, end: 2 },
      { id: 'b', start: 3, end: 4 },
    ];
    const out = moveSpan(clips, 'a', 2.5, DUR, 'trim');
    expect(out.find((c) => c.id === 'b')).toBeUndefined();
  });

  it('从中间盖住 → 邻居裂成两段（右段带 #r 后缀待 store 换新 id）', () => {
    const clips: Span[] = [
      { id: 'a', start: 8, end: 9 },
      { id: 'c', start: 2, end: 6 },
    ];
    const out = moveSpan(clips, 'a', 3, DUR, 'trim');
    const left = out.find((c) => c.id === 'c')!;
    const right = out.find((c) => c.id === 'c#r')!;
    expect([left.start, left.end]).toEqual([2, 3]);
    expect([right.start, right.end]).toEqual([4, 6]);
  });

  it('裁完不足 MIN_CLIP_LENGTH 的碎片被丢弃', () => {
    const clips: Span[] = [
      { id: 'a', start: 0, end: 2 },
      { id: 'b', start: 2, end: 2 + MIN_CLIP_LENGTH / 2 },
    ];
    const out = moveSpan(clips, 'a', 1.9, DUR, 'trim');
    expect(out.find((c) => c.id === 'b')).toBeUndefined();
  });
});

describe('resizeSpan（永远 reject 语义）', () => {
  it('拖 end 撞邻居 → 钳住', () => {
    const out = resizeSpan(lane(), 'a', 'end', 4, DUR);
    expect(out.find((c) => c.id === 'a')!.end).toBe(3);
  });

  it('拖 start 不越 0，且不长于 MIN', () => {
    const out = resizeSpan(lane(), 'a', 'start', -3, DUR);
    expect(out.find((c) => c.id === 'a')!.start).toBe(0);
    const out2 = resizeSpan(lane(), 'a', 'start', 1.99, DUR);
    expect(out2.find((c) => c.id === 'a')!.start).toBeCloseTo(2 - MIN_CLIP_LENGTH);
  });
});

describe('splitSpan', () => {
  it('切成两段，右段新 id', () => {
    const out = splitSpan(lane(), 'b', 4, () => 'new-id')!;
    expect(out).toHaveLength(3);
    const left = out.find((c) => c.id === 'b')!;
    const right = out.find((c) => c.id === 'new-id')!;
    expect([left.start, left.end]).toEqual([3, 4]);
    expect([right.start, right.end]).toEqual([4, 5]);
  });

  it('离边太近拒绝切', () => {
    expect(splitSpan(lane(), 'b', 3.01, () => 'x')).toBeNull();
    expect(splitSpan(lane(), 'b', 4.98, () => 'x')).toBeNull();
  });
});

describe('fadeWeight', () => {
  const clip = { id: 'a', start: 2, end: 6 };
  it('无 fade 恒 1', () => {
    expect(fadeWeight(clip, 0, 2)).toBe(1);
  });
  it('斜坡端点与中点', () => {
    expect(fadeWeight(clip, 1, 2)).toBe(0);
    expect(fadeWeight(clip, 1, 2.5)).toBeCloseTo(0.5);
    expect(fadeWeight(clip, 1, 3)).toBe(1);
    expect(fadeWeight(clip, 1, 5.5)).toBeCloseTo(0.5);
  });
});
