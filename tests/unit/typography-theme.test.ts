import { describe, expect, it } from 'vitest';
import { hexToRgb } from '../../src/core/color';
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  SHADE_IDS,
  STANDARD_COLORS,
  THEME_SLOTS,
  cloneAsCustomTheme,
  isKnownTheme,
  isThemeRef,
  paletteGrid,
  parseThemeRef,
  resolveThemeColor,
  sanitizeCustomThemes,
  shadeColor,
  themeById,
  themeRef,
  withSlotColor,
  type ThemeSlot,
} from '../../src/typography/theme';

/** 两个 hex 的**最大单通道差**。截图采样会带量化噪声，所以断言用容差。 */
function hexDelta(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return 255;
  return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b));
}

describe('配色方案数据表', () => {
  it('每个方案都有全部 10 个槽位，且都是合法 hex', () => {
    for (const t of BUILTIN_THEMES) {
      for (const slot of THEME_SLOTS) {
        expect(hexToRgb(t.colors[slot]), `${t.id}.${slot} = ${t.colors[slot]}`).not.toBeNull();
      }
    }
  });

  it('两个端点是纯白 / 纯黑（Office 内置方案的约定）', () => {
    for (const t of BUILTIN_THEMES) {
      expect(t.colors.lt1).toBe('#ffffff');
      expect(t.colors.dk1).toBe('#000000');
    }
  });

  it('含 23 个内置方案，且 id 不重复', () => {
    expect(BUILTIN_THEMES.length).toBe(23);
    expect(new Set(BUILTIN_THEMES.map((t) => t.id)).size).toBe(23);
  });

  it('未知 id 回落默认方案，绝不抛错（老工程 / 坏数据都要能打开）', () => {
    expect(themeById('does-not-exist').id).toBe(DEFAULT_THEME_ID);
    expect(themeById(undefined).id).toBe(DEFAULT_THEME_ID);
    expect(themeById(null).id).toBe(DEFAULT_THEME_ID);
  });

  it('两个经典方案与公开的 Office 主题 XML 逐位一致（采样可信的旁证）', () => {
    const y2013 = themeById('office-2013');
    expect(y2013.colors.dk2).toBe('#44546a');
    expect(y2013.colors.lt2).toBe('#e7e6e6');
    expect(y2013.colors.accent1).toBe('#4472c4');
    expect(y2013.colors.accent6).toBe('#70ad47');
    const y2007 = themeById('office-2007');
    expect(y2007.colors.accent1).toBe('#4f81bd');
    expect(y2007.colors.accent6).toBe('#f79646');
  });
});

describe('shadeColor（明暗变体）', () => {
  /*
   * 期望值是 `scripts/extract-theme-colors.mjs analyze <截图>` 的**实测采样**。
   * 容差 3 是截图量化噪声（PNG 无损，但界面本身经过 GPU 合成）。
   */

  it('常规色：保持色相/饱和度、只走 lumMod/lumOff（与 Office 网格逐通道一致）', () => {
    const got = SHADE_IDS.map((s) => shadeColor('#c830cc', s));
    const want = ['#f4d5f5', '#e9abeb', '#df81e1', '#962399', '#641766'];
    got.forEach((g, i) => expect(hexDelta(g, want[i]!), `${SHADE_IDS[i]} ${g} vs ${want[i]}`).toBeLessThanOrEqual(3));
  });

  it('纯白：lumMod 退化，改用向黑混合的灰阶（否则 5 格全是白的）', () => {
    const got = SHADE_IDS.map((s) => shadeColor('#ffffff', s));
    expect(got).toEqual(['#f2f2f2', '#d8d8d8', '#bfbfbf', '#a5a5a5', '#7f7f7f']);
  });

  it('纯黑：同理改用向白混合的灰阶', () => {
    const got = SHADE_IDS.map((s) => shadeColor('#000000', s));
    expect(got).toEqual(['#7f7f7f', '#595959', '#3f3f3f', '#262626', '#0c0c0c']);
  });

  it('极亮色：lumMod 会把前几格挤在纯白附近，改用亮度乘系数', () => {
    const got = SHADE_IDS.map((s) => shadeColor('#d8d9dc', s));
    const want = ['#c1c2c7', '#9ea1a8', '#676a72', '#333539', '#141516'];
    got.forEach((g, i) => expect(hexDelta(g, want[i]!), `${SHADE_IDS[i]} ${g} vs ${want[i]}`).toBeLessThanOrEqual(3));
  });

  it('三支规则都满足「越往下越暗」——这是调色板可读性的根', () => {
    for (const base of ['#ffffff', '#000000', '#d8d9dc', '#c830cc', '#454551', '#156082']) {
      const lum = SHADE_IDS.map((s) => {
        const c = hexToRgb(shadeColor(base, s))!;
        return c.r + c.g + c.b;
      });
      for (let i = 1; i < lum.length; i++) {
        expect(lum[i]!, `${base} ${SHADE_IDS[i]}`).toBeLessThan(lum[i - 1]!);
      }
    }
  });

  it('坏输入原样返回，不抛错（手改坏的工程不该让渲染炸掉）', () => {
    expect(shadeColor('not-a-color', 'l80')).toBe('not-a-color');
  });
});

