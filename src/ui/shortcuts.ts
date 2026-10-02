/**
 * shortcuts.ts — 快捷键表的唯一真源。
 *
 * 三处消费同一份数据：侧栏的快捷键面板、底栏右侧的提示、各按钮 tooltip 的角标。
 * 分开写必然出现「面板里写 Ctrl+Z，实际上代码里拦的是别的组合」这类漂移。
 *
 * 用法约定：`keys` 是给人看的写法，代码里判定的仍是 KeyboardEvent 的 key/code。
 * 目前不区分 macOS（本项目主平台是 Windows）。
 */

export interface Shortcut {
  /** 展示用写法，例如 'Ctrl+Shift+Z'。 */
  keys: string;
  label: string;
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '播放与时间',
    items: [
      { keys: 'Space', label: '播放 / 暂停' },
      { keys: '标尺拖动', label: 'scrub 播放头（吸附到当前档位）' },
      { keys: 'Ctrl+滚轮', label: '以鼠标为锚缩放时间轴' },
      { keys: '滚轮', label: '时间轴横向滚动' },
    ],
  },
  {
    title: '片段',
    items: [
      { keys: '拖动', label: '移动片段（可跨轨；松手时才套重叠策略）' },
      { keys: '拖边', label: '改变片段长度' },
      { keys: '双击片段', label: '打开片段编辑器（排版片段打开排版页）' },
      { keys: 'S', label: '在播放头处切分选中片段' },
      { keys: 'Alt+↑ / Alt+↓', label: '把选中片段上移 / 下移一轨' },
      { keys: 'Delete', label: '删除选中片段' },
      { keys: '右键', label: '在鼠标位置新建片段' },
    ],
  },
  {
    title: '排版编辑器',
    items: [
      { keys: '单击 / Shift+单击', label: '选中元素 / 加选' },
      { keys: '空白处拖动', label: '框选' },
      { keys: '拖动元素', label: '移动（自动吸附参考线；按住 Alt 临时关吸附）' },
      { keys: '方向键', label: '移动 1px（Shift ×10）' },
      { keys: 'Ctrl+A', label: '全选元素' },
      { keys: 'Esc', label: '取消选择' },
      { keys: 'Space', label: '播放 / 暂停（驱动 CSS 动画）' },
    ],
  },
  {
    title: '参数控件',
    items: [
      { keys: '拖动数字框', label: '连续改值' },
      { keys: 'Ctrl 拖动', label: '吸附到步长整数倍' },
      { keys: 'Alt 拖动', label: '精细（灵敏度 ×0.1）' },
      { keys: 'Shift 拖动', label: '粗调（灵敏度 ×10）' },
      { keys: 'Esc', label: '取消这次拖动，恢复原值' },
      { keys: '↑ / ↓', label: '按步长增减（Shift ×10）' },
    ],
  },
  {
    title: '工程',
    items: [
      { keys: 'Ctrl+S', label: '保存工程（没有位置时会先问目录）' },
      { keys: 'Ctrl+Shift+S', label: '另存为（选一个新目录）' },
    ],
  },
  {
    title: '通用',
    items: [
      { keys: 'Ctrl+Z', label: '撤销' },
      { keys: 'Ctrl+Shift+Z / Ctrl+Y', label: '重做' },
      { keys: 'Esc', label: '关闭当前弹层' },
    ],
  },
];

/** 扁平表，供需要按 keys 反查的场景（例如给按钮找它的快捷键角标）。 */
export const SHORTCUT_BY_LABEL: Record<string, string> = Object.fromEntries(
  SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => [i.label, i.keys])),
);
