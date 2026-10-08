import { describe, expect, it } from 'vitest';
import {
  localFontSource,
  normalizeFamilies,
  queryLocalFontFamilies,
  type LocalFontData,
  type LocalFontSource,
} from '../../src/typography/local-fonts';

/**
 * 假的本机字体源。
 *
 * 关键点：真实的 `queryLocalFonts()` 返回的是**字体文件**记录 —— 一个族有多个
 * 字重 / 斜体就多条。这里照这个形态造，否则「去重」那条测试等于没测。
 */
function fakeSource(fonts: { family: string; style?: string }[]): LocalFontSource {
  return {
    queryLocalFonts: async (): Promise<LocalFontData[]> =>
      fonts.map((f) => ({
        family: f.family,
        fullName: `${f.family} ${f.style ?? 'Regular'}`,
        postscriptName: `${f.family.replace(/\s/g, '')}-${f.style ?? 'Regular'}`,
        style: f.style ?? 'Regular',
      })),
  };
}

describe('localFontSource', () => {
  it('环境里没有这个 API 时返回 null（按钮据此置灰）', () => {
    // vitest 跑在 Node 上，全局没有 queryLocalFonts ⇒ 置灰分支。
    expect(localFontSource()).toBeNull();
  });

  it('**挂点必须是全局（window）** —— 挂在 navigator 上不算数', () => {
    /*
     * 这条是踩过的坑：API 是 `Window.queryLocalFonts()`（caniuse 的条目名
     * `mdn-api-window-querylocalfonts`），**不在 navigator 上**。
     *
     * 写成 `navigator.queryLocalFonts` 的症状极其误导：探测**永远**返回 null ⇒
     * 按钮一直灰着，看起来像「浏览器不支持」，而浏览器完全支持。
     * 所以要能分开这两种情况，两头都造一遍。
     */
    const g = globalThis as unknown as Record<string, unknown>;
    const nav = (globalThis as unknown as { navigator?: Record<string, unknown> }).navigator;
    const fake = async (): Promise<LocalFontData[]> => [];
    if (nav) nav.queryLocalFonts = fake;
    try {
      expect(localFontSource(), '只挂在 navigator 上时不该认得').toBeNull();
      g.queryLocalFonts = fake;
      expect(localFontSource(), '挂到全局就该认得').not.toBeNull();
    } finally {
      delete g.queryLocalFonts;
      if (nav) delete nav.queryLocalFonts;
    }
  });
});

describe('normalizeFamilies', () => {
  it('去掉首尾空白', () => {
    expect(normalizeFamilies(['  Arial  ', 'Arial'])).toEqual(['Arial']);
  });

  it('空串与纯空白一律丢掉（否则下拉里会出现一个选不中的空项）', () => {
    expect(normalizeFamilies(['', '   ', 'Arial'])).toEqual(['Arial']);
  });

  it('去重', () => {
    expect(normalizeFamilies(['A', 'B', 'A', 'B', 'A'])).toEqual(['A', 'B']);
  });

  it('按**本地化**顺序排 —— 中文族名不该全部沉到 ASCII 之后', () => {
    const out = normalizeFamilies(['微软雅黑', 'Arial', '宋体', 'Zapf']);
    // 判据是「中英文混排仍然有序」，而不是钉死某一个具体次序
    // （不同 ICU 版本的排序结果会有细微差别）。
    expect(out).toHaveLength(4);
    expect(new Set(out)).toEqual(new Set(['微软雅黑', 'Arial', '宋体', 'Zapf']));
    expect(out.indexOf('Arial')).toBeLessThan(out.indexOf('Zapf'));
  });
});

describe('queryLocalFontFamilies', () => {
  it('source 为 null ⇒ unsupported（不是「失败」也不是「被拒绝」）', async () => {
    expect(await queryLocalFontFamilies(null)).toEqual({ kind: 'unsupported' });
  });

  it('一个族的多个字重被合成一条', async () => {
    const r = await queryLocalFontFamilies(
      fakeSource([
        { family: 'Arial', style: 'Regular' },
        { family: 'Arial', style: 'Bold' },
        { family: 'Arial', style: 'Italic' },
        { family: 'Consolas' },
      ]),
    );
    expect(r).toEqual({ kind: 'ok', families: ['Arial', 'Consolas'] });
  });

  it('返回空数组归到 **denied**，不是「成功但 0 个」', async () => {
    /*
     * API 的约定是「用户拒绝授权 ⇒ resolve 空数组」而不是抛错。
     * 归成 ok 的话界面会说「已载入 0 个本机字体」—— 用户根本不知道
     * 自己是点过拒绝、还是机器上真的没字体。
     */
    expect(await queryLocalFontFamilies(fakeSource([]))).toEqual({ kind: 'denied' });
  });

  it('抛错时把**原因**带出来，不吞掉', async () => {
    const boom: LocalFontSource = {
      queryLocalFonts: () => Promise.reject(new Error('not allowed by permissions policy')),
    };
    const r = await queryLocalFontFamilies(boom);
    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') expect(r.message).toContain('permissions policy');
  });

  it('非 Error 的抛出也要能描述（不能变成 "[object Object]" 之外的崩溃）', async () => {
    const weird: LocalFontSource = { queryLocalFonts: () => Promise.reject('boom') };
    const r = await queryLocalFontFamilies(weird);
    expect(r).toEqual({ kind: 'failed', message: 'boom' });
  });
});
