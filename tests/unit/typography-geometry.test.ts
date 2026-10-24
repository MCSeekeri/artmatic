import { describe, expect, it } from 'vitest';
import {
  MIN_SIZE,
  alignElements,
  boundsOf,
  distribute,
  hitTest,
  hitTestAll,
  hitTestFirst,
  rectsIntersect,
  resizeFramesRotated,
  rotateFrames,
  rotateVec,
  scaleFrames,
  snapAngle,
  snapMove,
  toRects,
  type Rect,
} from '../../src/typography/geometry';

const rect = (id: string, x: number, y: number, w: number, h: number): Rect => ({ id, x, y, w, h });
const CANVAS = { w: 1000, h: 1000 };

describe('boundsOf', () => {
  it('取并集外接框', () => {
    expect(boundsOf([rect('a', 10, 20, 100, 50), rect('b', 200, 0, 50, 200)])).toEqual({
      id: '', x: 10, y: 0, w: 240, h: 200,
    });
  });

  it('空数组返回零框，不返回 Infinity', () => {
    expect(boundsOf([])).toEqual({ id: '', x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('rectsIntersect（框选用）', () => {
  it('相交为真', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 50, h: 50 }, rect('a', 40, 40, 50, 50))).toBe(true);
  });

  it('边贴边不算相交（避免拖框时把刚好擦到边的元素也选上）', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 50, h: 50 }, rect('a', 50, 0, 50, 50))).toBe(false);
  });

  it('完全分离为假', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, rect('a', 100, 100, 10, 10))).toBe(false);
  });
});

describe('snapMove', () => {
  it('阈值内吸附到画布中线', () => {
    const r = snapMove([rect('a', 0, 0, 100, 100)], 498, 0, [], CANVAS, 6);
    expect(r.frames.get('a')!.x).toBe(500);
  });

  it('阈值外不吸附', () => {
    const r = snapMove([rect('a', 0, 0, 100, 100)], 490, 0, [], CANVAS, 6);
    expect(r.frames.get('a')!.x).toBe(490);
  });

  it('threshold <= 0 时完全不吸附（按住 Alt 关吸附）', () => {
    const r = snapMove([rect('a', 0, 0, 100, 100)], 498, 0, [], CANVAS, 0);
    expect(r.frames.get('a')!.x).toBe(498);
    expect(r.guides).toEqual([]);
  });

  it('吸附到其它元素而不是画布', () => {
    const others = [rect('o', 300, 0, 100, 100)];
    const r = snapMove([rect('a', 0, 0, 100, 100)], 297, 0, others, CANVAS, 6);
    expect(r.frames.get('a')!.x).toBe(300);
    expect(r.guides.some((g) => g.target === 'o' && g.pos === 300)).toBe(true);
  });

  it('x 与 y 独立吸附到不同的对象', () => {
    const others = [rect('o', 0, 200, 100, 100)];
    const r = snapMove([rect('a', 0, 0, 100, 100)], 498, 197, others, CANVAS, 6);
    expect(r.frames.get('a')!.x).toBe(500);   // 吸画布中线
    expect(r.frames.get('a')!.y).toBe(200);   // 吸 o 的顶边
  });

  it('被拖元素的三条竖线都能触发吸附（左 / 中 / 右）', () => {
    // 右边缘 598 靠近 600 不在候选里；用元素的右边对齐画布右边缘 1000：
    // x + 100 落在 1000 附近 → x = 897 → 右边 997，距 1000 差 3
    const r = snapMove([rect('a', 0, 0, 100, 100)], 897, 0, [], CANVAS, 6);
    expect(r.frames.get('a')!.x).toBe(900);
  });

  it('多选时按整个选区的并集外接框吸附，并保持相对位置', () => {
    const group = [rect('a', 0, 0, 100, 100), rect('b', 200, 0, 100, 100)];
    const others = [rect('o', 150, 400, 50, 50)];
    const r = snapMove(group, 148, 0, others, CANVAS, 6);
    // 并集左边 148 距 o 的左边 150 差 2 → 整体吸到 150，相对间距不变
    expect(r.frames.get('a')!.x).toBe(150);
    expect(r.frames.get('b')!.x).toBe(350);
    expect(r.frames.get('b')!.x - r.frames.get('a')!.x).toBe(200);
  });

  it('空移动集不抛错', () => {
    expect(snapMove([], 10, 10, [], CANVAS, 6).frames.size).toBe(0);
  });


});

