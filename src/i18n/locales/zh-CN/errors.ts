/**
 * errors.ts — 会**呈现在界面上**的错误与降级提示。
 *
 * 前缀：`err.*`
 *
 * 判定标准只有一条：**用户有没有可能看到它**。看得到的进这里，看不到的
 * （`console.warn` 的开发诊断、断言式的内部不变量）**不进**——那些是给
 * 写代码的人看的，本地化只会让 grep 变难。
 *
 * 例：`特效 echo 缺少 glsl/echo.ts（两个文件纪律）` 是启动期的开发错误，
 * 不本地化；而 `打开失败：…` 会出现在底栏，必须本地化。
 *
 * 这些消息里**带着具体数值**（路径、字节数、版本号），所以大多是
 * 带占位符的模板。带占位符的统一用 `{名字}`，不要用模板字符串拼接 ——
 * 拼接会让「一句话」被拆成两半存进语言文件，翻译时无法重排语序。
 */

export const errors = {
  /* ------------------------------------------------ 工程校验（core/schema.ts） */
  /* 这些消息会被 project-actions 拼进底栏的「打开失败：…」，所以用户看得到。
     单测用正则断言了其中的关键词（/fps/、/轨道类型/、/音频轨/…），
     改文案时那几条会先失败——那不是测试过时，是提醒你它确实是对外契约。 */
  'err.schema.notObject': '不是对象',
  'err.schema.missingVersion': '缺少 schemaVersion',
  'err.schema.missingName': '缺少 name',
  'err.schema.badFps': 'fps 非法',
  'err.schema.badResolution': 'resolution 非法',
  'err.schema.badDuration': 'duration 非法',
  'err.schema.badBeatGrid': 'beatGrid 非法',
  'err.schema.badSeed': 'seed 非法',
  'err.schema.badOverlap': 'overlapBehavior 非法',
  'err.schema.badAssets': 'assets 非法',
  'err.schema.badTracks': 'tracks 非法',
  'err.schema.versionTooNew': '工程版本 {found} 高于本应用支持的 {supported}，请升级应用',
  'err.schema.missingMigration': '缺少从版本 {version} 的迁移函数',
  'err.schema.unknownTrackKind': '未知轨道类型 {kind}',
  'err.schema.trackMissingClips': '轨道缺少 clips',
  'err.schema.clipMissingId': '片段缺少 id',
  'err.schema.clipBadSpan': '片段 {id} 时间区间非法',
  'err.schema.clipBadFade': '片段 {id} fadeSec 非法',
  'err.schema.clipBadCurves': '片段 {id} curves 非法',
  'err.schema.audioTrackHasNonAudio': '音频轨里有非音频片段',
  'err.schema.visualTrackHasNonVisual': '视觉轨里有非视觉片段',
  'err.schema.effectClipMissingChain': '特效片段 {id} 缺少 chain',
  'err.schema.typographyBadDoc': '排版片段 {id} 的 doc 非法',
  'err.schema.typographyBadSize': '排版片段 {id} 的文档尺寸非法',
  'err.schema.transitionBadDefId': '片段 {id} 的转场缺少 defId',
  'err.schema.transitionBadDuration': '片段 {id} 的转场时长非法',
  'err.schema.transitionBadValues': '片段 {id} 的转场参数非法',

  /* ------------------------------------------------ 工程读写（project/io.ts） */
  /* 这些会经「打开失败：…」/「保存失败：…」进底栏，或进 SaveReport 的警告。 */
  'err.io.notAProject': '「{name}」不是一个 Artmatic 工程目录',
  'err.io.badJson': '{file} 不是合法 JSON：{detail}',
  'err.io.pathConflict': '素材文件名冲突，已中止保存：{detail}',
  'err.io.assetBytesMissing': '素材 {name}（{id}）在内存里没有字节，跳过写入',
  'err.io.removeFailed': '删除旧素材失败：{path}。这不影响您继续编辑工程。',
  'err.io.ledgerRebuilt': 'assets.json 缺失或不完整，已从 assets/ 目录重建台账',
  'err.io.untrackedFile': 'assets/{name} 不在工程的素材表里，已标为未跟踪',
  'err.io.openFailed': '打开失败：{detail}',
  'err.io.saveFailed': '保存失败：{detail}',

  /* ------------------------------------------------ 原子写（project/fs.ts） */
  'err.fs.backupFailed': '备份失败（继续保存）：{detail}',
  'err.fs.writeMismatch': '写入后校验失败：{name} 期望 {want} 字节，磁盘上是 {got}',
  'err.fs.writeCorrupt': '写入后校验失败：{name} 内容与预期不一致',
  'err.fs.dirNoIterator': '目录句柄不支持遍历（既没有 values() 也没有 entries()）',
  'err.fs.noDirPicker': '此浏览器不支持选择本地目录（需要 Chrome / Edge）',

  /* ------------------------------------------------ 素材台账（project/ledger.ts） */
  /* 前四条来自 parseLedger 的警告，后五条是 auditLedger 的 issue.message，
     会直接渲染在 Rail 的「素材检查」里。 */
  'err.ledger.badJson': 'assets.json 不是合法 JSON，已按空台账处理（将从 assets/ 重建）',
  'err.ledger.notObject': 'assets.json 不是对象，已按空台账处理',
  'err.ledger.versionTooNew': 'assets.json 的 layoutVersion {found} 高于本应用支持的 {supported}',
  'err.ledger.badEntry': 'assets.json 里的 {id} 形状不对，已忽略',
  'err.ledger.missing': '素材文件不在：{path}',
  'err.ledger.changed': '文件可能被替换过，{path} 的内容与工程记录不一致',
  'err.ledger.sizeChanged': '{path} 的大小是 {to} 字节，而非预期的 {from} 字节',
  'err.ledger.unhashed': '{path} 没有可用的哈希值',
  'err.ledger.untracked': 'assets/ 里有存在未被记录的文件：{path}',

  /* ------------------------------------------------ 导出（ui/export.ts、exporters/） */
  /* sink 抛出的错会经 `flash('导出失败：' + msg)` 进底栏，所以这些也要抽。 */
  'err.export.noWebCodecs': '本机浏览器不支持 WebCodecs，请改用 PNG 序列导出',
  'err.export.silentAudio': '音轨混流结果是静音，本次只导出画面',
  'err.export.mp4Done': '已导出 MP4 ，共 {size}',
  'err.export.failed': '导出失败：{detail}',
  'err.export.sinkCodec': 'Mp4Sink 只支持 {want}，收到 {got}',
  'err.export.sinkNoCanvas': 'Mp4Sink.configure 需要真实 canvas（见 frame-sink 的 FrameSinkConfigureOptions）',
  'err.export.canvasSizeMismatch':
    'canvas 尺寸 {cw}×{ch} 与声明的 {dw}×{dh} 不一致（是不是忘了先 renderer.setExportSize？）',
  'err.export.pngBlobNull': 'canvas.toBlob 返回 null',
  'err.export.notConfigured': 'configure 还没调用',
  'err.export.noBuffer': 'mediabunny 没有产出 buffer',
  'err.export.gifDone': '已导出 GIF，共 {size}',
  'err.export.gifSinkCodec': 'GifSink 只支持 {want}，收到 {got}',
  'err.export.gifNo2d': 'GIF 编码需要一张 2D 暂存 canvas，getContext("2d") 返回了 null',
  /* gifenc 是惰性写头的：一帧都没写就 finish，得到的是只有 trailer 的 1 字节文件。
     那种「成功」的空下载比报错更难排查，所以在这里挡死。 */
  'err.export.gifEmpty': 'GIF 一帧都没有写出（工程时长为 0，或抽帧步长不合理）',

  /* ------------------------------------------------ 视频素材 */
  /* 进底栏的 flash。容器认得、轨里没视频、或者编码本机解不动，都归这条 ——
     对用户来说下一步动作是同一个：换一个文件。 */
  'err.video.unreadable': '「{name}」不是能读的视频文件（容器或编码不支持）',

  /* ------------------------------------------------ 平台能力 */  
  'err.platform.openDirUnsupported': '这个浏览器不支持打开本地目录（需要 Chrome / Edge）',
  'err.platform.saveDirUnsupported': '这个浏览器不支持保存到本地目录（需要 Chrome / Edge）',
  'err.platform.webgl2': '此浏览器没有 WebGL2',
} as const;
