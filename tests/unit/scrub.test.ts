import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PX_PER_STEP,
  NO_MODIFIERS,
  SCRUB_THRESHOLD_PX,
  beginScrub,
  commitValue,
  effectiveStep,
  formatValue,
  modifiersEqual,
  parseValue,
  rebase,
  scrubValue,
  sensitivity,
  shouldBeginScrub,
  type Modifiers,
} from '../../src/ui/controls/scrub';

const cfg = { step: 1, min: 0, max: 100 };
const any = (p: Partial<Modifiers>): Modifiers => ({ ...NO_MODIFIERS, ...p });

describe('修饰键语义', () => {
  it('Alt 精细 ×0.1，Shift 粗调 ×10，无修饰为 1', () => {
    expect(sensitivity(NO_MODIFIERS)).toBe(1);
    expect(sensitivity(any({ alt: true }))).toBe(0.1);
    expect(sensitivity(any({ shift: true }))).toBe(10);
  });

  it('Alt 与 Shift 同按时 Alt 胜出（「慢」的直觉更强）', () => {
    expect(sensitivity(any({ alt: true, shift: true }))).toBe(0.1);
  });

  it('Ctrl 不改变灵敏度——它管的是吸附不是快慢', () => {
    expect(sensitivity(any({ ctrl: true }))).toBe(1);
  });

  it('effectiveStep 无浮点噪声（0.1 的 0.1 倍不该算出 18 位小数）', () => {
    expect(effectiveStep({ step: 0.1 }, any({ alt: true }))).toBe(0.01);
    expect(effectiveStep({ step: 0.1 }, NO_MODIFIERS)).toBe(0.1);
  });

  it('modifiersEqual 逐位比较', () => {
    expect(modifiersEqual(NO_MODIFIERS, any({}))).toBe(true);
    expect(modifiersEqual(NO_MODIFIERS, any({ ctrl: true }))).toBe(false);
    expect(modifiersEqual(any({ alt: true }), any({ shift: true }))).toBe(false);
  });
});

describe('scrubValue — 拖动映射', () => {
  const s = beginScrub(10);

  it('向右拖增大，向左拖减小，且与像素成正比', () => {
    expect(scrubValue(s, DEFAULT_PX_PER_STEP, NO_MODIFIERS, cfg)).toBeCloseTo(11, 6);
    expect(scrubValue(s, -DEFAULT_PX_PER_STEP, NO_MODIFIERS, cfg)).toBeCloseTo(9, 6);
    expect(scrubValue(s, DEFAULT_PX_PER_STEP * 5, NO_MODIFIERS, cfg)).toBeCloseTo(15, 6);
  });

  it('用累计位移而不是增量（同一 dx 幂等，不漂移）', () => {
    let v = 10;
    for (let i = 0; i < 50; i += 1) v = scrubValue(s, 20, NO_MODIFIERS, cfg);
    expect(v).toBeCloseTo(15, 6);
  });

  it('Alt 精细：同样位移产生的增量是常规的 1/10', () => {
    const normal = scrubValue(s, 40, NO_MODIFIERS, cfg); // 10 + (40/4)*1 = 20
    const fine = scrubValue(s, 40, any({ alt: true }), cfg); // 10 + (40/4)*0.1 = 11
    expect(normal).toBeCloseTo(20, 6);
    expect(fine - 10).toBeCloseTo((normal - 10) / 10, 6);
  });

  it('Shift 粗调：同样位移产生的增量是常规的 10 倍', () => {
    const normal = scrubValue(s, 4, NO_MODIFIERS, cfg); // 10 + 1 = 11
    const coarse = scrubValue(s, 4, any({ shift: true }), cfg); // 10 + 10 = 20
    expect(coarse - 10).toBeCloseTo((normal - 10) * 10, 6);
  });

  it('Ctrl 吸附到 step 整数倍', () => {
    // dx 使 raw ≈ 10.37，吸附后必须是整数
    const v = scrubValue(s, DEFAULT_PX_PER_STEP * 0.37, any({ ctrl: true }), cfg);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBe(10);
  });

  it('钳到 min/max，且 Ctrl 吸附后仍在界内', () => {
    expect(scrubValue(beginScrub(99), 100 * DEFAULT_PX_PER_STEP, NO_MODIFIERS, cfg)).toBe(100);
    expect(scrubValue(beginScrub(1), -100 * DEFAULT_PX_PER_STEP, NO_MODIFIERS, cfg)).toBe(0);
    const edge = scrubValue(beginScrub(99.6), 4 * DEFAULT_PX_PER_STEP, any({ ctrl: true }), cfg);
    expect(edge).toBeLessThanOrEqual(100);
  });

  it('未给 min/max 时不钳制（无界参数如坐标）', () => {
    const free = { step: 1 };
    expect(scrubValue(beginScrub(0), 1000 * DEFAULT_PX_PER_STEP, NO_MODIFIERS, free)).toBe(1000);
    expect(scrubValue(beginScrub(0), -50 * DEFAULT_PX_PER_STEP, NO_MODIFIERS, free)).toBe(-50);
  });

  it('pxPerStep 可调，且非法值回落到默认 4', () => {
    expect(scrubValue(s, 8, NO_MODIFIERS, { ...cfg, pxPerStep: 8 })).toBeCloseTo(11, 6);
    expect(scrubValue(s, 4, NO_MODIFIERS, { ...cfg, pxPerStep: 0 })).toBeCloseTo(11, 6);
  });
});

