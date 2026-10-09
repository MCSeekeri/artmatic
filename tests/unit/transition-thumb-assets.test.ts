import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listTransitions } from '../../src/effects/transitions/registry';

/**
 * 预先导出的转场缩略图资源（`src/assets/transition-thumbnails/`）的守卫。
 *
 * 与 `effect-thumb-assets.test.ts` / `algo-thumb-assets.test.ts` 同一件事：
 * 守「**资源与代码对齐**」—— 这类「预先烘好的静态素材」唯一的真实风险是
 * 加了转场但忘了导出（卡片空）、或上游删了条目而资源留在仓库里（构建产物变大）。
 *
 * 修法只有一条命令：`node scripts/gen-transition-thumbs.mjs`（见文件头）。
 *
 * ⚠️ 这个目录与 `src/ui/transition-picker/thumb-assets.ts` 的 glob 是**一对**，
 * 改目录名要同时改两处。
 */

const DIR = fileURLToPath(new URL('../../src/assets/transition-thumbnails', import.meta.url));

/** WebP：`RIFF` + 4 字节长度 + `WEBP`。 */
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const ascii = (at: number, n: number): string =>
    String.fromCharCode(...bytes.subarray(at, at + n));
  return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
}

const FILES = readdirSync(DIR).filter((f) => f.endsWith('.webp'));
const IDS = FILES.map((f) => f.replace(/\.webp$/, '')).sort();
const TRANSITION_IDS = listTransitions()
  .map((e) => e.id)
  .sort();

describe('转场缩略图资源：与目录对齐', () => {
  it('资源非空（守卫本身要有覆盖面）', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('目录里每条转场都有缩略图', () => {
    const have = new Set(IDS);
    const missing = TRANSITION_IDS.filter((id) => !have.has(id));
    expect(
      missing,
      '这些转场没有缩略图 → 选择器里那张卡片是空的。跑 `node scripts/gen-transition-thumbs.mjs`',
    ).toEqual([]);
  });

  it('没有孤儿资源（每个文件都对应一条真实转场）', () => {
    const known = new Set(TRANSITION_IDS);
    const orphans = IDS.filter((id) => !known.has(id));
    expect(orphans, '这些缩略图对应的转场已经不在目录里了（上游删了条目？）').toEqual([]);
  });

  it('目录里不该混进别的扩展名（PNG / JPEG 会把仓库撑大十几倍）', () => {
    const others = readdirSync(DIR).filter((f) => !f.endsWith('.webp'));
    expect(others, '只放导出的 WebP；原始 PNG 不要进仓库').toEqual([]);
  });
});

describe('转场缩略图资源：格式与体积', () => {
  it('每一张都是真的 WebP', () => {
    const bad = FILES.filter((f) => !isWebp(readFileSync(join(DIR, f))));
    expect(bad, '这些文件不是 WebP（扩展名换了但内容没换？）').toEqual([]);
  });

  it('单张与整套的体积都在预算内', () => {
    const sizes = FILES.map((f) => ({ f, n: statSync(join(DIR, f)).size }));
    const total = sizes.reduce((s, x) => s + x.n, 0);
    // 640×360 的 WebP q84 实测整套 1.87 MB、最大单张约 143 KB（TVStatic 那种噪声图）。
    // 阈值留一倍余量：超了说明有人换回了 PNG，或者质量参数被调飞了。
    expect(total, '整套转场缩略图过大').toBeLessThan(4 * 1024 * 1024);
    const fattest = sizes.filter((x) => x.n > 400 * 1024).map((x) => x.f);
    expect(fattest, '这些单张过大').toEqual([]);
  });

  it('每张都有内容（不是空文件 / 被截断）', () => {
    for (const f of FILES) {
      expect(statSync(join(DIR, f)).size, `${f} 太小`).toBeGreaterThan(200);
    }
  });
});
