import { describe, expect, it } from 'vitest';
import {
  TYPEAHEAD_RESET_MS,
  edgeIndex,
  indexOfValue,
  keyIntent,
  stepIndex,
  typeaheadIndex,
  type SelectOption,
} from '../../src/ui/controls/select-model';

const opts = (): SelectOption<string>[] => [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana', disabled: true },
  { value: 'c', label: 'Cherry' },
  { value: 'd', label: 'Date', disabled: true },
  { value: 'e', label: 'Elderberry' },
];

describe('indexOfValue', () => {
  it('找得到与找不到', () => {
    expect(indexOfValue(opts(), 'c')).toBe(2);
    expect(indexOfValue(opts(), 'zzz')).toBe(-1);
    expect(indexOfValue([], 'a')).toBe(-1);
  });
});

describe('stepIndex — 方向键必须跳过 disabled', () => {
  it('向下跳过 disabled', () => {
    expect(stepIndex(opts(), 0, 1)).toBe(2); // b 被跳过
    expect(stepIndex(opts(), 2, 1)).toBe(4); // d 被跳过
  });

  it('向上同样跳过', () => {
    expect(stepIndex(opts(), 2, -1)).toBe(0);
    expect(stepIndex(opts(), 4, -1)).toBe(2);
  });

  it('环绕', () => {
    expect(stepIndex(opts(), 4, 1)).toBe(0);
    expect(stepIndex(opts(), 0, -1)).toBe(4);
  });

  it('全表都 disabled 时不给出高亮（返回 -1），组件据此不动', () => {
    const all: SelectOption<string>[] = [
      { value: 'a', label: 'A', disabled: true },
      { value: 'b', label: 'B', disabled: true },
    ];
    expect(stepIndex(all, 0, 1)).toBe(-1);
    expect(stepIndex(all, 1, -1)).toBe(-1);
  });

  it('空表返回 -1', () => {
    expect(stepIndex([], 0, 1)).toBe(-1);
  });
});

describe('edgeIndex — Home / End', () => {
  it('跳过 disabled 找首尾', () => {
    expect(edgeIndex(opts(), 'first')).toBe(0);
    expect(edgeIndex(opts(), 'last')).toBe(4);
  });

  it('首项 disabled 时向后找', () => {
    const list: SelectOption<string>[] = [
      { value: 'a', label: 'A', disabled: true },
      { value: 'b', label: 'B' },
    ];
    expect(edgeIndex(list, 'first')).toBe(1);
  });

  it('末项 disabled 时向前找', () => {
    const list: SelectOption<string>[] = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B', disabled: true },
    ];
    expect(edgeIndex(list, 'last')).toBe(0);
  });

  it('空表 / 全 disabled 返回 -1', () => {
    expect(edgeIndex([], 'first')).toBe(-1);
    expect(edgeIndex([{ value: 'a', label: 'A', disabled: true }], 'first')).toBe(-1);
  });
});

describe('typeaheadIndex — 打字跳转', () => {
  it('前缀匹配并跳过 disabled', () => {
    expect(typeaheadIndex(opts(), 'c', 0)).toBe(2);
    expect(typeaheadIndex(opts(), 'e', 0)).toBe(4);
  });

  it('大小写不敏感', () => {
    expect(typeaheadIndex(opts(), 'elder', 0)).toBe(4);
  });

  it('从当前项之后开始找 → 连按同字母可轮转', () => {
    const list: SelectOption<string>[] = [
      { value: 'a1', label: 'Alpha' },
      { value: 'a2', label: 'Alpine' },
      { value: 'a3', label: 'Altair' },
    ];
    expect(typeaheadIndex(list, 'a', 0)).toBe(1);
    expect(typeaheadIndex(list, 'a', 1)).toBe(2);
    expect(typeaheadIndex(list, 'a', 2)).toBe(0); // 环绕
  });

  it('无匹配时保持原位', () => {
    expect(typeaheadIndex(opts(), 'zz', 2)).toBe(2);
  });

  it('空 buffer 原样返回；空表返回 -1', () => {
    expect(typeaheadIndex(opts(), '', 3)).toBe(3);
    expect(typeaheadIndex([], 'a', 0)).toBe(-1);
  });

  it('合并窗口是个正数常量（组件用它决定何时清空 buffer）', () => {
    expect(TYPEAHEAD_RESET_MS).toBeGreaterThan(0);
  });
});

describe('keyIntent — 键 → 意图', () => {
  it('合上时只有「开」与 Esc', () => {
    for (const k of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
      expect(keyIntent(k, false), k).toBe('open');
    }
    expect(keyIntent('Escape', false)).toBe('cancel');
    expect(keyIntent('a', false)).toBeNull();
    expect(keyIntent('Tab', false)).toBeNull();
  });

  it('打开后导航键各归其位', () => {
    expect(keyIntent('ArrowDown', true)).toBe('next');
    expect(keyIntent('ArrowUp', true)).toBe('prev');
    expect(keyIntent('Home', true)).toBe('first');
    expect(keyIntent('End', true)).toBe('last');
    expect(keyIntent('Enter', true)).toBe('commit');
    expect(keyIntent(' ', true)).toBe('commit');
  });

  it('打开后 Esc / Tab 都是取消，单字符是打字', () => {
    expect(keyIntent('Escape', true)).toBe('cancel');
    expect(keyIntent('Tab', true)).toBe('cancel');
    expect(keyIntent('c', true)).toBe('type');
  });

  it('打开后无关键放行', () => {
    expect(keyIntent('F5', true)).toBeNull();
    expect(keyIntent('Shift', true)).toBeNull();
  });
});
