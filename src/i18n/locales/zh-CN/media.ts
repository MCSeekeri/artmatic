/**
 * media.ts — 内置「素材库」的命名：特效、算法生成器、混合模式、形状、动画预设。
 *
 * 这些名字全部来自**数据表**（`effects/defs/*`、`algos/*`、
 * `typography/{document,shapes,animation}.ts`）。那些文件是注册表，
 * 保持成纯数据、不 import i18n —— 它们存的是 **key**，由 UI 侧 `tr()` 解析。
 *
 * 这么切的原因：数据表在模块加载时求值一次，如果直接写 `tr(...)`，
 * 值会被**冻结在导入那一刻的语言**上，切语言时永远不更新。
 * 存 key 则没有这个时间点问题，而且与「新增一个特效 = 两个文件」的
 * 纪律同构：新增一个特效 = 一个 def 文件 + 这里一批 key。
 */

export const media = {
  /* ------------------------------------------------ 特效（effects/defs/*） */
  'fx.echo': '回声拖尾',
  'fx.echo.decay': '衰减',
  'fx.echo.floor': '基底扣除',
  'fx.echo.weight': '拖尾权重',
  'fx.echo.zoom': '每帧缩放',
  'fx.echo.spin': '每帧旋转',

  'fx.channelSplit': '通道错位',
  'fx.channelSplit.amount': '错位量(px)',
  'fx.channelSplit.angle': '角度',

  'fx.slices': '切片错位',
  'fx.slices.count': '切片数',
  'fx.slices.amount': '幅度',
  'fx.slices.coverage': '覆盖率',

  'fx.pixelate': '像素化',
  'fx.pixelate.size': '像素块(px)',

  'fx.scanlines': '扫描线',
  'fx.scanlines.strength': '强度',
  'fx.scanlines.gap': '间距(px)',

  /* ------------------------------------------------ 算法生成器（algos/*） */
  'algo.rule110': '基本元胞自动机',
  'algo.rule110.rule': '规则',
  'algo.rule110.rule30': 'Rule 30（混沌）',
  'algo.rule110.rule90': 'Rule 90（分形）',
  'algo.rule110.rule110': 'Rule 110（图灵完备）',
  'algo.rule110.width': '宽度',
  'algo.rule110.height': '高度',
  'algo.rule110.seedMode': '种子',
  'algo.rule110.seedSingle': '单点',
  'algo.rule110.seedRandom': '随机 50%',
  'algo.rule110.speed': '生长速度(行/秒)',
  'algo.rule110.colorBg': '背景色',
  'algo.rule110.colorLive': '活细胞色',

  'algo.gameOfLife': '生命游戏',
  'algo.gameOfLife.grid': '网格',
  'algo.gameOfLife.density': '种子密度',
  'algo.gameOfLife.speed': '步/秒',
  'algo.gameOfLife.colorBg': '背景色',
  'algo.gameOfLife.colorLive': '活细胞色',

  'algo.mandelbrot': 'Mandelbrot',
  'algo.mandelbrot.centerX': '中心 X',
  'algo.mandelbrot.centerY': '中心 Y',
  'algo.mandelbrot.zoom': '放大(log)',
  'algo.mandelbrot.iterations': '迭代数',
  'algo.mandelbrot.colorSlow': '慢逃逸色',
  'algo.mandelbrot.colorFast': '快逃逸色',
  'algo.mandelbrot.colorInner': '内部色',
  'algo.mandelbrot.quality': '内部分辨率',
  'algo.mandelbrot.quality240': '240p（最快）',
  'algo.mandelbrot.quality480': '480p',
  'algo.mandelbrot.quality720': '720p',

  /* ------------------------------------------------ 混合模式（core/schema + typography/document） */
  'blend.normal': '正常',
  'blend.multiply': '正片叠底',
  'blend.add': '线性加深(加)',
  'blend.screen': '滤色',
  'blend.overlay': '叠加',
  'blend.difference': '差值',
  'blend.exclusion': '排除',
  'blend.subtract': '减去',

  /* 排版图层专用的扩展混合模式 */
  'blend.darken': '变暗',
  'blend.lighten': '变亮',
  'blend.colorDodge': '颜色减淡',
  'blend.colorBurn': '颜色加深',
  'blend.hardLight': '强光',
  'blend.softLight': '柔光',
  'blend.hue': '色相',
  'blend.saturation': '饱和度',
  'blend.color': '颜色',
  'blend.luminosity': '明度',

  /* ------------------------------------------------ 排版形状（typography/shapes） */
  'shape.rect': '矩形',
  'shape.roundRect': '圆角矩形',
  'shape.ellipse': '椭圆',
  'shape.triangle': '三角形',
  'shape.star': '五角星',
  'shape.hexagon': '六边形',
  'shape.line': '直线',

  /* ------------------------------------------------ 排版动画预设（typography/animation） */
  'anim.fadeIn': '淡入',
  'anim.fadeOut': '淡出',
  'anim.fadeInOut': '淡入淡出',
  'anim.slideInLeft': '左侧滑入',
  'anim.slideInRight': '右侧滑入',
  // id 描述运动方向、文案描述来向，所以这里是「反」的。原样保留，别改。
  'anim.slideInUp': '下方滑入',
  'anim.slideInDown': '上方滑入',
  'anim.zoomIn': '放大进入',
  'anim.zoomOut': '缩小进入',
  'anim.pop': '弹一下',
  'anim.spin': '旋转',
  'anim.pulse': '脉冲',
  'anim.shake': '抖动',
  'anim.blurIn': '模糊进入',
} as const;