describe('alignElements', () => {
  const target = rect('t', 0, 0, 1000, 600);
  const r = rect('a', 300, 300, 200, 100);

  it('left / right / top / bottom', () => {
    expect(alignElements([r], target, 'left').get('a')).toEqual({ x: 0, y: 300 });
    expect(alignElements([r], target, 'right').get('a')).toEqual({ x: 800, y: 300 });
    expect(alignElements([r], target, 'top').get('a')).toEqual({ x: 300, y: 0 });
    expect(alignElements([r], target, 'bottom').get('a')).toEqual({ x: 300, y: 500 });
  });

  it('居中：把元素中心对到目标中心', () => {
    expect(alignElements([r], target, 'center-h').get('a')).toEqual({ x: 400, y: 300 });
    expect(alignElements([r], target, 'middle').get('a')).toEqual({ x: 300, y: 250 });
  });

  it('居中到画布时目标就是画布框', () => {
    const canvas = rect('canvas', 0, 0, 1000, 600);
    const p = alignElements([r], canvas, 'center-h').get('a')!;
    expect(p.x + r.w / 2).toBe(canvas.w / 2);
  });

  it('只动相关的那一个轴', () => {
    const p = alignElements([r], target, 'left').get('a')!;
    expect(p.y).toBe(r.y);
  });

  it('distribute 的轴在这里返回空（走 distribute()）', () => {
    expect(alignElements([r], target, 'distribute-h').size).toBe(0);
  });

  it('多元素各自对齐同一目标（元素之间会重叠，这是预期语义）', () => {
    const out = alignElements([r, rect('b', 0, 0, 50, 50)], target, 'left');
    expect(out.get('a')!.x).toBe(0);
    expect(out.get('b')!.x).toBe(0);
  });
});

describe('distribute', () => {
  it('少于 3 个元素时无意义，返回空', () => {
    expect(distribute([rect('a', 0, 0, 10, 10), rect('b', 100, 0, 10, 10)], 'h').size).toBe(0);
  });

  it('首尾不动，中间等间隙', () => {
    const rects = [rect('a', 0, 0, 10, 10), rect('b', 20, 0, 10, 10), rect('c', 200, 0, 10, 10)];
    const out = distribute(rects, 'h');
    expect(out.has('a')).toBe(false);
    expect(out.has('c')).toBe(false);
    expect(out.get('b')).toBe(100);
  });

  it('垂直方向同理', () => {
    const rects = [rect('a', 0, 0, 10, 10), rect('b', 0, 20, 10, 10), rect('c', 0, 200, 10, 10)];
    expect(distribute(rects, 'v').get('b')).toBe(100);
  });

  it('已经等距时不改变位置', () => {
    const rects = [rect('a', 0, 0, 10, 10), rect('b', 100, 0, 10, 10), rect('c', 200, 0, 10, 10)];
    expect(distribute(rects, 'h').get('b')).toBe(100);
  });

  it('输入顺序不影响结果', () => {
    const a = rect('a', 0, 0, 10, 10);
    const b = rect('b', 20, 0, 10, 10);
    const c = rect('c', 200, 0, 10, 10);
    expect(distribute([c, a, b], 'h').get('b')).toBe(distribute([a, b, c], 'h').get('b'));
  });
});

describe('scaleFrames', () => {
  const orig = [rect('a', 0, 0, 100, 100)];
  const noMods = { keepRatio: false, fromCenter: false };

  it('右下角把手朝外拖 → 放大', () => {
    const out = scaleFrames(orig, 'se', 100, 100, noMods).get('a')!;
    expect(out).toMatchObject({ x: 0, y: 0, w: 200, h: 200 });
  });

  it('左上角把手朝里拖过头 → 钳到最小尺寸而不是翻转', () => {
    // 负数比例会让元素翻转，而 frame 里没有「翻转」这个语义
    const out = scaleFrames(orig, 'nw', 999, 999, noMods).get('a')!;
    expect(out.w).toBe(MIN_SIZE);
    expect(out.h).toBe(MIN_SIZE);
    expect(out.w).toBeGreaterThan(0);
  });

  it('Shift 保比例：角把手按变化更大的轴主导', () => {
    const wide = [rect('a', 0, 0, 200, 100)];
    const out = scaleFrames(wide, 'se', 100, 0, { keepRatio: true, fromCenter: false }).get('a')!;
    expect(out.w).toBe(300);
    expect(out.h).toBe(150);
  });

  it('Alt 从中心缩放：两边同时长', () => {
    const out = scaleFrames(orig, 'e', 50, 0, { keepRatio: false, fromCenter: true }).get('a')!;
    expect(out.w).toBe(200);
    expect(out.x).toBe(-50);
  });

  it('多选时元素之间的相对间距一同缩放', () => {
    const group = [rect('a', 0, 0, 100, 100), rect('b', 200, 0, 100, 100)];
    const out = scaleFrames(group, 'se', 300, 0, noMods);
    // 外接框 0..300 拉成 0..600，kx = 2
    expect(out.get('a')!.x).toBe(0);
    expect(out.get('a')!.w).toBe(200);
    expect(out.get('b')!.x).toBe(400);
    expect(out.get('b')!.w).toBe(200);
  });

  it('锚定的那条边不动', () => {
    const out = scaleFrames(orig, 'e', 50, 0, noMods).get('a')!;
    expect(out.x).toBe(0);
    expect(out.w).toBe(150);
  });

  it('空集合 / 退化外接框不抛错', () => {
    expect(scaleFrames([], 'se', 10, 10, noMods).size).toBe(0);
    expect(scaleFrames([rect('z', 0, 0, 0, 0)], 'se', 10, 10, noMods).get('z')).toEqual(rect('z', 0, 0, 0, 0));
  });


});

