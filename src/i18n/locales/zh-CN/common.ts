/**
 * common.ts — 通用动作词与相对时间。
 *
 * 只放**真的通用**的词：同一句话在多个功能里出现，且改一次就该一起改。
 * 一旦某个域的用词需要独立演化（比如排版里的「删除」要改成「删除元素」），
 * 就把它挪回该域自己的文件，不要在这里加开关 —— 共享键变成带参数的
 * 万能键，是文案表腐化的开始。
 */

export const common = {
  'common.cancel': '取消',
  'common.save': '保存',
  'common.apply': '应用',
  'common.close': '关闭',
  'common.delete': '删除',
  'common.add': '添加',
  'common.rename': '重命名',
  'common.up': '上移',
  'common.down': '下移',
  'common.reset': '重置',
  /* 并列名词之间的分隔符（如检查器里「影响：V2、V3」）。**单独成键**是为了让
     换语言时能一起换掉 —— 在代码里拼 `join('、')` 就等于把中文标点写死了。 */
  'common.listSep': '、',

  /* 相对时间（Rail 的「最近工程」列表）。 */
  'common.justNow': '刚刚',
  'common.minutesAgo': '{n} 分钟前',
  'common.hoursAgo': '{n} 小时前',
  'common.daysAgo': '{n} 天前',
} as const;
