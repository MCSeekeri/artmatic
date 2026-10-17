/**
 * glyph-atlas.ts — 字形图集（`u_atlas`）：把一串字符栅格化进一张纹理。
 *
 * 补的是「特效协议拿不到字形」这一环：ASCII 字符画要在每个格子里画一个字符，
 * 而 GLSL 里没有字体。做法与 `spectrum-texture.ts` / `box-tracker.ts` 同构 ——
 * CPU 侧准备好数据（这里用 Canvas2D 栅格化），GL 侧只负责上传与绑定；
 * 特效那一侧只认 uniform 协议（fragment 声明了 `u_atlas` 就调用它），
 * 所以主应用与 `/lab/` 自动都有。
 *
 * ## 三条不变量
 *
 * 1. **字形按实测覆盖率升序摆放**。`coverage` 是栅格化后 alpha 的均值。
 *    用户输入的字符集面积占比不齐，按原序映射亮度会让明暗断层；排序之后
 *    着色器的 `index = 亮度 × 字形数` 就是一条稳定的密度梯度 ——
 *    这是「自定义字符集会把画面搞乱」的正解，不需要人肉排序。
 * 2. **图集不含时间**。同一 (字符序列, 字体) 只建一次，之后按 LRU 复用；
 *    同一 `t` 连渲两次逐字节相同（与反馈类特效不是一回事）。
 * 3. **建纹理之前先切 scratch 单元**。`Program.tex()` 会把采样本依次绑到 0..n
 *    并留下最后一个为激活态，而 `bindTexture` / `texImage2D` 作用在**当前激活
 *    单元**上 —— 直接建纹理会把 `u_texture` 顶掉（`effects/AGENTS.md` 记过
 *    两次真实事故，其中一次就发生在这种「创建」路径上）。
 */

import type { Kit, Program } from './kit';

export interface GlyphAtlasSpec {
  /** 要栅格化的字符序列（调用方保证已去重、去空白）。 */
  text: string;
  /** `pixel` / `mono` / `sans` / `serif`。未知值按 `mono`。 */
  font: string;
}

/** 图集每格的边长（px）。着色器按 0..1 采一格，所以它是内部约定。 */
const CELL = 64;
/** 图集每行几格（着色器用 `u_glyphCols` 拿到同一个数）。 */
const COLS = 16;
/** 一张图集最多几个字形。 */
const MAX_GLYPHS = 96;
/** 最多留几张图集：用户来回拖自定义字符串时不要无限增长。 */
const MAX_ATLASES = 8;

const FONT_FAMILIES: Record<string, string> = {
  mono: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
  sans: 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
};

/**
 * 内置 5×7 像素字体（大写 + 数字 + 常用标点）。
 *
 * 为什么自己带一份：系统字体在每台机器上都不一样，而「像素字体」要的是
 * **确定的**方块感。5×7 是字符画的经典分辨率 —— 再低认不出字母，再高就不像素了。
 *
 * 小写字母按大写渲染（5×7 塞不下下伸部，`g` / `y` 会糊成一团）；
 * 表里没有的字符（中文、emoji…）退回系统字体栅格化，所以自定义字符集
 * 不会被这份表卡住。
 */
