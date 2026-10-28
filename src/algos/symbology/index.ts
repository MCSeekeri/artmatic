/**
 * index.ts — 机器可读符号的统一入口：`encodeCode()`。
 *
 * 上游（生成器 `algos/qr-code.ts`）只认识这个函数，不认识七种符号各自的实现。
 * 它返回的是**已经带静区的模块图**（0 / 255 字节），尺寸由内容决定 ——
 * 这一点很要紧：符号尺寸必须是内容与纠错级别的函数，而不是一个可拖的参数，
 * 否则「把版本拖到装不下」会得到一张中间大片空白的假码。
 *
 * 两种保真度（见 `qr.ts` / `structural.ts` 的文件头）由 `standard` 标出来，
 * 工具面与测试据此区分「能扫」与「只是结构」。
 */

import { encodeCode128 } from './code128';
import { DARK, ModuleMatrix } from './matrix';
import { encodeQr, type QrEcLevel } from './qr';
import {
  encodeAztec,
  encodeDataMatrix,
  encodeGridMatrix,
  encodeHanXin,
  encodeMaxiCode,
} from './structural';

export type SymbologyId =
  | 'qr'
  | 'code128'
  | 'aztec'
  | 'maxicode'
  | 'datamatrix'
  | 'gridmatrix'
  | 'hanxin';

/** 选择器里的顺序（也是 `symbology` 下拉的顺序）。 */
export const SYMBOLOGIES: readonly SymbologyId[] = [
  'qr',
  'code128',
  'aztec',
  'datamatrix',
  'maxicode',
  'gridmatrix',
  'hanxin',
];

/** 完整标准编码（真的扫得出来）的那两种。 */
const STANDARD = new Set<SymbologyId>(['qr', 'code128']);

export interface CodeOptions {
  /** QR 的纠错级别（其余符号忽略）。 */
  ec?: QrEcLevel;
  /** 静区模块数（2D 四边、1D 左右）。 */
  quiet?: number;
  /** 一维码的条高（模块）。 */
  barHeight?: number;
}

export interface CodeMatrix {
  /** 模块列数（不是像素）。 */
  w: number;
  /** 模块行数。 */
  h: number;
  /** 行优先、0 或 255。 */
  data: Uint8Array;
  /** 是否是完整标准编码（`qr` / `code128` 为真）。 */
  standard: boolean;
  /** 实际用的符号（解析过非法 id 之后的）。 */
  symbology: SymbologyId;
  /** 二维码实际用到的版本（1D 为 0）。工具面用。 */
  version: number;
}

/** 容器的默认静区：二维码标准是 4 模块，一维码建议 ≥10（见 `code128.ts`）。 */
export const DEFAULT_QUIET = 4;

export function isSymbologyId(v: unknown): v is SymbologyId {
  return typeof v === 'string' && (SYMBOLOGIES as readonly string[]).includes(v);
}

/** 内容为空时的兜底文本（空内容在 QR 里合法，但画面会是一张空码，看着像坏了）。 */
export const FALLBACK_CONTENT = 'ARTMATIC';

function layout(mat: ModuleMatrix, quiet: number): CodeMatrix {
  const q = Math.max(0, Math.round(quiet));
  const w = mat.w + q * 2;
  const h = mat.h + q * 2;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < mat.h; y++) {
    for (let x = 0; x < mat.w; x++) {
      if (mat.cells[mat.idx(x, y)] !== DARK) continue;
      data[(y + q) * w + x + q] = 255;
    }
  }
  return { w, h, data, standard: false, symbology: 'qr', version: 0 };
}

/** 一维码的容器：条高 + 左右静区（上下各留 1 模块白，避免贴着画幅边缘）。 */
function layoutBar(modules: Uint8Array, quiet: number, barHeight: number): CodeMatrix {
  const q = Math.max(0, Math.round(quiet));
  const barH = Math.max(3, Math.round(barHeight));
  const w = modules.length + q * 2;
  const h = barH + 2;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < barH; y++) {
    const row = (y + 1) * w;
    for (let x = 0; x < modules.length; x++) {
      if (modules[x]) data[row + x + q] = 255;
    }
  }
  return { w, h, data, standard: true, symbology: 'code128', version: 0 };
}

/**
 * 把文本编成某个符号的模块图。
 *
 * **非法 / 未知的符号 id 回落到 QR**（而不是抛异常）：这个值是工程 JSON 里的
 * 一个字符串，手改过、被旧版本写过、被插件拼坏过 —— 一律降级，绝不把工程
 * 卡在打不开的状态（与 `pattern-codec.ts` 同一条纪律）。
 */
export function encodeCode(
  symbology: string,
  content: string,
  opts: CodeOptions = {},
): CodeMatrix {
  const id: SymbologyId = isSymbologyId(symbology) ? symbology : 'qr';
  const text = content.length > 0 ? content : FALLBACK_CONTENT;
  const quiet = opts.quiet ?? DEFAULT_QUIET;

  if (id === 'code128') {
    const r = encodeCode128(text);
    return layoutBar(r.modules, quiet, opts.barHeight ?? 14);
  }

  let mat: ModuleMatrix;
  let version = 0;
  switch (id) {
    case 'aztec':
      mat = encodeAztec(text);
      break;
    case 'datamatrix':
      mat = encodeDataMatrix(text);
      break;
    case 'maxicode':
      mat = encodeMaxiCode(text);
      break;
    case 'gridmatrix':
      mat = encodeGridMatrix(text);
      break;
    case 'hanxin':
      mat = encodeHanXin(text);
      break;
    default: {
      const r = encodeQr(text, opts.ec ?? 'M');
      mat = r.matrix;
      version = r.version;
    }
  }

  const out = layout(mat, quiet);
  out.symbology = id;
  out.version = version;
  out.standard = STANDARD.has(id);
  return out;
}

export { encodeQr, type QrEcLevel } from './qr';
export { encodeCode128 } from './code128';
