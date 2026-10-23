import { describe, expect, it } from 'vitest';
import {
  codeHash,
  hasRunnableScripts,
  sanitizeScripts,
  scriptNeedsByElement,
  scriptSignature,
  SCRIPT_LIMITS,
  type TypographyScript,
} from '../../src/typography/script/model';
import { checkScriptSyntax, clearCompileCache, compileScript } from '../../src/typography/script/compile';
import { createBudget, ScriptApiError } from '../../src/typography/script/api';
import {
  resetScriptDiagnostics,
  scriptDiagnosticsFor,
  scriptDiagnosticsRevision,
  reportScriptDiagnostic,
  subscribeScriptDiagnostics,
} from '../../src/typography/script/diagnostics';
import type { TypographyDocument } from '../../src/typography/document';

function docWith(scripts: TypographyScript[]): TypographyDocument {
  return {
    size: { w: 1920, h: 1080 },
    background: { kind: 'none' },
    elements: [
      {
        id: 'a',
        kind: 'text',
        name: 'A',
        frame: { x: 0, y: 0, w: 100, h: 40, rot: 0 },
        blend: 'normal',
        opacity: 1,
        visible: true,
        locked: false,
        animations: [],
        runs: [{ text: 'hi' }],
        style: {} as never,
        autoHeight: false,
      },
      {
        id: 'b',
        kind: 'shape',
        name: 'B',
        frame: { x: 0, y: 0, w: 100, h: 100, rot: 0 },
        blend: 'normal',
        opacity: 1,
        visible: true,
        locked: false,
        animations: [],
        shape: 'svg',
        path: 'M0,0 L10,0 L10,10 Z',
        fill: { kind: 'none' },
        stroke: null,
      },
    ],
    fonts: [],
    scripts,
  };
}

const script = (over: Partial<TypographyScript> = {}): TypographyScript => ({
  id: 's1',
  name: 'S',
  code: 'ctx.opacity;',
  enabled: true,
  ...over,
});

describe('sanitizeScripts', () => {
  it('缺省 / 非数组 / 坏条目都不抛，坏条目整条丢弃', () => {
    expect(sanitizeScripts(undefined).scripts).toEqual([]);
    expect(sanitizeScripts('nope').dropped).toEqual(['scripts']);
    const r = sanitizeScripts([null, 3, {}, { id: 'x' }, { id: 'x', code: '   ' }]);
    expect(r.scripts).toEqual([]);
    expect(r.dropped.length).toBeGreaterThan(0);
  });

  it('保留代码原文（trim 会让报错行号对不上）', () => {
    const r = sanitizeScripts([{ id: 'a', code: '\n  ctx.t;\n' }]);
    expect(r.scripts[0]!.code).toBe('\n  ctx.t;\n');
  });

  it('id 去重、needs 去重、targets 去重', () => {
    const r = sanitizeScripts([
      { id: 'a', code: '1;', needs: ['chars', 'chars', 'bogus'], targets: ['e', 'e'] },
      { id: 'a', code: '2;' },
    ]);
    expect(r.scripts).toHaveLength(1);
    expect(r.scripts[0]!.needs).toEqual(['chars']);
    expect(r.scripts[0]!.targets).toEqual(['e']);
    expect(r.dropped).toContain('scripts[0].needs[2]');
    expect(r.dropped).toContain('scripts[1].id');
  });

  it('超过条数上限时整条丢弃', () => {
    const many = Array.from({ length: SCRIPT_LIMITS.maxScripts + 2 }, (_, i) => ({
      id: `s${i}`,
      code: '1;',
    }));
    const r = sanitizeScripts(many);
    expect(r.scripts).toHaveLength(SCRIPT_LIMITS.maxScripts);
    expect(r.dropped).toContain(`scripts[${SCRIPT_LIMITS.maxScripts}]`);
  });

  it('单条代码超长：截断并停用（半条代码跑起来更难查）', () => {
    const r = sanitizeScripts([{ id: 'a', code: 'x'.repeat(SCRIPT_LIMITS.maxCodeChars + 10) }]);
    expect(r.scripts[0]!.code).toHaveLength(SCRIPT_LIMITS.maxCodeChars);
    expect(r.scripts[0]!.enabled).toBe(false);
    expect(r.dropped).toContain('scripts[0].code');
  });
});