const PIXEL_GLYPHS: Record<string, string> = {
  '!': '00100/00100/00100/00100/00100/00000/00100',
  '"': '01010/01010/00000/00000/00000/00000/00000',
  '#': '01010/01010/11111/01010/11111/01010/01010',
  $: '00100/01111/10100/01110/00101/11110/00100',
  '%': '11001/11010/00010/00100/01000/01011/10011',
  '&': '01100/10010/10100/01000/10101/10010/01101',
  "'": '00100/00100/00000/00000/00000/00000/00000',
  '(': '00010/00100/01000/01000/01000/00100/00010',
  ')': '01000/00100/00010/00010/00010/00100/01000',
  '*': '00000/00100/10101/01110/10101/00100/00000',
  '+': '00000/00100/00100/11111/00100/00100/00000',
  ',': '00000/00000/00000/00000/00110/00100/01000',
  '-': '00000/00000/00000/11111/00000/00000/00000',
  '.': '00000/00000/00000/00000/00000/00110/00110',
  '/': '00001/00010/00010/00100/01000/01000/10000',
  '0': '01110/10001/10011/10101/11001/10001/01110',
  '1': '00100/01100/00100/00100/00100/00100/01110',
  '2': '01110/10001/00001/00010/00100/01000/11111',
  '3': '11111/00010/00100/00010/00001/10001/01110',
  '4': '00010/00110/01010/10010/11111/00010/00010',
  '5': '11111/10000/11110/00001/00001/10001/01110',
  '6': '00110/01000/10000/11110/10001/10001/01110',
  '7': '11111/00001/00010/00100/01000/01000/01000',
  '8': '01110/10001/10001/01110/10001/10001/01110',
  '9': '01110/10001/10001/01111/00001/00010/01100',
  ':': '00000/00110/00110/00000/00110/00110/00000',
  ';': '00000/00110/00110/00000/00110/00100/01000',
  '<': '00010/00100/01000/10000/01000/00100/00010',
  '=': '00000/00000/11111/00000/11111/00000/00000',
  '>': '01000/00100/00010/00001/00010/00100/01000',
  '?': '01110/10001/00001/00010/00100/00000/00100',
  '@': '01110/10001/10111/10101/10111/10000/01110',
  A: '01110/10001/10001/11111/10001/10001/10001',
  B: '11110/10001/10001/11110/10001/10001/11110',
  C: '01110/10001/10000/10000/10000/10001/01110',
  D: '11100/10010/10001/10001/10001/10010/11100',
  E: '11111/10000/10000/11110/10000/10000/11111',
  F: '11111/10000/10000/11110/10000/10000/10000',
  G: '01110/10001/10000/10111/10001/10001/01111',
  H: '10001/10001/10001/11111/10001/10001/10001',
  I: '01110/00100/00100/00100/00100/00100/01110',
  J: '00111/00010/00010/00010/00010/10010/01100',
  K: '10001/10010/10100/11000/10100/10010/10001',
  L: '10000/10000/10000/10000/10000/10000/11111',
  M: '10001/11011/10101/10101/10001/10001/10001',
  N: '10001/11001/10101/10011/10001/10001/10001',
  O: '01110/10001/10001/10001/10001/10001/01110',
  P: '11110/10001/10001/11110/10000/10000/10000',
  Q: '01110/10001/10001/10001/10101/10010/01101',
  R: '11110/10001/10001/11110/10100/10010/10001',
  S: '01111/10000/10000/01110/00001/00001/11110',
  T: '11111/00100/00100/00100/00100/00100/00100',
  U: '10001/10001/10001/10001/10001/10001/01110',
  V: '10001/10001/10001/10001/10001/01010/00100',
  W: '10001/10001/10001/10101/10101/11011/10001',
  X: '10001/10001/01010/00100/01010/10001/10001',
  Y: '10001/10001/01010/00100/00100/00100/00100',
  Z: '11111/00001/00010/00100/01000/10000/11111',
  '[': '01110/01000/01000/01000/01000/01000/01110',
  '\\': '10000/01000/01000/00100/00010/00010/00001',
  ']': '01110/00010/00010/00010/00010/00010/01110',
  '^': '00100/01010/10001/00000/00000/00000/00000',
  _: '00000/00000/00000/00000/00000/00000/11111',
  '`': '01000/00100/00000/00000/00000/00000/00000',
  '{': '00010/00100/00100/01000/00100/00100/00010',
  '|': '00100/00100/00100/00100/00100/00100/00100',
  '}': '01000/00100/00100/00010/00100/00100/01000',
  '~': '00000/00000/01000/10101/00010/00000/00000',
};

/** 半调方块（U+2591..U+2593）→ 填充比例档位。 */
const BLOCK_SHADES: Record<string, number> = { '░': 0, '▒': 1, '▓': 2 };
/** 分数方块（U+258F..U+2589）：下标 + 1 = 几分之几宽。 */
const FRACTIONAL_BLOCKS = '▏▎▍▌▋▊▉';

