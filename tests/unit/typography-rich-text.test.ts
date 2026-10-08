import { describe, expect, it } from 'vitest';
import {
  applySpanStyle,
  clearSpanStyle,
  hasSpanOverrides,
  normalizeRuns,
  plainTextOf,
  runsEquivalent,
  runsFromText,
  runsSignature,
  spanValueAt,
  SPAN_STYLE_KEYS,
  uniformSpanValue,
  type TextRun,
} from '../../src/typography/rich-text';
import { defaultTextStyle, type TextStyle } from '../../src/typography/document';

const SIZE = { w: 1920, h: 1080 };
const BASE: TextStyle = defaultTextStyle(SIZE);

/** 把一个 runs 数组渲染成便于阅读的形式：`[文本]{覆盖}`。 */
const show = (runs: readonly TextRun[]): string =>
  runs
    .map((r) => {
      const s = r.style
        ? Object.entries(r.style)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(',')
        : '';
      return `[${r.text}]${s ? `{${s}}` : ''}`;
    })
    .join('');

describe('runsFromText / plainTextOf / normalizeRuns', () => {
  it('纯文本 → 单段', () => {
    expect(runsFromText('abc')).toEqual([{ text: 'abc' }]);
    expect(plainTextOf(runsFromText('abc'))).toBe('abc');
  });

  it('合并相邻的同款段（否则反复加粗取消会把 runs 切得越来越碎）', () => {
    const merged = normalizeRuns([
      { text: 'a' },
      { text: 'b' },
      { text: 'c', style: { fontWeight: 700 } },
    ]);
    expect(show(merged)).toBe('[ab][c]{fontWeight=700}');
  });

  it('样式不同的相邻段不合并', () => {
    const out = normalizeRuns([
      { text: 'a', style: { fontWeight: 700 } },
      { text: 'b', style: { fontSize: 40 } },
    ]);
    expect(out).toHaveLength(2);
  });

  it('丢掉空段；全空时也给一个空 run（runs 永不为空数组）', () => {
    expect(normalizeRuns([{ text: '' }, { text: '' }])).toEqual([{ text: '' }]);
    expect(normalizeRuns([{ text: '', style: { color: '#fff' } }, { text: 'a' }])).toEqual([
      { text: 'a' },
    ]);
  });

  it('归一化不改原数组', () => {
    const src: TextRun[] = [
      { text: 'a' },
      { text: 'b' },
    ];
    normalizeRuns(src);
    expect(src).toHaveLength(2);
  });
});

