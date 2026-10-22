import { describe, expect, it } from 'vitest';
import { cssFamily, firstFamily } from '../../src/typography/font/css-family';

describe('firstFamily：取族列表的第一个族', () => {
  it('单个族名原样返回', () => {
    expect(firstFamily('Inter')).toBe('Inter');
  });

  it('列表只取第一个并去掉引号', () => {
    expect(firstFamily('"Inter", sans-serif')).toBe('Inter');
    expect(firstFamily("'PingFang SC', serif")).toBe('PingFang SC');
  });

  it('引号里的逗号不算分隔符（合法 CSS：族名本身带逗号）', () => {
    expect(firstFamily('"Foo, Bar", serif')).toBe('Foo, Bar');
  });

  it('空串 / 纯空白返回空串', () => {
    expect(firstFamily('')).toBe('');
    expect(firstFamily('   ')).toBe('');
  });
});

describe('cssFamily：族名 → 合法的 font-family 值', () => {
  it('多词族名加引号（裸拼虽然合法，但数字开头 / 含标点的名字会整条失效）', () => {
    expect(cssFamily('JetBrains Mono')).toBe('"JetBrains Mono"');
  });

  it('中文族名也能安全写进内联样式', () => {
    expect(cssFamily('宋体')).toBe('"宋体"');
  });

  it('通用族**不加**引号（"serif" 是一个叫 serif 的具体字体，等于没写）', () => {
    expect(cssFamily('serif')).toBe('serif');
    expect(cssFamily('Monospace')).toBe('monospace');
    expect(cssFamily('system-ui')).toBe('system-ui');
  });

  it('族名里的引号与反斜杠转义（否则声明被截断，静默退回默认字体）', () => {
    expect(cssFamily('a"b')).toBe('"a\\"b"');
    expect(cssFamily('a\\b')).toBe('"a\\\\b"');
  });

  it('传入族列表时只取第一个（与 firstFamily 同口径）', () => {
    expect(cssFamily('"Inter", sans-serif')).toBe('"Inter"');
  });

  it('空串返回空串 —— 调用方据此**不写**这条声明', () => {
    expect(cssFamily('')).toBe('');
    expect(cssFamily('  , serif')).toBe('');
  });
});
