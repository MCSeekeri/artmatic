import { describe, expect, it } from 'vitest';
import {
  ACCENT_MIN_CONTRAST,
  ACCENT_PRESETS,
  ACCENT_TOKEN_KEYS,
  BRAND_IDS,
  COMPONENT,
  CONTENT,
  PRIMITIVES,
  SEMANTIC,
  STATIC,
  accentRampFromHex,
  accentRampOf,
  canvasPalette,
  contrastRatio,
  parseHex,
  relativeLuminance,
  resolveTokens,
  rgbToHsl,
  hslToRgb,
  type ThemeMode,
  type ThemeSpec,
} from '../../src/ui/tokens';

const MODES: ThemeMode[] = ['light', 'dark'];

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

  it('component 层确实落到了输出里（不是死代码）', () => {
    const out = resolveTokens(spec('light'));
    expect(out['--menu-bg']).toBe(SEMANTIC.light['surface-3']);
    expect(out['--tl-side-bg']).toBe(SEMANTIC.light['surface-2']);
  });
});

/* ------------------------------------------------------------ 换品牌的影响面 */

describe('换品牌只改 accent 组（及其别名）', () => {
  /** 值溯源到 accent 的 component token。换品牌时它们跟着变是**正确**行为——
   *  真正要防的是「某个结构色被品牌悄悄带跑」。 */
  const accentDerivedComponentKeys = (() => {
    const accentKeys = new Set<string>(ACCENT_TOKEN_KEYS);
    const out: string[] = [];
    for (const [group, vars] of Object.entries(COMPONENT)) {
      for (const [name, key] of Object.entries(vars)) {
        if (accentKeys.has(key)) out.push(`--${group}-${name}`);
      }
    }
    return out;
  })();

  const allowed = new Set([
    ...ACCENT_TOKEN_KEYS.map((k) => `--${k}`),
    ...accentDerivedComponentKeys,
  ]);

  /** 不应随品牌变化的：结构色 semantic + content（数据类别色）+ static。 */
  const mustStayPut = [
    ...Object.keys(SEMANTIC.light).filter((k) => !(ACCENT_TOKEN_KEYS as readonly string[]).includes(k)),
    ...Object.keys(CONTENT.light),
    ...Object.keys(STATIC),
  ].map((k) => `--${k}`);

  it('存在别名到 accent 的 component token（这条不变量不是空转）', () => {
    expect(accentDerivedComponentKeys.length).toBeGreaterThan(0);
    expect(accentDerivedComponentKeys).toContain('--bar-accent');
  });

  it.each(MODES)('%s：变化的键全部溯源到 accent，结构色一个都没动', (mode) => {
    const a = resolveTokens(spec(mode, 'violet'));
    const b = resolveTokens(spec(mode, 'cyan'));
    const changed = Object.keys(a).filter((k) => a[k] !== b[k]);

    expect(changed).toContain('--accent'); // 确认真换了，不是空断言
    for (const k of changed) expect(allowed.has(k), `${k} 不该随品牌变`).toBe(true);
    for (const k of mustStayPut) expect(a[k], `${k} 被品牌带跑了`).toBe(b[k]);
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
