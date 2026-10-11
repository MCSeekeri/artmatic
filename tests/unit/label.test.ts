import { describe, expect, it } from 'vitest';
import {
  isTextLabel,
  labelText,
  normalizeLabel,
  resolveLabel,
  type Label,
} from '../../src/i18n/label';
import { LOCALES } from '../../src/i18n/locales';
import type { MessageKey } from '../../src/i18n/locales';

const zh = LOCALES['zh-CN'] as Record<string, string>;
const tr = (key: MessageKey): string => zh[key] ?? key;

/**
 * `Label` 是内置（文案键）与插件（字面量）共用的展示名契约。
 *
 * 它没有复杂逻辑，但**它是「插件能不能显示自己的名字」的唯一通道** ——
 * 解析错的表现是界面上出现 `fx.myPlugin.blur` 这种键名（而不是崩溃），
 * 所以每条分支都要有断言钉着。
 */
describe('Label：文案键', () => {
  it('走 tr() 解析', () => {
    expect(resolveLabel('fx.blur', tr)).toBe(zh['fx.blur']);
  });

  it('键不存在时回落到键本身（tr 的既有语义，不是本模块的职责）', () => {
    expect(resolveLabel('fx.notARealKey' as MessageKey, tr)).toBe('fx.notARealKey');
  });
});

describe('Label：字面量', () => {
  it('原样返回，不经文案表', () => {
    expect(resolveLabel(labelText('我的特效'), tr)).toBe('我的特效');
  });

  it('空文本返回空串（不是 undefined / null / 对象字面量）', () => {
    expect(resolveLabel({ text: '' }, tr)).toBe('');
  });

  it('labelText 会把非字符串输入转成字符串（不可信来源的兜底）', () => {
    // 刻意绕过类型传错值：插件是运行期数据，类型系统管不到它。
    const asText = (v: unknown) => labelText(v as string);
    expect(resolveLabel(asText(123), tr)).toBe('123');
    // null / undefined 走 `?? ''`，**不是** String(null) 的 "null" —— 后者会在
    // 界面上写一个 "null" 出来。
    expect(resolveLabel(asText(null), tr)).toBe('');
    expect(resolveLabel(asText(undefined), tr)).toBe('');
  });
});

describe('isTextLabel', () => {
  it('区分两种形态', () => {
    expect(isTextLabel('fx.blur')).toBe(false);
    expect(isTextLabel(labelText('x'))).toBe(true);
  });
});

describe('normalizeLabel：不可信输入', () => {
  it('字符串原样收下', () => {
    expect(normalizeLabel('hello')).toBe('hello');
  });

  it('{ text } 收下文本', () => {
    expect(normalizeLabel({ text: 'hi' })).toEqual({ text: 'hi' });
  });

  it('其余一律 null —— 宁可丢一项，也不要在界面上显示 [object Object]', () => {
    for (const bad of [null, undefined, 42, true, {}, { text: 1 }, [], ['a']]) {
      expect(normalizeLabel(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('规范化后的结果一定能被 resolveLabel 解析成文本', () => {
    for (const raw of ['a', { text: 'b' }]) {
      const label = normalizeLabel(raw) as Label;
      expect(() => resolveLabel(label, tr)).not.toThrow();
      expect(resolveLabel(label, tr)).toBeTruthy();
    }
  });
});
