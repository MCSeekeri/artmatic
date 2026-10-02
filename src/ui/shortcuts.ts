/**
 * shortcuts.ts — 快捷键表的唯一真源。
 *
 * 三处消费同一份数据：侧栏的快捷键面板、底栏右侧的提示、各按钮 tooltip 的角标。
 * 分开写必然出现「面板里写 Ctrl+Z，实际上代码里拦的是别的组合」这类漂移。
 *
 * 用法约定：`keysKey` 是**给人看的写法**（'Ctrl+Shift+Z'，或 '拖动' 这种手势名），
 * 代码里判定的仍是 KeyboardEvent 的 key/code（App.svelte 与 typography/keys.ts）。
 * 目前不区分 macOS（本项目主平台是 Windows）。
 *
 * 两个字段都是 `MessageKey` 而不是 `string` —— 它们都是展示文案，
 * 直接写字面量会把语言冻结在模块加载那一刻（见 effects/types.ts 的注释）。
 */
import type { MessageKey } from '../i18n/locales';

export interface Shortcut {
  /** 展示用写法，例如 'Ctrl+Shift+Z' 或 '拖动'。 */
  keysKey: MessageKey;
  labelKey: MessageKey;
}

export interface ShortcutGroup {
  titleKey: MessageKey;
  items: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titleKey: 'sc.group.playback',
    items: [
      { keysKey: 'sc.key.space', labelKey: 'sc.playPause' },
      { keysKey: 'sc.key.rulerDrag', labelKey: 'sc.scrub' },
      { keysKey: 'sc.key.ctrlWheel', labelKey: 'sc.zoomAtCursor' },
      { keysKey: 'sc.key.wheel', labelKey: 'sc.scrollTimeline' },
    ],
  },
  {
    titleKey: 'sc.group.clip',
    items: [
      { keysKey: 'sc.key.drag', labelKey: 'sc.moveClip' },
      { keysKey: 'sc.key.dragEdge', labelKey: 'sc.resizeClip' },
      { keysKey: 'sc.key.dblClick', labelKey: 'sc.openClipEditor' },
      { keysKey: 'sc.key.s', labelKey: 'sc.splitAtPlayhead' },
      { keysKey: 'sc.key.altArrows', labelKey: 'sc.shiftTrack' },
      { keysKey: 'sc.key.delete', labelKey: 'sc.deleteClip' },
      { keysKey: 'sc.key.rightClick', labelKey: 'sc.newClipAtCursor' },
    ],
  },
  {
    titleKey: 'sc.group.typo',
    items: [
      { keysKey: 'sc.key.clickShiftClick', labelKey: 'sc.selectElement' },
      { keysKey: 'sc.key.dragEmpty', labelKey: 'sc.marquee' },
      { keysKey: 'sc.key.dragElement', labelKey: 'sc.moveElement' },
      { keysKey: 'sc.key.arrows', labelKey: 'sc.nudgeElement' },
      { keysKey: 'sc.key.ctrlA', labelKey: 'sc.selectAll' },
      { keysKey: 'sc.key.esc', labelKey: 'sc.deselect' },
      { keysKey: 'sc.key.space', labelKey: 'sc.playPauseAnim' },
    ],
  },
  {
    titleKey: 'sc.group.param',
    items: [
      { keysKey: 'sc.key.dragNumber', labelKey: 'sc.scrubValue' },
      { keysKey: 'sc.key.ctrlDrag', labelKey: 'sc.snapToStep' },
      { keysKey: 'sc.key.altDrag', labelKey: 'sc.fineTune' },
      { keysKey: 'sc.key.shiftDrag', labelKey: 'sc.coarseTune' },
      { keysKey: 'sc.key.esc', labelKey: 'sc.cancelDrag' },
      { keysKey: 'sc.key.upDown', labelKey: 'sc.stepValue' },
    ],
  },
  {
    titleKey: 'sc.group.project',
    items: [
      { keysKey: 'sc.key.ctrlS', labelKey: 'sc.saveProject' },
      { keysKey: 'sc.key.ctrlShiftS', labelKey: 'sc.saveAs' },
    ],
  },
  {
    titleKey: 'sc.group.general',
    items: [
      { keysKey: 'sc.key.ctrlZ', labelKey: 'sc.undo' },
      { keysKey: 'sc.key.ctrlShiftZ', labelKey: 'sc.redo' },
      { keysKey: 'sc.key.esc', labelKey: 'sc.closeOverlay' },
    ],
  },
];

/**
 * 扁平表，供需要按用途反查按键写法的场景（例如给按钮找它的快捷键角标）。
 *
 * 键是**文案键**而不是渲染后的文案：用渲染后的字符串当键的话，
 * `SHORTCUT_BY_LABEL['撤销']` 在切语言的那一刻就全部查不到了，
 * 而且失败是静默的（查不到就当没有快捷键）。
 */
export const SHORTCUT_BY_LABEL: Partial<Record<MessageKey, MessageKey>> = Object.fromEntries(
  SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => [i.labelKey, i.keysKey] as const)),
);
