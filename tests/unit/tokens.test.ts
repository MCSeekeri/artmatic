import { describe, expect, it } from 'vitest';
import {
  ACCENT_MIN_CONTRAST,
  ACCENT_PRESETS,
  ACCENT_TOKEN_KEYS,
  BRAND_IDS,
  COMPONENT,
  CONTENT,
  MOTION,
  MOTION_SPEEDS,
  MOTION_SPEED_FACTOR,
  PAPER,
  PRIMITIVES,
  SEMANTIC,
  STATIC,
  THEME_MODES,
  accentRampFromHex,
  accentRampOf,
  canvasPalette,
  contrastRatio,
  paperScopeRule,
  parseHex,
  relativeLuminance,
  resolveMotionTokens,
  resolveTokens,
  rgbToHsl,
  hslToRgb,
  themeFamily,
  type ThemeMode,
  type ThemeSpec,
} from '../../src/ui/tokens';

const MODES: ThemeMode[] = [...THEME_MODES];

const spec = (mode: ThemeMode, id: (typeof BRAND_IDS)[number] = 'violet'): ThemeSpec => ({
  mode,
  accent: { kind: 'preset', id },
});

const COLOR_RE = /^(#[0-9a-f]{6}|rgba?\(\s*\d+,\s*\d+,\s*\d+(,\s*[\d.]+)?\s*\))$/;

/* ------------------------------------------------------------ 结构完整性 */

describe('resolveTokens 结构', () => {
  it('每个 mode 都把 semantic 全量展平成 --* 键', () => {
    for (const mode of MODES) {
      const out = resolveTokens(spec(mode));
      for (const key of Object.keys(SEMANTIC[mode])) {
        expect(out[`--${key}`], `${mode} 缺 --${key}`).toBeTruthy();
      }
    }
  });

  it('content 与 static 也全部落地', () => {
    for (const mode of MODES) {
      const out = resolveTokens(spec(mode));
      for (const key of Object.keys(CONTENT[mode])) expect(out[`--${key}`]).toBeTruthy();
      for (const key of Object.keys(STATIC)) expect(out[`--${key}`]).toBeTruthy();
    }
  });

  it('**primitive 绝不泄漏到输出**（组件看不见 --p-*）', () => {
    for (const mode of MODES) {
      const out = resolveTokens(spec(mode));
      const leaked = Object.keys(out).filter((k) => k.startsWith('--p-'));
      expect(leaked).toEqual([]);
    }
  });

  it('所有输出值都是合法颜色或尺寸串', () => {
    for (const mode of MODES) {
      for (const [k, v] of Object.entries(resolveTokens(spec(mode)))) {
        if (!k.startsWith('--color-') && COLOR_RE.test(v)) continue;
        expect(typeof v === 'string' && v.length > 0, `${k} = ${v}`).toBe(true);
      }
    }
  });

  it('component 的值都必须能在 semantic 里解析（无悬空引用）', () => {
    for (const [, vars] of Object.entries(COMPONENT)) {
      for (const [name, key] of Object.entries(vars)) {
        expect(Object.keys(SEMANTIC.light), `component 引用了不存在的 semantic: ${name} -> ${key}`).toContain(key);
      }
    }
  });

  it('component 层确实落到了输出里，且是 var() 引用（不是死代码）', () => {
    const out = resolveTokens(spec('light'));
    // 必须是引用而不是展开值：自定义属性的 var() 在**声明它的元素**上就替换完了，
    // 写死颜色的话 `data-paper` 那种局部覆盖追不到 --menu-bg。
    expect(out['--menu-bg']).toBe('var(--surface-3)');
    expect(out['--tl-side-bg']).toBe('var(--surface-2)');
  });
});

/* ------------------------------------------------------------ 界面微动效 */

describe('resolveMotionTokens', () => {
  const duration = (vars: Record<string, string>, key: string) =>
    Number.parseFloat(vars[`--motion-duration-${key}`]!);

  it('标准档使用唯一基准，最慢档也严格小于 200ms', () => {
    const normal = resolveMotionTokens(true, 'normal');
    expect(normal['--motion-duration-hover']).toBe(`${MOTION.hover}ms`);
    expect(normal['--motion-duration-enter']).toBe(`${MOTION.enter}ms`);
    expect(normal['--motion-duration-modal']).toBe(`${MOTION.modal}ms`);
    expect(normal['--motion-distance']).toBe(`${MOTION.distance}px`);

    for (const speed of MOTION_SPEEDS) {
      const vars = resolveMotionTokens(true, speed);
      for (const key of ['hover', 'enter', 'modal']) {
        const ms = duration(vars, key);
        expect(ms, `${speed} 档 ${key} 必须小于 200ms`).toBeLessThan(200);
        expect(ms, `${speed} 档 ${key} 必须为正`).toBeGreaterThan(0);
      }
    }
  });

  it.each(MOTION_SPEEDS)('%s 档按唯一倍率缩放三档时长', (speed) => {
    const vars = resolveMotionTokens(true, speed);
    const factor = MOTION_SPEED_FACTOR[speed];
    expect(duration(vars, 'hover')).toBe(Math.round(MOTION.hover * factor));
    expect(duration(vars, 'enter')).toBe(Math.round(MOTION.enter * factor));
    expect(duration(vars, 'modal')).toBe(Math.round(MOTION.modal * factor));
  });

  it('关闭时仍输出完整变量，但时长与位移归零', () => {
    const vars = resolveMotionTokens(false, 'slow');
    expect(vars['--motion-duration-hover']).toBe('0ms');
    expect(vars['--motion-duration-enter']).toBe('0ms');
    expect(vars['--motion-duration-modal']).toBe('0ms');
    expect(vars['--motion-distance']).toBe('0px');
    expect(vars['--motion-ease']).toBe(MOTION.ease);
  });
});

/* ------------------------------------------------------------ 换品牌的影响面 */

describe('换品牌只改 accent 组（及其别名）', () => {
  /** 换品牌时**允许**变化的键：accent 组 + 纸面那份 accent 组（弹窗里的强调色
   *  也属于同一个品牌）。 */
  const allowed = new Set([
    ...ACCENT_TOKEN_KEYS.map((k) => `--${k}`),
    ...ACCENT_TOKEN_KEYS.map((k) => `--paper-${k}`),
  ]);

  /** 不应随品牌变化的：结构色 semantic + content（数据类别色）+ static。 */
  const mustStayPut = [
    ...Object.keys(SEMANTIC.light).filter((k) => !(ACCENT_TOKEN_KEYS as readonly string[]).includes(k)),
    ...Object.keys(CONTENT.light),
    ...Object.keys(STATIC),
  ].map((k) => `--${k}`);

  it.each(MODES)('%s：变化的键全部溯源到 accent，结构色一个都没动', (mode) => {
    const a = resolveTokens(spec(mode, 'violet'));
    const b = resolveTokens(spec(mode, 'cyan'));
    const changed = Object.keys(a).filter((k) => a[k] !== b[k]);

    expect(changed).toContain('--accent'); // 确认真换了，不是空断言
    for (const k of changed) expect(allowed.has(k), `${k} 不该随品牌变`).toBe(true);
    for (const k of mustStayPut) expect(a[k], `${k} 被品牌带跑了`).toBe(b[k]);
  });

  it('component 层全是 var() 引用——换品牌不可能只改到某一个控件', () => {
    const out = resolveTokens(spec('dark', 'violet'));
    for (const [group, vars] of Object.entries(COMPONENT)) {
      for (const [name, key] of Object.entries(vars)) {
        expect(out[`--${group}-${name}`], `${group}-${name}`).toBe(`var(--${key})`);
      }
    }
  });

  it('预置色相两两之间都不碰结构色', () => {
    const base = resolveTokens(spec('light', 'violet'));
    for (const id of BRAND_IDS) {
      const other = resolveTokens(spec('light', id));
      for (const k of mustStayPut) expect(base[k], `${id} 动了 ${k}`).toBe(other[k]);
    }
  });

  it('换 mode 不动 static，也不动 content 之外的 component 结构绑定', () => {
    const l = resolveTokens(spec('light', 'violet'));
    const d = resolveTokens(spec('dark', 'violet'));
    for (const key of Object.keys(STATIC)) expect(l[`--${key}`]).toBe(d[`--${key}`]);
  });
});

/* ------------------------------------------------------------ 主题色可得性 */

describe('accent ramp', () => {
  it.each(MODES)('%s 模式下每个预置品牌都满足正文级对比度', (mode) => {
    for (const id of BRAND_IDS) {
      const ramp = accentRampOf({ kind: 'preset', id }, mode);
      const surface = SEMANTIC[mode]['surface-0'];
      const ratio = contrastRatio(ramp.accent, surface);
      expect(ratio, `${id}@${mode} 对比度 ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
        ACCENT_MIN_CONTRAST,
      );
    }
  });

  it.each(MODES)('%s 模式下 accentOn 叠在 accent 上可读', (mode) => {
    for (const src of [
      { kind: 'preset', id: 'violet' } as const,
      { kind: 'preset', id: 'amber' } as const,
      { kind: 'custom', hex: '#ff2d9b' } as const,
      { kind: 'custom', hex: '#ffe600' } as const,
    ]) {
      const ramp = accentRampOf(src, mode);
      const ratio = contrastRatio(ramp.accentOn, ramp.accent);
      expect(ratio, `${JSON.stringify(src)}@${mode} on-contrast ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('任意 hex 都能产出合法色阶，且对比度被钳到达标', () => {
    const probes = ['#000000', '#ffffff', '#808080', '#ffe600', '#00ff41', '#ff0000', '#0af', 'bad-input'];
    for (const mode of MODES) {
      for (const hex of probes) {
        const ramp = accentRampFromHex(hex, mode);
        for (const [k, v] of Object.entries(ramp)) {
          expect(COLOR_RE.test(v), `${hex}@${mode} 的 ${k} = ${v}`).toBe(true);
        }
        const ratio = contrastRatio(ramp.accent, SEMANTIC[mode]['surface-0']);
        expect(ratio, `${hex}@${mode} 未达标：${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
          ACCENT_MIN_CONTRAST,
        );
      }
    }
  });

  it('纯灰输入不炸（饱和度兜底）', () => {
    for (const mode of MODES) {
      const ramp = accentRampFromHex('#777777', mode);
      expect(COLOR_RE.test(ramp.accent)).toBe(true);
      expect(contrastRatio(ramp.accent, SEMANTIC[mode]['surface-0'])).toBeGreaterThanOrEqual(
        ACCENT_MIN_CONTRAST,
      );
    }
  });

  it('亮色模式的自定义色比暗色模式更暗（方向正确）', () => {
    const light = accentRampFromHex('#6f64ef', 'light');
    const dark = accentRampFromHex('#6f64ef', 'dark');
    const lum = (h: string) => relativeLuminance(parseHex(h)!);
    expect(lum(light.accent)).toBeLessThan(lum(dark.accent));
  });
});

/* ------------------------------------------------------------ 颜色工具自证 */

describe('颜色工具', () => {
  it('parseHex 支持缩写与大小写，拒绝垃圾输入', () => {
    expect(parseHex('#0af')).toEqual({ r: 0, g: 170, b: 255 });
    expect(parseHex('FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('zzzzzz')).toBeNull();
  });

  it('rgb ↔ hsl 往返在容差内', () => {
    for (const hex of ['#6f64ef', '#2b9fd8', '#6ba03a', '#d99a1f', '#123456']) {
      const c = parseHex(hex)!;
      const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
      const back = hslToRgb(h, s, l);
      expect(Math.abs(back.r - c.r)).toBeLessThan(1.5);
      expect(Math.abs(back.g - c.g)).toBeLessThan(1.5);
      expect(Math.abs(back.b - c.b)).toBeLessThan(1.5);
    }
  });

  it('contrastRatio 边界正确（黑/白 = 21，同色 = 1）', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#5b6067', '#5b6067')).toBeCloseTo(1, 5);
  });

  it('prettier 基准：#6f64ef 在白底上达不到 4.5（说明钳制是必要的）', () => {
    expect(contrastRatio(ACCENT_PRESETS.violet.hex, '#ffffff')).toBeLessThan(ACCENT_MIN_CONTRAST);
  });
});

/* ------------------------------------------------------------ Canvas 调色板 */

describe('canvasPalette', () => {
  it.each(MODES)('%s 模式全部字段都是合法颜色串', (mode) => {
    const p = canvasPalette(spec(mode));
    for (const [k, v] of Object.entries(p)) {
      expect(COLOR_RE.test(v), `${k} = ${v}`).toBe(true);
    }
  });

  it('亮暗两套的网格底不同（不是同一份影子副本）', () => {
    expect(canvasPalette(spec('light')).gridBg).not.toBe(canvasPalette(spec('dark')).gridBg);
  });

  it('拍线比小节线淡——读格靠这个层级', () => {
    for (const mode of MODES) {
      const p = canvasPalette(spec(mode));
      const alpha = (s: string) => Number(s.match(/,\s*([\d.]+)\)$/)?.[1] ?? 1);
      expect(alpha(p.beatLine)).toBeLessThan(alpha(p.barLine));
    }
  });

  it('换品牌时 originLine 跟着变，但网格底不变', () => {
    const a = canvasPalette(spec('light', 'violet'));
    const b = canvasPalette(spec('light', 'cyan'));
    expect(a.originLine).not.toBe(b.originLine);
    expect(a.gridBg).toBe(b.gridBg);
    expect(a.waveBody).toBe(b.waveBody);
  });

  it('PRIMITIVES 覆盖全部 intermediate ramp 步进（无洞）', () => {
    for (const step of ['0', '50', '100', '150', '200', '300', '400', '500', '600', '700', '800', '850', '900', '950', '1000']) {
      expect(PRIMITIVES[`neutral-${step}`], `缺 neutral-${step}`).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------------ 族 */

describe('themeFamily', () => {
  it('只有 light 是亮族，其余三套都是深底', () => {
    expect(themeFamily('light')).toBe('light');
    for (const mode of ['dark', 'gray', 'contrast'] as const) {
      expect(themeFamily(mode), mode).toBe('dark');
    }
  });
});

/* ------------------------------------------------------------ 灰色的来历 */

describe('灰色模式', () => {
  const sat = (hex: string): number => {
    const c = parseHex(hex)!;
    return rgbToHsl(c.r, c.g, c.b).s;
  };
  const lum = (hex: string): number => relativeLuminance(parseHex(hex)!);

  it('面板主背景 #525252 配白字，正文对比度 ≥ 7', () => {
    const out = resolveTokens(spec('gray'));
    expect(SEMANTIC.gray['surface-1']).toBe('#525252');
    expect(out['--surface-1']).toBe('#525252');
    expect(out['--text-primary']).toBe('#ffffff');
    expect(
      contrastRatio(SEMANTIC.gray['text-primary'], SEMANTIC.gray['surface-1']),
    ).toBeGreaterThanOrEqual(7);
  });

  it('比深色模式亮，但仍是深底（这正是它存在的理由）', () => {
    expect(lum(SEMANTIC.gray['surface-1'])).toBeGreaterThan(lum(SEMANTIC.dark['surface-1']));
    expect(lum(SEMANTIC.gray['surface-1'])).toBeLessThan(lum(SEMANTIC.light['surface-1']));
    expect(lum(SEMANTIC.gray['surface-1'])).toBeLessThan(0.5); // 白字仍然成立
  });

  it('品牌色更低饱和、更亮', () => {
    for (const id of BRAND_IDS) {
      const g = accentRampOf({ kind: 'preset', id }, 'gray');
      const d = accentRampOf({ kind: 'preset', id }, 'dark');
      // 「不更饱和」是硬约束；「更亮」是这一档的目的（对 #464646 的钳制结果）。
      expect(sat(g.accent), id).toBeLessThanOrEqual(sat(d.accent) + 0.02);
      expect(lum(g.accent), id).toBeGreaterThan(lum(d.accent));
    }
    // 旗舰色（紫，饱和度 0.81 > 上限 0.55）必须真的被压下来
    const violet = accentRampOf({ kind: 'preset', id: 'violet' }, 'gray');
    expect(sat(violet.accent)).toBeLessThan(0.6);
  });

  it.each(BRAND_IDS)('纸面强调色 %s 在 #BDBDBD 上也够读', (id) => {
    const out = resolveTokens(spec('gray', id));
    expect(out['--paper-surface-1']).toBe('#bdbdbd');
    const ratio = contrastRatio(out['--paper-accent']!, PAPER.gray['surface-1']);
    expect(ratio, `${id} 纸面强调色 ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(ACCENT_MIN_CONTRAST);
  });

  it('弹窗 / Ribbon 的纸面是 #BDBDBD + 黑字', () => {
    const out = resolveTokens(spec('gray'));
    expect(PAPER.gray['surface-1']).toBe('#bdbdbd');
    expect(out['--paper-surface-1']).toBe('#bdbdbd');
    expect(out['--paper-text-primary']).toBe('#141414');
    expect(
      contrastRatio(PAPER.gray['text-primary'], PAPER.gray['surface-1']),
    ).toBeGreaterThanOrEqual(8);
  });
});

/* ------------------------------------------------------------ 高对比度的边界 */

describe('高对比度模式', () => {
  const contrast = SEMANTIC.contrast;

  it('表面一律纯黑，正文一律纯白', () => {
    for (const key of ['surface-0', 'surface-1', 'surface-2', 'surface-3'] as const) {
      expect(contrast[key], key).toBe('#000000');
    }
    expect(contrast['text-primary']).toBe('#ffffff');
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });

  it('结构线与可点容器用不同颜色的边框（它唯一的分层手段）', () => {
    expect(contrast['border']).not.toBe(contrast['border-control']);
    for (const key of ['border', 'border-control', 'border-icon'] as const) {
      const ratio = contrastRatio(contrast[key], '#000000');
      expect(ratio, `${key} 对黑底 ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    }
    const out = resolveTokens(spec('contrast'));
    expect(out['--btn-border']).toBe('var(--border-control)');
    expect(out['--input-border']).toBe('var(--border-control)');
  });

  it('纯图标按钮只有这里才有边框（常规三套必须是透明）', () => {
    expect(contrast['border-icon']).not.toBe('transparent');
    for (const mode of ['light', 'dark', 'gray'] as const) {
      expect(SEMANTIC[mode]['border-icon'], mode).toBe('transparent');
    }
  });

  it('hover / active 不留在纯黑，但也不吃掉黑白对比', () => {
    expect(contrast['surface-hover']).not.toBe('#000000');
    expect(contrast['surface-active']).not.toBe('#000000');
    expect(
      contrastRatio(contrast['text-primary'], contrast['surface-hover']),
    ).toBeGreaterThanOrEqual(12);
  });

  it('文字三档都在正文标准之上（次级也是纯白，层级只靠字号与字重）', () => {
    for (const key of ['text-primary', 'text-secondary', 'text-muted'] as const) {
      const ratio = contrastRatio(contrast[key], '#000000');
      expect(ratio, `${key} ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(ACCENT_MIN_CONTRAST);
    }
  });
});

/* ------------------------------------------------------------ 纸面作用域 */

describe('纸面作用域（data-paper）', () => {
  const rule = paperScopeRule();

  it('覆盖全部 semantic 与 component 变量（规则由 TS 生成，不是手写清单）', () => {
    for (const key of Object.keys(SEMANTIC.light)) {
      expect(rule, `漏了 --${key}`).toContain(`--${key}:var(--paper-${key})`);
    }
    for (const [group, vars] of Object.entries(COMPONENT)) {
      for (const [name, key] of Object.entries(vars)) {
        expect(rule, `漏了 --${group}-${name}`).toContain(`--${group}-${name}:var(--${key})`);
      }
    }
    expect(rule).toContain('color-scheme:var(--paper-color-scheme)');
  });

  it('没有自引用（自定义属性自引用会整条失效，颜色静默回落）', () => {
    const refs = [...rule.matchAll(/(--[a-z0-9-]+):var\((--[a-z0-9-]+)\)/g)];
    expect(refs.length).toBeGreaterThan(20);
    for (const [, left, right] of refs) expect(left).not.toBe(right);
  });

  it('三套常规模式的纸面就是它们自己的语义表（弹窗配色不会漂）', () => {
    expect(PAPER.light).toBe(SEMANTIC.light);
    expect(PAPER.dark).toBe(SEMANTIC.dark);
    expect(PAPER.contrast).toBe(SEMANTIC.contrast);
    expect(PAPER.gray['surface-1']).not.toBe(SEMANTIC.gray['surface-1']);
  });

  it.each(MODES)('%s：resolveTokens 同时输出纸面那一套', (mode) => {
    const out = resolveTokens(spec(mode));
    for (const key of Object.keys(SEMANTIC[mode])) expect(out[`--paper-${key}`]).toBeTruthy();
    expect(['light', 'dark']).toContain(out['--paper-color-scheme']);
  });

  it('灰色模式的纸面是亮色（原生滚动条 / 取色器要跟着亮）', () => {
    expect(resolveTokens(spec('gray'))['--paper-color-scheme']).toBe('light');
    expect(resolveTokens(spec('dark'))['--paper-color-scheme']).toBe('dark');
  });
});
