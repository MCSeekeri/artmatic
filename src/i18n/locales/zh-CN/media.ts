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

  /* --- 以下 9 个移植自 openmosh gl/effect-shaders.ts（MIT，见 CREDITS.md） --- */

  /* 时钟三件套（effects/shader-def.ts 的 clockParams，多个特效共用一套文案） */
  'fx.clock.sync': '同步',
  'fx.clock.syncFree': '自由',
  'fx.clock.syncBeat': '按拍',
  'fx.clock.division': '分频',
  'fx.clock.div025': '4 拍一轮',
  'fx.clock.div05': '2 拍一轮',
  'fx.clock.div1': '每拍一轮',
  'fx.clock.div2': '每拍 2 轮',
  'fx.clock.div3': '每拍 3 轮',
  'fx.clock.div4': '每拍 4 轮',
  'fx.clock.div8': '每拍 8 轮',

  'fx.posterize': '色阶量化',
  'fx.posterize.levels': '色阶数',

  'fx.solarize': '萨巴蒂尔效应',
  'fx.solarize.pivot': '反折点',
  'fx.solarize.curve': '曲线',
  'fx.solarize.colorize': '着色量',

  'fx.bleach': '去饱和度',
  'fx.bleach.amount': '强度',

  'fx.colorCorrection': '色彩校正',
  'fx.colorCorrection.brightness': '亮度',
  'fx.colorCorrection.contrast': '对比度',
  'fx.colorCorrection.hue': '色相',
  'fx.colorCorrection.saturation': '饱和度',

  'fx.duotone': '双色调',
  'fx.duotone.shadowColor': '暗部色',
  'fx.duotone.highlightColor': '亮部色',
  'fx.duotone.intensity': '强度',

  'fx.thermal': '热成像',
  'fx.thermal.intensity': '强度',
  'fx.thermal.palette': '色带',
  'fx.thermal.paletteThermal': '热成像',
  'fx.thermal.paletteInfrared': '红外',
  'fx.thermal.paletteNight': '夜视',

  'fx.colorHalves': '二分色',
  'fx.colorHalves.position': '分界位置',
  'fx.colorHalves.angle': '角度',
  'fx.colorHalves.mode': '处理方式',
  'fx.colorHalves.modeInvert': '反相',
  'fx.colorHalves.modeHue': '色相偏移',
  'fx.colorHalves.modeDesat': '去饱和',
  'fx.colorHalves.modeContrast': '高对比',
  'fx.colorHalves.amount': '强度',

  'fx.hsvSwap': '通道换色',
  'fx.hsvSwap.mode': '解读方式',
  'fx.hsvSwap.modeRgbAsHsv': '按 HSV 解读',
  'fx.hsvSwap.modeHsvAsRgb': '拆出 HSV 分量',
  'fx.hsvSwap.amount': '强度',

  'fx.trioTone': '三段色阶',
  'fx.trioTone.darkColor': '暗部色',
  'fx.trioTone.midColor': '中段色',
  'fx.trioTone.brightColor': '亮部色',
  'fx.trioTone.intensity': '强度',

  /* --- Phase 1a·② 几何与采样 --- */

  'fx.edges': '边缘检测',
  'fx.edges.strength': '强度',
  'fx.edges.mix': '混合',

  'fx.neonEdges': '霓虹边缘',
  'fx.neonEdges.strength': '强度',
  'fx.neonEdges.glow': '辉光',
  'fx.neonEdges.bg': '背景亮度',

  'fx.sharpen': '锐化',
  'fx.sharpen.amount': '强度',
  'fx.sharpen.radius': '半径',
  'fx.sharpen.threshold': '阈值',

  'fx.mirror': '镜像',
  'fx.mirror.amount': '强度',
  'fx.mirror.side': '镜像边',
  'fx.mirror.position': '分界位置',

  'fx.kaleido': '万花筒',
  'fx.kaleido.amount': '强度',
  'fx.kaleido.sides': '扇区数',
  'fx.kaleido.angle': '角度',

  'fx.polar': '极坐标',
  'fx.polar.amount': '强度',
  'fx.polar.angle': '角度',

  'fx.zoom': '缩放',
  'fx.zoom.amount': '缩放量',

  'fx.circleWarp': '圆筒变形',
  'fx.circleWarp.radius': '半径',
  'fx.circleWarp.width': '横向压缩',
  'fx.circleWarp.rotation': '旋转',

  'fx.radialBlur': '径向模糊',
  'fx.radialBlur.strength': '强度',

  /* --- Phase 1a·③ 风格化与形态 --- */

  'fx.emboss': '浮雕',
  'fx.emboss.strength': '强度',
  'fx.emboss.angle': '角度',
  'fx.emboss.mix': '混合',

  'fx.stereoscopic': '红青立体',
  'fx.stereoscopic.depth': '视差量',
  'fx.stereoscopic.angle': '角度',
  'fx.stereoscopic.mode': '模式',
  'fx.stereoscopic.modeAnaglyph': '红青',
  'fx.stereoscopic.modeSplit': '分色',
  'fx.stereoscopic.depthSource': '深度来源',
  'fx.stereoscopic.sourceLuma': '亮度',
  'fx.stereoscopic.sourceEdges': '边缘',
  'fx.stereoscopic.sourceFlat': '平面',
  'fx.stereoscopic.focus': '对焦',

  'fx.pixelSort': '像素排序',
  'fx.pixelSort.threshold': '阈值',
  'fx.pixelSort.ceiling': '上限',
  'fx.pixelSort.range': '偏移范围',
  'fx.pixelSort.direction': '方向',
  'fx.pixelSort.dirHorizontal': '水平',
  'fx.pixelSort.dirVertical': '垂直',
  'fx.pixelSort.reverse': '反向',

  'fx.sobelNeon': '霓虹描边',
  'fx.sobelNeon.width': '描边宽度',
  'fx.sobelNeon.neon': '霓虹',
  'fx.sobelNeon.brightness': '亮度',
  'fx.sobelNeon.bgFade': '背景混合',
  'fx.sobelNeon.bgColor': '背景色',

  'fx.vignette': '暗角',
  'fx.vignette.size': '范围',
  'fx.vignette.amount': '强度',
  'fx.vignette.transparent': '透明',

  'fx.bulge': '凸起畸变',
  'fx.bulge.amount': '凸起量',
  'fx.bulge.radius': '半径',

  'fx.halftone': '半调网屏',
  'fx.halftone.scale': '网屏间距',
  'fx.halftone.angle': '角度',
  'fx.halftone.contrast': '对比度',
  'fx.halftone.mode': '模式',
  'fx.halftone.modeDots': '网点',
  'fx.halftone.modeLines': '刻线',
  'fx.halftone.invert': '反相',

  /* --- Phase 1b·① 位移与抖动 --- */

  'fx.jitter': '逐行抖动',
  'fx.jitter.amount': '幅度',
  'fx.jitter.speed': '速度',

  'fx.wobble': '游移',
  'fx.wobble.amount': '幅度',
  'fx.wobble.frequency': '频率',
  'fx.wobble.speed': '速度',

  'fx.shake': '整帧抖动',
  'fx.shake.amount': '幅度',
  'fx.shake.speed': '抖动频率',

  'fx.screenJump': '画面滚卷',
  'fx.screenJump.direction': '方向',
  'fx.screenJump.dirVertical': '垂直',
  'fx.screenJump.dirHorizontal': '水平',
  'fx.screenJump.intensity': '强度',
  'fx.screenJump.speed': '滚动速度',

  'fx.tile': '平铺',
  'fx.tile.size': '平铺数',
  'fx.tile.offset': '偏移',
  'fx.tile.angle': '角度',
  'fx.tile.speed': '滚动速度',

  'fx.swirl': '漩涡',
  'fx.swirl.angle': '扭转角',
  'fx.swirl.radius': '作用半径',
  'fx.swirl.speed': '呼吸速度',

  'fx.ripple': '涟漪',
  'fx.ripple.amount': '幅度',
  'fx.ripple.frequency': '频率',
  'fx.ripple.speed': '速度',

  'fx.pixelShifter': '行列偏移',
  'fx.pixelShifter.hFrequency': '横向频率',
  'fx.pixelShifter.hPhase': '横向相位',
  'fx.pixelShifter.hRandom': '横向随机',
  'fx.pixelShifter.vFrequency': '纵向频率',
  'fx.pixelShifter.vPhase': '纵向相位',
  'fx.pixelShifter.vRandom': '纵向随机',
  'fx.pixelShifter.sinusoidal': '正弦',
  'fx.pixelShifter.mirror': '镜像',

  'fx.transform3d': '3D 变换',
  'fx.transform3d.rotX': '绕 X',
  'fx.transform3d.rotY': '绕 Y',
  'fx.transform3d.rotZ': '绕 Z',
  'fx.transform3d.perspective': '透视',
  'fx.transform3d.zoom': '缩放',
  'fx.transform3d.spin': '自转速度',
  'fx.transform3d.axis': '自转轴',
  'fx.transform3d.axisX': 'X 轴',
  'fx.transform3d.axisY': 'Y 轴',
  'fx.transform3d.axisZ': 'Z 轴',
  'fx.transform3d.axisTumble': '翻滚',
  'fx.transform3d.edge': '边缘',
  'fx.transform3d.edgeNone': '透明',
  'fx.transform3d.edgeClamp': '钳制',
  'fx.transform3d.edgeTile': '平铺',
  'fx.transform3d.edgeMirror': '镜像',

  /* --- Phase 1b·② 频闪与时序故障 --- */

  'fx.strobe': '频闪',
  'fx.strobe.rate': '闪烁速率',
  'fx.strobe.duty': '占空比',
  'fx.strobe.amount': '强度',
  'fx.strobe.mode': '模式',
  'fx.strobe.modeBlack': '黑场',
  'fx.strobe.modeWhite': '白场',
  'fx.strobe.modeInvert': '反相',
  'fx.strobe.modeMono': '单色',

  'fx.rgbStrobe': '分通道频闪',
  'fx.rgbStrobe.rate': '闪烁速率',
  'fx.rgbStrobe.stagger': '相位错位',
  'fx.rgbStrobe.duty': '占空比',
  'fx.rgbStrobe.red': '红',
  'fx.rgbStrobe.green': '绿',
  'fx.rgbStrobe.blue': '蓝',

  'fx.rgbBurst': 'RGB 爆发',
  'fx.rgbBurst.amplitude': '幅度',
  'fx.rgbBurst.speed': '速度',

  'fx.resizeGlitch': '缩放故障',
  'fx.resizeGlitch.chance': '触发概率',
  'fx.resizeGlitch.rate': '触发频率',
  'fx.resizeGlitch.levelX': '横向缩放',
  'fx.resizeGlitch.levelY': '纵向缩放',
  'fx.resizeGlitch.randomWidth': '横向随机',
  'fx.resizeGlitch.randomHeight': '纵向随机',
  'fx.resizeGlitch.randomCenter': '随机中心',
  'fx.resizeGlitch.centerX': '中心 X',
  'fx.resizeGlitch.centerY': '中心 Y',

  'fx.stylizeGlitch': '风格化故障',
  'fx.stylizeGlitch.level': '故障块大小',
  'fx.stylizeGlitch.rate': '故障频率',
  'fx.stylizeGlitch.count': '块数',
  'fx.stylizeGlitch.mode': '方式',
  'fx.stylizeGlitch.modeRandom': '随机',
  'fx.stylizeGlitch.modeInvert': '反相',
  'fx.stylizeGlitch.modeDither': '抖动',
  'fx.stylizeGlitch.modeHue': '色相偏移',

  'fx.shockwave': '冲击波',
  'fx.shockwave.rate': '扩散速率',
  'fx.shockwave.magnitude': '环宽',
  'fx.shockwave.distortion': '畸变量',
  'fx.shockwave.centerX': '中心 X',
  'fx.shockwave.centerY': '中心 Y',

  'fx.ringWarp': '同心环',
  'fx.ringWarp.rings': '环数',
  'fx.ringWarp.offset': '相位',
  'fx.ringWarp.speed': '流动速度',
  'fx.ringWarp.mode': '模式',
  'fx.ringWarp.modeSingle': '单环',
  'fx.ringWarp.modeDouble': '双环',
  'fx.ringWarp.xSmear': '横向保留',
  'fx.ringWarp.ySmear': '纵向保留',
  'fx.ringWarp.centerX': '中心 X',
  'fx.ringWarp.centerY': '中心 Y',

  'fx.channelSplitPrism': '通道错位·扩展',
  'fx.channelSplitPrism.mode': '模式',
  'fx.channelSplitPrism.modeRadial': '径向',
  'fx.channelSplitPrism.modePrismatic': '棱镜',
  'fx.channelSplitPrism.amount': '错位量',
  'fx.channelSplitPrism.angle': '角度',
  'fx.channelSplitPrism.falloff': '边缘增强',
  'fx.channelSplitPrism.speed': '漂移速度',
  'fx.channelSplitPrism.hueShift': '色相偏移',

  /* --- Phase 1b·③ 信号与噪声 --- */

  'fx.grain': '颗粒',
  'fx.grain.amount': '强度',
  'fx.grain.rgb': '彩色',
  'fx.grain.blendMode': '混合方式',
  'fx.grain.modeAdditive': '叠加',
  'fx.grain.modeSoftlight': '柔光',
  'fx.grain.modeMultiply': '正片叠底',

  'fx.softGlitch': '软故障',
  'fx.softGlitch.amount': '强度',
  'fx.softGlitch.speed': '速度',

  'fx.dataBend': '数据弯折',
  'fx.dataBend.intensity': '强度',
  'fx.dataBend.corruption': '损坏程度',
  'fx.dataBend.channelShift': '通道错位',
  'fx.dataBend.speed': '变化速度',

  'fx.vhs': 'VHS 磁带',
  'fx.vhs.static': '噪点',
  'fx.vhs.speed': '速度',
  'fx.vhs.tracking': '跟踪条',

  'fx.composite': '复合视频',
  'fx.composite.bleed': '色度带宽',
  'fx.composite.crawl': '点蠕动',
  'fx.composite.crush': '黑场压制',
  'fx.composite.mix': '混合',

  'fx.opticalFlow': '流场',
  'fx.opticalFlow.amount': '强度',
  'fx.opticalFlow.speed': '速度',

  'fx.smear': '涂抹',
  'fx.smear.amount': '幅度',
  'fx.smear.angle': '角度',
  'fx.smear.trail': '拖尾',

  'fx.relief': '视差浮雕',
  'fx.relief.amount': '高度',
  'fx.relief.angle': '光照角度',

  'fx.fiberDisplace': '纤维位移',
  'fx.fiberDisplace.strength': '强度',
  'fx.fiberDisplace.density': '密度',
  'fx.fiberDisplace.comb': '梳理',
  'fx.fiberDisplace.angle': '角度',
  'fx.fiberDisplace.chrome': '虹彩',
  'fx.fiberDisplace.smoothness': '平滑',

  /* --- Phase 1c 反馈类（都要 u_feedback） --- */

  'fx.melt': '熔融',
  'fx.melt.amount': '强度',
  'fx.melt.speed': '速度',

  'fx.tunnel': '隧道',
  'fx.tunnel.zoom': '缩放',
  'fx.tunnel.spin': '旋转',
  'fx.tunnel.decay': '衰减',

  'fx.feedbackLoop': '反馈循环',
  'fx.feedbackLoop.decay': '衰减',
  'fx.feedbackLoop.scale': '缩放',
  'fx.feedbackLoop.rotate': '旋转',
  'fx.feedbackLoop.warp': '扰动',
  'fx.feedbackLoop.hue': '色相偏移',
  'fx.feedbackLoop.blend': '混合方式',
  'fx.feedbackLoop.blendMax': '最大值',
  'fx.feedbackLoop.blendScreen': '滤色',
  'fx.feedbackLoop.blendAdd': '相加',

  'fx.liquidLight': '液体光',
  'fx.liquidLight.scale': '胞元大小',
  'fx.liquidLight.flow': '流动',
  'fx.liquidLight.refraction': '折射',
  'fx.liquidLight.dispersion': '色散',

  'fx.flowContours': '流线等高',
  'fx.flowContours.bands': '层数',
  'fx.flowContours.flow': '流动',
  'fx.flowContours.cycle': '色相周期',
  'fx.flowContours.sheen': '光泽',

  /* --- Phase 1d 多 pass（prePasses + u_original） --- */

  'fx.glow': '辉光',
  'fx.glow.amount': '强度',
  'fx.glow.cutoff': '阈值',
  'fx.glow.radius': '半径',

  'fx.blur': '高斯模糊',
  'fx.blur.radius': '半径',

  'fx.ghosting': '镜头鬼影',
  'fx.ghosting.bias': '偏置',
  'fx.ghosting.scale': '缩放',
  'fx.ghosting.ghosts': '鬼影数',
  'fx.ghosting.dispersal': '扩散',
  'fx.ghosting.dirX': '方向 X',
  'fx.ghosting.dirY': '方向 Y',
  'fx.ghosting.lensColor': '镜片颜色',
  'fx.ghosting.additive': '叠加',

  'fx.fastMosh': '融帧故障',
  'fx.fastMosh.hold': '冻结关键帧',
  'fx.fastMosh.rate': '混合比例',
  'fx.fastMosh.block': '块大小',
  'fx.fastMosh.sharpen': '锐化',
  'fx.fastMosh.blur': '模糊',
  'fx.fastMosh.posterize': '色阶量化',
  'fx.fastMosh.mode': '模式',
  'fx.fastMosh.modeRelative': '相对',
  'fx.fastMosh.modeAbsolute': '绝对',
  'fx.fastMosh.modeDifference': '差分',

  'fx.motionMask': '运动遮罩',
  'fx.motionMask.threshold': '阈值',
  'fx.motionMask.persistence': '背景保持',
  'fx.motionMask.erode': '腐蚀',
  'fx.motionMask.blur': '模糊',
  'fx.motionMask.still': '静止区亮度',
  'fx.motionMask.showMask': '显示遮罩',
  'fx.motionMask.hardCutoff': '硬切',

  /* --- Phase 1e --- */

  'fx.petri': '培养皿',
  'fx.petri.reaction': '反应强度',
  'fx.petri.drift': '漂移',
  'fx.petri.scale': '胞元大小',
  'fx.petri.takeover': '画面侵蚀',

  /* --- Phase 1f 音频 --- */

  'fx.audioBars': '频谱条',
  'fx.audioBars.bars': '条数',
  'fx.audioBars.height': '高度',
  'fx.audioBars.gain': '增益',
  'fx.audioBars.smoothing': '平滑',
  'fx.audioBars.punch': '打击感',
  'fx.audioBars.opacity': '不透明度',
  'fx.audioBars.anchor': '锚点',
  'fx.audioBars.anchorBottom': '底部',
  'fx.audioBars.anchorTop': '顶部',
  'fx.audioBars.anchorCenter': '居中',
  'fx.audioBars.style': '样式',
  'fx.audioBars.styleSolid': '实心',
  'fx.audioBars.styleSegmented': '分段',
  'fx.audioBars.color': '颜色',

  /* ------------------------------------------------ 算法生成器（algos/*） */

  /* 所有 realtime 生成器共用的「内部分辨率」档位（algos/shader-lib.ts 的 intResParam） */
  'algo.intRes': '内部分辨率',
  'algo.intRes.240': '240p（最快）',
  'algo.intRes.480': '480p',
  'algo.intRes.720': '720p',

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

  /* ------------------------------------------------ 混合模式（core/schema + typography/document） */
  'blend.normal': '正常',
  'blend.multiply': '正片叠底',
  'blend.add': '线性加深',
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