interface Raster {
  image: ImageData;
  /** alpha 均值（0..1）= 这个字形占了多少面积。 */
  coverage: number;
}

interface Entry {
  tex: WebGLTexture;
  count: number;
  cols: number;
  used: number;
}

export class GlyphAtlases {
  private readonly cache = new Map<string, Entry>();
  private readonly scratchUnit: number;
  /** 没有图集时绑它：1×1 全白 = 每个格子画满方块，坏掉时一眼看得出来。 */
  private readonly blank: WebGLTexture;
  private clock = 0;
  private rasterCtx: CanvasRenderingContext2D | null = null;

  constructor(private readonly kit: Kit) {
    const gl = kit.gl;
    const max = gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number;
    this.scratchUnit = Math.max(1, (max || 16) - 1);
    gl.activeTexture(gl.TEXTURE0 + this.scratchUnit);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.blank = tex;
  }

  /**
   * program 声明了 `u_atlas` 就绑图集并派发 `u_glyphCount` / `u_glyphCols`；
   * 没声明就什么都不做（其余七十多个特效走这条早退路径，零开销）。
   *
   * `spec === null` 时绑全白占位图：sampler 停在未绑定状态是 GL 的未定义行为，
   * 而「整格画满字符色」这种坏掉的样子比随机垃圾更容易认出来。
   */
  bindTo(prog: Program, spec: GlyphAtlasSpec | null): void {
    if (!prog.uniforms['u_atlas']) return;
    const entry = spec ? this.ensure(spec) : null;
    if (!entry) {
      prog.tex('u_atlas', this.blank).u('u_glyphCount', 1).u('u_glyphCols', 1);
      return;
    }
    prog.tex('u_atlas', entry.tex).u('u_glyphCount', entry.count).u('u_glyphCols', entry.cols);
  }

  /**
   * 释放全部图集。**正常路径不需要调用** —— 缓存已按张数封顶（`MAX_ATLASES`），
   * 条目只按 (字符序列, 字体) 增长，与工程生命周期无关。留给诊断 / 上下文重建。
   */
  clear(): void {
    const gl = this.kit.gl;
    for (const e of this.cache.values()) gl.deleteTexture(e.tex);
    this.cache.clear();
  }

  private ensure(spec: GlyphAtlasSpec): Entry | null {
    const chars = Array.from(spec.text).slice(0, MAX_GLYPHS);
    if (chars.length === 0) return null;
    const key = `${spec.font}\u0000${chars.join('')}`;
    const hit = this.cache.get(key);
    if (hit) {
      hit.used = ++this.clock;
      return hit;
    }
    const entry = this.build(chars, spec.font);
    if (!entry) return null;
    entry.used = ++this.clock;
    this.cache.set(key, entry);
    this.evict();
    return entry;
  }