describe('颜色引用', () => {
  it('构造与解析往返', () => {
    expect(themeRef('accent1')).toBe('@accent1');
    expect(themeRef('accent1', 'l80')).toBe('@accent1.l80');
    expect(parseThemeRef('@accent1')).toEqual({ slot: 'accent1', shade: null });
    expect(parseThemeRef('@accent1.d50')).toEqual({ slot: 'accent1', shade: 'd50' });
  });

  it('严格解析：槽位 / 变体必须在白名单里', () => {
    for (const bad of ['@nope', '@accent1.xx', '@', '@accent1.l80.x', 'accent1', '#ffffff']) {
      expect(parseThemeRef(bad), bad).toBeNull();
      expect(isThemeRef(bad), bad).toBe(false);
    }
  });

  it('所有槽位 × 所有变体都能解析', () => {
    for (const slot of THEME_SLOTS) {
      expect(isThemeRef(themeRef(slot))).toBe(true);
      for (const shade of SHADE_IDS) expect(isThemeRef(themeRef(slot, shade))).toBe(true);
    }
  });

  it('resolveThemeColor：引用 → 方案色；裸色原样返回', () => {
    expect(resolveThemeColor('@accent1', 'office')).toBe('#156082');
    expect(resolveThemeColor('@accent1', 'office-2007')).toBe('#4f81bd');
    expect(resolveThemeColor('#ff0000', 'office')).toBe('#ff0000');
    expect(resolveThemeColor('rgb(1, 2, 3)', 'office')).toBe('rgb(1, 2, 3)');
    // 也可以直接给方案对象 / 什么都不给（缺省 = 默认方案）
    expect(resolveThemeColor('@accent1', themeById('office'))).toBe('#156082');
    expect(resolveThemeColor('@lt1')).toBe('#ffffff');
  });

  it('带变体的引用 = 基础色再套变体', () => {
    expect(resolveThemeColor('@accent1.l80', 'office')).toBe(
      shadeColor('#156082', 'l80'),
    );
  });

  it('**换方案即换色**：同一份引用在两个方案下解析出不同颜色', () => {
    const a = resolveThemeColor('@accent1', 'office');
    const b = resolveThemeColor('@accent1', 'violet-ii');
    expect(a).not.toBe(b);
  });
});

describe('paletteGrid（取色卡网格）', () => {
  const grid = paletteGrid(themeById('office'));

  it('10 列 × 5 行变体，列序 = THEME_SLOTS', () => {
    expect(grid.base.length).toBe(10);
    expect(grid.variants.length).toBe(5);
    for (const row of grid.variants) expect(row.length).toBe(10);
  });

  it('第一行就是方案的槽位色', () => {
    THEME_SLOTS.forEach((slot: ThemeSlot, i) => {
      expect(grid.base[i]).toBe(themeById('office').colors[slot]);
    });
  });

  it('每个格子都带引用（点它就是「用配色方案的颜色」）', () => {
    expect(grid.refs).toEqual(THEME_SLOTS.map((s) => `@${s}`));
  });

  it('同列的 5 个变体自上而下越来越暗', () => {
    // 只断言变体行之间：第一行是**原色**，它与变体的明暗关系依列而变
    // （黑列的原色比它自己的变体都暗，这正是「端点列用灰阶」的表现）。
    for (let c = 0; c < 10; c++) {
      const lum = grid.variants.map((r) => {
        const rgb = hexToRgb(r[c]!)!;
        return rgb.r + rgb.g + rgb.b;
      });
      for (let i = 1; i < lum.length; i++) {
        expect(lum[i]!, `列 ${c} 第 ${i} 行`).toBeLessThan(lum[i - 1]!);
      }
    }
  });
});

describe('标准色', () => {
  it('10 个固定色，值是 Office 标准色板的实测采样', () => {
    expect(STANDARD_COLORS).toEqual([
      '#c00000',
      '#ff0000',
      '#ffc000',
      '#ffff00',
      '#92d050',
      '#00b050',
      '#00b0f0',
      '#0070c0',
      '#002060',
      '#7030a0',
    ]);
  });
});

