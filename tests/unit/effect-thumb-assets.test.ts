import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listEffects } from '../../src/effects/registry';

/**
 * 预先导出的缩略图资源（`src/assets/effect-thumbnails/`）的守卫。
 *
 * 这里守的是「**资源与代码对齐**」—— 它是这类「预先烘好的静态素材」唯一的
 * 真实风险：加了一个特效但忘了导出缩略图，选择器里那张卡片就是空的；
 * 反过来，删了特效而资源留在仓库里，就会一直躺在构建产物里没人发现。
 *
 * 两条都会**明确报错**，而修法只有一条命令：去 lab 点「批量导出缩略图」，
 * 解压进这个目录（见 AGENTS §5.5）。
 *
 * ⚠️ 这个目录与 `src/ui/effect-picker/thumb-assets.ts` 的 glob 是**一对**，
 * 改目录名要同时改两处。
 */

const DIR = fileURLToPath(new URL('../../src/assets/effect-thumbnails', import.meta.url));

/** WebP：`RIFF` + 4 字节长度 + `WEBP`。 */
function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const ascii = (at: number, n: number): string =>
    String.fromCharCode(...bytes.subarray(at, at + n));
  return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
}

const FILES = readdirSync(DIR).filter((f) => f.endsWith('.webp'));
const IDS = FILES.map((f) => f.replace(/\.webp$/, '')).sort();
const EFFECTS = listEffects()
  .map((e) => e.id)
  .sort();

describe('缩略图资源：与注册表对齐', () => {
  it('资源非空（守卫本身要有覆盖面）', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('每个注册的特效都有缩略图', () => {
    const have = new Set(IDS);
    const missing = EFFECTS.filter((id) => !have.has(id));
    expect(
      missing,
      '这些特效没有缩略图 → 选择器里那张卡片是空的。去 lab 点「批量导出缩略图」',
    ).toEqual([]);
  });

  it('没有孤儿资源（每个文件都对应一个真实特效）', () => {
    const known = new Set(EFFECTS);
    const orphans = IDS.filter((id) => !known.has(id));
    expect(orphans, '这些缩略图对应的特效已经不存在了').toEqual([]);
  });

  it('目录里不该混进别的扩展名（PNG / JPEG 会把仓库撑大十几倍）', () => {
    const others = readdirSync(DIR).filter((f) => !f.endsWith('.webp'));
    expect(others, '只放导出的 WebP；原始 PNG 不要进仓库').toEqual([]);
  });
});

describe('缩略图资源：格式与体积', () => {
  it('每一张都是真的 WebP', () => {
    const bad = FILES.filter((f) => !isWebp(readFileSync(join(DIR, f))));
    expect(bad, '这些文件不是 WebP（扩展名换了但内容没换？）').toEqual([]);
  });

  it('单张与整套的体积都在预算内', () => {
    const sizes = FILES.map((f) => ({ f, n: statSync(join(DIR, f)).size }));
    const total = sizes.reduce((s, x) => s + x.n, 0);
    // 640×360 的 WebP q84 实测整套 1.11 MB、最大单张 157 KB（grain 那种噪声图）。
    // 阈值留一倍余量：超了说明有人换回了 PNG，或者质量参数被调飞了。
    expect(total, '整套缩略图过大').toBeLessThan(2.5 * 1024 * 1024);
    const fattest = sizes.filter((x) => x.n > 320 * 1024).map((x) => x.f);
    expect(fattest, '这些单张过大').toEqual([]);
  });

  it('每张都有内容（不是空文件 / 被截断）', () => {
    for (const f of FILES) {
      expect(statSync(join(DIR, f)).size, `${f} 太小`).toBeGreaterThan(200);
    }
  });
});
