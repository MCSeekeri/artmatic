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
  'typo.undo.addText': '添加文本框',
  'typo.undo.addShape': '插入图形',
  'typo.undo.addImage': '插入图片',
  'typo.undo.registerImageAsset': '登记图片素材',
  'typo.undo.blend': '修改混合模式',
  'typo.undo.opacity': '修改不透明度',
  'typo.undo.lock': '切换锁定',
  'typo.undo.hide': '切换隐藏',
  'typo.undo.duplicate': '复制元素',
  'typo.undo.delete': '删除元素',
  'typo.undo.move': '移动元素',
  'typo.undo.resize': '缩放元素',
  'typo.undo.rotate': '旋转元素',
  'typo.undo.order': '调整层级',
  'typo.undo.shapeFill': '修改填充',
  'typo.undo.shapeStroke': '修改描边',
  'typo.undo.strokeWidth': '修改描边宽度',
  'typo.undo.strokeStyle': '修改线型',
  'typo.undo.radius': '修改圆角',
  'typo.undo.imageFit': '修改图片适配',
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
  'typo.missingFonts': '字体「{fonts}」未就绪，正在用回落字体；导出结果也会用回落字体。',
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

  /* ------------------------------------------------ 图层面板（LayersPanel） */
  'typo.layers': '图层',
  'typo.layerUp': '上移一层',
  'typo.layerDown': '下移一层',
  'typo.layerToggleVisible': '显示 / 隐藏',
  'typo.layerLock': '锁定',
  'typo.layerUnlock': '解锁',
  'typo.layersEmpty': '还没有元素。',

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
  'typo.customCssUnbalanced': '花括号未配平，请检查 CSS 语法。',
  'typo.customCssUnwritable': '这段 keyframes 无法写入，请检查语法。',
  'typo.customCssEmpty': '当前内容为空或非法。',
  'typo.customCssResult': '结果：',

  /* ------------------------------------------------ 选择框（SelectionLayer） */
  'typo.rotateHandle': '旋转（Shift 吸附 15°）',
} as const;
