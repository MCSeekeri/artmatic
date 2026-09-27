<script lang="ts">
  import { onMount } from 'svelte';
  import Transport from './Transport.svelte';
  import Preview from './Preview.svelte';
  import Inspector from './Inspector.svelte';
  import Timeline from '../timeline/Timeline.svelte';
  import logoSmall from '../assets/brand/logo-small-with-fonttype.svg';
  import { appState } from './app-state.svelte';

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      if (e.code === 'Space') {
        e.preventDefault();
        appState.togglePlay();
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="shell">
  <header>
    <img src={logoSmall} alt="Artmatic" height="22" />
    <Transport />
  </header>
  <main>
    <Preview />
    <aside>
      <Inspector />
    </aside>
  </main>
  <footer>
    <Timeline />
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
    padding: 6px 12px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--line);
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
    height: 240px;
    flex-shrink: 0;
    border-top: 1px solid var(--line);
    background: var(--bg-1);
  }
</style>
