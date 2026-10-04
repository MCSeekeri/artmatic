/**
 * glyph-atlas.ts — 运行时生成的字形图集（给 ASCII 类生成器当纹理输入）。
 *
 * ## 为什么在运行时画，而不是打包一份字体/图集
 *
 * 打包图集就要引一份字体资产（PSF/BDF/TTF），随之而来的是**授权问题** ——
 * 而 ASCII 艺术需要的字符集极小（可打印 ASCII 共 95 个），用 Canvas2D +
 * 系统等宽字体现场画一遍是完全够用的，且零资产、零依赖、零授权风险。
 *
 * ## 布局
 *
 * 16 列 × 6 行 = 96 格，覆盖码点 32..126（95 个）+ 1 个空位。每格
 * `cell × cell` 像素，字符在格内**居中**绘制（居中是为了让生成器可以
 * 直接按格取 UV、不需要各自算基线偏移）。
 *
 * 图集用 NEAREST + CLAMP —— 它是一张**查找表**，不是照片，线性过滤会让
 * 相邻字形互相渗色（表现为笔画上出现邻格的黑边）。
 */

import { ASCII_FIRST, ASCII_LAST, type GlyphLayout } from './glyph-layout';

export type { GlyphLayout };

export interface GlyphAtlas {
  tex: WebGLTexture;
  w: number;
  h: number;
  cols: number;
  rows: number;
  cell: number;
  /** 首个码点（32 = 空格）。生成器的 `index = code - first` 用它。 */
  first: number;
}

/** 画图集用的字体栈：优先系统等宽，最后回落到通用 monospace。 */
const FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace';

export function buildGlyphAtlas(gl: WebGL2RenderingContext, layout: GlyphLayout): GlyphAtlas {
  const { cols, rows, cell } = layout;
  const w = cols * cell;
  const h = rows * cell;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 字号取 0.72 格：留出上下边距，避免字形在格边界被切掉。
  ctx.font = `${Math.round(cell * 0.72)}px ${FONT_STACK}`;

  for (let code = ASCII_FIRST; code <= ASCII_LAST; code++) {
    const i = code - ASCII_FIRST;
    if (i >= cols * rows) break;
    const cx = (i % cols) * cell + cell / 2;
    const cy = Math.floor(i / cols) * cell + cell / 2;
    ctx.fillText(String.fromCharCode(code), cx, cy);
  }

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return { tex, w, h, cols, rows, cell, first: ASCII_FIRST };
}
