<script lang="ts">
  import Transport from './Transport.svelte';
  import Preview from './Preview.svelte';
  import Inspector from './Inspector.svelte';
  import Timeline from '../timeline/Timeline.svelte';
  import logoSmall from '../assets/brand/logo-small-with-fonttype.svg';
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