describe('rotateFrames', () => {
  it('绕中心旋转 90° 映射正确（屏幕坐标 y 向下）', () => {
    const out = rotateFrames([rect('a', 0, 0, 10, 10)], { x: 0, y: 0 }, Math.PI / 2).get('a')!;
    expect(out.x).toBeCloseTo(-10, 6);
    expect(out.y).toBeCloseTo(0, 6);
  });

  it('绕自身中心转 360° 回到原位', () => {
    const r = rect('a', 40, 40, 10, 10);
    const out = rotateFrames([r], { x: 45, y: 45 }, Math.PI * 2).get('a')!;
    expect(out.x).toBeCloseTo(40, 6);
    expect(out.y).toBeCloseTo(40, 6);
  });

  it('只旋转位置，不改尺寸（尺寸变化靠 frame.rot）', () => {
    const out = rotateFrames([rect('a', 0, 0, 30, 10)], { x: 0, y: 0 }, 0.3).get('a')!;
    expect(Object.keys(out).sort()).toEqual(['x', 'y']);
  });

  it('非零角度绕自身中心不移动', () => {
    const r = rect('a', 10, 20, 40, 40);
    const out = rotateFrames([r], { x: 30, y: 40 }, 1.1).get('a')!;
    expect(out.x).toBeCloseTo(10, 6);
    expect(out.y).toBeCloseTo(20, 6);
  });
});

describe('toRects', () => {
  it('取 frame 的 x/y/w/h，保持顺序（顺序即 z 序）', () => {
    const els = [
      { id: 'a', frame: { x: 1, y: 2, w: 3, h: 4, rot: 0.5 } },
      { id: 'b', frame: { x: 5, y: 6, w: 7, h: 8, rot: 0 } },
    ];
    expect(toRects(els)).toEqual([
      { id: 'a', x: 1, y: 2, w: 3, h: 4 },
      { id: 'b', x: 5, y: 6, w: 7, h: 8 },
    ]);
  });

  it('丢掉 rot（吸附与对齐一律按未旋转框算）', () => {
    const el = { id: 'a', frame: { x: 0, y: 0, w: 1, h: 1, rot: 1.2 } };
    expect(toRects([el])[0]).not.toHaveProperty('rot');
  });
});

describe('hitTest', () => {
  const rects = [rect('bottom', 0, 0, 100, 100), rect('top', 50, 50, 100, 100)];

  it('返回最上层（数组靠后 = z 序更靠前）的那一个', () => {
    // (60,60) 同时落在两个框里：在排版坐标系里数组末位是最前景
    expect(hitTest(rects, 60, 60)!.id).toBe('top');
  });

  it('只命中一个时返回它', () => {
    expect(hitTest(rects, 10, 10)!.id).toBe('bottom');
  });

  it('都没命中返回 null', () => {
    expect(hitTest(rects, 500, 500)).toBeNull();
  });

  it('边界包含（点在最外沿也算命中），出界即落空', () => {
    expect(hitTest(rects, 0, 0)!.id).toBe('bottom');
    expect(hitTest(rects, 100, 100)!.id).toBe('top'); // top 覆盖 x∈[50,150]
    expect(hitTest(rects, 150, 150)!.id).toBe('top'); // 最外沿
    expect(hitTest(rects, 150.5, 150)).toBeNull(); // 出界
  });

  it('空集合返回 null', () => {
    expect(hitTest([], 0, 0)).toBeNull();
  });
});