describe('script needs / signature', () => {
  it('只统计启用的脚本；缺省 targets = 全部元素', () => {
    const doc = docWith([
      script({ id: 'a', needs: ['chars'] }),
      script({ id: 'b', needs: ['canvas'], enabled: false }),
      script({ id: 'c', needs: ['canvas'], targets: ['b'] }),
    ]);
    const needs = scriptNeedsByElement(doc);
    expect(needs.get('a')).toEqual({ chars: true, canvas: false });
    expect(needs.get('b')).toEqual({ chars: true, canvas: true });
  });

  it('签名包含 needs / targets（结构预处理变了必须重建 DOM）', () => {
    const a = scriptSignature({ scripts: [script({ needs: ['chars'] })] });
    const b = scriptSignature({ scripts: [script({ needs: ['canvas'] })] });
    expect(a).not.toBe(b);
  });

  it('hasRunnableScripts 不管总开关，只看单条启停与代码', () => {
    expect(hasRunnableScripts({ scripts: [script({ enabled: false })] })).toBe(false);
    expect(hasRunnableScripts({ scripts: [script({ code: '  ' })] })).toBe(false);
    expect(hasRunnableScripts({ scripts: [script()] })).toBe(true);
  });
});

describe('compileScript（软沙箱）', () => {
  it('能执行函数体，ctx 在作用域里', () => {
    clearCompileCache();
    const r = compileScript('return ctx.t + 1;');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.compiled.run({ t: 41 })).toBe(42);
  });

  it('语法错误在编译期返回（不执行）', () => {
    const r = checkScriptSyntax('if (');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail.length).toBeGreaterThan(0);
  });

  it('遮蔽 Math.random / Date.now / fetch / 定时器', () => {
    clearCompileCache();
    const ctx = { log: () => {} };
    const run = (code: string) => {
      const r = compileScript(code);
      expect(r.ok).toBe(true);
      if (!r.ok) return undefined;
      return r.compiled.run(ctx);
    };
    expect(() => run('Math.random();')).toThrow(/not available/);
    expect(() => run('Date.now();')).toThrow(/not available/);
    expect(() => run('fetch("/x");')).toThrow(/not available/);
    expect(() => run('setTimeout(() => {}, 1);')).toThrow(/not available/);
    expect(() => run('localStorage.getItem("a");')).toThrow(/not available/);
    // 其余 Math 照常可用（沙箱不是把整个 Math 拿走）。
    expect(run('return Math.max(1, 4);')).toBe(4);
  });

  it('globalThis / window / document 被遮成 undefined', () => {
    clearCompileCache();
    const r = compileScript('return [typeof globalThis, typeof window, typeof document];');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.compiled.run({ log: () => {} })).toEqual(['undefined', 'undefined', 'undefined']);
  });

  it('返回 Promise 时调用方可以识别（脚本必须同步）', () => {
    clearCompileCache();
    const r = compileScript('return Promise.resolve(1);');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ret = r.compiled.run({ log: () => {} });
      expect(typeof (ret as { then?: unknown }).then).toBe('function');
    }
  });
});

describe('预算与诊断', () => {
  it('写入次数超限抛 ScriptApiError(writes)', () => {
    const b = createBudget(2, 1000);
    b.check();
    b.check();
    expect(() => b.check()).toThrow(ScriptApiError);
    try {
      b.check();
    } catch (err) {
      expect((err as ScriptApiError).code).toBe('writes');
    }
  });

  it('同一条诊断重复只涨计数，不再通知订阅者', () => {
    resetScriptDiagnostics();
    let calls = 0;
    const off = subscribeScriptDiagnostics(() => calls++);
    const base = { scriptId: 'x', name: 'X', code: 'runtime-error' as const, detail: 'boom', frame: 0, elapsedMs: 1 };
    reportScriptDiagnostic(base);
    expect(calls).toBe(1);
    const rev = scriptDiagnosticsRevision();
    reportScriptDiagnostic(base);
    expect(calls).toBe(1);
    expect(scriptDiagnosticsRevision()).toBe(rev);
    expect(scriptDiagnosticsFor(['x'])[0]!.repeats).toBe(2);
    off();
  });
});

describe('codeHash', () => {
  it('同码同值、改一个字符就不同', () => {
    expect(codeHash('abc')).toBe(codeHash('abc'));
    expect(codeHash('abc')).not.toBe(codeHash('abd'));
  });
});
