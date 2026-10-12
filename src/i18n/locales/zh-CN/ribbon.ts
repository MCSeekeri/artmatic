/**
 * ribbon.ts — 排版编辑器的 Ribbon（选项卡 / 分组 / 按钮 / 下拉选项）。
 *
 * 前缀：`rib.*`
 *
 * 这里条目最多（原 `ribbon-defs.ts` 一个文件就有 100 处），因为它是一张
 * 数据驱动的表：每个按钮的 label / tip 都从这张表取。
 *
 * > 形状名 / 动画预设名 / 混合模式名**不在这里** —— 它们在 `media.ts`
 * > （`shape.*` / `anim.*` / `blend.*`），由数据表里的 `labelKey` 指过来。
 */

export const ribbon = {
  /* ------------------------------------------------ 选项卡 */
  'rib.home': '开始',
  'rib.insert': '插入',
  'rib.anim': '动画',
  'rib.view': '视图',
  'rib.shapeFormat': '图形格式',
  'rib.imageFormat': '图片格式',

  /* ------------------------------------------------ 分组标题 */
  'rib.group.font': '字体',
  'rib.group.para': '段落',
  'rib.group.alignTextH': '水平对齐',
  'rib.group.alignTextV': '垂直对齐',
  'rib.group.text': '文本',
  'rib.group.icons': '图标',
  'rib.group.align': '对齐',
  'rib.group.order': '层级',
  'rib.group.edit': '编辑',
  'rib.group.shapes': '图形',
  'rib.group.media': '图片',
  'rib.group.presets': '预设',
  'rib.group.timing': '时序',
  'rib.group.fill': '填充',
  'rib.group.stroke': '描边',
  'rib.group.shape': '形状',
  'rib.group.effects': '艺术效果',
  'rib.group.imageStyle': '图片样式',

  /* ------------------------------------------------ 视图 */
  'rib.group.grid': '网格',
  'rib.group.gridLines': '参考线',
  'rib.gridShow': '显示网格',
  'rib.gridSnap': '吸附网格',
  'rib.gridUnit': '网格单位',
  'rib.gridPx': '像素',
  'rib.gridPercent': '画幅 %',
  'rib.gridSize': '间距',
  'rib.gridVertical': '竖线',
  'rib.gridHorizontal': '横线',
  'rib.canvasFrame': '画幅线框',

  /* ------------------------------------------------ 图形格式 → 形状参数 */
  'rib.sides': '边数',
  'rib.starWaist': '锐利度',
  'rib.borderWidth': '壁厚',
  'rib.pieAngle': '张角',
  'rib.nodeEdit': '编辑顶点',
  'rib.group.nodes': '顶点',
  'rib.toPath': '转为路径',

  /* ------------------------------------------------ 图形格式 → 布尔运算 */
  'rib.group.boolean': '布尔运算',
  'rib.boolUnion': '并集',
  'rib.boolSubtract': '差集',
  'rib.boolIntersect': '交集',
  'rib.boolXor': '异或',

  /* ------------------------------------------------ 图形格式 → 填充 */
  'rib.fillKind': '填充类型',
  'rib.fillNoneShort': '无填充',
  'rib.fillSolid': '纯色',
  'rib.fillLinear': '线性渐变',
  'rib.fillRadial': '径向渐变',
  'rib.fillTexture': '纹理',
  'rib.gradientFrom': '起始色',
  'rib.gradientTo': '结束色',
  'rib.gradientAngle': '渐变角度',
  'rib.textureInk': '纹理色',
  'rib.textureBg': '底色',
  'rib.texturePattern': '图案',
  'rib.textureScale': '周期',
  'rib.textureThickness': '线宽',
  'rib.group.textFill': '文字填充',
  'rib.textFillFollow': '跟随文字色',

  /* ------------------------------------------------ [Contextual] 组合格式 */
  'rib.groupFormat': '组合格式',
  'rib.group.groupBox': '组合外框',
  'rib.groupBackdrop': '背景',
  'rib.groupBorder': '边框色',
  'rib.groupBorderWidth': '边框宽度',
  'rib.groupRadius': '外框圆角',
  'rib.groupPadding': '内边距',
  'rib.groupAction': '组合',
  'rib.ungroup': '解除组合',
  /* ------------------------------------------------ 开始 → 字体 */
  'rib.fontFamily': '字体',
  'rib.fontSearch': '搜索字体',
  'rib.fontSize': '字号',
  'rib.fontSizeDown': '减小字号',
  'rib.fontSizeUp': '增大字号',
  'rib.bold': '加粗',
  'rib.italic': '斜体',
  'rib.underline': '下划线',
  'rib.strike': '删除线',
  'rib.loadLocalFonts': '本机字体',
  'rib.importFont': '导入字体',

  /* ------------------------------------------------ 开始 → 段落 */
  'rib.letterSpacing': '字距',
  'rib.lineHeight': '行高',
  'rib.alignHLeft': '左',
  'rib.alignHCenter': '中',
  'rib.alignHRight': '右',
  'rib.alignHJustify': '两端',
  'rib.alignVTop': '顶',
  'rib.alignVMiddle': '中',
  'rib.alignVBottom': '底',

  /* ------------------------------------------------ 开始 → 文本颜色 */
  'rib.color': '颜色',

  /* ------------------------------------------------ 开始 → 对齐 */
  'rib.alignTo': '对齐到',
  'rib.alignTargetCanvas': '画布',
  'rib.alignTargetSelection': '选区',
  'rib.alignLeft': '左对齐',
  'rib.centerH': '水平居中',
  'rib.alignRight': '右对齐',
  'rib.alignTop': '顶对齐',
  'rib.centerV': '垂直居中',
  'rib.alignBottom': '底对齐',
  'rib.distributeH': '横向分布',
  'rib.distributeV': '纵向分布',

  /* ------------------------------------------------ 开始 → 层级 */
  /* 「上移 / 下移」用 common.up / common.down。 */
  'rib.toFront': '置顶',
  'rib.toBack': '置底',

  /* ------------------------------------------------ 开始 → 编辑 */
  /* 「删除」用 common.delete。 */
  'rib.addText': '文本框',
  'rib.duplicate': '复制',
  'rib.lock': '锁定',
  'rib.hide': '隐藏',

  /* ------------------------------------------------ 插入 */
  'rib.shape': '形状',
  'rib.pickShape': '选择形状…',
  'rib.addImage': '插入图片',
  'rib.addIcon': '插入图标',

  /* ------------------------------------------------ 动画 → 预设 */
  'rib.pickAnim': '选择预设…',
  'rib.clearAnim': '清除动画',

  /* ------------------------------------------------ 动画 → 时序 */
  'rib.animDelay': '延迟',
  'rib.animDuration': '时长',
  'rib.animIterations': '次数',
  'rib.iter1': '1 次',
  'rib.iter2': '2 次',
  'rib.iter3': '3 次',
  'rib.iter5': '5 次',
  'rib.iterLoop': '循环',
  'rib.animEasing': '缓动',
  'rib.easingLinear': '匀速',
  'rib.easingEase': '默认',
  'rib.easingEaseIn': '渐快',
  'rib.easingEaseOut': '渐慢',
  'rib.easingEaseInOut': '两端缓',
  'rib.animDirection': '方向',
  'rib.dirNormal': '正向',
  'rib.dirReverse': '反向',
  'rib.dirAlternate': '往复',
  'rib.dirAlternateReverse': '往复（反）',
  'rib.animFill': '填充',
  'rib.fillNone': '不保留',
  'rib.fillForwards': '保留终态',
  'rib.fillBackwards': '保留初态',
  'rib.fillBoth': '两端都保留',

  /* ------------------------------------------------ 动画 → 编辑 */
  'rib.customCss': '自定义 CSS',
  'rib.flatten': '转为图片',

  /* ------------------------------------------------ 图形格式 */
  'rib.shapeFill': '填充',
  'rib.strokeColor': '描边色',
  'rib.strokeWidth': '线宽',
  'rib.strokeStyle': '线型',
  'rib.lineSolid': '实线',
  'rib.lineDashed': '虚线',
  'rib.lineDotted': '点线',
  'rib.radius': '圆角',
  'rib.blend': '混合模式',
  'rib.opacity': '不透明度',

  /* ------------------------------------------------ 图片格式 */
  'rib.imageFit': '适配',
  'rib.fitFill': '拉伸',
  'rib.fitContain': '完整显示',
  'rib.fitCover': '铺满裁切',
  'rib.fitNone': '原始尺寸',

  /* ------------------------------------------------ Ribbon 容器 */
  'rib.ariaTools': '排版工具',
} as const;
