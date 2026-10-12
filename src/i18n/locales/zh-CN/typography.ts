/**
 * typography.ts — 排版编辑器：舞台、图层面板、选择框、自定义 CSS 弹窗、
 * 各动作的撤销标签、字体导入反馈、烘焙导出。
 *
 * 前缀：`typo.*`
 *
 * > Ribbon（工具栏）本身在 `ribbon.ts`，两者刻意分开：`typography.ts` 是
 * > **舞台与数据**的文案，`ribbon.ts` 是**按钮与选项卡**的文案。
 */

export const typography = {
  /* ------------------------------------------------ 文档模型的默认值 */
  /* 这几个是「新建元素时写进文档」的默认名/默认文字，会**持久化到工程里**。
     本地化它们是对的：Figma 也是这么做的，新建文本框叫什么取决于界面语言。
     注意它跟 `typo.defaultShapeName` 一起被 typography-doc 的单测覆盖着形态。 */
  'typo.defaultTextName': '文本',
  'typo.defaultText': '双击编辑文本',
  'typo.defaultShapeName': '形状',
  'typo.defaultImageName': '图片',

  /* ------------------------------------------------ 撤销标签（commit / 事务结算） */
  'typo.undo.textProp': '修改文本属性',
  'typo.undo.textAlign': '修改对齐',
  'typo.undo.vAlign': '修改垂直对齐',
  'typo.undo.fontStyle': '修改字形',
  'typo.undo.editText': '编辑文本',
  'typo.undo.spanStyle': '修改选中文字的格式',
  'typo.undo.clearFormat': '清除格式',
  'typo.clearFormat': '清除格式',
  'typo.localFontsLoaded': '已载入 {n} 个本机字体',
  'typo.localFontsDenied': '没有拿到字体访问权限（浏览器里可以重新授权）',
  'typo.localFontsUnsupported': '当前浏览器不支持读取本机字体（需要 Chrome / Edge 桌面版）',
  'typo.localFontsFailed': '读取本机字体失败：{msg}',
  'typo.nodeHint': '拖动顶点 · 双击线段加点 · 双击顶点删除 · Alt 拖手柄可断开对称',
  'typo.spanHint': '选中一段文字后，字体 / 字号 / 颜色只作用于那一段。',  'typo.undo.addText': '添加文本框',
  'typo.undo.addShape': '插入图形',
  'typo.undo.addImage': '插入图片',
  'typo.undo.addIcons': '插入图标',
  'typo.undo.registerImageAsset': '登记图片素材',
  'typo.undo.blend': '修改混合模式',
  'typo.undo.opacity': '修改不透明度',
  'typo.undo.lock': '切换锁定',
  'typo.undo.hide': '切换隐藏',
  'typo.undo.renameElement': '重命名元素',
  'typo.undo.renameGroup': '重命名组合',
  'typo.undo.duplicate': '复制元素',
  'typo.undo.duplicateDrag': '拖曳复制',  'typo.undo.delete': '删除元素',
  'typo.undo.move': '移动元素',
  'typo.undo.resize': '缩放元素',
  'typo.undo.rotate': '旋转元素',
  'typo.undo.frame': '修改元素几何',
  'typo.undo.order': '调整层级',
  'typo.undo.shapeFill': '修改填充',
  'typo.undo.shapeStroke': '修改描边',
  'typo.undo.strokeWidth': '修改描边宽度',
  'typo.undo.strokeStyle': '修改线型',
  'typo.undo.radius': '修改圆角',
  'typo.undo.shapeParam': '修改形状参数',
  'typo.undo.toPath': '转为路径',
  'typo.undo.addNode': '添加锚点',
  'typo.undo.deleteNode': '删除锚点',
  'typo.undo.editPath': '编辑路径',
  'typo.undo.shapeHandle': '调整图形参数',
  'typo.undo.boolean': '布尔运算',
  'typo.booleanEmpty': '运算结果为空，没有生成图形。',  'typo.undo.imageFit': '修改图片适配',
  'typo.undo.align': '对齐元素',
  'typo.undo.distribute': '分布元素',
  'typo.undo.addAnim': '添加动画',
  'typo.undo.clearAnim': '清除动画',
  'typo.undo.animTiming': '修改动画时序',
  'typo.undo.customAnim': '设置自定义动画',
  'typo.undo.flatten': '排版转为图片',

  /* ------------------------------------------------ 字体导入反馈 */
  'typo.fontsImported': '已导入 {ok} 个字体',
  'typo.fontsImportedPartial': '导入 {ok}/{total} 个字体（其余不是有效的字体文件）',

  /* ------------------------------------------------ 烘焙导出 */
  'typo.bakeFailed': '烘焙失败：浏览器没能把画布编码成 PNG',
  /* 烘焙出来的素材显示名。`flatten.png` 那类原始文件名是技术标识符，不进语言表。 */
  'typo.bakedName': '排版烘焙.png',

  /* ------------------------------------------------ 舞台（TypographyEditor） */
  /* 缺字体的横幅：字体名是数据，只有这句话要翻译；列表分隔符也随语言走。 */
  'typo.missingFonts': '字体「{fonts}」还没准备好，暂时用回落字体渲染。',
  'typo.fontListSeparator': '、',
  'typo.zoomOut': '缩小',
  'typo.zoomIn': '放大',
  'typo.zoomFit': '适配',
  'typo.zoom': '缩放',
  /* 画面尺寸读数。数字与 × 是格式，只有标题要翻译。 */
  'typo.canvasSize': '画面尺寸（文档像素）',
  /* 倍率本身（1.0x / 0.5x / 0.25x）是数值格式，不进语言表。 */
  'typo.previewScale': '预览画质 {scale}',
  'typo.rasterPreview': '光栅预览',

  /* ------------------------------------------------ 背景预览（半透明底图 + 局部播放） */
  'typo.bgToggle': '背景预览（把当前帧画面半透明垫在排版下方）',
  'typo.bgPlay': '播放排版预览',
  'typo.bgPause': '暂停排版预览',
  'typo.bgScrub': '排版预览进度',
  'typo.bgOpacity': '背景不透明度',

  /* ------------------------------------------------ 图层面板（LayersPanel） */
  'typo.layers': '图层',
  'typo.layerUp': '上移一层',
  'typo.layerDown': '下移一层',
  'typo.layerToggleVisible': '显示 / 隐藏',
  'typo.layerLock': '锁定',
  'typo.layerUnlock': '解锁',
  'typo.layersEmpty': '还没有元素。',
  'typo.panelDrag': '拖动调整面板宽度',
  /* 双击图层行名称 → 行内改名输入框的无障碍名。 */
  'typo.layerRename': '重命名',

  /* ------------------------------------------------ 元素属性面板（PropertiesPanel） */
  'typo.props': '元素属性',
  'typo.propsEmpty': '选中一个元素后，在这里编辑它的填充、描边、大小与位置。',
  /* 多选提示；{n} 是数字。 */
  'typo.propsMulti': '已选 {n} 个元素，改动作用于所有选中的元素。',
  /* 分节标题 */
  'typo.propTransform': '变换',
  'typo.propPos': '位置',
  'typo.propSize': '大小',
  'typo.propRotate': '旋转',
  'typo.propOpacity': '不透明度',
  'typo.propBlend': '混合模式',
  'typo.propFill': '填充',
  'typo.propFillKind': '填充方式',
  'typo.propTextBg': '文本框背景',
  'typo.propTextBorder': '文本框边框',
  'typo.propGlyphFill': '字形填充',
  'typo.propStroke': '描边',
  /* 填充类型 */
  'typo.propNone': '无',
  'typo.propFillSolid': '纯色',
  'typo.propFillLinear': '线性渐变',
  'typo.propFillRadial': '径向渐变',
  'typo.propFillTexture': '纹理',
  /* 字形填充的「无」不是无色，而是回到 style.color（纯色字形）。 */
  'typo.propFillFollow': '跟随文字色',
  /* 色标编辑器 */
  'typo.propStops': '色标',
  'typo.propStopAdd': '添加色标',
  'typo.propStopRemove': '删除色标',
  'typo.propStopPos': '色标位置',
  /* 纹理与渐变参数 */
  'typo.propAngle': '角度',
  'typo.propPattern': '图案',
  'typo.propTextureInk': '图案色',
  'typo.propTextureBg': '底色',
  'typo.propTextureScale': '周期',
  'typo.propTextureThickness': '线宽',
  'typo.propFillOpacity': '填充不透明度',
  /* 描边参数 */
  'typo.propStrokeColor': '描边颜色',
  'typo.propStrokeWidth': '描边宽度',
  'typo.propStrokeStyle': '线型',
  'typo.propStrokeNone': '无描边',
  'typo.propLineSolid': '实线',
  'typo.propLineDashed': '虚线',
  'typo.propLineDotted': '点线',

  /* ------------------------------------------------ 动画窗格（AnimationPanel） */
  'typo.animPane': '动画',
  'typo.animPlay': '播放',
  'typo.animPause': '暂停',
  'typo.animRewind': '回到片段起点',
  'typo.animPreview': '从头预览这段动画',
  'typo.animCount': '{n} 个元素',
  'typo.animEmpty': '还没有元素挂动画。选中元素后到「动画」选项卡挑一个预设试试。',
  'typo.anim.custom': '自定义',

  /* ------------------------------------------------ 右键菜单 */
  'typo.menu.copy': '复制',
  'typo.menu.cut': '剪切',
  'typo.menu.paste': '粘贴',
  'typo.menu.forward': '上移一层',
  'typo.menu.backward': '下移一层',
  'typo.menu.group': '组合',
  'typo.menu.ungroup': '解除组合',
  'typo.undo.paste': '粘贴元素',
  'typo.undo.group': '组合元素',
  'typo.undo.ungroup': '解除组合',
  'typo.undo.groupStyle': '修改组合样式',
  'typo.groupName': '组合',
  'typo.groupExpand': '展开组合',
  'typo.groupCollapse': '折叠组合',

  /* ------------------------------------------------ 图标选择器（IconPickerModal） */
  'typo.iconPickerSearch': '搜索图标…',
  'typo.iconPickerNone': '没有匹配的图标',
  /* 图标名只有英文 —— 搜中文必然为空，给一句指路而不是让用户以为坏了。 */
  'typo.iconPickerNoneHint': '图标名是英文（如 arrow、user、play），试试更短的关键词。',
  'typo.iconPickerHit': '共 {n} 个图标',
  'typo.iconPickerSelCount': '已选 {n} 个',
  'typo.iconPickerApply': '插入',
  'typo.iconPickerApplyN': '插入 {n} 个',

  /* ------------------------------------------------ 自定义 CSS 弹窗（CustomCssModal） */
  'typo.customCssTitle': '自定义动画（CSS @keyframes）',
  /*
   * 说明被 `@keyframes` / `from{…}to{…}` / `@import` / `position:fixed` 四个
   * 等宽代码块打断，没法整句存，所以按 app.projectHint* 那套约定拆成几段：
   * 技术标识符留在模板里，真正要翻译的只有这些连接词。
   */
  'typo.customCssHintA': '只填 ',
  'typo.customCssHintB': ' 的',
  'typo.customCssHintC': '体',
  'typo.customCssHintD': '，例如 ',
  'typo.customCssHintE': '。 ',
  'typo.customCssHintF': '顶层选择器、',
  'typo.customCssHintG': '、',
  'typo.customCssHintH': ' 都不会生效（会被剥掉）。',
  /* 多条动画（逗号分隔）写法的说明，同样被代码块打断。 */
  'typo.customCssMultiA': '要多条动画（同时或先后）时：先写一个或多个 ',
  'typo.customCssMultiB': ' 块，再写一行 ',
  'typo.customCssMultiC': '，多条用逗号分隔。名字可引用上面的块，也可用预设名（如 ',
  'typo.customCssMultiD': '）。',
  /* 代码样例里描述参数位置的占位词（技术标识符留在模板里）。 */
  'typo.customCssWordName': '名字',
  'typo.customCssWordDuration': '时长',
  'typo.customCssWordEasing': '缓动',
  'typo.customCssWordDelay': '延迟',
  'typo.customCssUnbalanced': '花括号未配平，请检查 CSS 语法。',
  'typo.customCssUnwritable': '这段 keyframes 无法写入，请检查语法。',
  'typo.customCssEmpty': '当前内容为空或非法。',
  'typo.customCssResult': '结果：',
  /* 解析失败的可读错误（对应 animation.ts 的 CustomCssError 每个编码）。 */
  'typo.customCssErrAtRule': '只支持关键帧规则，其它 @ 规则会被拒绝。',
  'typo.customCssErrSelector': '只允许关键帧块与动画声明，不接受选择器。',
  'typo.customCssErrBadName': '关键帧的名字不合法：只能用字母、数字、连字符、下划线，且不能以数字开头。',
  'typo.customCssErrMissingAnimation': '定义了关键帧却没说明用法：还需要补一行动画声明（形如「名字 时长 缓动 延迟 …」）。',
  'typo.customCssErrBadAnimation': '动画声明无法解析：每一条形如「名字 时长 缓动 延迟 次数 方向 填充」。',
  'typo.customCssErrUnknownName': '引用的动画名没有定义：请先用关键帧定义它，或改用预设名。',

  /* ------------------------------------------------ 选择框（SelectionLayer） */
  'typo.rotateHandle': '旋转（Shift 吸附 15°）',
} as const;
