import { describe, expect, it } from 'vitest';
import { resolveAsset, type LocationProbe } from '../../src/project/asset-resolve';
import type { AssetEntry } from '../../src/project/ledger';

/**
 * 素材解析的核心真值表：**同一份素材有多份副本时，到底用哪一份**。
 *
 * 这里的每一条都对应一个用户可见的形态：
 *  - 本地文件在、工程副本也在 → 用 mode 偏好的那份；
 *  - 首选的那份被改过 → 用另一份，但状态是 `stale`（界面必须提示）；
 *  - 两份都在且对不上 → `conflict`，**不许自动挑**；
 *  - 一份都不在 → `missing`（脱机占位）。
 */

const FP = 'fp1:100:abc';

function entry(over: Partial<AssetEntry> = {}): AssetEntry {
  return {
    id: 'a',
    kind: 'image',
    originName: 'a.png',
    mode: 'linked',
    addedAt: 0,
    content: { size: 100, fp: FP },
    locations: [
      { kind: 'local', path: '/x/a.png', seen: null },
      { kind: 'project', path: 'assets/a.png', seen: null },
    ],
    ...over,
  };
}

const okProject: LocationProbe = { exists: true, size: 100, fp: FP };
const okLocal: LocationProbe = { exists: true, size: 100, fp: FP };
const gone: LocationProbe = { exists: false, size: null, fp: null };
const otherContent: LocationProbe = { exists: true, size: 100, fp: 'fp1:100:zzz' };

describe('resolveAsset：两份都在', () => {
  it('linked 偏好本地、bundled 偏好工程副本（内容都对得上）', () => {
    expect(resolveAsset(entry({ mode: 'linked' }), { project: okProject, local: okLocal })).toMatchObject({
      use: 'local',
      status: 'ok',
      verified: true,
    });
    expect(resolveAsset(entry({ mode: 'bundled' }), { project: okProject, local: okLocal })).toMatchObject({
      use: 'project',
      status: 'ok',
      verified: true,
    });
  });

  it('首选那份内容变了、另一份对得上 → 用另一份并标 stale', () => {
    expect(
      resolveAsset(entry({ mode: 'linked' }), { project: okProject, local: otherContent }),
    ).toMatchObject({ use: 'project', status: 'stale', fellBack: true });
    expect(
      resolveAsset(entry({ mode: 'bundled' }), { project: otherContent, local: okLocal }),
    ).toMatchObject({ use: 'local', status: 'stale', fellBack: true });
  });

  it('两份都存在但对不上记录 → conflict（不许自动挑）', () => {
    // content 存在、两份互不相同、且都不是记录里的那份
    const c = resolveAsset(entry(), {
      project: { ...otherContent, fp: 'fp1:100:aaa' },
      local: { ...otherContent, fp: 'fp1:100:bbb' },
    });
    expect(c).toMatchObject({ status: 'conflict', use: 'none' });
  });
});

describe('resolveAsset：只有一份', () => {
  it('首选不在、另一份在 → 健康回退（use 另一份）', () => {
    expect(resolveAsset(entry({ mode: 'linked' }), { project: okProject, local: gone })).toMatchObject({
      use: 'project',
      status: 'stale',
      fellBack: true,
    });
    expect(resolveAsset(entry({ mode: 'bundled' }), { project: gone, local: okLocal })).toMatchObject({
      use: 'local',
      status: 'stale',
      fellBack: true,
    });
  });

  it('两份都不在 → missing', () => {
    expect(resolveAsset(entry(), { project: gone, local: gone })).toMatchObject({
      use: 'none',
      status: 'missing',
    });
  });

  it('在但对不上 → stale（不假装能用）', () => {
    const r = resolveAsset(entry({ mode: 'bundled' }), { project: otherContent, local: gone });
    expect(r).toMatchObject({ use: 'none', status: 'stale' });
  });
});

describe('resolveAsset：没有身份 / generated', () => {
  it('content 为 null 时两份都在：按偏好走，但 verified=false', () => {
    const r = resolveAsset(entry({ content: null }), { project: okProject, local: okLocal });
    expect(r).toMatchObject({ use: 'local', status: 'ok', verified: false });
  });

  it('generated 不参与 —— 永远 ok、不指任何位置', () => {
    expect(
      resolveAsset(entry({ mode: 'generated', content: null, locations: [] }), {
        project: gone,
        local: gone,
      }),
    ).toMatchObject({ use: 'none', status: 'ok' });
  });
});
