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
      editorState.commit('删除元素', (doc) => {
        doc.elements = doc.elements.filter((el) => !set.has(el.id) || el.locked);
      });
      editorState.clearSelection();
      return;
    }

    case e.key === 'Escape': {
      if (editorState.editingTextId) {
        editorState.editingTextId = null;
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