describe('hitTestFirst（带否决权 = 中空图形让下层可点）', () => {
  const rects = [rect('bottom', 0, 0, 100, 100), rect('top', 50, 50, 100, 100)];

  it('没有 accept 时与 hitTest 完全一致', () => {
    for (const [x, y] of [
      [60, 60],
      [10, 10],
      [500, 500],
    ] as const) {
      expect(hitTestFirst(rects, x, y)?.id).toBe(hitTest(rects, x, y)?.id ?? undefined);
    }
  });

  it('最上层被否决时继续往下找（透明处穿透）', () => {
    // top 是「中空」的：它框里的点不算数，于是落到下面的 bottom 上。
    expect(hitTestFirst(rects, 60, 60, { accept: (id) => id !== 'top' })!.id).toBe('bottom');
  });

  it('全部被否决 + 都没命中都返回 null', () => {
    expect(hitTestFirst(rects, 60, 60, { accept: () => false })).toBeNull();
    expect(hitTestFirst(rects, 500, 500, { accept: () => true })).toBeNull();
  });

  it('accept 只对框命中的元素求值（不是整张表都问一遍）', () => {
    const asked: string[] = [];
    hitTestFirst(rects, 10, 10, {
      accept: (id) => {
        asked.push(id);
        return true;
      },
    });
    expect(asked).toEqual(['bottom']);
  });

  it('slop 把外接框判定向外放宽（细线压在边缘外侧也点得中）', () => {
    const line = [rect('line', 200, 200, 4, 200)];
    // 指针在框外 2px：默认口径落空，带 3 的 slop 才命中。
    expect(hitTest(line, 205, 300)).toBeNull();
    expect(hitTestFirst(line, 205, 300)).toBeNull();
    expect(hitTestFirst(line, 205, 300, { slop: 3 })!.id).toBe('line');
  });

  it('slop 不放宽 z 序：被否决的最上层仍然让位', () => {
    expect(
      hitTestFirst(rects, 60, 60, { slop: 10, accept: (id) => id !== 'top' })!.id,
    ).toBe('bottom');
  });
});

describe('hitTestAll', () => {
  const rects = [
    rect('bottom', 0, 0, 100, 100),
    rect('mid', 40, 40, 80, 80),
    rect('top', 50, 50, 100, 100),
  ];

  it('返回命中的全部 id，顺序从最上层到最下层', () => {
    // (60,60) 落在三个框里（bottom / mid / top），数组末位 = 最前景。
    expect(hitTestAll(rects, 60, 60)).toEqual(['top', 'mid', 'bottom']);
  });

  it('首个元素与 hitTest 一致（最上层）', () => {
    const all = hitTestAll(rects, 60, 60);
    expect(all[0]).toBe(hitTest(rects, 60, 60)!.id);
  });

  it('只命中一个时返回单元素数组', () => {
    expect(hitTestAll(rects, 10, 10)).toEqual(['bottom']);
  });

  it('都没命中返回空数组', () => {
    expect(hitTestAll(rects, 500, 500)).toEqual([]);
  });

  it('边界包含，出界即落空（与 hitTest 同一口径）', () => {
    expect(hitTestAll(rects, 0, 0)).toEqual(['bottom']);
    expect(hitTestAll(rects, 150, 150)).toEqual(['top']);
    expect(hitTestAll(rects, 150.5, 150)).toEqual([]);
  });

  it('空集合返回空数组', () => {
    expect(hitTestAll([], 0, 0)).toEqual([]);
  });

  it('数组顺序即 z 序：交换两个框的顺序，返回顺序随之交换', () => {
    const swapped = [rect('top', 50, 50, 100, 100), rect('bottom', 0, 0, 100, 100)];
    expect(hitTestAll(swapped, 60, 60)).toEqual(['bottom', 'top']);
  });
});

