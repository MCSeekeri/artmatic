/**
 * inspector.ts — 右侧检查器、关键帧控件、以及自研控件族里**自己产生**的文案
 * （滑杆读数、数字框步进提示、下拉空态…）。
 *
 * 前缀：`insp.*` / `ctl.*`
 */

export const inspector = {
  /* ------------------------------------------------ 检查器外壳 / 片段类型 */
  'insp.title': '检查器',
  'insp.clipKindSource': '画面片段',
  'insp.clipKindEffect': '特效片段',
  'insp.clipKindAudio': '音频片段',
  'insp.placeholderSelect': '选中一个片段查看属性。',
  'insp.placeholderRightClick': '空白处右键在鼠标位置新建片段。',

  /* ------------------------------------------------ 片段属性 */
  'insp.name': '名称',
  'insp.start': '起点',
  'insp.end': '终点',
  'insp.fade': '淡变',
  'insp.blend': '混合',
  'insp.fit': '适配',
  /* 「适配」的三个取值：目前直接显示英文枚举名，原样保留。 */
  'insp.fitContain': 'contain',
  'insp.fitCover': 'cover',
  'insp.fitStretch': 'stretch',
  'insp.srcIn': '源内偏移',
  'insp.color': '颜色',

  /* 变换与透明度（E2E 断言了「不透明度」子串，改字会挂）。 */
  'insp.opacity': '不透明度',
  'insp.posX': '位置 X',
  'insp.posY': '位置 Y',
  'insp.scaleX': '缩放 X',
  'insp.scaleY': '缩放 Y',
  'insp.rotate': '旋转',

  /* 来源说明：算法生成器 / 图片素材。 */
  'insp.algoGenerator': '算法生成器：{name}',
  'insp.imageAsset': '图片素材：{name}',
  /* 烘焙入参不可打关键帧：`{label}` 是参数名。 */
  'insp.bakedParamTip': '{label}（烘焙入参，不可打关键帧）',

  /* ------------------------------------------------ 特效链 */
  'insp.addEffect': '添加特效',
  'insp.removeEffect': '删除特效',
  'insp.reorderEffect': '调整特效顺序',
  'insp.editEffectParam': '修改特效参数',
  'insp.toggleEffect': '切换特效',
  'insp.effectEnableTip': '启用 / 禁用这个特效实例',
  'insp.emptyChain': '空链：从上面添加特效。特效只作用于它下方的轨道。',

  /* ------------------------------------------------ 片段动作 */
  'insp.editTypography': '编辑排版',
  'insp.splitAtPlayhead': '在播放头分割',

  /* ------------------------------------------------ 关键帧 / 曲线 */
  'insp.keyframe': '打关键帧',
  'insp.removeKeyframe': '删除关键帧',
  'insp.clearCurve': '清除曲线',
  'insp.toggleAnchor': '切换锚到拍',
  'insp.editParam': '修改参数',
  'insp.anchorBeat': '锚到拍',
  'insp.anchorTip': '锚到拍：改 BPM/offset 时卡点自动跟随',

  /* ------------------------------------------------ 撤销栈动作词（「重命名」用 common.rename） */
  'insp.changeStart': '改起点',
  'insp.changeEnd': '改终点',
  'insp.changeFade': '改淡变',
  'insp.changeBlend': '改混合模式',
  'insp.changeFit': '改适配',
  'insp.changeColor': '改颜色',
  'insp.changeSrcIn': '改 srcIn',

  /* ------------------------------------------------ 抽屉 */
  'insp.resizeWidth': '调整检查器宽度',
  'insp.collapseDrawer': '收起检查器',

  /* ------------------------------------------------ 关键帧控件自产文案（ctl.*） */
  'ctl.keyframeTipDelete': '删除播放头处的关键帧',
  'ctl.keyframeTipAdd': '在播放头处打关键帧',
  'ctl.keyframeTipCreate': '创建曲线并打第一个关键帧',
  'ctl.keyframeDeleteTip': '点击删除这个关键帧',
  'ctl.clearCurve': '删除整条曲线（回到固定基值）',
  /* 数字框的 aria-label：`{label}` 是参数名。 */
  'ctl.valueAria': '{label} 数值',
} as const;
