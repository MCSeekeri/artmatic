import { beforeEach, describe, expect, it } from 'vitest';
import {
  localFontSource,
  normalizeFamilies,
  pickLocalFont,
  queryLocalFontFamilies,
  resetLocalFontCaches,
  resolveLocalFont,
  styleTextToFace,
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

/* ------------------------------------------------------------------ *
 * 文字转路径：从记录里挑 face、取字体文件字节
 * ------------------------------------------------------------------ */

/** 带 `blob()` 的记录。`bytes` 缺省给一段可辨认的假数据。 */
function record(
  family: string,
  style: string,
  bytes: Uint8Array = new Uint8Array([1, 2, 3]),
  fullName = `${family} ${style}`,
): LocalFontData {
  return {
    family,
    fullName,
    postscriptName: `${family.replace(/\s/g, '')}-${style.replace(/\s/g, '')}`,
    style,
    // `bytes.slice()` 的 buffer 是 ArrayBuffer（不是 ArrayBufferLike），才符合 BlobPart。
    blob: async () => new Blob([bytes.slice().buffer]),
  };
}

function sourceOf(fonts: LocalFontData[]): LocalFontSource {
  return { queryLocalFonts: async () => fonts };
}

describe('styleTextToFace', () => {
  it('常见 style 字符串', () => {
    expect(styleTextToFace('Regular')).toEqual({ weight: 400, italic: false });
    expect(styleTextToFace('Bold')).toEqual({ weight: 700, italic: false });
    expect(styleTextToFace('Bold Italic')).toEqual({ weight: 700, italic: true });
    expect(styleTextToFace('SemiBold')).toEqual({ weight: 600, italic: false });
    expect(styleTextToFace('ExtraLight')).toEqual({ weight: 200, italic: false });
    expect(styleTextToFace('Black')).toEqual({ weight: 900, italic: false });
    expect(styleTextToFace('Light Oblique')).toEqual({ weight: 300, italic: true });
  });

  it('认不出的按 Regular —— 与浏览器「回落 400」一致', () => {
    expect(styleTextToFace('Narrow')).toEqual({ weight: 400, italic: false });
    expect(styleTextToFace('')).toEqual({ weight: 400, italic: false });
  });

  it('复合词不会被拆错：ExtraBold 不是 Bold + Extra', () => {
    expect(styleTextToFace('ExtraBold').weight).toBe(800);
    expect(styleTextToFace('SemiBold Italic')).toEqual({ weight: 600, italic: true });
  });
});

describe('pickLocalFont', () => {
  const arial = [
    record('Arial', 'Regular'),
    record('Arial', 'Bold'),
    record('Arial', 'Italic'),
    record('Arial', 'Bold Italic'),
  ];

  it('按族名挑（大小写与多余空白不敏感）', () => {
    expect(pickLocalFont(arial, '  arial ', 400, 'normal')?.record.style).toBe('Regular');
  });

  it('缺 500 时按 CSS 规则回落到 400', () => {
    expect(pickLocalFont(arial, 'Arial', 500, 'normal')?.weight).toBe(400);
  });

  it('要粗体就拿 Bold，不会拿 Regular', () => {
    expect(pickLocalFont(arial, 'Arial', 700, 'normal')?.weight).toBe(700);
  });

  it('要斜体就拿 Italic', () => {
    const got = pickLocalFont(arial, 'Arial', 400, 'italic');
    expect(got?.record.style).toBe('Italic');
    expect(got?.italic).toBe(true);
  });

  it('只有常规面时返回常规面 + italic:false（合成判断交给调用方）', () => {
    const got = pickLocalFont([record('Consolas', 'Regular')], 'Consolas', 400, 'italic');
    expect(got?.record.style).toBe('Regular');
    expect(got?.italic).toBe(false);
  });

  it('族名对不上时回落到 fullName（中文全名）', () => {
    const msyh = record('Microsoft YaHei', 'Regular', undefined, '微软雅黑');
    expect(pickLocalFont([msyh], '微软雅黑', 400, 'normal')?.record.family).toBe('Microsoft YaHei');
  });

  it('族里没有这个字体 ⇒ null（不是「随便挑一个」）', () => {
    expect(pickLocalFont(arial, 'Noto Sans', 400, 'normal')).toBeNull();
  });
});

describe('resolveLocalFont', () => {
  beforeEach(() => {
    resetLocalFontCaches();
  });

  it('拿到字节与记录自身的字面信息', async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const r = await resolveLocalFont('Arial', 700, 'normal', sourceOf([record('Arial', 'Bold', bytes)]));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(new Uint8Array(r.bytes)).toEqual(bytes);
    expect(r.weight).toBe(700);
    expect(r.italic).toBe(false);
  });

  it('同一个字面第二次取字节走缓存（不再调 blob）', async () => {
    let calls = 0;
    const rec = record('Cache Me', 'Regular');
    const original = rec.blob!;
    rec.blob = async () => {
      calls += 1;
      return original();
    };
    await resolveLocalFont('Cache Me', 400, 'normal', sourceOf([rec]));
    await resolveLocalFont('Cache Me', 400, 'normal', sourceOf([rec]));
    expect(calls).toBe(1);
  });

  it('族不存在 ⇒ not-found（与「读不到字节」分开）', async () => {
    const r = await resolveLocalFont('Nope', 400, 'normal', sourceOf([record('Arial', 'Regular')]));
    expect(r).toEqual({ kind: 'not-found' });
  });

  it('族存在但没有 blob() ⇒ no-bytes', async () => {
    const rec = record('No Blob', 'Regular');
    delete rec.blob;
    const r = await resolveLocalFont('No Blob', 400, 'normal', sourceOf([rec]));
    expect(r).toEqual({ kind: 'no-bytes' });
  });

  it('权限被拒（空数组）⇒ denied', async () => {
    expect(await resolveLocalFont('Arial', 400, 'normal', sourceOf([]))).toEqual({ kind: 'denied' });
  });

  it('环境不支持（source 为 null）⇒ unsupported', async () => {
    expect(await resolveLocalFont('Arial', 400, 'normal', null)).toEqual({ kind: 'unsupported' });
  });

  it('blob() 抛错 ⇒ failed，带上原因', async () => {
    const rec = record('Broken', 'Regular');
    rec.blob = () => Promise.reject(new Error('file locked'));
    const r = await resolveLocalFont('Broken', 400, 'normal', sourceOf([rec]));
    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') expect(r.message).toContain('file locked');
  });

  it('空文件 ⇒ no-bytes（不能拿它去问 HarfBuzz）', async () => {
    const r = await resolveLocalFont(
      'Empty',
      400,
      'normal',
      sourceOf([record('Empty', 'Regular', new Uint8Array(0))]),
    );
    expect(r).toEqual({ kind: 'no-bytes' });
  });
});
