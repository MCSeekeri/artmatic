import { describe, expect, it } from 'vitest';
import {
  ANCHOR_GAP,
  EDGE_MARGIN,
  computePopoverPosition,
  computePreviewPosition,
} from '../../src/ui/controls/popover';

const VP = { width: 1280, height: 720 };
const rect = (left: number, top: number, w = 24, h = 22) => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

describe('computePreviewPosition — 预览浮层不遮菜单', () => {
  const preview = { width: 260, height: 180 };

  it('空间足够时贴在当前菜单右侧', () => {
    const cur = rect(100, 100, 200, 300);
    const p = computePreviewPosition(cur, [cur], 120, preview, VP);
    expect(p.x).toBe(300 + ANCHOR_GAP);
    expect(p.y).toBe(120);
  });

  it('二级菜单翻到左侧时，预览贴二级菜单左边（这是截图里的 bug）', () => {
    // 一级菜单贴右边缘，二级菜单翻到它左边
    const parent = rect(1104, 100, 156, 300);
    const sub = rect(880, 100, 220, 300);
    const p = computePreviewPosition(sub, [parent, sub], 120, preview, VP);
    // 贴 sub 右边会压住 parent（且越界），正确落点是 sub 左边
    expect(p.x).toBe(880 - preview.width - ANCHOR_GAP);
  });

  it('一级菜单靠右：预览翻到菜单左侧，而不是越界', () => {
    const cur = rect(1000, 100, 260, 300);
    const p = computePreviewPosition(cur, [cur], 110, preview, VP);
    expect(p.x).toBe(1000 - preview.width - ANCHOR_GAP);
  });

  it('四面都放不下时钳进视口，不返回负坐标', () => {
    const vp = { width: 300, height: 200 };
    const cur = rect(20, 10, 260, 180);
    const p = computePreviewPosition(cur, [cur], 20, preview, vp);
    expect(p.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
    expect(p.x + preview.width).toBeLessThanOrEqual(vp.width - EDGE_MARGIN);
  });
});

describe('computePopoverPosition — bottom-start', () => {
  it('空间足够时贴在锚点左下', () => {
    const p = computePopoverPosition(rect(100, 100), { width: 180, height: 200 }, VP);
    expect(p.x).toBe(100);
    expect(p.y).toBe(100 + 22 + ANCHOR_GAP);
    expect(p.flipped).toBe(false);
  });

  it('下方放不下 → 翻到上方（这是「窗口底部右键菜单溢出」的正解）', () => {
    const anchor = rect(100, 700); // 视口高 720，下面只剩 0px
    const p = computePopoverPosition(anchor, { width: 180, height: 200 }, VP);
    expect(p.flipped).toBe(true);
    expect(p.y).toBe(700 - 200 - ANCHOR_GAP);
    expect(p.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
  });

  it('锚点靠顶但面板放得下 → 不翻转，正常贴下方', () => {
    const p = computePopoverPosition(rect(100, 10), { width: 180, height: 600 }, VP);
    expect(p.flipped).toBe(false);
    expect(p.y).toBe(10 + 22 + ANCHOR_GAP);
  });

  it('面板高到上下都放不下 → 纵向钉在边距上，横向仍按锚点摆', () => {
    const p = computePopoverPosition(rect(100, 10), { width: 180, height: 800 }, VP);
    expect(p.y).toBe(EDGE_MARGIN);
    expect(p.x).toBe(100);
  });


  it('右边缘：横向钳进视口', () => {
    const p = computePopoverPosition(rect(1260, 100), { width: 180, height: 200 }, VP);
    expect(p.x).toBeLessThanOrEqual(VP.width - EDGE_MARGIN - 180);
    expect(p.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
  });

  it('锚点在左上角负坐标时也不越界', () => {
    const p = computePopoverPosition(rect(-50, -50), { width: 180, height: 200 }, VP);
    expect(p.x).toBe(EDGE_MARGIN);
    expect(p.y).toBe(EDGE_MARGIN);
  });

  it('面板比视口还大时也不返回负值（贴左上，交给自己滚动）', () => {
    const p = computePopoverPosition(rect(600, 300), { width: 2000, height: 2000 }, VP);
    expect(p.x).toBe(EDGE_MARGIN);
    expect(p.y).toBe(EDGE_MARGIN);
  });
});

describe('computePopoverPosition — bottom-end', () => {
  it('右对齐到锚点右边', () => {
    const p = computePopoverPosition(rect(1000, 100), { width: 180, height: 200 }, VP, 'bottom-end');
    expect(p.x).toBe(1000 + 24 - 180);
  });
});

describe('computePopoverPosition — right-start（子菜单）', () => {
  it('空间足够时贴父项右边', () => {
    const p = computePopoverPosition(rect(300, 200), { width: 160, height: 180 }, VP, 'right-start');
    expect(p.x).toBe(300 + 24 + ANCHOR_GAP);
    expect(p.flipped).toBe(false);
  });

  it('右边放不下 → 翻到左侧', () => {
    const anchor = rect(1200, 200);
    const p = computePopoverPosition(anchor, { width: 160, height: 180 }, VP, 'right-start');
    expect(p.flipped).toBe(true);
    expect(p.x).toBe(1200 - 160 - ANCHOR_GAP);
  });

  it('翻转后仍不越左边界（钳制）', () => {
    const anchor = rect(30, 200);
    const p = computePopoverPosition(anchor, { width: 160, height: 180 }, VP, 'right-start', 400);
    expect(p.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
  });

  it('纵向跟着父项，但贴底时钳住', () => {
    const p = computePopoverPosition(rect(300, 700), { width: 160, height: 180 }, VP, 'right-start');
    expect(p.y).toBeLessThanOrEqual(VP.height - EDGE_MARGIN - 180);
  });
});

describe('computePopoverPosition — 结论性断言', () => {
  it('任意锚点 + 任意面板尺寸下，结果永远在视口内（除非面板比视口大）', () => {
    for (const panelW of [80, 180, 400]) {
      for (const panelH of [60, 200, 500]) {
        for (let x = -20; x <= VP.width + 20; x += 137) {
          for (let y = -20; y <= VP.height + 20; y += 91) {
            for (const placement of ['bottom-start', 'bottom-end', 'right-start'] as const) {
              const p = computePopoverPosition(rect(x, y), { width: panelW, height: panelH }, VP, placement);
              const label = `${placement} panel=${panelW}x${panelH} anchor=(${x},${y}) → (${p.x},${p.y})`;
              expect(p.x, label).toBeGreaterThanOrEqual(EDGE_MARGIN);
              expect(p.y, label).toBeGreaterThanOrEqual(EDGE_MARGIN);
              expect(p.x + panelW, label).toBeLessThanOrEqual(VP.width);
              expect(p.y + panelH, label).toBeLessThanOrEqual(VP.height);
            }
          }
        }
      }
    }
  });
});
