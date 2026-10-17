import type { ParamDef } from '../types';

export const id = 'ascii';
export const nameKey = 'fx.ascii';
export const params: ParamDef[] = [
  /* ------------------------------------------------------------- 字符 */
  {
    key: 'charset',
    labelKey: 'fx.ascii.charset',
    type: 'select',
    defaultValue: 'classic',
    options: [
      { labelKey: 'fx.ascii.charsetClassic', value: 'classic' },
      { labelKey: 'fx.ascii.charsetLine', value: 'line' },
      { labelKey: 'fx.ascii.charsetBlock', value: 'block' },
      { labelKey: 'fx.ascii.charsetBinary', value: 'binary' },
      { labelKey: 'fx.ascii.charsetCustom', value: 'custom' },
    ],
  },
  {
    key: 'custom',
    labelKey: 'fx.ascii.custom',
    type: 'text',
    defaultValue: '',
    maxLength: 64,
    placeholderKey: 'fx.ascii.customHint',
    visibleWhen: (v) => v.charset === 'custom',
  },
  {
    key: 'font',
    labelKey: 'fx.ascii.font',
    type: 'select',
    defaultValue: 'pixel',
    options: [
      { labelKey: 'fx.ascii.fontPixel', value: 'pixel' },
      { labelKey: 'fx.ascii.fontMono', value: 'mono' },
      { labelKey: 'fx.ascii.fontSans', value: 'sans' },
      { labelKey: 'fx.ascii.fontSerif', value: 'serif' },
    ],
  },

  /* ------------------------------------------------------------- 网格 */
  /*
   * 分辨率用「每行字符数」而不是「字符像素大小」：后者会让预览（≈960 宽）
   * 与导出（工程分辨率）数出不同的字符数 —— 同一工程两边看起来不是一幅画。
   * 字符数在两处一致，变的是每个字形的像素密度。
   */
  { key: 'columns', labelKey: 'fx.ascii.columns', type: 'range', min: 16, max: 240, step: 1, defaultValue: 72 },
  { key: 'spacing', labelKey: 'fx.ascii.spacing', type: 'range', min: 0, max: 0.6, step: 0.01, defaultValue: 0.08 },
  { key: 'lineHeight', labelKey: 'fx.ascii.lineHeight', type: 'range', min: 0.7, max: 2.5, step: 0.01, defaultValue: 1.12 },

  /* ------------------------------------------------------------- 画面 */
  { key: 'invert', labelKey: 'fx.ascii.invert', type: 'checkbox', defaultValue: 0 },
  { key: 'edges', labelKey: 'fx.ascii.edges', type: 'checkbox', defaultValue: 0 },
  /*
   * 保留原图 = 把输入放在字符底下。此时两个背景色都不参与（否则「原图」被
   * 一块不透明底色盖住，这个开关等于没开）。
   */
  { key: 'keepOriginal', labelKey: 'fx.ascii.keepOriginal', type: 'checkbox', defaultValue: 0 },
  { key: 'charColor', labelKey: 'fx.ascii.charColor', type: 'color', defaultValue: '#e8e8e8' },
  { key: 'bgColor', labelKey: 'fx.ascii.bgColor', type: 'color', defaultValue: '#0a0a0a' },

  /* --------------------------------------------------------- 逐字背景 */
  { key: 'cellBgOn', labelKey: 'fx.ascii.cellBgOn', type: 'checkbox', defaultValue: 0 },
  {
    key: 'cellBgColor',
    labelKey: 'fx.ascii.cellBgColor',
    type: 'color',
    defaultValue: '#3a5a7a',
    visibleWhen: (v) => v.cellBgOn === 1,
  },
  /*
   * 明暗变化自动跟着格子的亮度走：默认「亮的格子背景更亮」，
   * 反相后「代表亮色的字符配更暗的背景」—— 底色与字色互相咬合。
   */
  {
    key: 'cellBgInvert',
    labelKey: 'fx.ascii.cellBgInvert',
    type: 'checkbox',
    defaultValue: 0,
    visibleWhen: (v) => v.cellBgOn === 1,
  },

  /* ------------------------------------------------------------- 抖动 */
  { key: 'jitter', labelKey: 'fx.ascii.jitter', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0 },
  {
    key: 'jitterFreq',
    labelKey: 'fx.ascii.jitterFreq',
    type: 'range',
    min: 0.5,
    max: 20,
    step: 0.1,
    defaultValue: 6,
    visibleWhen: (v) => Number(v.jitter) > 0,
  },
];
