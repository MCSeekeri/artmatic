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
  'app.icons': '图标',
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

  /* ------------------------------------------------ 导出面板 */
  'app.range': '范围',
  'app.frames': '{n} 帧',
  'app.resolution': '分辨率',
  'app.frameRate': '帧率',
  'app.exportHint':
    '导出是确定性逐帧渲染：与预览走同一条求值路径，差别只在分辨率。帧数 = 工程时长 × 帧率，时长可在轨道上方的工具条里改。',
  'app.exportMp4': '导出 MP4（约 {size}）',
  'app.exportMp4Hint':
    'H.264 + AAC，含工程里的音频轨。{size} 是按码率估的，画面越复杂实际越大。',
  'app.exportMp4Unsupported': '本机浏览器不支持 WebCodecs（`VideoEncoder` 不存在），只能导出 PNG 序列。',
  'app.exportPng': '导出 PNG 序列（.zip）',
  'app.exportPngHint':
    'PNG 序列体积大得多，但它是逃生舱：任何浏览器都能出，而且逐帧交给达芬奇 / Cavalry 精修本身是正当用途。',
  'app.exporting': '导出中 {pct}%',

  /* ------------------------------------------------ 工程面板 */
  'app.name': '名称',
  'app.location': '位置',
  'app.status': '状态',
  'app.assets': '素材',
  'app.dirConnected': '已连接磁盘目录',
  'app.dirNotChosen': '尚未选择（首次保存时会问）',
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
  'app.accentColor': '主题色',
  'app.accentHint': '主题色只用在「选中 / 激活 / 焦点 / 播放头」这几处，其余一律中性灰。',
  'app.customAccent': '自定义主题色',
  'app.mode': '模式',
  'app.modeCurrent': '当前：{mode}',
  'app.light': '亮色',
  'app.dark': '暗色',
  'app.keyframes': '关键帧',
  'app.beatAnchorNew': '新关键帧默认锚到拍',
  'app.beatAnchorTip': '锚到拍：改 BPM / offset 时卡点自动跟随',
  'app.inspector': '检查器',
  'app.drawerWidth': '宽度 {px}px',
  'app.resetDefault': '重置为默认',
  'app.resetTheme': '恢复默认主题',

  /* ------------------------------------------------ 顶栏与关闭确认 */
  'app.openProjects': '打开的工程',
  'app.unsavedChanges': '有未保存改动',
  'app.backToTimeline': '回到时间轴',
  'app.closeProjectTab': '关闭 {name}',
  'app.newProject': '新建工程',
  'app.newProjectTip': '新建工程（在同一页里再开一份）',
  'app.discardTitle': '放弃未保存的改动？',
  'app.discardMessage': '「{name}」有未保存的改动。关闭之后这些改动就找不回来了。',
  'app.discardConfirm': '放弃改动并关闭',
  'app.back': '返回',
  'app.projectGone': '这份工程已经不在了',

  /* ------------------------------------------------ 底栏 */
  'app.hoverHint': '悬停任意控件看说明',
  'app.fpsTip': '预览帧率（仅统计，不参与渲染求值）',

  /* ------------------------------------------------ 快捷键冲突提示（App.svelte） */
  'app.noTrackFits': '上下都没有能装下这个片段的轨道了',
  'app.targetOccupied': '目标轨该位置已被占据——换成「挤开邻居 / 吃掉重叠」策略，或先挪开邻居',

  /* ------------------------------------------------ 品牌色预置名 */
  /* 只在设置面板的色块 aria-label 与「当前品牌」文字里出现。 */
  'app.accentViolet': '紫',
  'app.accentCyan': '青',
  'app.accentLime': '黄绿',
  'app.accentAmber': '琥珀',
} as const;