describe('applySpanStyle', () => {
  it('在中间切开并只给区间加覆盖，两侧原样保留', () => {
    const out = applySpanStyle(runsFromText('abcdef'), 2, 4, { fontWeight: 700 });
    expect(show(out)).toBe('[ab][cd]{fontWeight=700}[ef]');
  });

  it('从开头 / 到结尾的区间不会产生空段', () => {
    expect(show(applySpanStyle(runsFromText('abcd'), 0, 2, { color: '#f00' }))).toBe(
      '[ab]{color=#f00}[cd]',
    );
    expect(show(applySpanStyle(runsFromText('abcd'), 2, 4, { color: '#f00' }))).toBe(
      '[ab][cd]{color=#f00}',
    );
  });

  it('只写补丁里给的键，其余照旧继承元素级', () => {
    const out = applySpanStyle(runsFromText('ab'), 0, 2, { fontWeight: 700 });
    expect(out[0]!.style).toEqual({ fontWeight: 700 });
  });

  it('多次调不同键会累积，不会互相覆盖', () => {
    let runs = runsFromText('ab');
    runs = applySpanStyle(runs, 0, 2, { fontWeight: 700 });
    runs = applySpanStyle(runs, 0, 2, { color: '#0f0' });
    expect(runs[0]!.style).toEqual({ fontWeight: 700, color: '#0f0' });
  });

  it('补丁值为 null = **删掉**这条覆盖（回到元素级），而不是设成 null', () => {
    let runs = applySpanStyle(runsFromText('ab'), 0, 2, { fontWeight: 700, color: '#0f0' });
    runs = applySpanStyle(runs, 0, 2, { fontWeight: null });
    expect(runs[0]!.style).toEqual({ color: '#0f0' });
    runs = applySpanStyle(runs, 0, 2, { color: null });
    expect(runs[0]!.style).toBeUndefined();
  });

  it('undefined = 这一项不动（与 null 的语义严格区分）', () => {
    const start = applySpanStyle(runsFromText('ab'), 0, 2, { fontWeight: 700 });
    const out = applySpanStyle(start, 0, 2, { fontWeight: undefined, color: '#0f0' });
    expect(out[0]!.style).toEqual({ fontWeight: 700, color: '#0f0' });
  });

  it('空区间（光标收起）退化成「改动光标所在的那一段」', () => {
    const base = applySpanStyle(runsFromText('abcd'), 0, 2, { fontWeight: 700 }); // [ab]{b}[cd]
    const out = applySpanStyle(base, 1, 1, { color: '#0f0' });
    // 第 1 个字符落在第一个 run 里 ⇒ 只改那一段，不碰 [cd]
    expect(show(out)).toBe('[ab]{fontWeight=700,color=#0f0}[cd]');
  });

  it('区间越界会被钳住（元素刚被删掉一段时不会抛）', () => {
    expect(show(applySpanStyle(runsFromText('ab'), 5, 99, { color: '#f00' }))).toBe(
      '[ab]{color=#f00}',
    );
    expect(show(applySpanStyle(runsFromText('ab'), -5, 1, { color: '#f00' }))).toBe(
      '[a]{color=#f00}[b]',
    );
  });

  it('结果恒为归一化形态（相邻同款段被合并）', () => {
    let runs = runsFromText('abc');
    runs = applySpanStyle(runs, 0, 1, { fontWeight: 700 });
    runs = applySpanStyle(runs, 1, 2, { fontWeight: 700 });
    expect(show(runs)).toBe('[ab]{fontWeight=700}[c]');
  });

  it('跨多个已有的段时每一段都被改到', () => {
    const base: TextRun[] = [
      { text: 'aa', style: { color: '#111' } },
      { text: 'bb' },
      { text: 'cc', style: { fontSize: 40 } },
    ];
    const out = applySpanStyle(base, 1, 5, { fontWeight: 700 });
    // 'aa' 的第一段保留原覆盖、第二段多出 fontWeight；'bb' 整段加粗；
    // 'cc' 同样被切开，两侧都还带着自己的 fontSize。
    expect(show(out)).toBe(
      '[a]{color=#111}[a]{color=#111,fontWeight=700}[bb]{fontWeight=700}[c]{fontSize=40,fontWeight=700}[c]{fontSize=40}',
    );
  });

  it('对空文档（单空 run）不抛', () => {
    expect(applySpanStyle([{ text: '' }], 0, 3, { fontWeight: 700 })).toEqual([{ text: '' }]);
  });
});

describe('spanValueAt / uniformSpanValue', () => {
  const runs = applySpanStyle(runsFromText('abcdef'), 2, 4, { fontSize: 40 });

  it('区间外读元素级，区间内读覆盖', () => {
    expect(spanValueAt(runs, 0, BASE, 'fontSize')).toBe(BASE.fontSize);
    expect(spanValueAt(runs, 3, BASE, 'fontSize')).toBe(40);
  });

  it('落在末尾时取最后一段（光标可以在最后一个字符之后）', () => {
    expect(spanValueAt(runs, 6, BASE, 'fontSize')).toBe(spanValueAt(runs, 5, BASE, 'fontSize'));
  });

  it('统一时给出值，混合时标记 non-uniform', () => {
    expect(uniformSpanValue(runs, 2, 4, BASE, 'fontSize')).toEqual({ uniform: true, value: 40 });
    expect(uniformSpanValue(runs, 0, 6, BASE, 'fontSize').uniform).toBe(false);
  });

  it('**没写覆盖**的属性读出来是元素级的值（加粗按钮才会是按下态）', () => {
    const boldBase: TextStyle = { ...BASE, fontWeight: 700 };
    const plain = runsFromText('abc');
    // 元素级是粗体、这一段没有任何覆盖 ⇒ 生效值仍是 700
    expect(uniformSpanValue(plain, 0, 3, boldBase, 'fontWeight')).toEqual({
      uniform: true,
      value: 700,
    });
  });

  it('空区间退化成光标处的值', () => {
    expect(uniformSpanValue(runs, 3, 3, BASE, 'fontSize').value).toBe(40);
    expect(uniformSpanValue(runs, 0, 0, BASE, 'fontSize').value).toBe(BASE.fontSize);
  });
});

