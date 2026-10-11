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

  /* 影响深度（`EffectClip.affectDepth`）。语义见 engine/stack.ts 的文件头。 */
  'insp.affectDepth': '影响深度',
  'insp.affectDepthTip':
    '只作用于下方最近的 N 条启用轨道；0 = 下方全部。作用域内的画面先独立合成、再由特效处理，所以它看不到作用域之外的轨道。',
  'insp.affectDepthAll': '影响下方所有轨道。',
  'insp.affectDepthTracks': '影响：{names}',
  'insp.affectDepthEmpty': '下方没有启用的视觉轨，这个特效作用在空画面上。',

  /* ------------------------------------------------ 特效选择器 */
  'insp.pickerSearch': '搜索特效……',
  'insp.pickerViewGrid': '缩略图（大）',
  'insp.pickerViewList': '列表（小）',
  'insp.pickerViewGridTip': '切换到网格视图：大缩略图',
  'insp.pickerViewListTip': '切换到列表视图：小缩略图 + 标签',
  'insp.pickerFilter': '条件筛选',
  'insp.pickerFilterCat': '分类',
  'insp.pickerFilterTag': '标签',
  'insp.pickerClearFilters': '清除条件',
  'insp.pickerSort': '排序',
  'insp.pickerSortDefault': '默认顺序',
  'insp.pickerSortName': '名称',
  'insp.pickerSortCategory': '分类',
  'insp.pickerSelected': '已选',
  'insp.pickerSelCount': '已选 {n} 个',
  'insp.pickerApply': '保存并应用',
  'insp.pickerApplyN': '保存并应用（{n}）',
  'insp.pickerApplyTip': '按选择顺序追加到特效链末尾',
  'insp.pickerNone': '没有符合条件的特效。',
  'insp.pickerNoneHint': '少勾几个条件，或换个搜索词。',
  'insp.pickerHitCount': '{n} 个特效',

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
  'insp.changeAffectDepth': '改影响深度',

  /* ------------------------------------------------ 转场（出画） */
  /* 转场的**参数名不翻译**：`pixelSize` / `blocksize` 那些逐字来自 gl-transitions
     的第三方作者，是 GLSL uniform 的名字 —— 翻译之后就对着上游文档找不到那一行。
     **中文名与说明在 `transitions.ts`（`tns.*`）**，不在这里：那是每一条转场一条
     的成批数据，和本文件的「界面文案」不是一类东西。 */
  'insp.transition': '转场（出画）',
  'insp.transitionNone': '无',
  'insp.transitionDuration': '时长',
  'insp.transitionPick': '选择转场',
  'insp.setTransition': '设置转场',
  'insp.changeTransitionDuration': '改转场时长',
  'insp.editTransitionParam': '修改转场参数',
  'insp.transitionNoNext': '这条轨道后面没有片段，转场无处可去。',
  'insp.transitionNextNotSource': '下一个片段是特效片段，没有画面可以作为「入画」内容。',
  'insp.transitionNotAdjacent': '与下一个片段之间有缝隙。转场需要两个片段紧邻；把片段拖到贴合即可生效。',
  'insp.transitionTooShort': '两侧片段太短，放不下转场。',
  'insp.transitionClamped': '时长超过两侧片段能容纳的上限，实际按 {max}s 生效。',
  'insp.transitionFadeTip': '这个片段同时设了淡变，窗口内会叠加成二次淡出，通常只需要其中一种。',
  'insp.transitionInactive': '当前未生效',
  'insp.transitionChange': '更换转场',
  'insp.transitionClear': '清除转场',

  /* 转场选择器：转场数量过百之后，一个下拉既不能搜、也看不见每条转场把两张图切成了
     什么样。缩略图是「两张底图 @ 50% 进度」的定格（`gen-transition-thumbs.mjs`）。 */
  'insp.transitionPickerSearch': '搜索转场（名称或作者）……',
  'insp.transitionPickerApply': '应用',
  'insp.transitionPickerNone': '无转场',
  'insp.transitionPickerNoneHint': '清除这个片段上的出画转场',
  'insp.transitionPickerSelected': '当前选择：{name}',
  'insp.transitionPickerHit': '{n} 条转场',
  'insp.transitionPickerEmpty': '没有符合条件的转场。',
  'insp.transitionPickerEmptyHint': '换个搜索词，或按作者查。',
  'insp.transitionPickerSortName': '名称',
  'insp.transitionPickerSortAuthor': '作者',
  /* 按上游 id 排 —— 知道 gl-transitions 命名的人用它对齐文档。 */
  'insp.transitionPickerSortId': '上游 id',

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
