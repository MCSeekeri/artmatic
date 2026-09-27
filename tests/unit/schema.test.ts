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
});
