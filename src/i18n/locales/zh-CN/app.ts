/**
 * app.ts — 应用外壳：顶栏、底栏、窄侧栏、四个全屏面板（关于 / 快捷键 / 导出 /
 * 设置 / 工程）、主题与品牌色、确认框。
 *
 * 前缀：`app.*`
 */

export const app = {
  /* ------------------------------------------------ 品牌与「关于」 */
  'app.aboutArtmatic': '关于 Artmatic',
  'app.aboutLead': '把算法艺术与故障艺术按音乐结构编排起来的时间轴工具。',
  'app.version': '版本',
  'app.render': '渲染',
  'app.icons': '图标库',
  'app.compression': '压缩',
  /* 许可方括号用全角 —— 这本身就是排版约定，所以整串进语言文件。 */
  'app.licenseLucide': 'Lucide（ISC）',
  'app.licenseFflate': 'fflate（MIT）',

  /* ------------------------------------------------ 侧栏入口 */
  'app.shortcuts': '快捷键',
  'app.project': '工程',
  'app.projectPanelTip': '新建 / 打开 / 最近工程',
  'app.saveProject': '保存工程',
  'app.saveToCurrentDir': '保存到当前工程目录（Ctrl+S）',
  'app.savePickDir': '选择目录并保存（Ctrl+S）',
  'app.export': '导出',
  'app.settings': '设置',
  'app.toDark': '切到暗色',
  'app.toLight': '切到亮色',
  'app.openLab': '打开试炼场',
  'app.openLabTip': '试炼场：逐个审查特效 / 生成器 / 转场，定默认参数',

  /* ------------------------------------------------ 画幅与帧率（工程级设置） */
  'app.frameRate': '帧率',
  'app.fpsChangeHint': '改帧率会改变逐帧随机种子，带随机参数的生成器/特效画面会跟着变。',
  'app.custom': '自定义',
  'app.presetLandscape': '横屏 1080p',
  'app.preset720': '横屏 720p',
  'app.preset4k': '横屏 4K',
  'app.presetVertical': '竖屏 1080×1920',
  'app.presetSquare': '方形 1080',

  /* ------------------------------------------------ 预览浮动工具栏 */
  /* 这些档位只影响预览；导出永远是全帧全质，所以文案里不含「导出」。 */
  'app.previewFps': '帧率',
  'app.previewFpsFull': '全速',
  'app.previewFpsFraction': '1/{n} 帧率',
  'app.previewQuality': '画质',
  'app.previewRestore': '暂停回全质',
  'app.previewRestoreTip': '播放时用上面的档位，暂停时自动回到全质（停住时看到的必须是准的）',
  'app.previewOptions': '预览选项',
  'app.previewCollapse': '收起为悬浮球',

  /* ------------------------------------------------ 导出面板 */
  'app.exportFileName': '文件名',
  'app.duration': '时长',
  'app.framesSeconds': '{n} 帧（{sec} 秒）',
  'app.resolution': '分辨率',
  'app.exportMp4': 'MP4',
  'app.exportMp4Hint': 'H.264 + AAC · 约 {size}',
  'app.exportMp4Unsupported': '本机浏览器不支持 WebCodecs，只能导出 PNG 序列。',
  'app.exportPng': 'PNG 序列',
  /* 「未压缩」是**上界**，不是预计值：PNG 的压缩率完全取决于画面内容。 */
  'app.exportPngHint': '未压缩约 {size}',
  'app.exportGif': 'GIF',
  /* GIF 独有的参数，只在导出面板出现；标签与「工程帧率」不是一回事。 */
  'app.gifFps': '帧率',
  'app.gifWidth': '宽度',
  'app.gifRange': '区间',
  /* 只有读屏用户听得到，但仍要抽：输入框里是两个没有上下文的光秃数字。 */
  'app.gifRangeStart': '开始',
  'app.gifRangeEnd': '结束',
  /* 抽帧后的实际帧数，紧跟区间输入框 —— 改区间时唯一的即时反馈。 */
  'app.gifFrames': '{n} 帧',
  /* 与 PNG 那条同一个口径：给的是索引数据的**未压缩**大小，不是预计体积 ——
     LZW 的压缩率同样完全取决于画面内容。 */
  'app.exportGifHint': '未压缩约 {size}',
  'app.exporting': '导出中 {pct}%',
  /*
   * 拖动播放头时画面会比播放头**早**（见 app-state 的 syncSimBudget）——
   * 模拟是主线程同步的，向前跳必须真把中间每一步算完。追上之前给个明确提示，
   * 否则用户会以为预览坏了。
   */
  'app.simCatchUp': '模拟追赶中',

  /* ------------------------------------------------ 工程面板 */
  'app.name': '名称',
  'app.location': '位置',
  'app.status': '状态',
  'app.assets': '素材',
  'app.dirConnected': '已连接磁盘目录',
  'app.dirNotChosen': '尚未选择',
  'app.savedAgo': '已保存 · {ago}',
  'app.notSavedYet': '尚未保存',
  'app.assetCount': '{n} 个 · {size}',
  'app.assetCountShort': '{n} 素材',
  'app.assetAudit': '素材检查',
  'app.actions': '动作',
  'app.newBlank': '新建空白',
  'app.loadDemo': '载入演示',
  'app.openProjectEllipsis': '打开工程…',
  'app.saveAsEllipsis': '另存为…',
  'app.recentProjects': '最近的工程',
  /*
   * 工程目录说明被三个 <code> 元素打断，所以拆成四段。
   * 这是 i18n 里的固有麻烦：句子中间嵌了标记就没法整句存。
   * 这里的取舍是**保视觉**（文件名走等宽样式）而不是保整句 ——
   * 文件名本身是技术标识符，不进语言文件，真正要翻译的只有这四段连接词。
   */
  'app.projectHintA': '工程是一个磁盘目录：',
  'app.projectHintB': ' 是内容，',
  'app.projectHintC': ' 是素材台账，素材字节在 ',
  'app.projectHintD': '。整个目录可以直接拷走。',

  /* ------------------------------------------------ 设置面板 */
  'app.settingsNavProject': '当前工程',
  'app.settingsNavAppearance': '外观',
  'app.settingsNavHabits': '操作习惯',
  'app.settingsNavEditor': '编辑器行为',
  'app.applySettings': '保存并应用',
  'app.changedMark': '本次已更改',
  'app.renameProject': '重命名工程',

  /* —— 当前工程 —— */
  'app.basic': '基础',
  'app.projectName': '工程名称',
  'app.customResolution': '自定义分辨率…',
  'app.width': '宽',
  'app.height': '高',
  'app.customFps': '自定义帧率…',
  /* 改分辨率不会缩放已有排版 —— 这是唯一会让人"改完吓一跳"的后果，所以要说明。 */
  'app.resolutionWarn': '改变分辨率不会缩放已有的排版：画布尺寸变了，文本框的位置与换行会跟着变。',
  'app.music': '音乐',
  'app.bpm': 'BPM',
  'app.offset': '偏移',
  'app.beatsPerBar': '每小节的拍数',
  'app.beatsPerBarHint': '拍网格的计量方式。改 BPM / 偏移前先确认它。',

  /* —— 外观 —— */
  'app.fontScale': '字号',
  'app.fontScaleSmall': '小',
  'app.fontScaleNormal': '标准',
  'app.fontScaleLarge': '大',
  'app.fontScaleXLarge': '特大',
  'app.accentColor': '主题色',
  'app.customAccent': '自定义主题色',
  'app.mode': '模式',
  'app.light': '亮色',
  'app.dark': '暗色',
  /* 彩蛋。文案刻意只说「是什么」，不说「怎么玩」—— 捏一下的乐趣在于自己发现。 */
  'app.mascot': '看板娘',
  'app.mascotEnable': '启用',
  'app.mascotTip': '在左下角放一只可以捏的看板娘。捏太急她会坏掉。',
  'app.mascotPoke': '捏一下',

  /* —— 操作习惯 —— */
  'app.shortcutScheme': '快捷键方案',
  'app.shortcutSplit': '切分片段',
  'app.shortcutSchemeHint': '各方案之间只有「切分片段」的按键不同，其余按键完全一致。',

  /* —— 编辑器行为 —— */
  'app.overlapBehavior': '片段重叠行为',
  'app.overlapBehaviorTip': '把片段拖到同轨邻居身上时怎么办。',
  'app.keyframes': '关键帧',
  'app.beatAnchorNew': '新关键帧默认锚到拍',
  'app.beatAnchorTip': '锚到拍：改 BPM / offset 时卡点自动跟随',
  'app.inspector': '检查器',

  /* ------------------------------------------------ 顶栏与关闭确认 */
  'app.openProjects': '打开的工程',
  'app.unsavedChanges': '有未保存改动',
  'app.backToTimeline': '回到时间轴',
  'app.closeProjectTab': '关闭 {name}',
  'app.newProject': '新建工程',
  'app.newProjectTip': '新建工程',
  'app.discardTitle': '放弃未保存的改动？',
  'app.discardMessage': '「{name}」有未保存的改动，放弃改动会丢失工作内容。',
  'app.discardConfirm': '放弃改动并关闭',
  'app.back': '返回',
  'app.projectGone': '这份工程已经不在了',

  /* ------------------------------------------------ 空界面（一份工程都没开） */
  /* 只有一句「从哪开始」。空界面上不该有第二句解释 —— 能做的事就三件。 */
  'app.emptyLead': '新建一份工程，或打开磁盘上已有的工程目录。',
  'app.emptyImport': '导入工程',
  'app.emptyRecentEmpty': '还没有打开过工程。',

  /* ------------------------------------------------ 底栏 */
  'app.hoverHint': '悬停任意控件获取说明',
  'app.fpsTip': '预览帧率',

  /* ------------------------------------------------ 快捷键冲突提示（App.svelte） */
  'app.noTrackFits': '上下都没有能装下这个片段的轨道了',
  'app.targetOccupied': '目标轨没有多余空间',

  /* ------------------------------------------------ 品牌色预置名 */
  /* 只在设置面板的色块 aria-label 与「当前品牌」文字里出现。 */
  'app.accentViolet': '紫',
  'app.accentCyan': '青',
  'app.accentLime': '黄绿',
  'app.accentAmber': '琥珀',
} as const;
