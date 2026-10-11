/**
 * agent.ts — Agent 控制平面（`src/agent/`）的文案。前缀：`agent.*`
 *
 * ## 为什么这些消息要进语言表（而不是像开发诊断那样留在代码里）
 *
 * 它们的**出口是 agent，不是界面**：经 MCP / CDP 回到编码 agent，再由它转述给
 * 人。判断标准是「用户有没有可能看到它」—— 会看到，只是不经过 `ui/`。
 * `tests/unit/i18n.test.ts` 的硬编码文案守卫据此把它们算作**未抽取的文案**，
 * 这是对的：把它们塞进 `DEV_ONLY_ALLOWED` 就等于承认「用户可以读到的句子
 * 不必进语言表」，而那条口子一旦开了，下一个真实的前端文案就会从那里溜过去。
 *
 * ## 措辞纪律
 *
 * 每条消息都在回答「agent 下一步该做什么」，而不只是「哪里错了」：
 * 「找不到生成器 X」后面跟着的 `detail.validIds` 才是真正的答案。所以这里的
 * 句子一律短、一律带具体值、**不写「请检查」这类没有信息量的话**。
 * 会拼字符串的地方一律用 `{名字}` 占位符（与 errors.ts 同一条纪律）。
 */

export const agent = {
  /* ------------------------------------------------ 上下文 / 运行期实例 */
  'agent.ctx.noProject': '当前没有打开的工程',
  'agent.ctx.notReady': '渲染服务还没装配好（预览 canvas 尚未挂载）',

  /* ------------------------------------------------------------ 片段 */
  'agent.clip.notFound': '找不到片段 {id}',
  'agent.clip.notSource': '片段 {id} 是 {kind}，没有画面来源',
  'agent.clip.notEffect': '片段 {id} 是 {kind}，没有特效链',
  'agent.clip.inputNotObject': '片段参数必须是对象',
  'agent.clip.badKind': 'kind 必须是 {kinds}',
  'agent.clip.needGenerator': 'algo 源必须给 generator',
  'agent.clip.needAsset': '{kind} 源必须给 assetId',
  'agent.clip.needDoc': 'text 源必须给 doc',
  'agent.clip.unknownSource': '未知的源类型 {kind}',
  'agent.clip.badSpanFinite': 'start / end 必须是有限数字（秒）',
  'agent.clip.badSpanStart': '片段起点不能为负',
  'agent.clip.badSpanOrder': '片段终点必须大于起点',
  'agent.clip.noSourceParams': '{type} 源没有可调参数',

  /* ------------------------------------------------------------ 轨道 */
  'agent.track.notFound': '找不到轨道 {id}',
  'agent.track.badKind': 'kind 只能是 visual / audio',
  'agent.track.badIndex': '轨道下标越界（0..{max}）',
  'agent.track.audioOnlyAudio': '音频轨只装 audio 片段；画面片段请用视觉轨',
  'agent.track.cannotHost': '轨道 {id} 装不下 {kind} 片段',

  /* ------------------------------------------- 注册表里没有这个 id */
  'agent.gen.notFound': '没有生成器 {id}',
  'agent.fx.notFound': '没有特效 {id}',
  'agent.tr.notFound': '没有转场 {id}',
  'agent.asset.notFound': '素材 {id} 不在台账里',
  'agent.asset.none': '(空)',
  /* 下面三条是给 `checkScalars` / `checkKnownKeys` 的 `what` 参数用的
     （「生成器 X 里没有这些参数：…」那句话的前半截）。 */
  'agent.what.generator': '生成器 {id}',
  'agent.what.effect': '特效 {id}',
  'agent.what.solid': 'solid 源',

  /* ------------------------------------------------------- 参数校验 */
  'agent.args.notObject': '{what} 必须是对象',
  'agent.args.notFinite': '{what}.{key} 不是有限数字',
  'agent.args.notScalar': '{what}.{key} 必须是数字或字符串',
  'agent.args.unknownKeys': '{what} 里没有这些参数：{keys}',
  'agent.args.seconds': '{what} 必须是秒',
  'agent.args.emptyPatch': '{what} 不能为空',
  'agent.args.notWritable': '不可写的字段：{keys}',
  'agent.args.blend': '未知混合模式 {value}',
  'agent.args.fit': '未知 fit {value}',
  'agent.args.opacity': 'opacity 必须是数字',
  'agent.args.fade': 'fadeSec 不能为负',
  'agent.args.transform': 'transform 必须是对象',
  'agent.args.edge': "edge 只能是 'start' / 'end'",
  'agent.args.resolution': 'resolution 必须是 { w, h }',
  'agent.args.overlap': '未知重叠策略 {value}',
  'agent.args.chainIndex': 'chainIndex {index} 越界（0..{max}）',
  'agent.args.effectIndex': '特效下标越界（0..{max}）',

  /* ------------------------------------------------------------ 落点 */
  'agent.place.conflict': '落点被重叠策略（{behavior}）拒绝',
  'agent.place.addFailed': '轨道 {id} 上放不下这个片段',
  'agent.place.addEffectFailed': '轨道 {id} 上放不下这个特效片段',
  'agent.place.splitOutside': '切点 {at}s 落在片段之外',

  /* ------------------------------------------------------------ 转场 */
  'agent.transition.host': '片段 {id} 上放不了转场（只支持视觉轨的 source 片段）',
  'agent.transition.cut': '剪切点放不下转场：{reason}',

  /* ------------------------------------------------------------ 曲线 */
  'agent.curve.notCurvable': '片段 {id} 上 {param} 不是可打关键帧的参数',
  'agent.curve.shape': 'curves.{param} 必须是 { keys: [ ... ] }',
  'agent.curve.mode': '未知曲线模式 {mode}',
  'agent.curve.key': 'curves.{param}.keys[{index}] 需要有限的 t / v',
  'agent.curve.interp': 'curves.{param}.keys[{index}].interp 非法',
  'agent.curve.order': 'keys 必须按 t 升序',

  /* -------------------------------------------------- 整体改写 / 事务 */
  'agent.scene.notObject': 'project 必须是对象',
  'agent.scene.invalid': '工程校验失败：{detail}',
  'agent.tx.open': '已经有一个 agent 事务开着',
  'agent.tx.none': '没有开着的事务',

  /* ------------------------------------------------------------ 看 */
  'agent.view.noFrame': '还没有渲染过任何一帧：先调 renderFrame(t)',
  'agent.view.no2d': '建不出 2D 上下文',
  'agent.view.pngFailed': 'PNG 编码失败',

  /* ------------------------------------------------------------ 导 */
  'agent.export.busy': '已经有一个导出在跑',
  'agent.export.badFormat': '未知格式 {format}',
  'agent.export.cancelled': '导出已取消',
  'agent.export.saveFailed': '保存没有完成（未绑定工程目录，或目录选择器不可用）',
} as const;
