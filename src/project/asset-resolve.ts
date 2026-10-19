/**
 * asset-resolve.ts — 「这条素材现在该用哪一份？」（纯函数，不读盘）。
 *
 * 判据的顺序是刻意的：
 *
 * 1. **内容身份优先**。`content.fp` 是唯一能回答「这还是不是原来那份」的东西；
 *    路径只说明「哪里有一份」。
 * 2. **`mode` 决定偏好**，不是「哪条路径先存在」。linked 的工程优先本地原文件
 *    （不读工程副本），bundled 的工程优先工程副本（可移植）。
 * 3. **对不上就是 `stale` / `conflict`，绝不静默换内容**。两份都存在但内容
 *    不同时，用户必须知道，并且默认落在 `mode` 那一份上。
 *
 * 这里不读盘：调用方先把两份位置 probe 成 `{ exists, size, fp }`（128 KiB
 * 采样），再交给它判定。这样整张真值表可以在 vitest 里穷举。
 */

import type { AssetContent } from './fingerprint';
import { locationOf, type AssetEntry, type LocationKind } from './ledger';

export interface LocationProbe {
  exists: boolean;
  size: number | null;
  fp: string | null;
}

export interface ResolveInput {
  project: LocationProbe | null;
  local: LocationProbe | null;
}

export type AssetStatus = 'ok' | 'conflict' | 'stale' | 'missing';

export interface AssetResolution {
  /** 该用哪一份；`none` = 现在没有任何可用副本。 */
  use: 'project' | 'local' | 'none';
  status: AssetStatus;
  /** `mode` 指定的那一路（仅用于解释 fallback / 提示）。 */
  preferred: LocationKind | null;
  /** 用的不是首选那份（另一份还在，属于健康回退）。 */
  fellBack: boolean;
  /** 是否用指纹确认过（false = 只比了大小 / 没有身份）。 */
  verified: boolean;
}

const NONE: AssetResolution = {
  use: 'none',
  status: 'missing',
  preferred: null,
  fellBack: false,
  verified: false,
};

/** 某个位置是否与记录的内容对得上。 */
function usable(probe: LocationProbe | null, content: AssetContent | null): boolean {
  if (!probe?.exists) return false;
  if (!content) return true; // 没有身份：只能接受（verified = false）
  if (probe.size !== null && probe.size !== content.size) return false;
  if (probe.fp !== null && probe.fp !== content.fp) return false;
  return true;
}

function verifiedBy(probe: LocationProbe | null, content: AssetContent | null): boolean {
  return !!probe?.exists && !!content && !!probe.fp && probe.size !== null;
}

export function resolveAsset(entry: AssetEntry, probes: ResolveInput): AssetResolution {
  if (entry.mode === 'generated') {
    return { ...NONE, status: 'ok' };
  }

  const preferred: LocationKind | null =
    entry.mode === 'linked'
      ? 'local'
      : entry.mode === 'bundled'
        ? 'project'
        : locationOf(entry, 'local')
          ? 'local'
          : 'project';

  const content = entry.content;
  const p = probes.project;
  const l = probes.local;
  const pOk = usable(p, content);
  const lOk = usable(l, content);
  const pExists = !!p?.exists;
  const lExists = !!l?.exists;

  if (pOk && lOk) {
    /*
     * 两份都「对得上记录」——如果它们各自的指纹不一致，只可能是记录本身
     * 已经过期（或者两份里只有一份真对）。能分辨就挑对的那份并标 stale；
     * 分辨不了（没有身份）就只能按偏好走，并明确 `verified:false`。
     */
    if (content && p?.fp && l?.fp && p.fp !== l.fp) {
      const pMatch = p.fp === content.fp;
      const lMatch = l.fp === content.fp;
      if (pMatch !== lMatch) {
        return {
          use: pMatch ? 'project' : 'local',
          status: 'stale',
          preferred,
          fellBack: false,
          verified: true,
        };
      }
      return {
        use: preferred ?? 'project',
        status: 'conflict',
        preferred,
        fellBack: false,
        verified: false,
      };
    }
    const use = preferred ?? 'project';
    return {
      use,
      status: 'ok',
      preferred,
      fellBack: false,
      verified: verifiedBy(use === 'project' ? p : l, content),
    };
  }

  if (pOk || lOk) {
    const use: 'project' | 'local' = pOk ? 'project' : 'local';
    const used = use === 'project' ? p : l;
    const otherExists = use === 'project' ? lExists : pExists;
    return {
      use,
      // 首选那份坏了/变了、另一份还能用：这是回退，需要让用户知道。
      status: otherExists || use !== preferred ? 'stale' : 'ok',
      preferred,
      fellBack: use !== preferred,
      verified: verifiedBy(used, content),
    };
  }

  if (!pExists && !lExists) {
    return { ...NONE, preferred };
  }

  /*
   * 至少一份存在但都对不上：一份是「源文件变过」，两份都不同是「两份互相
   * 不一致」——后者必须由用户决定哪份才是这条素材，不能自动挑。
   */
  return {
    use: 'none',
    status: pExists && lExists ? 'conflict' : 'stale',
    preferred,
    fellBack: false,
    verified: false,
  };
}