describe('换修饰键不跳值（rebase）', () => {
  it('不加 rebase 会跳值——这就是要防的现象', () => {
    const s = beginScrub(10);
    const coarse = scrubValue(s, 40, NO_MODIFIERS, cfg); // 10 + 10 = 20
    expect(coarse).toBeCloseTo(20, 6);
    // 同一个 session 直接换 Alt：会把「已经走掉的 40px」按新灵敏度重算 → 跳到 11
    const jumped = scrubValue(s, 40, any({ alt: true }), cfg);
    expect(jumped).toBeCloseTo(11, 6);
    expect(Math.abs(jumped - coarse)).toBeGreaterThan(1); // 证明隐患真实存在
  });

  it('rebase 之后切换点两侧连续（不跳值）', () => {
    let s = beginScrub(10);
    const dx = 40;
    const before = scrubValue(s, dx, NO_MODIFIERS, cfg); // 20
    s = rebase(s, before, dx); // 修饰键变化时重锚
    const after = scrubValue(s, dx, any({ alt: true }), cfg);
    expect(after).toBeCloseTo(before, 6);
    // 继续往右拖，增量按 Alt 灵敏度走
    const more = scrubValue(s, dx + DEFAULT_PX_PER_STEP, any({ alt: true }), cfg);
    expect(more).toBeCloseTo(before + 0.1, 6);
  });

  it('rebase 不动 originValue（Esc 仍能回到手势起点）', () => {
    let s = beginScrub(10);
    s = rebase(s, 25, 60);
    expect(s.originValue).toBe(10);
  });
});

describe('进入 scrub 的阈值与取消', () => {
  it('小位移不算 scrub（算点击 → 聚焦编辑）', () => {
    expect(shouldBeginScrub(0)).toBe(false);
    expect(shouldBeginScrub(1)).toBe(false);
    expect(shouldBeginScrub(2)).toBe(false);
    expect(shouldBeginScrub(3)).toBe(true);
    expect(shouldBeginScrub(-3)).toBe(true);
    expect(SCRUB_THRESHOLD_PX).toBe(3);
  });

  it('beginScrub 起点即锚点，originValue 可恢复', () => {
    const s = beginScrub(42);
    expect(s.originValue).toBe(42);
    expect(s.anchorValue).toBe(42);
    expect(s.anchorDx).toBe(0);
    expect(s.started).toBe(false);
  });
});

describe('commitValue / parseValue / formatValue', () => {
  it('commit 量化 + 钳制', () => {
    expect(commitValue(3.7, { step: 1, min: 0, max: 10 })).toBe(4);
    expect(commitValue(99, { step: 1, min: 0, max: 10 })).toBe(10);
    expect(commitValue(-5, { step: 1, min: 0, max: 10 })).toBe(0);
  });

  it('commit 尊重显式 precision', () => {
    expect(commitValue(1.23456, { step: 0, precision: 2 })).toBe(1.23);
  });

  it('parseValue：还在编辑中的输入返回 null（别提交）', () => {
    for (const s of ['', ' ', '-', '.', '-.', 'abc']) expect(parseValue(s), s).toBeNull();
    expect(parseValue('12')).toBe(12);
    expect(parseValue(' -3.5 ')).toBe(-3.5);
    expect(parseValue('1,5')).toBe(1.5); // 逗号小数点
  });

  it('formatValue 按精度补零/截断', () => {
    expect(formatValue(1.5, 2)).toBe('1.50');
    expect(formatValue(1.239, 2)).toBe('1.24');
    expect(formatValue(3, 0)).toBe('3');
    expect(formatValue(Number.NaN, 2)).toBe('');
  });
});
