import { describe, expect, it } from 'vitest';
import {
  activeRangeOf,
  frameOfSec,
  nextRangeName,
  normalizeRange,
  rangeDurationSec,
  rangeFrames,
  snapSecToFrame,
  spanFromRange,
} from '../../src/core/preclip';
import type { AssetTrimRange } from '../../src/core/schema';

/**
 * 预剪辑范围的纯逻辑。
 *
 * 这一层的判据只有一个：**界面显示的帧数 = 落进工程的时间长度**。任何一处
 * 取整规则走岔，都会在时间轴上表现为「插入 3 秒的范围得到 3.03 秒」——看起来
 * 像鼠标抖了一下，实际上没人会对齐它。
 */

const FPS = 30;

function range(inSec: number, outSec: number, name = 'r'): AssetTrimRange {
  return { id: name, name, inSec, outSec };
}

describe('帧 ↔ 秒', () => {
  it('就近取整到帧', () => {
    expect(frameOfSec(0.1, FPS)).toBe(3);
    expect(frameOfSec(0.116, FPS)).toBe(3); // 3.48 → 3
    expect(frameOfSec(0.117, FPS)).toBe(4); // 3.51 → 4
    expect(snapSecToFrame(0.116, FPS)).toBeCloseTo(3 / 30, 12);
  });

  it('负值归 0（素材没有负时间）', () => {
    expect(frameOfSec(-1, FPS)).toBe(0);
    expect(snapSecToFrame(-1, FPS)).toBe(0);
  });

  it('非法 fps 不产生 NaN / 除零', () => {
    expect(Number.isFinite(frameOfSec(1, 0))).toBe(true);
    expect(Number.isFinite(snapSecToFrame(1, 0))).toBe(true);
  });
});

describe('normalizeRange：写入前的唯一取整入口', () => {
  it('把任意秒值吸到帧栅格', () => {
    const r = normalizeRange({ inSec: 0.11, outSec: 1.19 }, 10, FPS)!;
    expect(r.inSec).toBeCloseTo(3 / 30, 12);
    expect(r.outSec).toBeCloseTo(36 / 30, 12);
  });

  it('出点越界 → 钳到素材末尾', () => {
    const r = normalizeRange({ inSec: 0, outSec: 99 }, 2, FPS)!;
    expect(r.outSec).toBe(2);
  });

  it('入点 >= 出点 → 至少保留 1 帧（从入点起）', () => {
    const r = normalizeRange({ inSec: 1, outSec: 1 }, 2, FPS)!;
    expect(rangeFrames(r, FPS)).toBe(1);
    expect(r.outSec - r.inSec).toBeCloseTo(1 / 30, 12);
  });

  it('素材短于一帧 → null（不造 0 长片段）', () => {
    expect(normalizeRange({ inSec: 0, outSec: 1 }, 0.01, FPS)).toBeNull();
    expect(normalizeRange({ inSec: 0, outSec: 1 }, 0, FPS)).toBeNull();
  });

  it('入点落在最后一帧之后 → 仍收成最后一帧的 1 帧，而不是 null', () => {
    const r = normalizeRange({ inSec: 1.99, outSec: 2 }, 2, FPS)!;
    expect(rangeFrames(r, FPS)).toBe(1);
    expect(r.outSec).toBe(2);
  });
});

describe('rangeFrames / rangeDurationSec', () => {
  it('帧数与时长同源', () => {
    const r = range(0.5, 1.5);
    expect(rangeFrames(r, FPS)).toBe(30);
    expect(rangeDurationSec(r, FPS)).toBeCloseTo(1, 12);
  });

  it('对齐过的范围不会出现半帧误差', () => {
    const r = range(3 / 30, 9 / 30);
    expect(rangeDurationSec(r, FPS)).toBeCloseTo(6 / 30, 12);
  });
});

describe('spanFromRange：落到时间轴', () => {
  it('长度 = 帧数 / fps，srcIn = 入点', () => {
    const span = spanFromRange(range(1, 2), 5, FPS);
    expect(span.start).toBe(5);
    expect(span.end).toBeCloseTo(6, 12);
    expect(span.srcIn).toBeCloseTo(1, 12);
  });

  it('负的落点归 0', () => {
    expect(spanFromRange(range(0, 1), -3, FPS).start).toBe(0);
  });
});

describe('nextRangeName / activeRangeOf', () => {
  it('取已用编号的最大值 +1', () => {
    expect(nextRangeName([], (n) => `范围 ${n}`)).toBe('范围 1');
    expect(nextRangeName([{ name: '范围 2' }, { name: '范围 7' }], (n) => `范围 ${n}`)).toBe('范围 8');
    // 不以数字结尾的名字不参与编号
    expect(nextRangeName([{ name: '开场' }], (n) => `范围 ${n}`)).toBe('范围 1');
  });

  it('激活 id 失效时回落到第一个（双击插入不该变成整段）', () => {
    const ranges = [range(0, 1, 'a'), range(1, 2, 'b')];
    expect(activeRangeOf({ ranges, activeRangeId: 'b' })?.id).toBe('b');
    expect(activeRangeOf({ ranges, activeRangeId: '不存在' })?.id).toBe('a');
    expect(activeRangeOf({ ranges })?.id).toBe('a');
    expect(activeRangeOf({})).toBeNull();
  });
});
