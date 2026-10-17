import { describe, expect, it } from 'vitest';
import {
  cloneProject,
  defaultKeySettings,
  defaultProject,
  identityQuad,
  migrateProject,
  newId,
  SCHEMA_VERSION,
  validateProject,
  type QuadCorners,
} from '../../src/core/schema';
import { resolveThemeColor } from '../../src/typography/theme';
import { createTextElement, createTypographyDocument } from '../../src/typography/document';

describe('validateProject', () => {
  it('defaultProject 通过校验', () => {
    expect(() => validateProject(defaultProject('ok'))).not.toThrow();
  });

  it('缺字段 / 非法值被拒', () => {
    const p = defaultProject('bad');
    (p as { fps: number }).fps = 0;
    expect(() => validateProject(p)).toThrow(/fps/);
  });

  it('未知轨道类型被拒', () => {
    const p = defaultProject('bad');
    (p.tracks as unknown[]).push({ kind: 'weird', id: 'x', clips: [] });
    expect(() => validateProject(p)).toThrow(/轨道类型/);
  });

  it('音频轨里放视觉片段被拒', () => {
    const p = defaultProject('bad');
    p.tracks.push({
      kind: 'audio', id: newId(), name: 'A1', enabled: true, bus: 'master',
      clips: [{
        kind: 'source', id: newId(), start: 0, end: 1, label: '', fadeSec: 0,
        curves: {}, source: { type: 'solid', color: '#000' }, blend: 'normal',
        opacity: 1, transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 }, fit: 'contain',
      }],
    } as never);
    expect(() => validateProject(p)).toThrow(/音频轨/);
  });

  it('overlapBehavior 三值之外被拒', () => {
    const p = defaultProject('bad');
    (p as { overlapBehavior: string }).overlapBehavior = 'merge';
    expect(() => validateProject(p)).toThrow(/overlapBehavior/);
  });
});

describe('validateProject：历史遗留的「主题色引用」', () => {
  /*
   * 取色卡对**所有**颜色入口都提供主题色（`@accent1`），但只有排版文档会在
   * 渲染时解析引用。算法参数 / 特效参数 / 纯色片段的颜色直接进
   * `hexToRgba()` —— 引用在那里算坏颜色，回退成**品红**。
   *
   * 用户侧的形态：在检查器里挑一个主题色，画面整片变品红，而参数表里存的
   * 是一串 `@accent1`。新数据由检查器写入时解析，老数据由 validateProject 补。
   */
  const solid = (color: string) =>
    ({
      kind: 'source',
      id: newId(),
      start: 0,
      end: 1,
      label: '',
      fadeSec: 0,
      curves: {},
      source: { type: 'solid', color },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'contain',
    }) as never;

  const algo = (params: Record<string, unknown>) =>
    ({
      kind: 'source',
      id: newId(),
      start: 0,
      end: 1,
      label: '',
      fadeSec: 0,
      curves: {},
      source: { type: 'algo', generator: 'game-of-life', params },
      blend: 'normal',
      opacity: 1,
      transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
      fit: 'contain',
    }) as never;

  const effect = (values: Record<string, unknown>) =>
    ({
      kind: 'effect',
      id: newId(),
      start: 0,
      end: 1,
      label: '',
      fadeSec: 0,
      curves: {},
      chain: [{ instanceId: newId(), defId: 'duotone', enabled: true, values }],
    }) as never;

  it('纯色 / 算法参数 / 特效参数里的 @slot 被解析成裸 hex', () => {
    const p = defaultProject('refs');
    p.tracks = [
      {
        kind: 'visual',
        id: 'v1',
        name: 'V1',
        enabled: true,
        clips: [solid('@accent1'), algo({ colorLive: '@accent1.d25', speed: 1, colorBg: '#102030' }), effect({ tint: '@lt1', amount: 0.5 })],
      },
    ] as never;

    validateProject(p);
    const clips = (p.tracks[0] as unknown as { clips: unknown[] }).clips as {
      source?: { color?: string; params?: Record<string, unknown> };
      chain?: { values: Record<string, unknown> }[];
    }[];

    expect(clips[0]!.source!.color, '纯色片段里的引用必须解析成 hex').toBe('#156082');
    const params = clips[1]!.source!.params!;
    expect(String(params.colorLive)).toMatch(/^#[0-9a-f]{6}$/i);
    // 变体（`.d25`）也要解析对：它比原色暗，不是把整个引用当普通 hex 丢掉。
    expect(params.colorLive).toBe(resolveThemeColor('@accent1.d25'));
    expect(params.colorLive).not.toBe('#156082');
    // 非颜色参数（数字 / 裸 hex）一个都不能被动。
    expect(params.speed).toBe(1);
    expect(params.colorBg).toBe('#102030');
    expect(clips[2]!.chain![0]!.values.tint).toBe('#ffffff');
    expect(clips[2]!.chain![0]!.values.amount).toBe(0.5);
  });

  it('排版文档里的引用一个字都不能动（那是换配色方案的唯一依据）', () => {
    const doc = createTypographyDocument();
    const el = createTextElement(doc.size, { text: 'hi' });
    el.style.color = '@accent1';
    doc.elements.push(el);

    const p = defaultProject('refs-typo');
    p.tracks = [
      {
        kind: 'visual',
        id: 'v1',
        name: 'V1',
        enabled: true,
        clips: [
          {
            kind: 'source',
            id: newId(),
            start: 0,
            end: 1,
            label: '',
            fadeSec: 0,
            curves: {},
            source: { type: 'text', doc },
            blend: 'normal',
            opacity: 1,
            transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 },
            fit: 'contain',
          },
        ],
      },
    ] as never;

    validateProject(p);
    const src = ((p.tracks[0] as unknown as { clips: { source: { doc: typeof doc } }[] }).clips[0]!).source;
    const first = src.doc.elements[0]!;
    expect(first.kind).toBe('text');
    expect(first.kind === 'text' ? first.style.color : null).toBe('@accent1');
  });

  it('解析不了的值原样保留（自定义文本参数里手打的 @foo）', () => {
    const p = defaultProject('refs-keep');
    p.tracks = [
      {
        kind: 'visual',
        id: 'v1',
        name: 'V1',
        enabled: true,
        clips: [algo({ labelCustom: '@foo', colorLive: '#123456' })],
      },
    ] as never;

    validateProject(p);
    const params = ((p.tracks[0] as { clips: { source: { params: Record<string, unknown> } }[] }).clips[0]!).source
      .params;
    expect(params.labelCustom).toBe('@foo');
    expect(params.colorLive).toBe('#123456');
  });
});