/* -------------------------------------------------- 自定义配色方案（工程级） */

describe('自定义配色方案', () => {
  const custom = [
    {
      id: 'my-theme',
      name: '我的方案',
      colors: {
        lt1: '#ffffff',
        dk1: '#000000',
        lt2: '#eee8dd',
        dk2: '#33261c',
        accent1: '#b5541e',
        accent2: '#d9a441',
        accent3: '#6d8f66',
        accent4: '#3f5e78',
        accent5: '#8d5b8c',
        accent6: '#c7bfa4',
      },
    },
  ];

  it('themeById 认自定义方案；查表顺序「自定义 → 内置 → 默认」', () => {
    expect(themeById('my-theme', custom).name).toBe('我的方案');
    expect(themeById('my-theme').id).toBe(DEFAULT_THEME_ID); // 不给 custom 就查不到
    expect(themeById('office', custom).id).toBe('office'); // 内置仍然在
    expect(themeById('nope', custom).id).toBe(DEFAULT_THEME_ID);
  });

  it('isKnownTheme 覆盖自定义', () => {
    expect(isKnownTheme('my-theme', custom)).toBe(true);
    expect(isKnownTheme('my-theme')).toBe(false);
    expect(isKnownTheme('office', custom)).toBe(true);
    expect(isKnownTheme('nope', custom)).toBe(false);
  });

  it('resolveThemeColor 用自定义方案的槽位色', () => {
    expect(resolveThemeColor('@accent1', 'my-theme', custom)).toBe('#b5541e');
    expect(resolveThemeColor('@accent1.d50', 'my-theme', custom)).toBe(shadeColor('#b5541e', 'd50'));
    // 非引用原样返回
    expect(resolveThemeColor('#123456', 'my-theme', custom)).toBe('#123456');
  });

  it('withSlotColor 返回新对象（就地改会绕过撤销栈）', () => {
    const next = withSlotColor(custom[0]!, 'accent1', '#0000ff');
    expect(next.colors.accent1).toBe('#0000ff');
    expect(custom[0]!.colors.accent1).toBe('#b5541e'); // 原对象没动
    expect(next.id).toBe(custom[0]!.id); // 其它字段带着走
  });

  it('cloneAsCustomTheme：只复制 8 个可变槽，端点恒为纯白 / 纯黑', () => {
    const odd = { ...custom[0]!, colors: { ...custom[0]!.colors, lt1: '#f0f0f0', dk1: '#101010' } };
    const copy = cloneAsCustomTheme(odd, 'copy-1', '副本');
    expect(copy.id).toBe('copy-1');
    expect(copy.name).toBe('副本');
    expect(copy.colors.lt1).toBe('#ffffff');
    expect(copy.colors.dk1).toBe('#000000');
    expect(copy.colors.accent1).toBe(odd.colors.accent1);
    expect(copy.colors.dk2).toBe(odd.colors.dk2);
    // 自定义方案没有 labelKey（名字是用户文本）
    expect(copy.labelKey).toBeUndefined();
  });
});

describe('sanitizeCustomThemes：坏数据整条丢，绝不抛', () => {
  const good = {
    id: 'g',
    name: '好的',
    colors: {
      lt1: '#ffffff', dk1: '#000000', lt2: '#eeeeee', dk2: '#222222',
      accent1: '#111111', accent2: '#222222', accent3: '#333333',
      accent4: '#444444', accent5: '#555555', accent6: '#666666',
    },
  };

  it('非数组 / 空数组 → 空', () => {
    expect(sanitizeCustomThemes(undefined)).toEqual([]);
    expect(sanitizeCustomThemes('x')).toEqual([]);
    expect(sanitizeCustomThemes([])).toEqual([]);
  });

  it('好条目原样通过', () => {
    expect(sanitizeCustomThemes([good])).toEqual([good]);
  });

  it('坏条目整条丢：缺槽 / 坏 hex / 撞内置 id / 缺 id', () => {
    const bad = [
      { ...good, id: 'office' },                                   // 撞内置 id
      { ...good, id: '', },                                        // 空 id
      { ...good, colors: { ...good.colors, accent3: 'red' } },     // 非法 hex
      { ...good, colors: { ...good.colors, accent6: undefined } }, // 缺槽
      null,
      'x',
      { name: '没 id' },
    ];
    expect(sanitizeCustomThemes(bad)).toEqual([]);
  });

  it('坏条目不影响好条目（逐个独立判定）', () => {
    const out = sanitizeCustomThemes([{ ...good, id: 'bad', colors: {} }, good]);
    expect(out.map((t) => t.id)).toEqual(['g']);
  });
});
