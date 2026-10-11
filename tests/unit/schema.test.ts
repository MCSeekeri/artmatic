import { describe, expect, it } from 'vitest';
import {
  defaultProject,
  migrateProject,
  newId,
  SCHEMA_VERSION,
  validateProject,
} from '../../src/core/schema';

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
