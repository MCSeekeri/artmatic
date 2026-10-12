/**
 * timeline.ts — 时间轴：轨道工具条（播放 / 拍网格 / 时长 / 缩放 / 重叠策略）、
 * 轨道与片段的上下文菜单、片段自身的文案、导入音频、拖拽的撤销标签。
 *
 * 前缀：`tl.*`（轨道工具条另有 `tp.*` 一组，取自 Transport）
 */

export const timeline = {
  /* ------------------------------------------------ 轨道侧栏（Timeline.svelte） */
  'tl.sideTitle': '轨道',
  'tl.trackMenu': '轨道菜单',
  'tl.addTrack': '添加轨道',
  'tl.addVisualTrack': '视频',
  'tl.addAudioTrack': '音频',
  /* 轨道开关的四态提示（音频轨走静音，视觉轨走显隐）。 */
  'tl.muteAudioTrack': '静音这条音频轨',
  'tl.unmuteAudioTrack': '取消静音',
  'tl.hideTrack': '隐藏这条轨道',
  'tl.showTrack': '显示这条轨道',

  /* ------------------------------------------------ 菜单：新建片段 / 轨道操作 */
  'tl.addSolid': '纯色片段',
  'tl.addText': '排版片段',
  'tl.addEffect': '特效片段',
  'tl.addAlgo': '算法片段',
  /* 图片与视频同族：都是把一个本地文件变成一条 source 片段。 */
  'tl.importImageMenu': '导入图片…',
  'tl.importImage': '导入图片',
  'tl.importVideoMenu': '导入视频…',
  'tl.importVideo': '导入视频',
  'tl.setFps': '改帧率',
  'tl.renameTrack': '重命名轨道',
  'tl.removeTrack': '删除轨道',
  'tl.moveTrack': '调整轨道顺序',
  /* 导入音频：菜单项带省略号（要弹文件框），撤销标签不带。 */
  'tl.importAudio': '导入音频',
  'tl.importAudioMenu': '导入音频…',

  /* 新建出来的片段默认名。 */
  'tl.clipSolid': '纯色',
  'tl.clipText': '排版',
  'tl.clipEffect': '特效',

  /* ------------------------------------------------ 片段自身（ClipView.svelte） */
  'tl.fade': '淡入淡出',

  /* ------------------------------------------------ 拖拽的撤销标签（drag.ts） */
  'tl.moveClip': '移动片段',
  'tl.moveClips': '移动 {n} 个片段',
  'tl.resizeClip': '调整片段长度',

  /* ------------------------------------------------ 吸附档位名（core/time.ts 的 SNAP_MODES 表） */
  'tl.snapBar': '小节',
  'tl.snapBeat': '拍',
  'tl.snapHalf': '半拍',
  'tl.snapFree': '自由',

  /* ------------------------------------------------ 撤销标签（core/project-store.ts） */
  'tl.newTrack': '新建{kind}轨道',
  'tl.trackKindVisual': '视觉',
  'tl.trackKindAudio': '音频',
  'tl.enableTrack': '启用轨道',
  'tl.disableTrack': '禁用轨道',
  'tl.addClip': '新建片段',
  'tl.removeClip': '删除片段',
  'tl.removeClips': '删除 {n} 个片段',
  'tl.moveTrackUp': '上移一轨',
  'tl.moveTrackDown': '下移一轨',
  'tl.setDuration': '修改时长',
  'tl.fitDuration': '时长贴合内容',
  'tl.setResolution': '修改分辨率',
  'tl.splitClip': '切分片段',
  'tl.setOverlapBehavior': '切换重叠策略',
  'tl.setBeatGrid': '修改拍网格',
  'tl.loadProject': '载入工程',

  /* ------------------------------------------------ 演示工程（core/demo-project.ts） */
  'tl.demoProjectName': 'Artmatic Demo',
  'tl.demoAudioAsset': '演示节拍 120 BPM',
  'tl.demoClipBeats': '演示节拍',
  /* 轨名：V6 → V1 自上而下 = 前景 → 背景，A1 是唯一的音频轨。 */
  'tl.demoTrackV6': 'V6 全局调色',
  'tl.demoTrackV5': 'V5 标题排版',
  'tl.demoTrackV4': 'V4 故障链',
  'tl.demoTrackV3': 'V3 叠层',
  'tl.demoTrackV2': 'V2 主视觉',
  'tl.demoTrackV1': 'V1 复平面底图',
  'tl.demoTrackA1': 'A1 音乐',
  /* 片段名：写成「生成器 / 特效链 + 一眼能对上画面的描述」，不写片汤话。 */
  'tl.demoClipGrade': '调色 · 暗角 · 颗粒',
  'tl.demoClipTitle': '标题排版',
  'tl.demoClipGlitch': '切片 · 通道错位 · 扫描线 · 拖尾',
  'tl.demoClipBifurcation': 'Logistic 分岔图生长',
  'tl.demoClipFlow': '音频反应墨线',
  'tl.demoClipStrands': '音频反应丝弦',
  'tl.demoClipAnt': '兰顿蚂蚁',
  'tl.demoClipSand': '阿贝尔沙堆',
  'tl.demoClipMandelbrot': 'Mandelbrot 推近',

  /* ------------------------------------------------ 轨道工具条（Transport.svelte） */
  'tp.play': '播放',
  'tp.pause': '暂停',
  'tp.stop': '停止',
  'tp.timeTip': '工程时间 / 小节.拍',
  'tp.bpmTip': 'BPM',
  'tp.offsetTip': 'offset：第 0 拍的秒数',
  /* 自动估计拍网格。算法移植自 angel-echo 的 analyze_audio.py（谱通量 + 自相关）。 */
  'tp.estimate': '自动估计',
  'tp.estimateTip': '从工程里的音频估计 BPM 与 offset（谱通量 + 自相关）',
  'tp.estimateBusy': '估计中…',
  'tp.estimateOk': '估计完成：{bpm} BPM，offset {offset}s',
  'tp.estimateNoAudio': '还没有导入音频，无法估计',
  'tp.estimateSilent': '这段音频几乎是静音，估不出拍点',
  'tp.estimateFailed': '估计失败：这段音频里找不到稳定的节拍',
  'tp.beatsPerBar': '拍/小节',
  'tp.beatsPerBarTip': '每小节拍数',
  'tp.snap': '吸附',
  'tp.snapTip': '吸附档位',
  'tp.duration': '时长',
  'tp.projectDuration': '工程时长',
  'tp.durationTip':
    '工程时长（秒）：决定导出帧数范围。与素材长度无关，可以随便改；片段被拖出末尾时会自动把工程撑长',
  'tp.fitDuration': '时长收到内容末尾',
  'tp.overlap': '重叠',
  'tp.overlapTip': '同轨重叠策略',
  'tp.overlapReject': '拒绝落点',
  'tp.overlapPush': '挤开邻居',
  'tp.overlapTrim': '吃掉重叠',
  'tp.zoom': '时间轴缩放',
  'tp.zoomTip': '时间轴缩放（也可 Ctrl+滚轮，以鼠标为锚）',
  /* 当前帧截图：逐帧操作，所以放轨道工具条（§6.7）。文件名是「工程名-frame-帧号.png」。 */
  'tp.snapshot': '导出当前帧',
  'tp.snapshotTip': '把当前预览帧按工程分辨率导出为 PNG（文件名带帧号）',
  'tp.snapshotSaved': '已导出第 {frame} 帧',
  'tp.snapshotFailed': '导出当前帧失败',
} as const;
