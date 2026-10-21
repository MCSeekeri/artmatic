/**
 * fonts-woff2-to-sfnt.mjs — 把内置字体的 woff2 无损还原成 TTF（SFNT）。
 *
 * ## 为什么需要这一步
 *
 * `FontFace`（浏览器渲染 / 光栅化）吃 woff2 没问题，但**转路径**要给
 * HarfBuzz 一份字体 —— 它只认 SFNT（TTF/OTF），对 woff2 取不到任何字形
 * （实测：upem 能读出来，但 `nominalGlyph` 全是 undefined、`glyphToPath` 为空）。
 * 同时 `hb_subset_or_fail` 对 woff2 也返回 0（子集化因此退回整体内联）。
 *
 * woff2 → TTF 是**无损解压**，所以还原出来的字节与浏览器渲染用的是同一份
 * 字形（度量、轮廓逐字节相同），不会有「预览一套、转出来另一套」。
 *
 * ## 用法
 *
 *   bun run fonts:sfnt            # 转换 public/fonts/*.woff2 → 同名 .ttf
 *   bun run fonts:sfnt --check    # 只校验 .ttf 存在且是合法 SFNT
 *
 * 产物**已提交**（字体不会变），脚本只在换字体版本时重跑。
 * `--check` 刻意**不比 mtime**：git 不保存修改时间，新克隆里 TTF 永远比 woff2 旧。
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decompress } from 'wawoff2';

const DIR = 'public/fonts';
const check = process.argv.includes('--check');

const files = readdirSync(DIR).filter((f) => f.endsWith('.woff2'));
if (!files.length) {
  console.error(`[fonts] ${DIR} 里没有 .woff2`);
  process.exit(1);
}

let missing = 0;
for (const file of files) {
  const src = join(DIR, file);
  const out = join(DIR, file.replace(/\.woff2$/, '.ttf'));
  let outStat = null;
  try {
    outStat = statSync(out);
  } catch {
    // 没有产物
  }

  if (check) {
    // 合法 SFNT 的开头：0x00010000（TrueType）或 'OTTO'（CFF）。woff2 是 'wOF2'。
    const head = outStat ? readFileSync(out).subarray(0, 4) : null;
    const sfnt =
      head !== null &&
      ((head[0] === 0x00 && head[1] === 0x01 && head[2] === 0x00 && head[3] === 0x00) ||
        head.toString('latin1') === 'OTTO');
    if (!outStat || !sfnt) {
      console.error(`[fonts] ${out} 缺失或不是 SFNT —— 跑一次 bun run fonts:sfnt`);
      missing += 1;
    }
    continue;
  }

  const ttf = await decompress(readFileSync(src));
  // decompress 返回 Uint8Array（wawoff2 的 CJS 类型标注是 Buffer，运行时两者都行）。
  writeFileSync(out, ttf);
  console.log(`[fonts] ${src} → ${out}（${ttf.byteLength} 字节）`);
}

if (missing) process.exit(1);
