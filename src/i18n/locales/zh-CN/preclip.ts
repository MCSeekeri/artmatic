/**
 * preclip.ts — 视频预剪辑弹窗：入点 / 出点、范围列表、插入。
 *
 * 前缀：`preclip.*`。
 *
 * 与 `pool.*` 分开：那个域是「媒体池条目」的界面，这里是**一个具体功能**的
 * 全套文案（含范围命名与快捷键提示）。放回 `pool.*` 会让那一份从 90 行涨到
 * 130 行，而找「预剪辑那句话在哪」时前缀帮不上忙。
 */

export const preclip = {
  'preclip.title': '预剪辑',
  'preclip.close': '关闭预剪辑',
  /* 顶栏右侧：工程帧率与素材总帧数。 */
  'preclip.meta': '{fps} fps · 共 {frames} 帧',
  'preclip.decodeFailed': '这个视频在本机解不出画面（容器或编码不支持）',

  /* ------------------------------------------------ 范围 */
  'preclip.rangeDefault': '范围 {n}',
  /* 右侧列表标题：范围数量。 */
  'preclip.ranges': '范围（{n}）',
  'preclip.rangeUntitled': '未命名范围',
  'preclip.in': '入点',
  'preclip.out': '出点',
  'preclip.frameUnit': '帧',
  'preclip.saveRange': '保存当前为范围',
  'preclip.updateRange': '更新「{name}」',
  'preclip.empty': '还没有保存的范围',
  'preclip.emptyHint': '打好入点 / 出点后点上面的「保存当前为范围」。',
  'preclip.rename': '重命名',
  'preclip.remove': '删除范围',
  'preclip.rangeName': '范围名称',
  'preclip.rangeAdded': '已保存范围「{name}」',
  'preclip.rangeUpdated': '已更新范围「{name}」',
  'preclip.rangeRemoved': '已删除范围「{name}」',
  'preclip.rangeMeta': '{frames} 帧 · {seconds}s',

  /* ------------------------------------------------ 底栏 */
  'preclip.insert': '插入时间线',
  'preclip.hint': 'I 入点 · O 出点 · ←/→ 逐帧 · 空格播放',
  /* 拖柄把范围拖成 0 帧时的兜底（至少保留 1 帧）。 */
  'preclip.minOneFrame': '范围至少要有 1 帧',
} as const;