describe('clearSpanStyle', () => {
  it('清掉区间内的全部行内覆盖', () => {
    const runs = applySpanStyle(runsFromText('abcd'), 0, 4, { fontWeight: 700, color: '#0f0' });
    const cleared = clearSpanStyle(runs, 1, 3);
    expect(show(cleared)).toBe('[a]{fontWeight=700,color=#0f0}[bc][d]{fontWeight=700,color=#0f0}');
  });

  it('只清指定的键', () => {
    const runs = applySpanStyle(runsFromText('ab'), 0, 2, { fontWeight: 700, color: '#0f0' });
    expect(show(clearSpanStyle(runs, 0, 2, ['color']))).toBe('[ab]{fontWeight=700}');
  });

  it('没有覆盖时是恒等变换', () => {
    expect(clearSpanStyle(runsFromText('ab'), 0, 2)).toEqual([{ text: 'ab' }]);
  });
});

describe('签名与等价性', () => {
  it('相邻同款段被拆开不影响等价性', () => {
    const a: TextRun[] = [{ text: 'ab', style: { fontWeight: 700 } }];
    const b: TextRun[] = [
      { text: 'a', style: { fontWeight: 700 } },
      { text: 'b', style: { fontWeight: 700 } },
    ];
    expect(runsEquivalent(a, b)).toBe(true);
  });

  it('**等长但内容不同**也不等价（签名只看长度就会把这种编辑判成「没变化」）', () => {
    expect(runsEquivalent(runsFromText('ab'), runsFromText('ac'))).toBe(false);
    expect(runsSignature(runsFromText('ab'))).not.toBe(runsSignature(runsFromText('ac')));
  });

  it('样式不同 => 不等价', () => {
    expect(
      runsEquivalent(runsFromText('ab'), applySpanStyle(runsFromText('ab'), 0, 2, { color: '#f00' })),
    ).toBe(false);
  });

  it('签名对同一输入稳定（光栅化缓存键依赖它）', () => {
    const a = applySpanStyle(runsFromText('abcd'), 1, 3, { fontWeight: 700 });
    const b = applySpanStyle(runsFromText('abcd'), 1, 3, { fontWeight: 700 });
    expect(runsSignature(a)).toBe(runsSignature(b));
  });

  it('hasSpanOverrides 只认真的有覆盖的情况', () => {
    expect(hasSpanOverrides(runsFromText('ab'))).toBe(false);
    expect(hasSpanOverrides(applySpanStyle(runsFromText('ab'), 0, 1, { color: '#f00' }))).toBe(true);
    // 覆盖被删干净之后又回到「没有覆盖」
    const back = applySpanStyle(
      applySpanStyle(runsFromText('ab'), 0, 2, { color: '#f00' }),
      0,
      2,
      { color: null },
    );
    expect(hasSpanOverrides(back)).toBe(false);
  });
});

describe('白名单', () => {
  it('段落级属性不在行内覆盖范围内', () => {
    const banned = ['lineHeight', 'align', 'vAlign', 'writingMode', 'textTransform'];
    for (const k of banned) expect(SPAN_STYLE_KEYS as readonly string[]).not.toContain(k);
  });

  it('用户要的那几项都在（字号 / 字距 / 粗体 / 字体 / 颜色）', () => {
    for (const k of ['fontSize', 'letterSpacing', 'fontWeight', 'fontFamily', 'color']) {
      expect(SPAN_STYLE_KEYS as readonly string[]).toContain(k);
    }
  });
});
