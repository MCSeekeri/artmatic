import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 三套缩略图目录（特效 / 转场 / 生成器）共用的资源读取。
 *
 * 这三份检查是同一件事的三个对象：**预先烘好的静态资源与注册表对齐**。
 * 以前每个文件各自抄一遍 `isWebp` 与目录列举，改一次 MIME 判据要改三处。
 *
 * 各文件**只留自己业务上的那几条**（`previewT`、base 选择、id 来源、体积预算），
 * 那些是不能合并的。
 */

/** WebP：`RIFF` + 4 字节长度 + `WEBP`。 */
export function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const ascii = (at: number, n: number): string => String.fromCharCode(...bytes.subarray(at, at + n));
  return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
}

export interface ThumbDir {
  /** 目录下全部 `.webp` 的文件名（含扩展名），已排序。 */
  files: string[];
  /** 去掉 `.webp` 后缀的 id，已排序。 */
  ids: string[];
  /** 读某个 id 的字节。 */
  bytesOf: (id: string) => Uint8Array;
}

export function readThumbDir(dir: string): ThumbDir {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.webp'))
    .sort();
  return {
    files,
    ids: files.map((f) => f.replace(/\.webp$/, '')),
    bytesOf: (id: string) => new Uint8Array(readFileSync(join(dir, `${id}.webp`))),
  };
}