describe('migrateProject', () => {
  it('当前版本原样通过', () => {
    const p = defaultProject('cur');
    const out = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.name).toBe('cur');
  });

  it('拒绝更高版本（防静默损坏）', () => {
    const p = defaultProject('future');
    p.schemaVersion = SCHEMA_VERSION + 1;
    expect(() => migrateProject(JSON.parse(JSON.stringify(p)))).toThrow(/高于/);
  });

  it('缺 schemaVersion 被拒', () => {
    expect(() => migrateProject({})).toThrow(/schemaVersion/);
  });

  it('v1 → v2：形状不合法的手改 doc 被补齐成合法空文档', () => {
    // v1 里 text 源是 { type:'text'; doc: unknown }，理论上没产出过；
    // 但手改 JSON 可能带一个残缺 doc，不补的话 validateProject 会在更远处炸。
    const p = defaultProject('v1');
    p.schemaVersion = 1;
    p.tracks.push({
      kind: 'visual',
      id: newId(),
      name: 'V1',
      enabled: true,
      clips: [{
        kind: 'source', id: newId(), start: 0, end: 1, label: '', fadeSec: 0, curves: {},
        source: { type: 'text', doc: { garbage: true } },
        blend: 'normal', opacity: 1,
        transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 }, fit: 'contain',
      }],
    } as never);

    const out = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    const clip = out.tracks[0]!.clips[0]!;
    if (clip.kind !== 'source' || clip.source.type !== 'text') throw new Error('unreachable');
    expect(Array.isArray(clip.source.doc.elements)).toBe(true);
    expect(clip.source.doc.size.w).toBeGreaterThan(0);
    expect(clip.source.doc.size.h).toBeGreaterThan(0);
  });

  it('v1 → v2：本来就合法的 doc 原样保留', () => {
    const doc = {
      size: { w: 1280, h: 720 },
      background: { kind: 'none' },
      elements: [{ id: 'keep-me' }],
      fonts: [],
    };
    const p = defaultProject('v1-ok');
    p.schemaVersion = 1;
    p.tracks.push({
      kind: 'visual', id: newId(), name: 'V1', enabled: true,
      clips: [{
        kind: 'source', id: newId(), start: 0, end: 1, label: '', fadeSec: 0, curves: {},
        source: { type: 'text', doc },
        blend: 'normal', opacity: 1,
        transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 }, fit: 'contain',
      }],
    } as never);

    const out = migrateProject(JSON.parse(JSON.stringify(p)));
    const clip = out.tracks[0]!.clips[0]!;
    if (clip.kind !== 'source' || clip.source.type !== 'text') throw new Error('unreachable');
    expect((clip.source.doc.elements[0] as { id: string }).id).toBe('keep-me');
    expect(clip.source.doc.size).toEqual({ w: 1280, h: 720 });
  });

  it('v1 → v2 迁移是幂等的（跑两次结果一致）', () => {
    const p = defaultProject('idem');
    p.schemaVersion = 1;
    const once = migrateProject(JSON.parse(JSON.stringify(p)));
    const twice = migrateProject(JSON.parse(JSON.stringify(once)));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe('排版片段的校验', () => {
  const textClip = (doc: unknown) => ({
    kind: 'source', id: newId(), start: 0, end: 1, label: '', fadeSec: 0, curves: {},
    source: { type: 'text', doc },
    blend: 'normal', opacity: 1,
    transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 }, fit: 'contain',
  });

  const withClip = (clip: unknown) => {
    const p = defaultProject('t');
    p.tracks.push({ kind: 'visual', id: newId(), name: 'V1', enabled: true, clips: [clip] } as never);
    return p;
  };

  it('合法文档通过', () => {
    const p = withClip(textClip({ size: { w: 1920, h: 1080 }, background: { kind: 'none' }, elements: [], fonts: [] }));
    expect(() => validateProject(p)).not.toThrow();
  });

  it('doc 缺 elements 被拒（否则会静默穿透到光栅化再炸）', () => {
    expect(() => validateProject(withClip(textClip({ size: { w: 10, h: 10 } })))).toThrow(/doc 非法/);
    expect(() => validateProject(withClip(textClip(null)))).toThrow(/doc 非法/);
  });

  it('文档尺寸非法被拒', () => {
    const bad = { size: { w: 0, h: 100 }, elements: [], fonts: [] };
    expect(() => validateProject(withClip(textClip(bad)))).toThrow(/尺寸非法/);
  });
});

describe('影响深度（EffectClip.affectDepth）', () => {
  const withFx = (affectDepth: unknown) => {
    const p = defaultProject('fx');
    p.tracks.push({
      kind: 'visual', id: newId(), name: 'V1', enabled: true,
      clips: [{
        kind: 'effect', id: newId(), start: 0, end: 1, label: '', fadeSec: 0, curves: {},
        chain: [], ...(affectDepth === undefined ? {} : { affectDepth }),
      }],
    } as never);
    return p;
  };

  it('0 / 正整数 / 缺省都通过', () => {
    expect(() => validateProject(withFx(undefined))).not.toThrow();
    expect(() => validateProject(withFx(0))).not.toThrow();
    expect(() => validateProject(withFx(2))).not.toThrow();
  });

  it('负数 / 小数 / 非数字被拒（否则会以另一种语义穿透到 buildStack）', () => {
    for (const bad of [-1, 2.5, NaN, 'two']) {
      expect(() => validateProject(withFx(bad)), String(bad)).toThrow(/影响深度/);
    }
  });

  it('v4 → v5 是恒等迁移：字段原样保留', () => {
    const p = withFx(3);
    p.schemaVersion = 4;
    const out = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    const clip = out.tracks[0]!.clips[0]!;
    if (clip.kind !== 'effect') throw new Error('unreachable');
    expect(clip.affectDepth).toBe(3);
  });
});

describe('片段级抠图 / 四角（SourceClip.key / quad，v7）', () => {
  const sourceClip = (extra: Record<string, unknown> = {}) => ({
    kind: 'source', id: newId(), start: 0, end: 1, label: '', fadeSec: 0, curves: {},
    source: { type: 'solid', color: '#000' },
    blend: 'normal', opacity: 1,
    transform: { x: 0.5, y: 0.5, sx: 1, sy: 1, rot: 0 }, fit: 'contain',
    ...extra,
  });

  const withClip = (clip: unknown) => {
    const p = defaultProject('v7');
    p.tracks.push({ kind: 'visual', id: newId(), name: 'V1', enabled: true, clips: [clip] } as never);
    return p;
  };

  it('工厂函数给出约定的出厂值', () => {
    expect(defaultKeySettings()).toEqual({
      color: '#00ff00', tolerance: 0.25, softness: 0.12, spill: 0.5,
    });
    expect(identityQuad()).toEqual({ tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] });
  });

  it('合法的 key / quad 通过校验；缺省字段照旧通过', () => {
    expect(() => validateProject(withClip(sourceClip()))).not.toThrow();
    expect(() =>
      validateProject(withClip(sourceClip({ key: defaultKeySettings(), quad: identityQuad() }))),
    ).not.toThrow();
    // 边界值合法：容差 0 / 1 是闭区间端点。
    expect(() =>
      validateProject(withClip(sourceClip({
        key: { ...defaultKeySettings(), tolerance: 0, softness: 1, spill: 0 },
      }))),
    ).not.toThrow();
    // 四角允许拖到单位方之外（UI 就是让用户自由拉角），只要求有限数。
    const outward: QuadCorners = {
      tl: [-0.2, -0.1], tr: [1.1, 0.05], br: [1.05, 1.2], bl: [-0.05, 0.95],
    };
    expect(() => validateProject(withClip(sourceClip({ quad: outward })))).not.toThrow();
  });

  it('坏抠图参数被拒（错误文案里带片段 id）', () => {
    const cases: [string, unknown][] = [
      ['坏颜色（没有 #）', { ...defaultKeySettings(), color: '00ff00' }],
      ['坏颜色（三位简写）', { ...defaultKeySettings(), color: '#0f0' }],
      ['颜色不是字符串', { ...defaultKeySettings(), color: 255 }],
      ['tolerance = NaN', { ...defaultKeySettings(), tolerance: NaN }],
      ['tolerance = Infinity', { ...defaultKeySettings(), tolerance: Infinity }],
      ['softness 越界', { ...defaultKeySettings(), softness: 1.5 }],
      ['spill 是字符串', { ...defaultKeySettings(), spill: '0.5' }],
      ['不是对象', null],
      ['是数组', []],
    ];
    for (const [name, bad] of cases) {
      const clip = sourceClip({ key: bad });
      const p = withClip(clip);
      expect(() => validateProject(p), name).toThrow((clip as { id: string }).id);
      expect(() => validateProject(p), name).toThrow(/抠图/);
    }
  });

  it('坏四角被拒（错误文案里带片段 id）', () => {
    const good = identityQuad();
    const cases: [string, unknown][] = [
      ['少一个角', { tl: good.tl, tr: good.tr, bl: good.bl }],
      ['角不是数组', { ...good, tl: '0,0' }],
      ['角长度不是 2', { ...good, tl: [0, 0, 0] }],
      ['角里有 NaN', { ...good, bl: [0, NaN] }],
      ['角里有 Infinity', { ...good, br: [Infinity, 1] }],
      ['不是对象', '#fff'],
      ['是数组', [0, 0]],
    ];
    for (const [name, bad] of cases) {
      const clip = sourceClip({ quad: bad });
      const p = withClip(clip);
      expect(() => validateProject(p), name).toThrow((clip as { id: string }).id);
      expect(() => validateProject(p), name).toThrow(/四角/);
    }
  });

  it('v6 → v7 是恒等迁移：key / quad 原样保留，版本抬到 7', () => {
    const key = { ...defaultKeySettings(), color: '#123abc' };
    // 一般透视四边形（含负坐标，验证迁移 / 校验不会顺手夹到 [0,1]）。
    const quad: QuadCorners = {
      tl: [-0.1, 0.15], tr: [0.9, 0.2], br: [1.05, 0.95], bl: [0, 0.8],
    };
    const p = withClip(sourceClip({ key, quad }));
    p.schemaVersion = 6;
    const out = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.schemaVersion).toBe(7);
    const clip = out.tracks[0]!.clips[0]!;
    if (clip.kind !== 'source') throw new Error('unreachable');
    expect(clip.key).toEqual(key);
    expect(clip.quad).toEqual(quad);
  });

  it('cloneProject 保留新字段，且是深拷贝', () => {
    const p = withClip(sourceClip({ key: defaultKeySettings(), quad: identityQuad() }));
    const copy = cloneProject(p);
    const clip = copy.tracks[0]!.clips[0]!;
    if (clip.kind !== 'source') throw new Error('unreachable');
    expect(clip.key).toEqual(defaultKeySettings());
    expect(clip.quad).toEqual(identityQuad());
    // 撤销栈按整份 JSON 深拷贝存储，改副本不能影响原工程。
    clip.key!.color = '#000000';
    const orig = p.tracks[0]!.clips[0]!;
    if (orig.kind !== 'source') throw new Error('unreachable');
    expect(orig.key!.color).toBe('#00ff00');
  });
});