describe('resizeFramesRotated', () => {
  const noMods = { keepRatio: false, fromCenter: false };
  const r = [rect('a', 0, 0, 100, 100)];

  it('rot = 0 时与直接用 scaleFrames 完全一致（退化等价）', () => {
    const viaRotated = resizeFramesRotated(r, 'se', 30, 20, 0, noMods).get('a')!;
    const direct = scaleFrames(r, 'se', 30, 20, noMods).get('a')!;
    expect(viaRotated.x).toBeCloseTo(direct.x, 9);
    expect(viaRotated.y).toBeCloseTo(direct.y, 9);
    expect(viaRotated.w).toBeCloseTo(direct.w, 9);
    expect(viaRotated.h).toBeCloseTo(direct.h, 9);
  });

  it('rot = 0 时锚定边不动（与 scaleFrames 同一套锚点语义）', () => {
    const out = resizeFramesRotated(r, 'e', 50, 0, 0, noMods).get('a')!;
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.w).toBeCloseTo(150, 9);
  });

  it('旋转 90°：在屏幕上拖「右边把手」往**下**拖，宽度才增长', () => {
    // 元素转了 90°，它的本地 +x 轴指向世界的 +y。所以「拖右边」= 世界向下拖。
    const down = resizeFramesRotated(r, 'e', 0, 50, Math.PI / 2, noMods).get('a')!;
    expect(down.w).toBeCloseTo(150, 6);
    expect(down.h).toBeCloseTo(100, 6);
    // 中心沿本地 +x（世界 +y）移动了「增长量的一半」
    expect(down.y).toBeCloseTo(25, 6);

    // 而往世界 **右** 拖是垂直于把手的方向，尺寸不变（不是「拖了没反应」而是本就该没反应）
    const right = resizeFramesRotated(r, 'e', 50, 0, Math.PI / 2, noMods).get('a')!;
    expect(right.w).toBeCloseTo(100, 6);
    expect(right.x).toBeCloseTo(0, 6);
  });

  it('旋转 90° 时「往下拖右边把手」在未旋转时反而是无效方向', () => {
    // 对照组：同样的世界位移，rot=0 时对 'e' 把手完全没作用。
    const out = resizeFramesRotated(r, 'e', 0, 50, 0, noMods).get('a')!;
    expect(out.w).toBeCloseTo(100, 6);
    expect(out.h).toBeCloseTo(100, 6);
  });

  it('Alt 从中心缩放时不产生位移（本地中心保持不动）', () => {
    const out = resizeFramesRotated(r, 'e', 50, 0, Math.PI / 3, {
      keepRatio: false,
      fromCenter: true,
    }).get('a')!;
    expect(out.x + out.w / 2).toBeCloseTo(50, 6);
    expect(out.y + out.h / 2).toBeCloseTo(50, 6);
    expect(out.w).toBeGreaterThan(100);
  });

  it('Shift 保比例在旋转下同样成立', () => {
    const out = resizeFramesRotated([rect('a', 0, 0, 200, 100)], 'e', 0, 100, Math.PI / 2, {
      keepRatio: true,
      fromCenter: false,
    }).get('a')!;
    expect(out.w / out.h).toBeCloseTo(2, 6);
  });

  it('多选（rot 传 0）时元素之间的相对间距一同缩放', () => {
    const group = [rect('a', 0, 0, 100, 100), rect('b', 200, 0, 100, 100)];
    const out = resizeFramesRotated(group, 'se', 300, 0, 0, noMods);
    expect(out.get('a')!.x).toBeCloseTo(0, 6);
    expect(out.get('b')!.x).toBeCloseTo(400, 6);
    expect(out.get('b')!.w).toBeCloseTo(200, 6);
  });

  it('不改变元素数量，也不丢 id', () => {
    const out = resizeFramesRotated(r, 'se', 10, 10, 0.4, noMods);
    expect([...out.keys()]).toEqual(['a']);
  });

  it('零位移时是恒等变换（哪怕元素已经转了）', () => {
    const out = resizeFramesRotated(r, 'se', 0, 0, 1.2, noMods).get('a')!;
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.w).toBeCloseTo(100, 6);
    expect(out.h).toBeCloseTo(100, 6);
  });
});

describe('rotateVec', () => {
  it('旋转 90° 把 +x 映到 +y（屏幕坐标向下为正）', () => {
    const v = rotateVec({ x: 1, y: 0 }, Math.PI / 2);
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.y).toBeCloseTo(1, 9);
  });

  it('正反各转一次回到原处', () => {
    const v = rotateVec(rotateVec({ x: 3, y: -7 }, 0.9), -0.9);
    expect(v.x).toBeCloseTo(3, 9);
    expect(v.y).toBeCloseTo(-7, 9);
  });

  it('零角度不变', () => {
    expect(rotateVec({ x: 5, y: 2 }, 0)).toEqual({ x: 5, y: 2 });
  });
});

describe('snapAngle', () => {
  it('关闭时不吸附', () => {
    expect(snapAngle(0.4, false)).toBe(0.4);
  });

  it('开启时吸到 15° 的整数倍', () => {
    const step = (Math.PI / 180) * 15;
    expect(snapAngle(step * 3 + 0.01, true)).toBeCloseTo(step * 3, 9);
    expect(snapAngle(0.02, true)).toBe(0);
  });
});
