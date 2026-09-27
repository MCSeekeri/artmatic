<script lang="ts">
  import { onMount } from 'svelte';
  import Transport from './Transport.svelte';
  import Preview from './Preview.svelte';
  import Inspector from './Inspector.svelte';
  import Brand from './Brand.svelte';
  import Timeline from '../timeline/Timeline.svelte';
  import { appState } from './app-state.svelte';

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      if (e.code === 'Space') {
        e.preventDefault();
        appState.togglePlay();
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && appState.selectedClipId) {
        // alt-up / alt-down：抬一轨 / 降一轨（剪辑软件的通用手势）
        e.preventDefault();
        const r = appState.store.shiftClipTrack(appState.selectedClipId, e.key === 'ArrowUp' ? -1 : 1);
        if (r === 'no-track') appState.flash('上下都没有能装下这个片段的轨道了');
        else if (r === 'blocked') appState.flash('目标轨该位置已被占据——换成「挤开邻居 / 吃掉重叠」策略，或先挪开邻居');
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && appState.selectedClipId) {
        appState.store.removeClip(appState.selectedClipId);
        appState.selectedClipId = null;
      } else if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        appState.store.undo();
      } else if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && (e.key === 'Z' || e.key === 'z'))) {
        e.preventDefault();
        appState.store.redo();
      } else if (e.key === 's' && appState.selectedClipId) {
        const f = appState.store.findClip(appState.selectedClipId);
        if (f) appState.store.splitClipAt(f.track.id, f.clip.id, appState.playT);
      }
    };

    /**
     * 原生右键菜单全应用禁用（轨道区用自绘菜单，见 timeline/Timeline.svelte）。
     * 输入框例外：那里的复制/粘贴/拼写检查是系统能力，禁掉只会让人难受。
     */
    const onContextMenu = (e: MouseEvent): void => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      e.preventDefault();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  });
</script>

<div class="shell">
  <header>
    <Brand height={20} />
  </header>
  <main>
    <Preview />
    <aside>
      <Inspector />
    </aside>
  </main>
  <footer>
    <!-- 工具条放在轨道正上方：这些都是针对时间轴的操作，不该跑到窗口最顶上 -->
    <div class="toolbar">
      <Transport />
    </div>
    <div class="tracks">
      <Timeline />
    </div>
  </footer>
</div>

<style>
  .shell {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 4px 12px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
  }
  main {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  aside {
    width: 300px;
    flex-shrink: 0;
    background: var(--bg-1);
    border-left: 1px solid var(--line);
    overflow-y: auto;
  }
  footer {
    height: 320px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
    background: var(--bg-1);
    min-height: 0;
  }
  .toolbar {
    flex-shrink: 0;
    padding: 5px 10px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-2);
  }
  .tracks {
    flex: 1;
    min-height: 0;
  }
</style>