  private evict(): void {
    if (this.cache.size <= MAX_ATLASES) return;
    const oldest = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [key, e] of oldest) {
      if (this.cache.size <= MAX_ATLASES) break;
      this.kit.gl.deleteTexture(e.tex);
      this.cache.delete(key);
    }
  }

  private ctx2d(): CanvasRenderingContext2D | null {
    if (this.rasterCtx) return this.rasterCtx;
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = CELL;
    canvas.height = CELL;
    const g = canvas.getContext('2d');
    if (!g) return null;
    this.rasterCtx = g;
    return g;
  }

  private build(chars: string[], font: string): Entry | null {
    const g = this.ctx2d();
    if (!g) return null;

    const rasters: Raster[] = [];
    for (const ch of chars) {
      drawGlyph(g, ch, font);
      const image = g.getImageData(0, 0, CELL, CELL);
      const data = image.data;
      let sum = 0;
      for (let i = 3; i < data.length; i += 4) sum += data[i]!;
      rasters.push({ image, coverage: sum / (CELL * CELL * 255) });
    }
    // 按覆盖率升序：暗处用稀字符、亮处用密字符（见文件头第 1 条）。
    rasters.sort((a, b) => a.coverage - b.coverage);

    const count = rasters.length;
    const rows = Math.ceil(count / COLS);
    const atlas = document.createElement('canvas');
    atlas.width = COLS * CELL;
    atlas.height = rows * CELL;
    const ag = atlas.getContext('2d');
    if (!ag) return null;
    for (let i = 0; i < count; i += 1) {
      ag.putImageData(rasters[i]!.image, (i % COLS) * CELL, Math.floor(i / COLS) * CELL);
    }
    return { tex: this.upload(atlas, font === 'pixel'), count, cols: COLS, used: 0 };
  }

  private upload(canvas: HTMLCanvasElement, nearest: boolean): WebGLTexture {
    const gl = this.kit.gl;
    gl.activeTexture(gl.TEXTURE0 + this.scratchUnit);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    /*
     * **不翻 Y**（与 `SourceManager.uploadImage` 相反，那一条针对整幅画面）。
     * 图集不是按 vUv 直接采样的：行号由着色器算，不翻时 `v = 0` 正好是画布
     * 第一行 = 图集的第 0 行，`floor(idx / cols)` 的映射最直白。
     * 字形内部的上下翻转由着色器补（`gp.y = 1.0 - gp.y`）。
     */
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    // 像素字体必须 NEAREST：它是硬边方块，线性过滤会把 1px 的笔画糊成灰边。
    const filter = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
}

/* ------------------------------------------------------------ 栅格化 */

function drawGlyph(g: CanvasRenderingContext2D, ch: string, font: string): void {
  g.clearRect(0, 0, CELL, CELL);
  g.fillStyle = '#fff';
  if (font === 'pixel' && drawPixelGlyph(g, ch)) return;
  // 方块字符与字体无关：它们是几何形状，几何绘制才能保证面积占比精确。
  if (drawBlockGlyph(g, ch)) return;
  const family = FONT_FAMILIES[font] ?? FONT_FAMILIES.mono!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${Math.round(CELL * 0.82)}px ${family}`;
  g.fillText(ch, CELL / 2, CELL / 2 + CELL * 0.04);
}

function drawPixelGlyph(g: CanvasRenderingContext2D, ch: string): boolean {
  const rows = PIXEL_GLYPHS[ch] ?? PIXEL_GLYPHS[ch.toUpperCase()];
  if (!rows) return false;
  const px = Math.floor(CELL / 8); // 5 列 + 3 列留白 → 8 份
  const ox = Math.floor((CELL - px * 5) / 2);
  const oy = Math.floor((CELL - px * 7) / 2);
  const lines = rows.split('/');
  for (let y = 0; y < lines.length; y += 1) {
    const line = lines[y]!;
    for (let x = 0; x < line.length; x += 1) {
      if (line[x] === '1') g.fillRect(ox + x * px, oy + y * px, px, px);
    }
  }
  return true;
}

/**
 * 方块元素。三种填充：全块、左起 1/8..7/8、以及 25/50/75% 的网纹。
 *
 * 网纹用 8×8 个 8px 方块铺满整格 —— 覆盖率正好是 25/50/75%，
 * 栅格化后的实测值也就落在对应档位上（排序时不会和分数块打架）。
 */
function drawBlockGlyph(g: CanvasRenderingContext2D, ch: string): boolean {
  if (ch === '█') {
    g.fillRect(0, 0, CELL, CELL);
    return true;
  }
  const frac = FRACTIONAL_BLOCKS.indexOf(ch);
  if (frac >= 0) {
    g.fillRect(0, 0, Math.round((CELL * (frac + 1)) / 8), CELL);
    return true;
  }
  const shade = BLOCK_SHADES[ch];
  if (shade === undefined) return false;
  const s = CELL / 8;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const on =
        shade === 0
          ? x % 2 === 0 && y % 2 === 0
          : shade === 1
            ? (x + y) % 2 === 0
            : !(x % 2 === 0 && y % 2 === 0);
      if (on) g.fillRect(x * s, y * s, s, s);
    }
  }
  return true;
}
