import { describe, expect, it } from 'vitest';
import { bottomScopeBlend, neutralizeBottomBlend } from '../../src/engine/scope-blend';
import type { RenderOp } from '../../src/engine/stack';
import type { BlendMode } from '../../src/core/schema';

/** 造一个 source op（只带判据用得到的字段）。 */
function src(z: number, blend: BlendMode): RenderOp {
  return {
    type: 'source',
    z,
    source: { clip: {} as never, opacity: 1, transform: { x: 0, y: 0, sx: 1, sy: 1, rot: 0 }, blend },
  };
}

describe('bottomScopeBlend —— 作用域里「贴背景」的那个混合模式', () => {
  it('取最底下那个 source 的混合模式', () => {
    expect(bottomScopeBlend([src(0, 'add'), src(1, 'screen')])).toBe('add');
  });

  it('跳过特效 op（它不带混合模式）', () => {
    const fx: RenderOp = { type: 'effect', z: 1, clip: {} as never };
    expect(bottomScopeBlend([fx, src(0, 'multiply')])).toBe('multiply');
  });

  it('转场用它自己的 blend（取入画片段的那一个）', () => {
    const tr: RenderOp = {
      type: 'transition',
      z: 0,
      from: {} as never,
      to: {} as never,
      defId: 'x',
      values: {},
      progress: 0.5,
      blend: 'screen',
    };
    expect(bottomScopeBlend([tr])).toBe('screen');
  });

  it('空作用域回落到 normal', () => {
    expect(bottomScopeBlend([])).toBe('normal');
  });
});

describe('neutralizeBottomBlend —— 只把最底层那个 source 收成 normal', () => {
  it('最底层 source 被改成 normal，其余原样', () => {
    const ops = [src(0, 'add'), src(1, 'screen')];
    const out = neutralizeBottomBlend(ops);
    expect((out[0] as { source: { blend: BlendMode } }).source.blend).toBe('normal');
    expect((out[1] as { source: { blend: BlendMode } }).source.blend).toBe('screen');
  });

  it('不改动入参（纯函数）', () => {
    const ops = [src(0, 'add')];
    neutralizeBottomBlend(ops);
    expect((ops[0] as { source: { blend: BlendMode } }).source.blend).toBe('add');
  });

  it('特效 op 在前时不影响：第一个 source 才是被改的那个', () => {
    const fx: RenderOp = { type: 'effect', z: 2, clip: {} as never };
    const out = neutralizeBottomBlend([fx, src(0, 'multiply'), src(1, 'add')]);
    expect((out[1] as { source: { blend: BlendMode } }).source.blend).toBe('normal');
    expect((out[2] as { source: { blend: BlendMode } }).source.blend).toBe('add');
  });

  it('只有转场时什么都不改', () => {
    const tr: RenderOp = {
      type: 'transition',
      z: 0,
      from: {} as never,
      to: {} as never,
      defId: 'x',
      values: {},
      progress: 0.5,
      blend: 'screen',
    };
    const out = neutralizeBottomBlend([tr]);
    expect((out[0] as { blend: BlendMode }).blend).toBe('screen');
  });
});
