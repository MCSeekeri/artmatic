/**
 * keys.ts — 排版编辑页的键盘分发。
 *
 * 与时间轴快捷键**分流**而不是共用：在 App.svelte 的全局 onKey 里，
 * 排版页激活时整段交给 handleTypographyKey，时间轴那套一行都不执行。
 * 这样切分（S）与移轨（Alt+↑↓）在排版页自然失效 —— 而不需要
 * 在时间轴的分支里到处加 `if (!editorOpen)`。
 *
 * 不去扩展 ui/focus.ts：排版页里的新控件全是原生 <button>、原生
 * <input type=color>，或已有的 NumberInput（自带 data-exempt）；
 * 文本编辑用 contenteditable（isExempt 已覆盖）。要变的只是「谁处理这些键」。
 */

import { appState } from '../app-state.svelte';
import { activeElementOwnsSpace } from '../focus';
import { editorState } from './editor-state.svelte';
import { createTypographyActions } from './actions';
import { tr } from '../../i18n/index.svelte';

/**
 * 剪贴板 / 复制这类动作与 Ribbon 按钮走**同一份实现**。
 * 在这里各写一遍会让「按钮复制得到、快捷键复制不到」这类差异悄悄出现。
 */
const actions = createTypographyActions();

export function handleTypographyKey(e: KeyboardEvent): void {
  const ids = editorState.selectedIds;

  switch (true) {
    case e.code === 'Space': {
      // 聚焦在按钮上时 Space 归按钮 —— 否则会「激活按钮 + 播放」双触发。
      if (activeElementOwnsSpace()) return;
      e.preventDefault();
      // 排版页也要能播放：CSS 动画就是靠 playT 驱动 seek 的。
      appState.togglePlay();
      return;
    }

    case e.key === 'Delete' || e.key === 'Backspace': {
      if (!ids.length) return;
      e.preventDefault();
      const set = new Set(ids);
      editorState.commit(tr('typo.undo.delete'), (doc) => {
        doc.elements = doc.elements.filter((el) => !set.has(el.id) || el.locked);
      });
      editorState.clearSelection();
      return;
    }

    case e.key === 'Escape': {
      /*
       * 格式刷 / 动画刷是最外层的模式：先收起刷子，**不动选择集** ——
       * 用户按 Esc 是「不刷了」，源元素还该是选中的（否则得重新选一次）。
       */
      if (editorState.painter) {
        editorState.painter = null;
        return;
      }
      if (editorState.editingTextId) {
        editorState.editingTextId = null;
        return;
      }
      // 顶点编辑态**先退出这一层**，而不是连选择集一起清掉：用户按 Escape
      // 十有八九是「这个点拖歪了，我要退出编辑」，把元素也取消选中会让他
      // 又得重新选一遍。与文本编辑的分层退出同理。
      if (editorState.nodeEditId) {
        editorState.nodeEditId = null;
        return;
      }
      editorState.clearSelection();
      return;
    }

    case e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'a': {
      e.preventDefault();
      editorState.selectAll();
      return;
    }

    /* 剪贴板。**只用编辑器内部剪贴板**，不调 navigator.clipboard ——
       那需要权限、在无头 E2E 里还不一定可用，而这套功能只在编辑器内部闭环。 */
    case e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c': {
      if (!ids.length) return;
      e.preventDefault();
      actions.copySelection();
      return;
    }

    case e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'x': {
      if (!ids.length) return;
      e.preventDefault();
      actions.cutSelection();
      return;
    }

    case e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'v': {
      if (!actions.hasClipboard()) return;
      e.preventDefault();
      actions.pasteClipboard();
      return;
    }

    case e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'd': {
      if (!ids.length) return;
      e.preventDefault();
      actions.duplicateSelection();
      return;
    }

    /* 组合 / 解组。Ctrl+Shift+G 是 PPT 的解组键位。 */
    case e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'g': {
      if (!actions.canGroup()) return;
      e.preventDefault();
      actions.groupSelection();
      return;
    }

    case e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'g': {
      if (!actions.canUngroup()) return;
      e.preventDefault();
      actions.ungroupSelection();
      return;
    }

    case e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z': {
      e.preventDefault();
      appState.store.undo();
      return;
    }

    case (e.ctrlKey && e.key.toLowerCase() === 'y') ||
      (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z'): {
      e.preventDefault();
      appState.store.redo();
      return;
    }

    case !e.ctrlKey && !e.altKey && e.key.startsWith('Arrow'): {
      if (!ids.length) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      editorState.nudge(dx, dy);
      return;
    }

    default:
      // S / Alt+↑↓ 落到这里 → 排版页里自然失效，这正是想要的。
      return;
  }
}

/**
 * **编辑文本时仍然生效**的快捷键（Ctrl+B / I / U / \）。
 *
 * 单独一个入口，因为它的调用点必须在 `isExempt` **之前** —— contenteditable
 * 命中了豁免（打字不能被全局键吃掉），而这几个键恰恰是「正在打字时才最想按」
 * 的。放进 `handleTypographyKey` 的话它们就只在没编辑时可用，用处正好反过来。
 *
 * 返回 true = 已消费。**只认这几个组合**，其余一律放行给编辑区自己
 * （退格、回车、方向键都在那边）。
 */
export function handleTypingFormatKey(e: KeyboardEvent): boolean {
  if (!editorState.editingTextId) return false;
  if (!e.ctrlKey || e.altKey) return false;

  // **动手之前先读一次 DOM 选区**：缓存可能落后于用户刚做的选择
  // （拖选之后既没松键也没松鼠标的情况不存在，但把权威来源钉在 DOM 上更省心）。
  textRangeRefresher?.();

  const k = e.key.toLowerCase();

  // Ctrl+\ ：清除格式。反斜杠在键盘上与「取消样式」的联想最直接。
  if (!e.shiftKey && e.key === '\\') {
    if (!actions.hasSpanRange()) return false;
    e.preventDefault();
    actions.clearSpanFormats();
    return true;
  }
  if (e.shiftKey) return false;

  const flag =
    k === 'b' ? ('bold' as const) : k === 'i' ? ('italic' as const) : k === 'u' ? ('underline' as const) : null;
  if (!flag) return false;
  // 没选中文字时不动：那时 Ctrl+B 的最小意外语义是「什么都没发生」，
  // 而不是「整块变粗」——后者用户会以为自己误触了什么。
  if (!actions.hasSpanRange()) return false;
  e.preventDefault();
  actions.toggleTextFlag(flag);
  return true;
}


/**
 * 行内选区的「按需刷新器」。由编辑器注册（它是唯一认识 DOM 的一侧）。
 *
 * 之所以要这个间接层：快捷键处理在 `keys.ts`，而「当前选了什么」只有编辑器
 * 能从 DOM 读出来。让 keys.ts 自己去 querySelector 会把 DOM 结构的知识
 * 复制一份到键位表里。
 */
let textRangeRefresher: (() => void) | null = null;

export function registerTextRangeRefresher(fn: (() => void) | null): void {
  textRangeRefresher = fn;
}
